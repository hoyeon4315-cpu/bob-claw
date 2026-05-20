import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  computePendleYtExitFromPosition,
  buildPendleYtExitFromPositionReport,
} from "../src/strategy/pendle-yt-exit-from-position.mjs";

const OPP = "pendle-direct:8453:0x6ae9";
const CHAIN = "base";

// Synthetic Pendle YT position mark carrying every dimensional invariant
// field. Defaults model a small canary: 0.5 YT-cbBTC with cbBTC underlying.
function ytMark({
  status = "open",
  assetAmount = 0.5,
  assetDecimals = 18,
  assetPriceUsd = 900,
  underlyingAssetSymbol = "cbBTC",
  underlyingAssetPriceUsd = 77000,
  valuationProvenance = "current_position_onchain",
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
    assetDecimals,
    shareBalance: "500000000000000000",
    assetPriceUsd,
    underlyingAssetSymbol,
    underlyingAssetPriceUsd,
    valuationProvenance,
    healthFactor: null,
    walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    freshness: "fresh",
    confidence: "verified_current",
    positionId: "protocol:base:pendle:...:yt",
  };
}

function canaryQueueWith({
  opportunityId = OPP,
  ytPriceInAsset = 0.012,
  impliedApyDecimal = 0.156,
  yearsToExpiry = 0.082,
  marketAddress = "0x6ae9",
  ytTokenAddress = "0xf90c",
  maturity = "2026-06-18T00:00:00.000Z",
  unit = "asset_per_yt",
  quotedAt = "2026-05-19T03:00:30.000Z",
  quoteIntent = "yt_market_swap",
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
              unit,
              quotedAt,
              quoteIntent,
            },
          },
        },
      },
    ],
  };
}

test("evidenced=true: dimensionally valid synthetic small position computes net USD from underlying price not asset slot", () => {
  // 0.5 YT × 0.012 (asset/YT) × 77000 ($/asset) = 462; − 0.06 cost floor = 461.94
  const mark = ytMark({ assetAmount: 0.5 });
  const queue = canaryQueueWith({ ytPriceInAsset: 0.012 });
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [mark],
    canaryQueue: queue,
  });
  assert.equal(result.evidenced, true);
  assert.equal(result.producerName, "pendle_yt_exit_from_position");
  assert.equal(result.underlyingAssetSymbol, "cbBTC");
  assert.equal(result.underlyingAssetPriceUsd, 77000);
  assert.equal(result.valuationProvenance, "current_position_onchain");
  assert.equal(result.quoteUnit, "asset_per_yt");
  assert.equal(result.quoteIntent, "yt_market_swap");
  assert.ok(Math.abs(result.exitAssetUnits - 0.006) < 1e-9);
  assert.ok(Math.abs(result.exitGrossUsd - 462) < 1e-6);
  assert.ok(Math.abs(result.costFloorUsd - 0.06) < 1e-9);
  assert.ok(Math.abs(result.expectedNetUsd - 461.94) < 1e-6);
});

test("invalid_input: rejects mark missing underlyingAssetPriceUsd even when assetAmount and ytPriceInAsset are finite", () => {
  const mark = ytMark();
  delete mark.underlyingAssetPriceUsd;
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [mark],
    canaryQueue: canaryQueueWith(),
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.invalidFields.includes("mark_underlying_asset_price_usd_missing"));
});

test("invalid_input: rejects when assetSymbol=YT and assetPriceUsd equals underlying full price (NAV misuse pattern)", () => {
  // Reproduces the current real-world defect: mark sets assetPriceUsd to the
  // full underlying USD price as if the YT token itself were worth one unit
  // of underlying. Producer rejects regardless of opportunityId.
  const mark = ytMark({ assetPriceUsd: 77000, underlyingAssetPriceUsd: 77000 });
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [mark],
    canaryQueue: canaryQueueWith(),
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.invalidFields.includes("mark_asset_price_usd_misapplies_underlying_full_price"));
});

test("invalid_input: rejects exitQuote without explicit unit=asset_per_yt", () => {
  const queue = canaryQueueWith();
  delete queue.queue[0].protocolBindingPlan.resolvedBinding.exitQuote.unit;
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [ytMark()],
    canaryQueue: queue,
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.invalidFields.includes("exit_quote_unit_not_asset_per_yt"));
});

test("invalid_input: rejects exitQuote without quotedAt or quoteIntent", () => {
  const queue = canaryQueueWith();
  delete queue.queue[0].protocolBindingPlan.resolvedBinding.exitQuote.quotedAt;
  delete queue.queue[0].protocolBindingPlan.resolvedBinding.exitQuote.quoteIntent;
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [ytMark()],
    canaryQueue: queue,
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.invalidFields.includes("exit_quote_quoted_at_missing"));
  assert.ok(result.invalidFields.includes("exit_quote_intent_missing"));
});

test("invalid_input: rejects when valuationProvenance is missing or not a current-position kind", () => {
  const mark = ytMark({ valuationProvenance: "stale_snapshot" });
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [mark],
    canaryQueue: canaryQueueWith(),
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.invalidFields.includes("mark_valuation_provenance_not_current_position"));
});

test("invalid_input: rejects when ytPriceInAsset > 1 (per-YT price cannot exceed underlying)", () => {
  const queue = canaryQueueWith({ ytPriceInAsset: 1.2 });
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [ytMark()],
    canaryQueue: queue,
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.invalidFields.includes("yt_price_in_asset_exceeds_one"));
});

