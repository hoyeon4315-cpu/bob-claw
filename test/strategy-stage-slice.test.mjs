import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildStrategyStageSlice,
  summarizeStageDistribution,
  STAGES,
} from "../src/status/strategy-stage-slice.mjs";

function reportFixture(overrides = {}) {
  return {
    strategyId: "s1",
    mode: "blocked",
    shadowReady: false,
    liveReady: false,
    blockerCount: 0,
    blockers: [],
    topBlocker: null,
    projectedNetUsd: null,
    economics: {},
    ...overrides,
  };
}

describe("buildStrategyStageSlice", () => {
  test("empty reports returns frozen zeros", () => {
    const slice = buildStrategyStageSlice([]);
    assert.equal(slice.total, 0);
    assert.equal(slice.blockedCount, 0);
    assert.equal(slice.shadowReadyCount, 0);
    assert.equal(slice.liveCandidateCount, 0);
    assert.equal(slice.liveReadyCount, 0);
    assert.deepEqual(slice.byStrategy, {});
    assert.ok(Object.isFrozen(slice));
    assert.ok(Object.isFrozen(slice.byStrategy));
  });

  test("counts 4 vanilla stages without promotion evidence", () => {
    const reports = [
      reportFixture({ strategyId: "a", mode: "blocked" }),
      reportFixture({ strategyId: "b", mode: "shadow_ready", shadowReady: true }),
      reportFixture({ strategyId: "c", mode: "live_candidate", liveReady: false }),
      reportFixture({ strategyId: "d", mode: "live_candidate", liveReady: true }),
    ];
    const slice = buildStrategyStageSlice(reports);
    assert.equal(slice.total, 4);
    assert.equal(slice.blockedCount, 1);
    assert.equal(slice.shadowReadyCount, 1);
    assert.equal(slice.liveCandidateCount, 2);
    assert.equal(slice.liveReadyCount, 0);
  });

  test("promotes live_candidate to live_ready when evidence says eligible", () => {
    const reports = [
      reportFixture({ strategyId: "c1", mode: "live_candidate" }),
      reportFixture({ strategyId: "c2", mode: "live_candidate" }),
    ];
    const promotionEvidence = {
      c1: { eligible: true },
      c2: { eligible: false },
    };
    const slice = buildStrategyStageSlice(reports, promotionEvidence);
    assert.equal(slice.total, 2);
    assert.equal(slice.liveCandidateCount, 1);
    assert.equal(slice.liveReadyCount, 1);
    assert.equal(slice.byStrategy.c1.promotionVerdict, "live_ready");
    assert.equal(slice.byStrategy.c2.promotionVerdict, "live_candidate");
    assert.equal(slice.byStrategy.c1.promotionEligible, true);
    assert.equal(slice.byStrategy.c2.promotionEligible, false);
  });

  test("promotionVerdict falls back to mode when no evidence", () => {
    const reports = [
      reportFixture({ strategyId: "x", mode: "shadow_ready", shadowReady: true }),
    ];
    const slice = buildStrategyStageSlice(reports);
    assert.equal(slice.byStrategy.x.promotionVerdict, "shadow_ready");
    assert.equal(slice.byStrategy.x.promotionEligible, null);
  });

  test("byStrategy fields are populated from report and evidence", () => {
    const reports = [
      reportFixture({
        strategyId: "s1",
        mode: "blocked",
        blockerCount: 2,
        blockers: ["cap_exceeded", "hf_low"],
        topBlocker: "cap_exceeded",
        projectedNetUsd: 150,
      }),
    ];
    const slice = buildStrategyStageSlice(reports);
    const s1 = slice.byStrategy.s1;
    assert.equal(s1.mode, "blocked");
    assert.equal(s1.blockerCount, 2);
    assert.equal(s1.topBlocker, "cap_exceeded");
    assert.equal(s1.projectedNetUsd, 150);
    assert.equal(s1.shadowReady, false);
    assert.equal(s1.liveReady, false);
  });

  test("falls back to economics.projectedNetUsd when top-level missing", () => {
    const reports = [
      reportFixture({
        strategyId: "s1",
        mode: "blocked",
        projectedNetUsd: null,
        economics: { projectedNetUsd: 42 },
      }),
    ];
    const slice = buildStrategyStageSlice(reports);
    assert.equal(slice.byStrategy.s1.projectedNetUsd, 42);
  });

  test("falls back to blockers.length when blockerCount missing", () => {
    const reports = [
      reportFixture({
        strategyId: "s1",
        mode: "blocked",
        blockerCount: undefined,
        blockers: ["a", "b", "c"],
      }),
    ];
    const slice = buildStrategyStageSlice(reports);
    assert.equal(slice.byStrategy.s1.blockerCount, 3);
  });

  test("generatedAt is ISO string", () => {
    const slice = buildStrategyStageSlice([]);
    assert.ok(/\d{4}-\d{2}-\d{2}T/.test(slice.generatedAt));
  });

  test("demotion overrides live_ready back to live_candidate", () => {
    const reports = [
      reportFixture({ strategyId: "dem1", mode: "live_candidate" }),
      reportFixture({ strategyId: "dem2", mode: "live_candidate" }),
    ];
    const promotionEvidence = {
      dem1: { eligible: true },
      dem2: { eligible: true },
    };
    const demotionEvidence = {
      dem1: { demoted: true, triggers: ["recent_failure_burst"] },
      dem2: { demoted: false, triggers: [] },
    };
    const slice = buildStrategyStageSlice(reports, promotionEvidence, demotionEvidence);
    assert.equal(slice.liveReadyCount, 1);
    assert.equal(slice.liveCandidateCount, 1);
    assert.equal(slice.byStrategy.dem1.promotionVerdict, "live_candidate");
    assert.equal(slice.byStrategy.dem2.promotionVerdict, "live_ready");
    assert.deepEqual(slice.byStrategy.dem1.demotionTriggers, ["recent_failure_burst"]);
    assert.deepEqual(slice.byStrategy.dem2.demotionTriggers, []);
  });

  test("demotion does not affect non-live_ready strategies", () => {
    const reports = [
      reportFixture({ strategyId: "blk", mode: "blocked" }),
      reportFixture({ strategyId: "shd", mode: "shadow_ready" }),
    ];
    const demotionEvidence = {
      blk: { demoted: true, triggers: ["stale_evidence"] },
      shd: { demoted: true, triggers: ["stale_evidence"] },
    };
    const slice = buildStrategyStageSlice(reports, {}, demotionEvidence);
    assert.equal(slice.byStrategy.blk.promotionVerdict, "blocked");
    assert.equal(slice.byStrategy.shd.promotionVerdict, "shadow_ready");
  });
});

