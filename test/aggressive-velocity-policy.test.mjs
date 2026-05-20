import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGGRESSIVE_VELOCITY_POLICY_NAME,
  evaluateAggressiveVelocityPolicy,
} from "../src/executor/policy/aggressive-velocity-policy.mjs";
import { AGGRESSIVE_VELOCITY_SLEEVE_ID } from "../src/config/aggressive-velocity/config.mjs";

const NOW = "2026-05-20T00:00:00.000Z";

function readyManifest(overrides = {}) {
  return {
    kind: "aggressive-velocity-manifest-v1",
    verdict: {
      readyForPolicyReview: true,
      exitAutomationEnforced: true,
      capitalConcentrationOk: true,
      totalExpectedNetBtcProfit: 0.0002,
      ...overrides.verdict,
    },
    artifacts: overrides.artifacts || [],
  };
}

test("aggressive velocity policy allows unrelated intents", () => {
  const result = evaluateAggressiveVelocityPolicy({
    intent: { strategyId: "unrelated" },
    now: NOW,
  });

  assert.equal(result.policy, AGGRESSIVE_VELOCITY_POLICY_NAME);
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.sleeve, null);
});

test("aggressive velocity policy allows ready sleeve manifests above floor", () => {
  const result = evaluateAggressiveVelocityPolicy({
    manifest: readyManifest(),
    now: NOW,
    minExpectedNetBtc: 0.00005,
  });

  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.blockers, []);
  assert.equal(result.sleeve, AGGRESSIVE_VELOCITY_SLEEVE_ID);
  assert.equal(result.verdictSummary.totalExpectedNetBtcProfit, 0.0002);
});

test("aggressive velocity policy blocks manifests missing readiness invariants", () => {
  const result = evaluateAggressiveVelocityPolicy({
    manifest: readyManifest({
      verdict: {
        readyForPolicyReview: false,
        exitAutomationEnforced: false,
        capitalConcentrationOk: false,
        totalExpectedNetBtcProfit: 0.00001,
      },
    }),
    now: NOW,
    minExpectedNetBtc: 0.00005,
  });

  assert.equal(result.decision, "BLOCK");
  assert.ok(result.blockers.includes("sleeve_manifest_not_ready_for_policy"));
  assert.ok(result.blockers.includes("sleeve_exit_automation_not_enforced"));
  assert.ok(result.blockers.includes("sleeve_concentration_breach"));
  assert.ok(result.blockers.includes("sleeve_expected_net_btc_below_floor"));
});

test("aggressive velocity policy can derive expected net from artifacts", () => {
  const result = evaluateAggressiveVelocityPolicy({
    manifest: readyManifest({
      verdict: { totalExpectedNetBtcProfit: 0 },
      artifacts: [
        { positionKey: "base:synthetic-a", expectedNetBtcProfit: 0.00003 },
        { positionKey: "base:synthetic-b", expectedNetBtcProfit: 0.00004 },
      ],
    }),
    now: NOW,
    minExpectedNetBtc: 0.00005,
  });

  assert.equal(result.decision, "ALLOW");
  assert.ok(Math.abs(result.verdictSummary.totalExpectedNetBtcProfit - 0.00007) < 1e-12);
  assert.equal(result.artifactCount, 2);
});
