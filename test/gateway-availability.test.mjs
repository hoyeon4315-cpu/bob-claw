import assert from "node:assert/strict";
import { test } from "node:test";
import { GATEWAY_POLICY, isGatewayMethod, resolveGatewayAvailability } from "../src/config/gateway.mjs";
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

test("policy.checkGatewayAvailability blocks Gateway route when current API routes omit destination", async () => {
  const verdict = await checkGatewayAvailability({
    intent: {
      method: "gateway_btc_onramp",
      metadata: {
        gatewayRoute: {
          srcChain: "bitcoin",
          dstChain: "optimism",
        },
      },
    },
    availability: {
      available: true,
      observedAt: "2026-05-08T00:00:00Z",
      routes: [
        { srcChain: "bitcoin", dstChain: "base" },
        { srcChain: "base", dstChain: "bitcoin" },
      ],
    },
  });
  assert.equal(verdict.decision, "BLOCK");
  assert.deepEqual(verdict.blockers, ["gateway_route_currently_unavailable"]);
  assert.equal(verdict.routeAvailable, false);
});

test("policy.checkGatewayAvailability allows Gateway route when current API route is present", async () => {
  const verdict = await checkGatewayAvailability({
    intent: {
      method: "gateway_btc_onramp",
      metadata: {
        gatewayRoute: {
          srcChain: "bitcoin",
          dstChain: "base",
        },
      },
    },
    availability: {
      available: true,
      observedAt: "2026-05-08T00:00:00Z",
      routes: [{ srcChain: "bitcoin", dstChain: "base" }],
    },
  });
  assert.equal(verdict.decision, "ALLOW");
  assert.equal(verdict.routeAvailable, true);
});

test("policy.checkGatewayAvailability requires current Gateway token route for XAUT intents", async () => {
  const xaut = "0x68749665FF8D2d112Fa859AA293F07A622782F38";
  const paxg = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";
  const btc = "0x0000000000000000000000000000000000000000";
  const verdict = await checkGatewayAvailability({
    intent: {
      method: "gateway_btc_onramp",
      metadata: {
        gatewayRoute: {
          srcChain: "bitcoin",
          dstChain: "ethereum",
          srcToken: btc,
          dstToken: xaut,
        },
      },
    },
    availability: {
      available: true,
      observedAt: "2026-05-14T00:00:00Z",
      routes: [{ srcChain: "bitcoin", dstChain: "ethereum", srcToken: btc, dstToken: paxg }],
    },
  });
  assert.equal(verdict.decision, "BLOCK");
  assert.deepEqual(verdict.blockers, ["gateway_route_currently_unavailable"]);
  assert.equal(verdict.routeAvailable, false);
});

test("policy.checkGatewayAvailability blocks bridged radar canary when current Gateway route is absent", async () => {
  const verdict = await checkGatewayAvailability({
    intent: {
      intentType: "tiny_live_canary",
      gatewayQuoteId: "quote_1",
      metadata: {
        gatewayRoute: {
          srcChain: "bitcoin",
          dstChain: "sei",
        },
      },
    },
    availability: {
      available: true,
      observedAt: "2026-05-08T00:00:00Z",
      routes: [
        { srcChain: "bitcoin", dstChain: "base" },
        { srcChain: "base", dstChain: "bitcoin" },
      ],
    },
  });

  assert.equal(verdict.decision, "BLOCK");
  assert.deepEqual(verdict.blockers, ["gateway_route_currently_unavailable"]);
  assert.equal(verdict.routeAvailable, false);
});
