// codex-scaffold-adapter CLI scaffold.
// Triggered when triage queue has needs_adapter items. Asks Codex coder for
// a new adapter following adapter-templates.mjs whitelist, runs output-validator,
// commits to codex/auto/<id> branch (manual push — never auto-merges).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { callCodex, PURPOSE } from "../llm/codex-client.mjs";
import { buildContextPack } from "../llm/context-pack.mjs";
import { getFamilyTemplate, validateScaffoldOutput } from "../llm/adapter-templates.mjs";
import { validateOutput } from "../llm/output-validator.mjs";

function readJsonOr(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

export async function scaffoldOne({
  queueItem,
  family = "vault_share",
  evidence = null,
  outDir = "data/codex-scaffolds",
  callLlm = callCodex,
  now = new Date(),
} = {}) {
  if (!queueItem || !queueItem.candidateId) throw new TypeError("queueItem.candidateId required");
  const tmpl = getFamilyTemplate(family);
  if (!tmpl) return { ok: false, reason: `unknown_family:${family}` };

  const ctx = buildContextPack({
    purpose: "coder",
    fileExcerpts: tmpl.referencePaths
      .filter((p) => existsSync(p))
      .map((p) => ({ path: p, content: readFileSync(p, "utf8").slice(0, 4000) })),
    auditSlice: evidence ? [{ evidence }] : [],
  });

  const llm = await callLlm({
    purpose: PURPOSE.CODER,
    prompt: `Scaffold a ${family} adapter for ${queueItem.candidateId}. Required exports: ${tmpl.requiredExports.join(", ")}. Stay inside whitelist paths only.`,
    context: ctx,
  });

  if (!llm.ok || llm.dryRun) {
    return { ok: false, candidateId: queueItem.candidateId, llm, reason: llm.reason || "llm_unavailable" };
  }
  const files = Array.isArray(llm.files) ? llm.files : [];

  const familyCheck = validateScaffoldOutput({ family, files });
  if (!familyCheck.ok) return { ok: false, candidateId: queueItem.candidateId, stage: "family_whitelist", ...familyCheck };

  const validation = validateOutput({ files });
  if (!validation.ok) return { ok: false, candidateId: queueItem.candidateId, stage: "output_validator", validation };

  const branch = `codex/auto/${queueItem.candidateId}`;
  const ts = new Date(now).toISOString();
  const recordPath = join(outDir, `${queueItem.candidateId}.json`);
  if (!existsSync(dirname(recordPath))) mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, JSON.stringify({ ts, branch, files: files.map((f) => f.path), evidence }, null, 2));
  return { ok: true, candidateId: queueItem.candidateId, branch, files: files.map((f) => f.path) };
}

export async function runScaffold({
  queuePath = "data/codex-triage/queue.json",
  outDir = "data/codex-scaffolds",
  callLlm = callCodex,
  family = "vault_share",
} = {}) {
  const queue = readJsonOr(queuePath, { items: [] });
  const targets = (queue.items || []).filter((i) => i.decision === "needs_adapter");
  const results = [];
  for (const item of targets) {
    results.push(await scaffoldOne({ queueItem: item, family, outDir, callLlm }));
  }
  return { count: results.length, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runScaffold().then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
    .catch((err) => { console.error(err); process.exitCode = 1; });
}
