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
      candidateId: "wrapped-btc-loop-base-moonwell",
      candidateLabel: "Wrapped BTC lending loop (Base / Moonwell)",
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
      candidateId: "wrapped-btc-loop-base-moonwell",
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

test("lane-aware live policy recognizes recursive loop caps but keeps live blocked until enabled", () => {
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
  assert.equal(overall.liveTrading, "BLOCKED");
  assert.equal(overall.blockers.includes("audit_blocks_live"), true);
  assert.equal(overall.warnings.includes("strategy_caps_missing"), false);
  assert.equal(overall.warnings.includes("strategy_auto_execute_disabled"), true);
  assert.equal(policy.strategyId, "recursive_wrapped_btc_lending_loop");
  assert.equal(policy.capValidation.ok, true);
  assert.equal(policy.autoExecute, false);
  assert.equal(policy.caps.perTxUsd, 1_000_000);
  assert.equal(policy.caps.perChainUsd.base, 1_000_000);
  assert.deepEqual(policy.exposure.protocols, ["moonwell", "odos"]);
  assert.equal(policy.exposure.btcDenominated, true);
  assert.equal(policy.leverage.healthFactorMin, 1.35);
});
