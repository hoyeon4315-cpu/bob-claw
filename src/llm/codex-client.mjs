// Codex client. Env-indirected key, dryRun stub when key absent, audit log on every call.
//
// Env contract:
//   OPENAI_API_KEY_PATH   path to file containing the key (NEVER inline in env)
//   OPENAI_CODEX_MODEL_TRIAGE  default model id for triage (cheap)
//   OPENAI_CODEX_MODEL_CODER   default model id for coder (expensive)
//
// AGENTS.md compliance:
//   - Key value never enters logs / args / context. Only the path is referenced.
//   - Every call appends to logs/codex-audit.jsonl (append-only).
//   - When key/model unset and dryRun !== false, returns a stub WITHOUT
//     pretending success. The stub explicitly flags { dryRun: true, reason }.

import { spawnSync } from "node:child_process";
import { readFileSync, appendFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { maskJson } from "./context-pack.mjs";

const AUDIT_PATH = process.env.CODEX_AUDIT_LOG || "logs/codex-audit.jsonl";

export const PURPOSE = Object.freeze({
  TRIAGE: "triage",
  CODER: "coder",
  REPORT: "report",
});

function pickModel(purpose, override) {
  if (override) return override;
  if (purpose === PURPOSE.CODER) return process.env.OPENAI_CODEX_MODEL_CODER || null;
  if (purpose === PURPOSE.REPORT) return process.env.OPENAI_CODEX_MODEL_REPORT || process.env.OPENAI_CODEX_MODEL_TRIAGE || null;
  return process.env.OPENAI_CODEX_MODEL_TRIAGE || null;
}

function loadKey() {
  const path = process.env.OPENAI_API_KEY_PATH;
  if (!path) return { key: null, reason: "OPENAI_API_KEY_PATH not set" };
  try {
    const value = readFileSync(path, "utf8").trim();
    if (!value) return { key: null, reason: "key file empty" };
    return { key: value, reason: null };
  } catch (err) {
    return { key: null, reason: `cannot read key file: ${err.code || err.message}` };
  }
}

function authMode() {
  return (process.env.CODEX_AUTH_MODE || "api_key").trim().toLowerCase();
}

function buildCliPrompt({ purpose, prompt, context }) {
  const maskedContext = maskJson(context || null);
  const payload = {
    purpose,
    instructions: prompt,
    context: maskedContext,
    outputContract: purpose === PURPOSE.CODER
      ? "Return only JSON: {\"files\":[{\"path\":\"...\",\"content\":\"...\"}]}. Do not edit files."
      : "Return concise plain text. Do not edit files.",
  };
  return { text: JSON.stringify(payload, null, 2), maskedContext };
}

function callCodexCli({ purpose, model, prompt, context, inputHash, ts }) {
  const cli = process.env.CODEX_CLI_PATH || "codex";
  let dir = null;
  let outPath = null;
  const started = Date.now();
  let raw = "";
  let result = null;
  let maskedContext = null;
  try {
    dir = mkdtempSync(join(tmpdir(), "bob-claw-codex-cli-"));
    outPath = join(dir, "last-message.txt");
    const args = [
      "exec",
      "--ephemeral",
      "-s",
      "read-only",
      "-C",
      process.cwd(),
      "-o",
      outPath,
    ];
    if (model) args.push("-m", model);
    args.push("-");
    const cliPrompt = buildCliPrompt({ purpose, prompt, context });
    maskedContext = cliPrompt.maskedContext;
    result = spawnSync(cli, args, {
      input: cliPrompt.text,
      encoding: "utf8",
      timeout: Number(process.env.CODEX_CLI_TIMEOUT_MS || 300_000),
      maxBuffer: 1024 * 1024,
    });
    if (existsSync(outPath)) raw = readFileSync(outPath, "utf8").trim();
  } catch (err) {
    const rec = {
      ts,
      purpose,
      model: model || "codex-cli-default",
      result: "error",
      authMode: "cli",
      inputHash,
      context: maskedContext,
      outputHash: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      durationMs: Date.now() - started,
      error: err.message,
    };
    appendAudit(rec);
    return { ok: false, dryRun: false, error: rec.error, audit: rec };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  const durationMs = Date.now() - started;
  const ok = result.status === 0 && raw.length > 0;
  let output = raw;
  let files = null;
  if (purpose === PURPOSE.CODER && raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.files)) files = parsed.files;
      output = parsed;
    } catch {
      // Leave raw output for audit hash and caller diagnostics.
    }
  }
  const rec = {
    ts,
    purpose,
    model: model || "codex-cli-default",
    result: ok ? "ok" : "error",
    authMode: "cli",
    inputHash,
    context: maskedContext,
    outputHash: raw ? hashContent(raw) : null,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    durationMs,
    error: ok ? null : (result.error?.message || result.stderr?.trim().split("\n").slice(-1)[0] || `exit_${result.status}`),
  };
  appendAudit(rec);
  if (!ok) return { ok: false, dryRun: false, error: rec.error, audit: rec };
  return { ok: true, dryRun: false, output, files: files || undefined, audit: rec };
}

