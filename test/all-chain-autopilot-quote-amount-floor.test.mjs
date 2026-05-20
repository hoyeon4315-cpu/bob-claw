import test from "node:test";
import assert from "node:assert/strict";

import { refillRouteAttemptReason, routeExhaustionDeferral } from "../src/executor/all-chain-autopilot.mjs";

// Producer chain: when a Gateway route quote rejects below-minimum input with
// HTTP 422 QUOTE_AMOUNT_TOO_LOW, the helper plan surfaces
// `blockedReason: "quote_amount_too_low"` plus `quoteAmountFloor: { minimum,
// actual }`. The autopilot must (a) forward `quoteAmountFloor` into each route
// attempt entry without dropping it, and (b) classify a route exhaustion that
// is exclusively amount-floor as `bridge_quote_amount_below_minimum` (not the
// generic `routing_exhausted` taxonomy). Synthetic chain/asset/method strings
// prove no target hardcode.

test("refillRouteAttemptReason forwards quoteAmountFloor from plan", () => {
  const result = {
    json: {
      preparation: {
        blockedReason: "quote_amount_too_low",
        plan: {
          blockedReason: "quote_amount_too_low",
          quoteAmountFloor: { minimum: "777", actual: "111" },
        },
      },
    },
  };
  const reason = refillRouteAttemptReason(result, { method: "synthetic_route_method" });
  assert.equal(reason.method, "synthetic_route_method");
  assert.equal(reason.blockedReason, "quote_amount_too_low");
  assert.equal(reason.planBlockedReason, "quote_amount_too_low");
  assert.deepEqual(reason.quoteAmountFloor, { minimum: "777", actual: "111" });
});

test("refillRouteAttemptReason omits quoteAmountFloor when plan does not carry one", () => {
  const result = {
    json: {
      preparation: {
        blockedReason: "no_route",
        plan: { blockedReason: "no_route" },
      },
    },
  };
  const reason = refillRouteAttemptReason(result, { method: "synthetic_method" });
  assert.equal(reason.blockedReason, "no_route");
  assert.equal(reason.quoteAmountFloor, undefined);
});

test("routeExhaustionDeferral classifies single-method quote_amount_too_low as bridge_quote_amount_below_minimum", () => {
  const deferral = routeExhaustionDeferral([
    {
      method: "synthetic_method_a",
      blockedReason: "quote_amount_too_low",
      quoteAmountFloor: { minimum: "5", actual: "1" },
    },
  ]);
  assert.equal(deferral.routeDeferralReason, "bridge_quote_amount_below_minimum");
  assert.equal(deferral.routeDeferralAction, "defer_until_input_amount_meets_route_minimum_or_consolidate_inventory");
});

test("routeExhaustionDeferral keeps existing no_route taxonomy when only no_route was observed", () => {
  const deferral = routeExhaustionDeferral([
    { method: "synthetic_method_b", blockedReason: "no_route", planBlockedReason: "no_route" },
  ]);
  assert.equal(deferral.routeDeferralReason, "bridge_route_unavailable_gateway_no_route_no_alternate_provider");
});

test("routeExhaustionDeferral keeps existing taxonomy when quote_amount_too_low mixes with other reasons", () => {
  const deferral = routeExhaustionDeferral([
    { method: "synthetic_a", blockedReason: "quote_amount_too_low" },
    { method: "synthetic_b", blockedReason: "lifi_quote_rejected" },
  ]);
  // Falls through to mixed-provider behavior, not the amount-floor branch.
  assert.notEqual(deferral.routeDeferralReason, "bridge_quote_amount_below_minimum");
});