describe("summarizeStageDistribution", () => {
  test("distributes strategies across all stages", () => {
    const reports = [
      reportFixture({ strategyId: "a", mode: "blocked" }),
      reportFixture({ strategyId: "b", mode: "shadow_ready", shadowReady: true }),
      reportFixture({ strategyId: "c", mode: "live_candidate" }),
      reportFixture({ strategyId: "d", mode: "live_candidate" }),
    ];
    const promotionEvidence = {
      d: { eligible: true },
    };
    const dist = summarizeStageDistribution(reports, promotionEvidence);
    assert.equal(dist.blocked.count, 1);
    assert.deepEqual(dist.blocked.strategyIds, ["a"]);
    assert.equal(dist.shadow_ready.count, 1);
    assert.equal(dist.live_candidate.count, 1);
    assert.deepEqual(dist.live_candidate.strategyIds, ["c"]);
    assert.equal(dist.live_ready.count, 1);
    assert.deepEqual(dist.live_ready.strategyIds, ["d"]);
  });

  test("returns frozen objects per stage", () => {
    const dist = summarizeStageDistribution([]);
    for (const stage of STAGES) {
      assert.ok(Object.isFrozen(dist[stage]));
    }
    assert.ok(Object.isFrozen(dist));
  });

  test("demotion moves live_ready count to live_candidate in distribution", () => {
    const reports = [
      reportFixture({ strategyId: "a", mode: "live_candidate" }),
      reportFixture({ strategyId: "b", mode: "live_candidate" }),
    ];
    const promotionEvidence = { a: { eligible: true }, b: { eligible: true } };
    const demotionEvidence = { a: { demoted: true, triggers: ["x"] }, b: { demoted: false, triggers: [] } };
    const dist = summarizeStageDistribution(reports, promotionEvidence, demotionEvidence);
    assert.equal(dist.live_ready.count, 1);
    assert.deepEqual(dist.live_ready.strategyIds, ["b"]);
    assert.equal(dist.live_candidate.count, 1);
    assert.deepEqual(dist.live_candidate.strategyIds, ["a"]);
  });
});