export function hashContent(content) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function appendAudit(record) {
  try {
    if (!existsSync(dirname(AUDIT_PATH))) mkdirSync(dirname(AUDIT_PATH), { recursive: true });
    appendFileSync(AUDIT_PATH, JSON.stringify(record) + "\n");
  } catch {
    // Audit failures must not crash callers; log to stderr without keys.
    process.stderr.write(`[codex-client] audit append failed for ${AUDIT_PATH}\n`);
  }
}

// budgetGate is injected so tests / runtime can plug in budget-lock semantics
// without coupling the client module to fs side-effects directly.
export async function callCodex({
  purpose,
  model,
  prompt,
  context,
  inputForHash,
  schema, // optional zod schema for output
  budgetGate,
  fetchImpl,
  dryRun,
} = {}) {
  if (!Object.values(PURPOSE).includes(purpose)) {
    throw new Error(`callCodex: invalid purpose "${purpose}"`);
  }
  const ts = new Date().toISOString();
  const inputHash = hashContent(inputForHash ?? prompt ?? "");

  if (typeof budgetGate === "function") {
    const allowed = await budgetGate({ purpose, ts });
    if (!allowed.ok) {
      const rec = { ts, purpose, model: null, result: "budget_blocked", inputHash, reason: allowed.reason || "budget_blocked", tokensIn: 0, tokensOut: 0, costUsd: 0 };
      appendAudit(rec);
      return { ok: false, dryRun: false, blocked: true, reason: rec.reason, audit: rec };
    }
  }

  const resolvedModel = pickModel(purpose, model);
  if (authMode() === "cli") {
    return callCodexCli({ purpose, model: resolvedModel, prompt, context, inputHash, ts });
  }

  const { key, reason: keyReason } = loadKey();

  const isDry = dryRun === true || (dryRun !== false && (!key || !resolvedModel));
  if (isDry) {
    const reason = keyReason || (!resolvedModel ? "no model configured" : "dryRun forced");
    const rec = { ts, purpose, model: resolvedModel, result: "dry_run", inputHash, outputHash: null, tokensIn: 0, tokensOut: 0, costUsd: 0, reason };
    appendAudit(rec);
    return { ok: true, dryRun: true, reason, output: null, audit: rec };
  }

  const fetcher = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetcher) {
    throw new Error("callCodex: no fetch implementation available");
  }

  const body = {
    model: resolvedModel,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  };
  let response;
  let parsed = null;
  let raw = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let result = "ok";
  let error = null;
  try {
    response = await fetcher("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    const json = await response.json();
    raw = json.choices?.[0]?.message?.content || "";
    tokensIn = json.usage?.prompt_tokens || 0;
    tokensOut = json.usage?.completion_tokens || 0;
    costUsd = estimateCostUsd({ purpose, tokensIn, tokensOut });
    if (schema && typeof schema.parse === "function") {
      parsed = schema.parse(JSON.parse(raw));
    } else {
      parsed = raw;
    }
  } catch (err) {
    result = "error";
    error = err.message;
  }
  const outputHash = raw ? hashContent(raw) : null;
  const rec = { ts, purpose, model: resolvedModel, result, inputHash, outputHash, tokensIn, tokensOut, costUsd, error };
  appendAudit(rec);
  if (result === "error") return { ok: false, dryRun: false, error, audit: rec };
  return { ok: true, dryRun: false, output: parsed, audit: rec };
}

const MODEL_PRICES_USD_PER_1K = {
  "gpt-5-codex": { in: 0.005, out: 0.015 },
  "gpt-5-codex-mini": { in: 0.001, out: 0.003 },
};

export function estimateCostUsd({ tokensIn = 0, tokensOut = 0, purpose }) {
  const model = process.env[purpose === PURPOSE.CODER ? "OPENAI_CODEX_MODEL_CODER" : "OPENAI_CODEX_MODEL_TRIAGE"];
  const price = (model && MODEL_PRICES_USD_PER_1K[model]) || MODEL_PRICES_USD_PER_1K["gpt-5-codex-mini"];
  return (tokensIn / 1000) * price.in + (tokensOut / 1000) * price.out;
}

export function _readAuditPathForTesting() {
  return resolve(AUDIT_PATH);
}
