import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIterate, buildScorer, runAutoResearch } from "../src/cli/auto-research-pipeline.mjs";
import { LOOP_LIMITS } from "../src/cli/auto-research-loop.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "phase16p-")); }

test("buildScorer flags llm_unavailable when all scaffold results are dryRun", async () => {
  const scorer = buildScorer({});
  const r = await scorer({
    triage: { items: [{ candidateId: "x" }] },
    scaffold: { results: [{ ok: false, reason: "llm_unavailable" }] },
  });
  assert.equal(r.passed, false);
  assert.ok(r.blockers.includes("llm_unavailable"));
});

test("buildScorer fails when no ok scaffold results", async () => {
  const scorer = buildScorer({});
  const r = await scorer({ triage: { items: [{ candidateId: "x" }] }, scaffold: { results: [] } });
  assert.equal(r.passed, false);
  assert.ok(r.blockers.includes("scaffold_zero_ok"));
  assert.ok(!r.blockers.includes("llm_unavailable"));
});

test("buildScorer passes no-op when triage has no candidates", async () => {
  const scorer = buildScorer({});
  const r = await scorer({ triage: { items: [] }, scaffold: { results: [] } });
  assert.equal(r.passed, true);
  assert.equal(r.reason, "no_candidates");
});

test("runAutoResearch with empty board exits no-op cleanly", async () => {
  const dir = tmp();
  try {
    const r = await runAutoResearch({
      auditPath: join(dir, "audit.jsonl"),
      limits: { ...LOOP_LIMITS, iterationCap: 5, sameFailureCap: 2 },
      iterateOptions: {
        triagePaths: { boardPath: join(dir, "no-board.json"), queuePath: join(dir, "no-queue.json"), outDir: dir },
        scaffoldPaths: { queuePath: join(dir, "no-queue.json"), outDir: dir },
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.score.reason, "no_candidates");
    assert.equal(r.cumulativeCostUsd, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("buildIterate returns zero costUsd and zero files in dryRun", async () => {
  const dir = tmp();
  try {
    const iterate = buildIterate({
      triagePaths: { boardPath: join(dir, "board.json"), queuePath: join(dir, "queue.json"), outDir: dir },
      scaffoldPaths: { queuePath: join(dir, "queue.json"), outDir: dir },
    });
    const r = await iterate({ iteration: 0 });
    assert.equal(r.costUsd, 0);
    assert.equal(r.files.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
