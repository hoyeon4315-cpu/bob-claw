import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GATEWAY_POLICY,
  isGatewayMethod,
  resolveGatewayAvailability,
} from "../src/config/gateway.mjs";
import { checkGatewayAvailability } from "../src/executor/policy/gateway-availability.mjs";

test("isGatewayMethod classifies Gateway-backed methods", () => {
  assert.equal(isGatewayMethod("cross_chain_bridge_or_swap"), true);
  assert.equal(isGatewayMethod("cross_chain_swap_via_btc_intermediate"), true);
  assert.equal(isGatewayMethod("gateway_onramp"), true);
  assert.equal(isGatewayMethod("cross_chain_bridge_across"), false);
  assert.equal(isGatewayMethod("same_chain_token_to_native_swap"), false);
  assert.equal(isGatewayMethod(""), false);
});

test("resolveGatewayAvailability returns available when enabled and no state file", async () => {
  const result = await resolveGatewayAvailability({
    policy: { ...GATEWAY_POLICY, enabled: true, stateFile: "state/gateway.disabled" },
    existsImpl: async () => false,
  });
  assert.equal(result.available, true);
  assert.equal(result.reason, null);
});

test("resolveGatewayAvailability blocks when committed flag disabled", async () => {
  const result = await resolveGatewayAvailability({
    policy: {
      ...GATEWAY_POLICY,
      enabled: false,
      pausedReason: "operator_team_maintenance",
      pausedSince: "2026-04-24T00:00:00Z",
    },
    existsImpl: async () => false,
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, "gateway_committed_policy_disabled");
  assert.equal(result.pausedReason, "operator_team_maintenance");
});

test("resolveGatewayAvailability blocks when runtime state file present", async () => {
  const result = await resolveGatewayAvailability({
    policy: { ...GATEWAY_POLICY, enabled: true, stateFile: "state/gateway.disabled" },
    existsImpl: async () => true,
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, "gateway_runtime_disabled_state_file_present");
});

test("policy.checkGatewayAvailability blocks Gateway intent when paused", async () => {
  const verdict = await checkGatewayAvailability({
    intent: { method: "cross_chain_swap_via_btc_intermediate", chain: "base" },
    availability: {
      available: false,
      reason: "gateway_runtime_disabled_state_file_present",
      observedAt: "2026-04-24T00:00:00Z",
    },
  });
  assert.equal(verdict.decision, "BLOCK");
  assert.deepEqual(verdict.blockers, ["gateway_runtime_disabled_state_file_present"]);
});

test("policy.checkGatewayAvailability allows non-Gateway intent when Gateway paused", async () => {
  const verdict = await checkGatewayAvailability({
    intent: { method: "cross_chain_bridge_across", chain: "base" },
    availability: {
      available: false,
      reason: "gateway_committed_policy_disabled",
      observedAt: "2026-04-24T00:00:00Z",
    },
  });
  assert.equal(verdict.decision, "ALLOW");
  assert.deepEqual(verdict.blockers, []);
});

test("policy.checkGatewayAvailability allows Gateway intent when Gateway available", async () => {
  const verdict = await checkGatewayAvailability({
    intent: { method: "cross_chain_bridge_or_swap" },
    availability: { available: true, observedAt: "2026-04-24T00:00:00Z" },
  });
  assert.equal(verdict.decision, "ALLOW");
});
