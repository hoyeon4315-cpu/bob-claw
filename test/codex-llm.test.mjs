import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PURPOSE, callCodex, hashContent, estimateCostUsd } from "../src/llm/codex-client.mjs";
import { maskText, maskJson, buildContextPack } from "../src/llm/context-pack.mjs";
import { scanBanList, validateOutput } from "../src/llm/output-validator.mjs";
import { tallyDailyUsageUsd, isBudgetLocked, setBudgetLock, clearBudgetLock, budgetGate } from "../src/llm/codex-budget-lock.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "codex-test-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// --- codex-client ---
test("hashContent stable", () => {
  assert.equal(hashContent("abc"), hashContent("abc"));
  assert.notEqual(hashContent("abc"), hashContent("abcd"));
});

test("callCodex dryRun stub when key missing", async () => {
  await withTempDir(async (dir) => {
    process.env.CODEX_AUDIT_LOG = join(dir, "audit.jsonl");
    delete process.env.OPENAI_API_KEY_PATH;
    const r = await callCodex({ purpose: PURPOSE.TRIAGE, prompt: "hi" });
    assert.equal(r.ok, true);
    assert.equal(r.dryRun, true);
    assert.match(r.reason, /OPENAI_API_KEY_PATH/);
    assert.equal(r.audit.result, "dry_run");
    delete process.env.CODEX_AUDIT_LOG;
  });
});

test("callCodex respects budgetGate block", async () => {
  await withTempDir(async (dir) => {
    process.env.CODEX_AUDIT_LOG = join(dir, "audit.jsonl");
    const r = await callCodex({
      purpose: PURPOSE.TRIAGE,
      prompt: "x",
      budgetGate: async () => ({ ok: false, reason: "test_block" }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
    assert.equal(r.reason, "test_block");
    delete process.env.CODEX_AUDIT_LOG;
  });
});

test("callCodex throws on invalid purpose", async () => {
  await assert.rejects(callCodex({ purpose: "bogus", prompt: "x" }));
});

test("estimateCostUsd produces non-negative", () => {
  assert.ok(estimateCostUsd({ tokensIn: 1000, tokensOut: 1000, purpose: PURPOSE.TRIAGE }) > 0);
});

// --- context-pack masking (regression guards) ---
test("maskText hides BURNER_* env values", () => {
  process.env.BURNER_TEST_KEY = "supersecretXYZ987654";
  const masked = maskText("token=supersecretXYZ987654 used");
  delete process.env.BURNER_TEST_KEY;
  assert.ok(!masked.includes("supersecretXYZ987654"));
  assert.match(masked, /\[masked\]/);
});

test("maskText hides EVM addresses", () => {
  const t = maskText("send to 0x1234567890abcdef1234567890ABCDEF12345678 now");
  assert.ok(!t.includes("0x1234567890abcdef1234567890ABCDEF12345678"));
  assert.match(t, /<masked-evm:1>/);
});

test("maskText hides PRIVATE KEY blocks", () => {
  const block = "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----";
  const t = maskText(`pre ${block} post`);
  assert.ok(!t.includes("ABC"));
});

test("maskText hides URL key segments", () => {
  const t = maskText("call https://api.example.com/v1/abcdefghijklmnop12345/data");
  assert.match(t, /\[masked-key\]/);
});

test("maskJson recurses into objects/arrays", () => {
  process.env.OPENAI_API_KEY_TEST = "topsecretABCDEFGH987";
  const out = maskJson({ a: ["call topsecretABCDEFGH987 here"], b: { c: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" } });
  delete process.env.OPENAI_API_KEY_TEST;
  assert.ok(!JSON.stringify(out).includes("topsecretABCDEFGH987"));
  assert.ok(!JSON.stringify(out).includes("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"));
});

test("buildContextPack masks file excerpts and audit", () => {
  process.env.BURNER_X = "leakedKEY12345678";
  const pack = buildContextPack({
    purpose: "triage",
    fileExcerpts: [{ path: "src/x.mjs", content: "const k = leakedKEY12345678;" }],
    auditSlice: [{ secret: "leakedKEY12345678" }],
    positions: [{ wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" }],
  });
  delete process.env.BURNER_X;
  const text = JSON.stringify(pack);
  assert.ok(!text.includes("leakedKEY12345678"));
  assert.ok(!text.includes("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"));
});

// --- output-validator ---
test("scanBanList flags BURNER env reads", () => {
  const f = scanBanList({ files: [{ path: "x.mjs", content: "const k = process.env.BURNER_FOO;" }] });
  assert.ok(f.find((x) => x.ruleId === "burner_env_read"));
});

test("scanBanList flags audit log unlink", () => {
  const f = scanBanList({ files: [{ path: "x.mjs", content: "import { unlinkSync } from 'fs'; unlinkSync('logs/signer-audit.jsonl');" }] });
  assert.ok(f.find((x) => x.ruleId === "audit_log_unlink"));
});

test("scanBanList flags raw signer import", () => {
  const f = scanBanList({ files: [{ path: "x.mjs", content: "import { signRaw } from '../signer/raw-key';" }] });
  assert.ok(f.find((x) => x.ruleId === "raw_signer_import"));
});

test("validateOutput returns ok for clean valid JS", () => {
  const r = validateOutput({ files: [{ path: "tmp.mjs", content: "export const a = 1;" }] });
  assert.equal(r.ok, true);
});

test("validateOutput rejects on syntax error", () => {
  const r = validateOutput({ files: [{ path: "tmp.mjs", content: "export const = 1;" }] });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "node_check");
});

// --- budget-lock ---
test("tallyDailyUsageUsd sums today only", () => {
  withTempDir((dir) => {
    const path = join(dir, "codex-audit.jsonl");
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000 * 2).toISOString();
    writeFileSync(path, [
      JSON.stringify({ ts: yesterday, costUsd: 9 }),
      JSON.stringify({ ts: today, costUsd: 1.5 }),
      JSON.stringify({ ts: today, costUsd: 0.25 }),
    ].join("\n"));
    const total = tallyDailyUsageUsd({ auditPath: path });
    assert.equal(total, 1.75);
  });
});

test("setBudgetLock + isBudgetLocked + clear", () => {
  withTempDir((dir) => {
    const lockPath = join(dir, "lock.json");
    assert.equal(isBudgetLocked({ path: lockPath }), false);
    setBudgetLock({ reason: "test", capUsd: 5, usageUsd: 6, path: lockPath });
    assert.equal(isBudgetLocked({ path: lockPath }), true);
    clearBudgetLock({ reason: "test_clear", path: lockPath });
    // After clear we wrote a clearedAt sentinel — isBudgetLocked treats absence of activeUntilDate as unlocked
    assert.equal(isBudgetLocked({ path: lockPath }), false);
  });
});

test("budgetGate locks when usage >= cap", async () => {
  await withTempDir(async (dir) => {
    const auditPath = join(dir, "codex-audit.jsonl");
    const lockPath = join(dir, "lock.json");
    const today = new Date().toISOString();
    writeFileSync(auditPath, JSON.stringify({ ts: today, costUsd: 99 }) + "\n");
    process.env.CODEX_AUDIT_LOG = auditPath;
    process.env.CODEX_BUDGET_LOCK_PATH = lockPath;
    const r = await budgetGate({ capUsd: 5 });
    delete process.env.CODEX_AUDIT_LOG;
    delete process.env.CODEX_BUDGET_LOCK_PATH;
    assert.equal(r.ok, false);
    assert.equal(r.reason, "daily_cap_reached");
  });
});
