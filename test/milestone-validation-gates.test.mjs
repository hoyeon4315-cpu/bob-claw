import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMilestoneValidationGates, summarizeMilestoneValidationGates } from "../src/strategy/milestone-validation-gates.mjs";
import { buildRecursiveLendingLoopReceiptGuide } from "../src/strategy/recursive-lending-loop-dry-run.mjs";

const recursiveWrappedReceiptCommand = buildRecursiveLendingLoopReceiptGuide({
  strategyId: "recursive_wrapped_btc_lending_loop",
}).sampleCommand;

test("milestone validation gates summarize completed and blocked phases coherently", () => {
  const report = buildMilestoneValidationGates({
    phase1Revalidation: {
      overfitDecision: "LIVE_BLOCKED",
      varianceRouteCount: 214,
      laneCount: 8,
      candidateForValidationCount: 0,
      globalOverfitPasses: false,
      blockedByContractFloorCount: 0,
    },
    strategyResearchBoard: {
      candidateCount: 7,
      topCandidate: { id: "stablecoin_entry_exit_loop_revalidation" },
      nextAction: { code: "refresh_stable_loop_validation" },
    },
    flashFloorDecision: {
      summary: { currentDecision: "setter_available_no_redeploy_required" },
    },
    wrappedBtcLendingLoopSlice: {
      strategy: { id: "wrapped-btc-loop-base-moonwell", protocol: "moonwell" },
      validation: { ok: true },
      blockers: ["protocol_adapter_not_built", "watcher_runtime_not_wired", "dry_run_unwind_not_recorded"],
      readiness: { readyForDryRun: true, readyForLive: false },
      entryPlan: { loopedExposureMultiple: 1.64, projectedHealthFactor: 1.87 },
      watcherPlan: { breachAction: "auto_unwind", checks: [{ id: "hf" }, { id: "buffer" }] },
      unwindPlan: { dryRunRequired: true },
      pnl: {
        estimated: { status: "unavailable_until_protocol_adapter_and_rate_feed_exist" },
        realized: { sampleCount: 0 },
      },
    },
    preliveValidation: {
      validationStatus: "blocked",
      readinessPct: 35,
      currentStageId: "shadow_replay",
      blockers: ["no_policy_ready_implemented_strategy"],
      warnings: ["connected_refresh_required"],
      summary: { blockerCount: 1 },
      nextAction: { code: "refresh_shadow_inputs", command: "npm run report:prelive-readiness" },
    },
    now: "2026-04-15T13:00:00.000Z",
  });

  assert.equal(report.summary.gateCount, 6);
  assert.equal(report.summary.passedCount >= 3, true);
  assert.equal(report.summary.overallStatus, "blocked");
  assert.equal(report.summary.nextGateId, "strategy_vertical_slice");

  const runtimeSafety = report.gates.find((gate) => gate.id === "runtime_safety");
  assert.ok(runtimeSafety);
  assert.equal(runtimeSafety.status, "passed");
  assert.equal(runtimeSafety.evidence.passCount, runtimeSafety.evidence.checkCount);

  const summary = summarizeMilestoneValidationGates(report);
  assert.equal(summary.overallStatus, "blocked");
  assert.equal(summary.nextGate.id, "strategy_vertical_slice");
  assert.equal(summary.nextAction.code, "wire_wrapped_btc_loop_adapter");
});

test("milestone validation gates prioritize recursive strategy evidence when allocator top planning is recursive", () => {
  const report = buildMilestoneValidationGates({
    phase1Revalidation: {
      overfitDecision: "LIVE_BLOCKED",
      varianceRouteCount: 214,
      laneCount: 8,
      candidateForValidationCount: 0,
      globalOverfitPasses: false,
      blockedByContractFloorCount: 0,
    },
    strategyResearchBoard: {
      candidateCount: 6,
      topCandidate: { id: "recursive_wrapped_btc_lending_loop" },
    },
    flashFloorDecision: {
      summary: { currentDecision: "setter_available_no_redeploy_required" },
    },
    allocatorCore: {
      planningView: {
        planningQueue: [{ id: "recursive_wrapped_btc_lending_loop" }, { id: "wrapped-btc-loop-base-moonwell" }],
      },
    },
    recursiveWrappedBtcLoop: {
      strategy: {
        id: "recursive_wrapped_btc_lending_loop",
        label: "Recursive wrapped-BTC lending loop",
        protocol: "moonwell",
      },
      validation: { ok: true },
      readiness: { readyForDryRun: true, readyForLive: false },
      entryPlan: { loopedExposureMultiple: 1.82, projectedHealthFactor: 1.71 },
      watcherPlan: { breachAction: "auto_unwind", checks: [{ id: "hf" }, { id: "buffer" }] },
      unwindPlan: { dryRunRequired: true },
      dryRunSummary: { dryRunReceiptRecorded: true, autoUnwindPassCount: 2, signerBackedRunCount: 0 },
    },
    phase3Validation: {
      validations: [
        {
          id: "recursive_wrapped_btc_lending_loop_validation",
          blockers: ["recursive_observed_receipts_missing"],
          oosSplitStatus: "simulated_dry_run_recorded",
          nextAction: { code: "collect_recursive_loop_observed_receipts", command: recursiveWrappedReceiptCommand },
        },
      ],
    },
    protocolMarketWatchers: {
      watchers: [
        {
          id: "recursive_wrapped_btc_lending_loop_market_watch",
          blockers: ["recursive_observed_receipts_missing"],
          nextAction: { code: "collect_recursive_loop_observed_receipts", command: recursiveWrappedReceiptCommand },
        },
      ],
    },
    preliveValidation: {
      validationStatus: "blocked",
      blockers: ["no_policy_ready_implemented_strategy"],
      nextAction: { code: "refresh_shadow_inputs" },
    },
  });

  assert.equal(report.summary.nextGateId, "strategy_vertical_slice");
  assert.equal(report.summary.nextAction.code, "collect_recursive_loop_observed_receipts");
  const strategyGate = report.gates.find((gate) => gate.id === "strategy_vertical_slice");
  const watcherGate = report.gates.find((gate) => gate.id === "strategy_watchers_and_unwind");
  assert.ok(strategyGate);
  assert.ok(watcherGate);
  assert.equal(strategyGate.evidence.strategyId, "recursive_wrapped_btc_lending_loop");
  assert.equal(strategyGate.blockers.includes("recursive_observed_receipts_missing"), true);
  assert.equal(watcherGate.evidence.strategyId, "recursive_wrapped_btc_lending_loop");
});
