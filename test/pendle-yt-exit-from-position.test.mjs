import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  computePendleYtExitFromPosition,
  buildPendleYtExitFromPositionReport,
} from "../src/strategy/pendle-yt-exit-from-position.mjs";

const OPP = "pendle-direct:8453:0x6ae9";
const CHAIN = "base";

function ytMark({
  status = "open",
  assetAmount = 349.2417,
  assetPriceUsd = 77000,
  observedAt = "2026-05-19T03:00:00.000Z",
  opportunityId = OPP,
  chain = CHAIN,
} = {}) {
  return {
    event: "position_marked",
    status,
    observedAt,
    opportunityId,
    chain,
    protocolId: "pendle",
    bindingKind: "pendle_market_swap",
    assetSymbol: "YT",
    assetAmount,
    shareBalance: "349241714986569603215",
    assetPriceUsd,
    healthFactor: null,
    walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    freshness: "fresh",
    confidence: "verified_current",
    positionId: "protocol:base:pendle:...:yt",
  };
}

function canaryQueueWith({
  opportunityId = OPP,
  ytPriceInAsset = 0.011764,
  impliedApyDecimal = 0.156,
  yearsToExpiry = 0.082,
  marketAddress = "0x6ae9",
  ytTokenAddress = "0xf90c",
  maturity = "2026-06-18T00:00:00.000Z",
} = {}) {
  return {
    queue: [
      {
        opportunityId,
        chain: CHAIN,
        protocolId: "pendle",
        protocolBindingPlan: {
          bindingKind: "pendle_yt_buy_sell_redeem",
          resolvedBinding: {
            marketAddress,
            ytTokenAddress,
            maturity,
            ytExpiry: maturity,
            exitQuote: {
              source: "pendle_fair_value_model",
              outputUsd: 10,
              depthUsd: 10000,
              slippageBps: 5,
              ytPriceInAsset,
              impliedApyDecimal,
              yearsToExpiry,
            },
          },
        },
      },
    ],
  };
}

test("evidenced=true: computes true expectedNetUsd from actual share balance × ytPriceInAsset × assetPriceUsd minus chain cost floor", () => {
  const mark = ytMark({ assetAmount: 100, assetPriceUsd: 50000 });
  const queue = canaryQueueWith({ ytPriceInAsset: 0.02 });
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [mark],
    canaryQueue: queue,
  });
  assert.equal(result.evidenced, true);
  assert.equal(result.producerName, "pendle_yt_exit_from_position");
  assert.equal(result.ytAmount, 100);
  assert.equal(result.ytPriceInAsset, 0.02);
  assert.equal(result.assetPriceUsd, 50000);
  // 100 * 0.02 = 2 asset units
  assert.ok(Math.abs(result.exitAssetUnits - 2) < 1e-9);
  // 2 * 50000 = 100000 gross
  assert.ok(Math.abs(result.exitGrossUsd - 100000) < 1e-6);
  // base chain: exit 0.01 + gas 0.05 = 0.06
  assert.ok(Math.abs(result.costFloorUsd - 0.06) < 1e-9);
  assert.ok(Math.abs(result.expectedNetUsd - 99999.94) < 1e-6);
  assert.equal(result.chainCostProfile, "base");
});

test("evidenced=false: missingFields lists exact gaps when canary queue is null", () => {
  const mark = ytMark();
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [mark],
    canaryQueue: null,
  });
  assert.equal(result.evidenced, false);
  assert.deepEqual(result.missingFields, ["canary_queue_item", "resolved_binding", "binding_exit_quote"]);
  assert.equal(result.producerName, "pendle_yt_exit_from_position");
});

test("evidenced=false: missingFields lists position_mark when no matching mark", () => {
  const queue = canaryQueueWith();
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [],
    canaryQueue: queue,
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.missingFields.includes("position_mark"));
});

test("opportunityId filter: cross-opp marks do not satisfy", () => {
  const otherMark = ytMark({ opportunityId: "other-opp" });
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [otherMark],
    canaryQueue: canaryQueueWith(),
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.missingFields.includes("position_mark"));
});

test("ignores non-YT pendle marks (PT, LP)", () => {
  const ptMark = { ...ytMark(), assetSymbol: "PT" };
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [ptMark],
    canaryQueue: canaryQueueWith(),
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.missingFields.includes("position_mark"));
});

test("ignores closed marks", () => {
  const closedMark = { ...ytMark(), status: "closed" };
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [closedMark],
    canaryQueue: canaryQueueWith(),
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.missingFields.includes("position_mark"));
});

test("ethereum chain uses higher exit + gas cost floor", () => {
  const mark = { ...ytMark({ assetAmount: 1, assetPriceUsd: 1000 }), chain: "ethereum" };
  const queue = {
    queue: [
      {
        opportunityId: OPP,
        chain: "ethereum",
        protocolId: "pendle",
        protocolBindingPlan: {
          bindingKind: "pendle_yt_buy_sell_redeem",
          resolvedBinding: { exitQuote: { ytPriceInAsset: 0.1, impliedApyDecimal: 0.2, yearsToExpiry: 0.5 } },
        },
      },
    ],
  };
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: "ethereum",
    protocolPositionMarks: [mark],
    canaryQueue: queue,
  });
  assert.equal(result.evidenced, true);
  // ethereum: exit 0.05 + gas 1.20 = 1.25
  assert.ok(Math.abs(result.costFloorUsd - 1.25) < 1e-9);
});

test("buildPendleYtExitFromPositionReport returns one row per unique open YT mark", () => {
  const m1 = ytMark({ opportunityId: "opp-a", assetAmount: 10, assetPriceUsd: 100 });
  const m2 = ytMark({ opportunityId: "opp-b", assetAmount: 20, assetPriceUsd: 200 });
  const queue = {
    queue: [
      {
        opportunityId: "opp-a",
        chain: CHAIN,
        protocolId: "pendle",
        protocolBindingPlan: {
          bindingKind: "pendle_yt_buy_sell_redeem",
          resolvedBinding: { exitQuote: { ytPriceInAsset: 0.01 } },
        },
      },
      {
        opportunityId: "opp-b",
        chain: CHAIN,
        protocolId: "pendle",
        protocolBindingPlan: {
          bindingKind: "pendle_yt_buy_sell_redeem",
          resolvedBinding: { exitQuote: { ytPriceInAsset: 0.01 } },
        },
      },
    ],
  };
  const report = buildPendleYtExitFromPositionReport({
    protocolPositionMarks: [m1, m2],
    canaryQueue: queue,
  });
  assert.equal(report.openPositionCount, 2);
  assert.equal(report.evidencedCount, 2);
  assert.equal(report.results.length, 2);
});

test("report is read-only and never has signer/broadcast fields", () => {
  const report = buildPendleYtExitFromPositionReport({ protocolPositionMarks: [], canaryQueue: null });
  assert.equal(report.broadcastMode, "read_only_no_signer_dispatch");
  assert.equal(report.runtimeAuthority, "policy_engine_only");
});
