import assert from "node:assert/strict";
import { test } from "node:test";

import { applyLaneAwareLivePolicy } from "../src/status/live-policy.mjs";

test("lane-aware live policy suppresses transport-only audit for auto-executable strategy", () => {
  const overall = applyLaneAwareLivePolicy({
    overall: {
      liveTrading: "BLOCKED",
      shadowTrading: "ALLOWED",
      blockers: ["audit_blocks_live"],
      warnings: [],
    },
    audit: {
      decision: "LIVE_BLOCKED",
      blockers: ["candidate amount diversity"],
    },
    reviewPackage: {
      candidateType: "strategy",
      candidateId: "gateway_native_asset_conversion_sleeve",
      candidateLabel: "Gateway native-asset conversion sleeve",
    },
    prelive: {
      currentStage: "tiny_live_canary_review",
    },
    liveBaseline: {
      counts: {
        total: 0,
      },
    },
  });

  assert.equal(overall.liveTrading, "ALLOWED");
  assert.deepEqual(overall.blockers, []);
  assert.equal(overall.warnings.includes("transport_audit_warning_only"), true);
  assert.equal(overall.lanePolicy.auditSuppressedForStrategy, true);
  assert.equal(overall.lanePolicy.strategyPolicy.autoExecute, true);
});

test("lane-aware live policy replaces transport-only audit with real baseline blocker codes", () => {
  const overall = applyLaneAwareLivePolicy({
    overall: {
      liveTrading: "BLOCKED",
      shadowTrading: "ALLOWED",
      blockers: ["audit_blocks_live"],
      warnings: [],
    },
    audit: {
      decision: "LIVE_BLOCKED",
      blockers: ["candidate amount diversity"],
    },
    reviewPackage: {
      candidateType: "strategy",
      candidateId: "gateway_native_asset_conversion_sleeve",
    },
    prelive: {
      currentStage: "tiny_live_canary_review",
    },
    liveBaseline: {
      counts: {
        total: 1,
      },
      blockers: {
        refresh: [],
        operator: [],
        technical: [{ code: "executor_runtime_unavailable" }],
        objective: [],
      },
    },
  });

  assert.equal(overall.liveTrading, "BLOCKED");
  assert.deepEqual(overall.blockers, ["executor_runtime_unavailable"]);
  assert.equal(overall.warnings.includes("transport_audit_warning_only"), true);
  assert.equal(overall.lanePolicy.auditSuppressedForStrategy, true);
});

test("lane-aware live policy keeps non-transport audit blocker live-blocking", () => {
  const overall = applyLaneAwareLivePolicy({
    overall: {
      liveTrading: "BLOCKED",
      shadowTrading: "ALLOWED",
      blockers: ["audit_blocks_live"],
      warnings: [],
    },
    audit: {
      decision: "LIVE_BLOCKED",
      blockers: ["shadow time window"],
    },
    reviewPackage: {
      candidateType: "strategy",
      candidateId: "wrapped-btc-loop-base-moonwell",
    },
    prelive: {
      currentStage: "tiny_live_canary_review",
    },
    liveBaseline: {
      counts: {
        total: 0,
      },
    },
  });

  assert.equal(overall.liveTrading, "BLOCKED");
  assert.deepEqual(overall.blockers, ["audit_blocks_live"]);
  assert.equal(overall.lanePolicy.auditSuppressedForStrategy, false);
});

test("lane-aware live policy requires strategy auto-execute caps", () => {
  const overall = applyLaneAwareLivePolicy({
    overall: {
      liveTrading: "BLOCKED",
      shadowTrading: "ALLOWED",
      blockers: ["audit_blocks_live"],
      warnings: [],
    },
    audit: {
      decision: "LIVE_BLOCKED",
      blockers: ["candidate amount diversity"],
    },
    reviewPackage: {
      candidateType: "strategy",
      candidateId: "gateway-instant-swap-verification",
    },
    prelive: {
      currentStage: "tiny_live_canary_review",
    },
    liveBaseline: {
      counts: {
        total: 0,
      },
    },
  });

  assert.equal(overall.liveTrading, "BLOCKED");
  assert.equal(overall.blockers.includes("audit_blocks_live"), true);
  assert.equal(overall.warnings.includes("strategy_auto_execute_disabled"), true);
  assert.equal(overall.lanePolicy.strategyPolicy.ok, false);
});

