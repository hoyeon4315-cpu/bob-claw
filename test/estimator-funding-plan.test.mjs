import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEstimatorFundingPlan } from "../src/estimator/funding-plan.mjs";

const ADDRESS = "0x000000000000000000000000000000000000dEaD";
const WBTC_OFT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

test("funding plan aggregates highest shortfall per chain, token, and allowance", () => {
  const plan = buildEstimatorFundingPlan(
    {
      readinessRecords: [
        {
          observedAt: "2026-04-11T00:00:00.000Z",
          address: ADDRESS,
          routeKey: `bob:${WBTC_OFT}->base:${WBTC_OFT}`,
          amount: "10000",
          srcChain: "bob",
          dstChain: "base",
          srcToken: WBTC_OFT,
          native: {
            balanceWei: "100",
            requiredWei: "1000",
            ok: false,
            shortfallWei: "900",
          },
          token: {
            token: WBTC_OFT,
            actual: "0",
            required: "10000",
            ok: false,
            shortfall: "10000",
          },
          allowance: {
            spender: WBTC_OFT,
            actual: "0",
            required: "10000",
            ok: false,
            shortfall: "10000",
          },
          overallReady: false,
        },
        {
          observedAt: "2026-04-11T00:01:00.000Z",
          address: ADDRESS,
          routeKey: `bob:${WBTC_OFT}->ethereum:${WBTC_OFT}`,
          amount: "25000",
          srcChain: "bob",
          dstChain: "ethereum",
          srcToken: WBTC_OFT,
          native: {
            balanceWei: "100",
            requiredWei: "1400",
            ok: false,
            shortfallWei: "1300",
          },
          token: {
            token: WBTC_OFT,
            actual: "5000",
            required: "25000",
            ok: false,
            shortfall: "20000",
          },
          allowance: {
            spender: "0x1111111111111111111111111111111111111111",
            actual: "5000",
            required: "25000",
            ok: false,
            shortfall: "20000",
          },
          overallReady: false,
        },
      ],
      readinessFailures: [
        {
          observedAt: "2026-04-11T00:02:00.000Z",
          address: ADDRESS,
          routeKey: `base:${WBTC_OFT}->bob:${WBTC_OFT}`,
          amount: "10000",
          reason: "missing_tx_data",
        },
      ],
    },
    { address: ADDRESS },
  );

  assert.equal(plan.routeCount, 2);
  assert.equal(plan.readyRouteCount, 0);
  assert.equal(plan.blockedRouteCount, 2);
  assert.equal(plan.skippedRouteCount, 1);
  assert.deepEqual(plan.failureReasons, [{ reason: "missing_tx_data", count: 1 }]);
  assert.equal(plan.chains.length, 1);
  assert.equal(plan.chains[0].native.shortfall, "1300");
  assert.equal(plan.chains[0].tokens[0].shortfall, "20000");
  assert.equal(plan.chains[0].tokens[0].actual, "5000");
  assert.equal(plan.chains[0].tokens[0].actualDecimal, 0.00005);
  assert.equal(plan.chains[0].allowances[0].shortfall, "20000");
  assert.equal(plan.chains[0].allowances[0].actual, "5000");
  assert.equal(plan.chains[0].allowances[0].actualDecimal, 0.00005);
});

test("funding plan keeps ready routes and filters by address", () => {
  const plan = buildEstimatorFundingPlan(
    {
      readinessRecords: [
        {
          observedAt: "2026-04-11T00:00:00.000Z",
          address: ADDRESS,
          routeKey: `bob:${WBTC_OFT}->base:${WBTC_OFT}`,
          amount: "10000",
          srcChain: "bob",
          dstChain: "base",
          srcToken: WBTC_OFT,
          native: {
            balanceWei: "5000",
            requiredWei: "1000",
            ok: true,
            shortfallWei: "0",
          },
          token: {
            token: WBTC_OFT,
            actual: "10000",
            required: "10000",
            ok: true,
            shortfall: "0",
          },
          allowance: {
            spender: WBTC_OFT,
            actual: "10000",
            required: "10000",
            ok: true,
            shortfall: "0",
          },
          overallReady: true,
        },
        {
          observedAt: "2026-04-11T00:00:00.000Z",
          address: "0x1111111111111111111111111111111111111111",
          routeKey: `bob:${WBTC_OFT}->base:${WBTC_OFT}`,
          amount: "10000",
          srcChain: "bob",
          dstChain: "base",
          srcToken: WBTC_OFT,
          native: {
            balanceWei: "0",
            requiredWei: "1000",
            ok: false,
            shortfallWei: "1000",
          },
          token: null,
          allowance: null,
          overallReady: false,
        },
      ],
      readinessFailures: [],
    },
    { address: ADDRESS },
  );

  assert.equal(plan.routeCount, 1);
  assert.equal(plan.readyRouteCount, 1);
  assert.equal(plan.blockedRouteCount, 0);
  assert.equal(plan.chains[0].routes[0].overallReady, true);
  assert.equal(plan.chains[0].native.shortfall, "0");
  assert.equal(plan.chains[0].tokens[0].actual, "10000");
  assert.equal(plan.chains[0].allowances[0].actual, "10000");
});