test("invalid_input: rejects when mark lacks assetDecimals (cannot trust raw-vs-human unit interpretation)", () => {
  const mark = ytMark();
  delete mark.assetDecimals;
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [mark],
    canaryQueue: canaryQueueWith(),
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.invalidFields.includes("mark_asset_decimals_missing"));
});

test("real-world target fixture (mark.assetPriceUsd=77053 reused as underlying) returns evidenced=false with explicit invalid fields", () => {
  // Reproduces the exact shape of the current protocol-position-marks.jsonl
  // row for the target opportunity. No opportunityId / market address is
  // hardcoded into the producer; this is a generic dimensional rejection.
  const realMark = {
    event: "position_marked",
    status: "open",
    observedAt: "2026-05-19T09:03:07.079Z",
    opportunityId: OPP,
    chain: CHAIN,
    protocolId: "pendle",
    bindingKind: "pendle_market_swap",
    assetSymbol: "YT",
    assetAmount: 349.2417149865696,
    assetDecimals: 18,
    shareBalance: "349241714986569603215",
    assetPriceUsd: 77053,
    healthFactor: null,
    walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    freshness: "fresh",
    confidence: "verified_current",
    // NO underlyingAssetPriceUsd, NO underlyingAssetSymbol, NO valuationProvenance
  };
  const realQueue = {
    queue: [
      {
        opportunityId: OPP,
        chain: CHAIN,
        protocolId: "pendle",
        protocolBindingPlan: {
          bindingKind: "pendle_yt_buy_sell_redeem",
          resolvedBinding: {
            exitQuote: {
              source: "pendle_fair_value_model",
              outputUsd: 10,
              depthUsd: 10000,
              slippageBps: 5,
              ytPriceInAsset: 0.011710754641074295,
              impliedApyDecimal: 0.156,
              yearsToExpiry: 0.081,
              // NO unit, NO quotedAt, NO quoteIntent
            },
          },
        },
      },
    ],
  };
  const result = computePendleYtExitFromPosition({
    opportunityId: OPP,
    chain: CHAIN,
    protocolPositionMarks: [realMark],
    canaryQueue: realQueue,
  });
  assert.equal(result.evidenced, false);
  assert.ok(result.invalidFields.includes("mark_underlying_asset_symbol_missing"));
  assert.ok(result.invalidFields.includes("mark_underlying_asset_price_usd_missing"));
  assert.ok(result.invalidFields.includes("mark_valuation_provenance_missing"));
  assert.ok(result.invalidFields.includes("exit_quote_unit_not_asset_per_yt"));
  assert.ok(result.invalidFields.includes("exit_quote_quoted_at_missing"));
  assert.ok(result.invalidFields.includes("exit_quote_intent_missing"));
  // Should NOT emit fake $315K
  assert.equal(result.expectedNetUsd, undefined);
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
  const mark = { ...ytMark({ assetAmount: 1, underlyingAssetPriceUsd: 1000, assetPriceUsd: 12 }), chain: "ethereum" };
  const queue = {
    queue: [
      {
        opportunityId: OPP,
        chain: "ethereum",
        protocolId: "pendle",
        protocolBindingPlan: {
          bindingKind: "pendle_yt_buy_sell_redeem",
          resolvedBinding: {
            exitQuote: {
              ytPriceInAsset: 0.1,
              impliedApyDecimal: 0.2,
              yearsToExpiry: 0.5,
              unit: "asset_per_yt",
              quotedAt: "2026-05-19T03:00:30.000Z",
              quoteIntent: "yt_market_swap",
            },
          },
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

test("buildPendleYtExitFromPositionReport returns one row per unique open YT mark; invalidCount counts dimensional rejections", () => {
  const m1 = ytMark({ opportunityId: "opp-a", assetAmount: 10, underlyingAssetPriceUsd: 100, assetPriceUsd: 1.2 });
  const m2 = { ...ytMark({ opportunityId: "opp-b" }) };
  delete m2.underlyingAssetPriceUsd;
  const queue = {
    queue: [
      {
        opportunityId: "opp-a",
        chain: CHAIN,
        protocolId: "pendle",
        protocolBindingPlan: {
          bindingKind: "pendle_yt_buy_sell_redeem",
          resolvedBinding: {
            exitQuote: {
              ytPriceInAsset: 0.01,
              unit: "asset_per_yt",
              quotedAt: "2026-05-19T03:00:30.000Z",
              quoteIntent: "yt_market_swap",
            },
          },
        },
      },
      {
        opportunityId: "opp-b",
        chain: CHAIN,
        protocolId: "pendle",
        protocolBindingPlan: {
          bindingKind: "pendle_yt_buy_sell_redeem",
          resolvedBinding: {
            exitQuote: {
              ytPriceInAsset: 0.01,
              unit: "asset_per_yt",
              quotedAt: "2026-05-19T03:00:30.000Z",
              quoteIntent: "yt_market_swap",
            },
          },
        },
      },
    ],
  };
  const report = buildPendleYtExitFromPositionReport({
    protocolPositionMarks: [m1, m2],
    canaryQueue: queue,
  });
  assert.equal(report.openPositionCount, 2);
  assert.equal(report.evidencedCount, 1);
  assert.equal(report.invalidCount, 1);
});

test("report is read-only and never has signer/broadcast fields", () => {
  const report = buildPendleYtExitFromPositionReport({ protocolPositionMarks: [], canaryQueue: null });
  assert.equal(report.broadcastMode, "read_only_no_signer_dispatch");
  assert.equal(report.runtimeAuthority, "policy_engine_only");
});