test("lane-aware live policy recognizes reopened recursive loop caps", () => {
  const overall = applyLaneAwareLivePolicy({
    overall: {
      liveTrading: "BLOCKED",
      shadowTrading: "ALLOWED",
      blockers: ["audit_blocks_live"],
      warnings: [],
    },
    audit: {
      decision: "LIVE_BLOCKED",
      blockers: ["candidate amount diversity"],
    },
    reviewPackage: {
      candidateType: "strategy",
      candidateId: "recursive_wrapped_btc_lending_loop",
      candidateLabel: "Recursive wrapped-BTC lending loop",
    },
    prelive: {
      currentStage: "tiny_live_canary_review",
    },
    liveBaseline: {
      counts: {
        total: 0,
      },
    },
  });

  const policy = overall.lanePolicy.strategyPolicy;
  assert.equal(overall.liveTrading, "ALLOWED");
  assert.equal(overall.blockers.includes("audit_blocks_live"), false);
  assert.equal(overall.warnings.includes("strategy_caps_missing"), false);
  assert.equal(overall.warnings.includes("strategy_auto_execute_disabled"), false);
  assert.equal(policy.strategyId, "recursive_wrapped_btc_lending_loop");
  assert.equal(policy.capValidation.ok, true);
  assert.equal(policy.autoExecute, true);
  assert.equal(policy.caps.perTxUsd, 150);
  assert.equal(policy.caps.perDayUsd, 200);
  assert.equal(policy.caps.perChainUsd.base, 200);
  assert.equal(policy.caps.maxDailyLossUsd, 25);
  assert.deepEqual(policy.exposure.protocols, ["moonwell", "odos"]);
  assert.equal(policy.exposure.btcDenominated, true);
  assert.equal(policy.leverage.healthFactorMin, 1.35);
});

test("lane-aware live policy keeps Stage B advisory without blocking policy live trading", () => {
  const overall = applyLaneAwareLivePolicy({
    overall: {
      liveTrading: "ALLOWED",
      shadowTrading: "ALLOWED",
      blockers: [],
      warnings: [],
    },
    reviewPackage: {
      candidateType: "strategy",
      candidateId: "wrapped-btc-loop-base-moonwell",
    },
    prelive: {
      currentStage: "tiny_live_canary_review",
    },
    liveBaseline: {
      counts: {
        total: 0,
      },
    },
    stageEvaluation: {
      currentStage: "B",
      blockers: ["refill_routes_unresolved"],
      evidence: {
        refreshSuccessRatio24h: 0.98,
        transientFrequency24h: 0.01,
      },
    },
  });

  assert.equal(overall.liveTrading, "ALLOWED");
  assert.deepEqual(overall.blockers, []);
  assert.equal(overall.warnings.includes("lane_stage_advisory_only"), true);
  assert.equal(overall.lanePolicy.stage, "B");
  assert.equal(overall.lanePolicy.policyLiveTrading, "ALLOWED");
  assert.deepEqual(overall.lanePolicy.stageBlockers, ["refill_routes_unresolved"]);
});

test("lane-aware live policy surfaces kill-switch runtime blockers and stale-arm evidence", () => {
  const overall = applyLaneAwareLivePolicy({
    overall: {
      liveTrading: "ALLOWED",
      shadowTrading: "ALLOWED",
      blockers: [],
      warnings: [],
    },
    reviewPackage: {
      candidateType: "strategy",
      candidateId: "wrapped-btc-loop-base-moonwell",
    },
    prelive: {
      currentStage: "tiny_live_canary_review",
    },
    liveBaseline: {
      counts: {
        total: 0,
      },
    },
    stageEvaluation: {
      currentStage: "C",
      blockers: [],
      evidence: {},
    },
    executorRuntime: {
      killSwitch: {
        halted: true,
        activeReason: "auto_kill:failure_burst_per_strategy",
        replay: {
          staleArm: true,
        },
      },
    },
  });

  assert.equal(overall.liveTrading, "BLOCKED");
  assert.deepEqual(overall.blockers, [
    "kill_switch_present",
    "kill_switch_stale_arm_present",
  ]);
  assert.deepEqual(overall.lanePolicy.runtimeBlockers, [
    "kill_switch_present",
    "kill_switch_stale_arm_present",
  ]);
  assert.deepEqual(overall.lanePolicy.runtimeEvidence, {
    halted: true,
    activeReason: "auto_kill:failure_burst_per_strategy",
    staleArm: true,
  });
});
