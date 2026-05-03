import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateCandidate, filterCandidates, applyRegimeWeight, countRecentFamilyHits } from "../src/strategy/codex-candidate-filter.mjs";
import { getFamilyTemplate, isFamilyAllowedPath, validateScaffoldOutput, FAMILY_TEMPLATES } from "../src/llm/adapter-templates.mjs";
import { runTriage } from "../src/cli/codex-triage.mjs";
import { scaffoldOne } from "../src/cli/codex-scaffold-adapter.mjs";
import { tracePeriod } from "../src/cli/report-position-to-payback-trace.mjs";
import { buildUtilizationReport } from "../src/cli/report-codex-budget-utilization.mjs";
import { buildMonitorCoverage } from "../src/cli/report-position-monitor-coverage.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "phase35-")); }

// --- candidate-filter ---
test("evaluateCandidate rejects when tinyLivePerTxUsd missing", () => {
  const r = evaluateCandidate({ candidate: { family: "vault_share", protocolId: "x", routeCost: { estimatedUsd: 1 } } });
  assert.equal(r.decision, "reject");
  assert.ok(r.reasons.includes("tinyLivePerTxUsd_missing"));
});

test("evaluateCandidate rejects when route cost missing", () => {
  const r = evaluateCandidate({ candidate: { family: "vault_share", protocolId: "x", tinyLivePerTxUsd: 5 } });
  assert.equal(r.decision, "reject");
  assert.ok(r.reasons.includes("route_cost_missing"));
});

test("evaluateCandidate flags needs_adapter when binding missing", () => {
  const r = evaluateCandidate({
    candidate: { family: "vault_share", protocolId: "x", tinyLivePerTxUsd: 5, routeCost: { estimatedUsd: 1 } },
    bindingExists: false,
  });
  assert.equal(r.decision, "needs_adapter");
});

test("countRecentFamilyHits applies 30d window", () => {
  const now = new Date("2026-05-10T00:00:00Z");
  const history = [
    { family: "f", protocolId: "p", ts: new Date(now.getTime() - 5 * 86400e3).toISOString() },
    { family: "f", protocolId: "p", ts: new Date(now.getTime() - 40 * 86400e3).toISOString() },
  ];
  assert.equal(countRecentFamilyHits(history, "f", "p", now), 1);
});

test("applyRegimeWeight halves leverage in bull_peak", () => {
  assert.equal(applyRegimeWeight(1, "bull_peak", "lending_loop"), 0.5);
  assert.equal(applyRegimeWeight(1, "neutral", "lending_loop"), 1);
});

test("filterCandidates batches across set bindings", () => {
  const out = filterCandidates({
    candidates: [
      { candidateId: "a", bindingKey: "k", family: "vault_share", protocolId: "p", tinyLivePerTxUsd: 1, routeCost: { estimatedUsd: 1 } },
      { candidateId: "b", bindingKey: "z", family: "vault_share", protocolId: "p", tinyLivePerTxUsd: 1, routeCost: { estimatedUsd: 1 } },
    ],
    bindings: new Set(["k"]),
  });
  assert.equal(out[0].decision, "accept");
  assert.equal(out[1].decision, "needs_adapter");
});

// --- adapter-templates ---
test("FAMILY_TEMPLATES exposes the 5 enum families", () => {
  assert.deepEqual(Object.keys(FAMILY_TEMPLATES).sort(), ["basis", "campaign_only", "cl_lp", "lending_loop", "vault_share"]);
});

test("validateScaffoldOutput rejects unknown family", () => {
  const r = validateScaffoldOutput({ family: "bogus", files: [] });
  assert.equal(r.ok, false);
});

test("validateScaffoldOutput accepts adapter + test paths", () => {
  const r = validateScaffoldOutput({
    family: "vault_share",
    files: [
      { path: "src/treasury/adapters/new-vault.mjs", content: "" },
      { path: "test/new-vault.test.mjs", content: "" },
    ],
  });
  assert.equal(r.ok, true);
});

test("validateScaffoldOutput rejects writes outside whitelist", () => {
  const r = validateScaffoldOutput({
    family: "vault_share",
    files: [{ path: "src/config/strategy-caps/x.mjs", content: "" }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "family_path_mismatch");
});

// --- codex-triage CLI ---
test("runTriage writes results and updates queue (LLM stub)", async () => {
  const dir = tmp();
  try {
    const boardPath = join(dir, "board.json");
    const queuePath = join(dir, "queue.json");
    writeFileSync(boardPath, JSON.stringify({
      candidates: [
        { candidateId: "a", bindingKey: "x", family: "vault_share", protocolId: "p", tinyLivePerTxUsd: 1, routeCost: { estimatedUsd: 1 } },
      ],
    }));
    const r = await runTriage({
      boardPath, queuePath, outDir: dir,
      bindings: new Set(),
      callLlm: async () => ({ ok: true, dryRun: true, output: "stub", reason: "test" }),
    });
    assert.equal(r.boardSize, 1);
    assert.equal(r.needsAdapter, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- scaffold-adapter ---
test("scaffoldOne refuses when LLM is dryRun (no auto-commit)", async () => {
  const r = await scaffoldOne({
    queueItem: { candidateId: "abc", decision: "needs_adapter" },
    family: "vault_share",
    callLlm: async () => ({ ok: true, dryRun: true, reason: "stub" }),
  });
  assert.equal(r.ok, false);
});

test("scaffoldOne rejects family mismatch", async () => {
  const r = await scaffoldOne({
    queueItem: { candidateId: "abc", decision: "needs_adapter" },
    family: "vault_share",
    callLlm: async () => ({ ok: true, dryRun: false, files: [{ path: "src/config/strategy-caps/x.mjs", content: "export const a = 1;" }] }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.stage, "family_whitelist");
});

// --- payback trace ---
test("tracePeriod sums disbursements and matches exits", () => {
  const dir = tmp();
  try {
    const exits = join(dir, "exits.jsonl");
    const disb = join(dir, "disb.jsonl");
    writeFileSync(exits, [
      JSON.stringify({ exitId: "e1", netUsd: 10 }),
      JSON.stringify({ exitId: "e2", netUsd: 5 }),
    ].join("\n"));
    writeFileSync(disb, JSON.stringify({ disbursementId: "d1", periodId: "P1", amountUsd: 12, sourceExitIds: ["e1", "e2"] }) + "\n");
    const r = tracePeriod({ exitsPath: exits, paybackDisbursementsPath: disb, period: "P1" });
    assert.equal(r.totalPaidUsd, 12);
    assert.equal(r.matchedExits.d1.count, 2);
    assert.equal(r.matchedExits.d1.netUsd, 15);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- utilization reports ---
test("buildUtilizationReport recommends increase_interval when low", () => {
  const dir = tmp();
  try {
    const path = join(dir, "audit.jsonl");
    const today = new Date();
    writeFileSync(path, JSON.stringify({ ts: today.toISOString(), costUsd: 0.1 }) + "\n");
    const r = buildUtilizationReport({ auditPath: path, capUsd: 5 });
    assert.equal(r.recommendation, "increase_interval");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("buildMonitorCoverage flags low coverage", () => {
  const dir = tmp();
  try {
    const path = join(dir, "audit.jsonl");
    writeFileSync(path, JSON.stringify({ ts: new Date().toISOString(), count: 1 }) + "\n");
    const r = buildMonitorCoverage({ auditPath: path });
    assert.ok(r.coverage < 0.3);
    assert.equal(r.recommendation, "increase_interval");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
