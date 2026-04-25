import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeGatewayRoundTripQuote } from "../src/strategy/snapshots/gateway-round-trip-snapshot.mjs";

const BTC = 60_000;
const SATS = 100_000_000;

// Entry: 1_000_000 sats = 0.01 BTC = $600. Output 599 USDC, fees 0.5 USDC.
// → slippage 0.5 USD → 8 bps; fees 0.5 USD → 8 bps; total 17 bps.
function entry(overrides = {}) {
  return {
    inputAmount: { amount: "1000000" },             // sats
    outputAmount: { amount: String(599 * 1e6) },    // USDC raw (6 dec)
    fees: { amount: String(0.4 * 1e6) },
    executionFees: { amount: String(0.1 * 1e6) },
    ...overrides,
  };
}

// Exit: 600 USDC in → 998000 sats out (0.00998 BTC = $598.8), fees 0.4 USD
// = 666 sats. inputUsd = 600. outputUsd = 598.8. feesUsd = 0.4.
// slippageUsd = 600 − 598.8 − 0.4 = 0.8 → 13 bps. feesBps = 7. total 20.
function exit(overrides = {}) {
  return {
    inputAmount: { amount: String(600 * 1e6) },     // USDC raw
    outputAmount: { amount: String(998000) },       // sats
    fees: { amount: String(666) },                  // sats
    executionFees: { amount: "0" },
    ...overrides,
  };
}

const now = "2026-04-21T12:00:00Z";
const fresh = "2026-04-21T11:59:00Z"; // 60s ago
const stale = "2026-04-21T11:00:00Z"; // 1h ago

describe("gateway-round-trip-snapshot", () => {
  test("rejects bad btcPriceUsd", () => {
    assert.throws(() => normalizeGatewayRoundTripQuote({ btcPriceUsd: 0 }));
    assert.throws(() => normalizeGatewayRoundTripQuote({ btcPriceUsd: -1 }));
    assert.throws(() => normalizeGatewayRoundTripQuote({ btcPriceUsd: NaN }));
  });

  test("happy path: both fresh, market fields populated", () => {
    const out = normalizeGatewayRoundTripQuote({
      entryQuote: entry(),
      exitQuote: exit(),
      entryQuoteFetchedAt: fresh,
      exitQuoteFetchedAt: fresh,
      btcPriceUsd: BTC,
      now,
    });
    assert.equal(out.partial, false);
    assert.equal(out.missing.length, 0);
    assert.equal(out.market.gatewayQuoteFresh, true);
    assert.equal(typeof out.market.entrySlippageBps, "number");
    assert.equal(typeof out.market.exitSlippageBps, "number");
    assert.equal(
      out.market.gatewayRoundTripCostBps,
      out.sides.entry.totalBps + out.sides.exit.totalBps,
    );
    assert.equal(out.market.offrampCostBps, out.sides.exit.totalBps);
    // Entry: input $600, fees $0.5, output $599 → slip $0.5
    assert.equal(out.sides.entry.feesBps, 8); // 0.5/600 * 10000 = 8.33 → 8
    assert.equal(out.sides.entry.slippageBps, 8); // 0.5/600 → 8
    assert.ok(Object.isFrozen(out));
    assert.ok(Object.isFrozen(out.market));
    assert.ok(Object.isFrozen(out.sides));
  });

  test("entry quote missing → entry fields null, partial true", () => {
    const out = normalizeGatewayRoundTripQuote({
      entryQuote: null,
      exitQuote: exit(),
      entryQuoteFetchedAt: fresh,
      exitQuoteFetchedAt: fresh,
      btcPriceUsd: BTC,
      now,
    });
    assert.equal(out.partial, true);
    assert.equal(out.market.entrySlippageBps, null);
    assert.equal(out.market.gatewayRoundTripCostBps, null);
    assert.equal(out.market.gatewayQuoteFresh, false);
    assert.ok(out.missing.includes("entry_quote_payload_missing"));
  });

  test("exit quote missing → offrampCostBps null", () => {
    const out = normalizeGatewayRoundTripQuote({
      entryQuote: entry(),
      exitQuote: null,
      entryQuoteFetchedAt: fresh,
      exitQuoteFetchedAt: fresh,
      btcPriceUsd: BTC,
      now,
    });
    assert.equal(out.market.offrampCostBps, null);
    assert.equal(out.market.gatewayRoundTripCostBps, null);
    assert.ok(out.missing.includes("exit_quote_payload_missing"));
  });

  test("stale entry quote → not fresh, missing entry_quote_stale", () => {
    const out = normalizeGatewayRoundTripQuote({
      entryQuote: entry(),
      exitQuote: exit(),
      entryQuoteFetchedAt: stale,
      exitQuoteFetchedAt: fresh,
      btcPriceUsd: BTC,
      now,
    });
    assert.equal(out.market.gatewayQuoteFresh, false);
    assert.equal(out.sides.entry.fresh, false);
    assert.equal(out.sides.exit.fresh, true);
    assert.ok(out.missing.includes("entry_quote_stale"));
  });

  test("missing fetchedAt timestamps surface explicit missing entries", () => {
    const out = normalizeGatewayRoundTripQuote({
      entryQuote: entry(),
      exitQuote: exit(),
      entryQuoteFetchedAt: null,
      exitQuoteFetchedAt: null,
      btcPriceUsd: BTC,
      now,
    });
    assert.equal(out.market.gatewayQuoteFresh, false);
    assert.ok(out.missing.includes("entry_quote_age_unknown"));
    assert.ok(out.missing.includes("exit_quote_age_unknown"));
  });

  test("malformed amount fields → reason surfaced, no NaN leak", () => {
    const out = normalizeGatewayRoundTripQuote({
      entryQuote: { inputAmount: { amount: "abc" }, outputAmount: { amount: "1" } },
      exitQuote: exit(),
      entryQuoteFetchedAt: fresh,
      exitQuoteFetchedAt: fresh,
      btcPriceUsd: BTC,
      now,
    });
    assert.equal(out.market.entrySlippageBps, null);
    assert.ok(out.missing.includes("entry_quote_amount_fields_missing"));
  });

  test("custom maxQuoteAgeMs respected", () => {
    const out = normalizeGatewayRoundTripQuote({
      entryQuote: entry(),
      exitQuote: exit(),
      entryQuoteFetchedAt: fresh, // 60s
      exitQuoteFetchedAt: fresh,
      btcPriceUsd: BTC,
      now,
      maxQuoteAgeMs: 10_000, // 10s
    });
    assert.equal(out.market.gatewayQuoteFresh, false);
    assert.ok(out.missing.includes("entry_quote_stale"));
  });

  test("future-dated quote treated as not-fresh (negative age)", () => {
    const out = normalizeGatewayRoundTripQuote({
      entryQuote: entry(),
      exitQuote: exit(),
      entryQuoteFetchedAt: "2026-04-21T13:00:00Z", // 1h in the future
      exitQuoteFetchedAt: fresh,
      btcPriceUsd: BTC,
      now,
    });
    assert.equal(out.sides.entry.fresh, false);
    assert.equal(out.market.gatewayQuoteFresh, false);
  });
});
