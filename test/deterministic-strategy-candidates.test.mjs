import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDeterministicStrategyCandidates, summarizeDeterministicStrategyCandidates } from "../src/strategy/deterministic-strategy-candidates.mjs";
import { buildRecursiveLendingLoopScaffold } from "../src/strategy/recursive-lending-loop-slice.mjs";
import { buildSecondaryStrategyScaffolds } from "../src/strategy/secondary-strategy-scaffolds.mjs";
import { buildStrategyResearchBoard } from "../src/strategy/strategy-research-board.mjs";
import { buildLendingLoopResearchEntries } from "../src/strategy/lending-loop-research.mjs";

test("deterministic candidate report ranks repo-auto-build lending loops ahead of design scaffolds", () => {
  const strategyResearchBoard = buildStrategyResearchBoard({
    laneReclassification: {
      lanes: [
        {
          id: "btc_proxy_spreads",
          statusNew: "measured_inside_variance_floor",
          clearsNewFloor: false,
          passesOverfitGate: false,
          remainingBlockers: ["thin_buy_quote_coverage"],
        },
      ],
    },
    lendingLoopResearchEntries: buildLendingLoopResearchEntries(),
    nativeBtcOpportunitySurface: null,
    now: "2026-04-17T00:00:00.000Z",
  });
  const secondaryStrategyScaffolds = buildSecondaryStrategyScaffolds({
    laneReclassification: {
      lanes: [],
    },
    now: "2026-04-17T00:00:00.000Z",
  });
  const report = buildDeterministicStrategyCandidates({
    strategyResearchBoard,
    secondaryStrategyScaffolds,
    recursiveWrappedBtcLoop: buildRecursiveLendingLoopScaffold({
      strategyId: "recursive_wrapped_btc_lending_loop",
      now: "2026-04-17T00:00:00.000Z",
    }),
    recursiveStablecoinLoop: buildRecursiveLendingLoopScaffold({
      strategyId: "recursive_stablecoin_lending_loop",
      now: "2026-04-17T00:00:00.000Z",
    }),
    now: "2026-04-17T00:00:00.000Z",
  });

  assert.equal(report.summary.repoAutoBuildCount, 1);
  assert.equal(report.summary.readyForDryRunCount, 2);
  assert.equal(report.summary.receiptBackedCount, 0);
  assert.equal(report.summary.topCandidateId, "recursive_wrapped_btc_lending_loop");
  assert.equal(report.candidates[0].deterministicStatus, "repo_auto_build_supported");

  const summary = summarizeDeterministicStrategyCandidates(report);
  assert.equal(summary.topCandidate.id, "recursive_wrapped_btc_lending_loop");
  assert.equal(summary.readyForDryRunCount, 2);
  assert.equal(summary.receiptBackedCount, 0);
});
