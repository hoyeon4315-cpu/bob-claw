import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runOnce } from "../src/executor/health/position-monitor-loop.mjs";
import { buildDailyReport } from "../src/cli/codex-daily-report.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "phase4-")); }

test("position-monitor runOnce writes actions and audit", async () => {
  const dir = tmp();
  try {
    const outPath = join(dir, "actions.json");
    const auditPath = join(dir, "audit.jsonl");
    const r = await runOnce({
      loadSnapshot: async () => ({ positions: [{ positionId: "p1", strategyId: "s1", healthFactor: 0.5 }] }),
      loadPolicies: async () => ({ s1: { minHealthFactor: 1.0 } }),
      outPath,
      auditPath,
    });
    assert.equal(r.actions.length, 1);
    assert.equal(r.actions[0].type, "exit");
    assert.ok(existsSync(outPath));
    assert.ok(existsSync(auditPath));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("position-monitor dryRun does not write files", async () => {
  const dir = tmp();
  try {
    const outPath = join(dir, "actions.json");
    const auditPath = join(dir, "audit.jsonl");
    const r = await runOnce({
      loadSnapshot: async () => ({ positions: [] }),
      loadPolicies: async () => ({}),
      outPath, auditPath, dryRun: true,
    });
    assert.equal(r.actions.length, 0);
    assert.equal(existsSync(outPath), false);
    assert.equal(existsSync(auditPath), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("daily-report uses LLM stub and writes output", async () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, "logs"));
    writeFileSync(join(dir, "logs/signer.jsonl"), JSON.stringify({ ts: new Date().toISOString(), x: 1 }) + "\n");
    const out = join(dir, "report.json");
    const r = await buildDailyReport({
      signerAuditPath: join(dir, "logs/signer.jsonl"),
      positionMonitorAuditPath: join(dir, "missing.jsonl"),
      triageQueuePath: join(dir, "missing.json"),
      paybackKpiPath: join(dir, "missing.json"),
      outPath: out,
      callLlm: async () => ({ ok: true, dryRun: true, reason: "stub", output: "ok" }),
    });
    assert.equal(r.auditEvents24h, 1);
    assert.equal(r.llm.dryRun, true);
    assert.ok(existsSync(out));
    const written = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(written.llm.summary, "ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
