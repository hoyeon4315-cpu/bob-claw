import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMicroCanarySlice, summarizeMicroCanaryForStage } from "../src/status/micro-canary-slice.mjs";

function reportFixture(overrides = {}) {
  return {
    strategyId: "s1",
    microCanaryStatus: "not_started",
    mode: "blocked",
    evidence: { signerBackedCount: 0, passedCount: 0 },
    blockers: [],
    ...overrides,
  };
}

test("micro-canary slice counts 4 stages correctly", () => {
  const reports = [
    reportFixture({ strategyId: "a", microCanaryStatus: "not_started" }),
    reportFixture({ strategyId: "b", microCanaryStatus: "micro_canary_ready", shadowReady: true }),
    reportFixture({ strategyId: "c", microCanaryStatus: "minimal_live_proof_exists", evidence: { signerBackedCount: 1, passedCount: 1 } }),
    reportFixture({ strategyId: "d", microCanaryStatus: "micro_canary_repeatable", evidence: { signerBackedCount: 3, passedCount: 3 } }),
  ];
  const slice = buildMicroCanarySlice(reports);
  assert.equal(slice.total, 4);
  assert.equal(slice.notStartedCount, 1);
  assert.equal(slice.readyCount, 1);
  assert.equal(slice.minimalLiveProofExistsCount, 1);
  assert.equal(slice.repeatableCount, 1);
});

test("micro-canary byStrategy includes lastFailureReason and realizedNetUsd", () => {
  const reports = [
    reportFixture({
      strategyId: "s1",
      microCanaryStatus: "minimal_live_proof_exists",
      evidence: { signerBackedCount: 1, passedCount: 1, realizedNetUsd: 12.5 },
      blockers: ["vault_withdrawal_unproven"],
    }),
  ];
  const slice = buildMicroCanarySlice(reports);
  const s1 = slice.byStrategy.s1;
  assert.equal(s1.microCanaryStatus, "minimal_live_proof_exists");
  assert.equal(s1.signerBackedCount, 1);
  assert.equal(s1.lastFailureReason, "vault_withdrawal_unproven");
  assert.equal(s1.realizedNetUsd, 12.5);
});

test("summarizeMicroCanaryForStage filters by stage", () => {
  const reports = [
    reportFixture({ strategyId: "a", microCanaryStatus: "minimal_live_proof_exists" }),
    reportFixture({ strategyId: "b", microCanaryStatus: "minimal_live_proof_exists" }),
  ];
  const summary = summarizeMicroCanaryForStage("minimal_live_proof_exists", reports);
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.strategyIds, ["a", "b"]);
});
