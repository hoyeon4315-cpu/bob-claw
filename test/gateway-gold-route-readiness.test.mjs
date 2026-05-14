import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGatewayGoldRouteSurface,
  buildGatewayGoldRouteReadinessSlice,
  evaluateGatewayGoldRouteReadiness,
} from "../src/strategy/gateway-gold-route-readiness.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const PAXG = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";
const XAUT = "0x68749665FF8D2d112Fa859AA293F07A622782F38";

function btcToGold(chain = "ethereum", token = PAXG) {
  return {
    srcChain: "bitcoin",
    dstChain: chain,
    srcToken: ZERO,
    dstToken: token,
  };
}

function goldToBtc(chain = "ethereum", token = PAXG) {
  return {
    srcChain: chain,
    dstChain: "bitcoin",
    srcToken: token,
    dstToken: ZERO,
  };
}

test("gold route surface marks explicit blockers when no routes exist", () => {
  const surface = buildGatewayGoldRouteSurface([]);
  assert.equal(surface.routeAvailable, false);
  assert.equal(surface.bestGoldAsset, null);
  assert.deepEqual(surface.blockers, ["route_not_available_yet", "gateway_gold_route_missing"]);
});

test("gold route surface identifies XAUT round-trip route availability by token address", () => {
  const surface = buildGatewayGoldRouteSurface([btcToGold("ethereum", XAUT), goldToBtc("ethereum", XAUT)]);
  assert.equal(surface.routeAvailable, true);
  assert.equal(surface.bestGoldAsset, "XAUT");
  assert.deepEqual(surface.blockers, []);
  assert.equal(surface.routePairs.length, 1);
  assert.equal(surface.routePairs[0].assetTicker, "XAUT");
  assert.equal(surface.routePairs[0].routeAvailable, true);
});

test("gold readiness slice falls back to route detector blockers without report", () => {
  const slice = buildGatewayGoldRouteReadinessSlice({ routes: [] });
  assert.equal(slice.routeAvailable, false);
  assert.equal(slice.blocker, "route_not_available_yet");
  assert.equal(slice.liveEligible, false);
  assert.deepEqual(slice.familyTargets, ["gold_rotation", "tokenized_gold_rotation", "tokenized_reserve_sleeve"]);
});

test("gold readiness slice exposes deterministic live eligibility from quote preflight", () => {
  const slice = buildGatewayGoldRouteReadinessSlice({
    routes: [btcToGold("ethereum", XAUT), goldToBtc("ethereum", XAUT)],
    report: {
      observedAt: "2026-05-14T00:00:00.000Z",
      routeAvailable: true,
      bestGoldAsset: "XAUT",
      blocker: null,
      blockers: [],
      quoteObservedAt: "2026-05-14T00:00:00.000Z",
      roundTripCostBtc: 0.00000125,
      roundTripCostUsd: 0.1,
      slippageBps: 4.2,
      minViableCanarySizeSats: "100000",
      liveEligible: true,
      preflight: {
        attempted: true,
        successfulAttemptCount: 1,
      },
    },
  });

  assert.equal(slice.routeAvailable, true);
  assert.equal(slice.bestGoldAsset, "XAUT");
  assert.equal(slice.roundTripCostUsd, 0.1);
  assert.equal(slice.minViableCanarySizeSats, "100000");
  assert.equal(slice.preflight.attempted, true);
  assert.equal(slice.liveEligible, true);
});

test("gold quote preflight omits sender on native BTC entry quotes", async () => {
  const calls = [];
  const client = {
    async getQuote(params) {
      calls.push(params);
      if (params.srcChain === "bitcoin") {
        assert.equal(params.sender, undefined);
        return {
          body: {
            onramp: {
              outputAmount: { amount: "100000", address: XAUT, chain: "ethereum" },
            },
          },
          latencyMs: 1,
        };
      }
      assert.equal(params.sender, "0x000000000000000000000000000000000000dEaD");
      return {
        body: {
          offramp: {
            outputAmount: { amount: "99000", address: ZERO, chain: "bitcoin" },
          },
        },
        latencyMs: 1,
      };
    },
  };

  const report = await evaluateGatewayGoldRouteReadiness({
    client,
    routes: [btcToGold("ethereum", XAUT), goldToBtc("ethereum", XAUT)],
    sampleSats: ["100000"],
    sender: "0x000000000000000000000000000000000000dEaD",
    btcRecipient: "1BitcoinEaterAddressDontSendf59kuE",
    prices: { btc: 100000, xaut: 4000 },
    now: "2026-05-14T00:00:00.000Z",
  });

  assert.equal(report.preflight.successfulAttemptCount, 1);
  assert.equal(report.liveEligible, true);
  assert.equal(calls.length, 2);
});

test("gold quote preflight reports exit quote blocker when XAUT entry quote succeeds", async () => {
  const client = {
    async getQuote(params) {
      if (params.srcChain === "bitcoin") {
        return {
          body: {
            onramp: {
              outputAmount: { amount: "100000", address: XAUT, chain: "ethereum" },
            },
          },
          latencyMs: 1,
        };
      }
      throw new Error("Gateway request failed: HTTP 500 INTERNAL_ERROR Unsupported API version");
    },
  };

  const report = await evaluateGatewayGoldRouteReadiness({
    client,
    routes: [btcToGold("ethereum", XAUT), goldToBtc("ethereum", XAUT)],
    sampleSats: ["100000"],
    sender: "0x000000000000000000000000000000000000dEaD",
    btcRecipient: "1BitcoinEaterAddressDontSendf59kuE",
    prices: { btc: 100000, xaut: 4000 },
    now: "2026-05-14T00:00:00.000Z",
  });

  assert.equal(report.blocker, "gateway_gold_exit_quote_preflight_failed");
  assert.deepEqual(report.blockers, ["gateway_gold_exit_quote_preflight_failed"]);
  assert.equal(report.liveEligible, false);
  assert.equal(
    report.onChainExitLiquidityStatus.XAUT.exitLiquidityStatus,
    "entry_quote_available_exit_quote_unavailable",
  );
});
