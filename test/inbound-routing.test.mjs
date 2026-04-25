import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInboundRoutingDecision, buildInboundRoutingPlan } from "../src/treasury/inbound-routing.mjs";

test("native BTC deposits route to Gateway onramp", () => {
  const decision = buildInboundRoutingDecision({
    event: {
      eventId: "e1",
      chain: "bitcoin",
      token: "0x0000000000000000000000000000000000000000",
      amount: "100000",
      amountDecimal: 0.001,
      observedAt: "2026-04-25T00:00:00.000Z",
    },
  });

  assert.equal(decision.status, "route_ready");
  assert.equal(decision.job.targetStrategyId, "gateway-btc-onramp");
  assert.equal(decision.job.targetChain, "base");
});

test("stable deposits route to Merkl portfolio float", () => {
  const decision = buildInboundRoutingDecision({
    event: {
      eventId: "e2",
      chain: "base",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "25000000",
      amountDecimal: 25,
      observedAt: "2026-04-25T00:00:00.000Z",
    },
  });

  assert.equal(decision.status, "route_ready");
  assert.equal(decision.routeType, "stable_to_merkl_portfolio_float");
  assert.equal(decision.job.targetStrategyId, "gateway_native_asset_conversion_sleeve");
});

test("unknown deposits only produce a pending whitelist record", () => {
  const plan = buildInboundRoutingPlan({
    events: [
      {
        eventId: "e3",
        chain: "base",
        token: "0x9999999999999999999999999999999999999999",
        amount: "1",
        amountDecimal: 1,
        observedAt: "2026-04-25T00:00:00.000Z",
      },
    ],
  });

  assert.equal(plan.summary.manualReviewCount, 1);
  assert.equal(plan.jobs.length, 0);
  assert.equal(plan.pendingWhitelist[0].requiredAction, "commit_token_whitelist_or_leave_manual_only");
});
