import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPendleFairValueQuote, PENDLE_V4_ROUTER } from "../src/research/pendle-yt-on-chain-quote.mjs";

const NOW = new Date("2026-05-11T00:00:00Z").getTime();
const SIX_MONTHS_MS = 6 * 30 * 24 * 3600 * 1000;

test("Pendle V4 Router address is the documented canonical singleton", () => {
  assert.equal(PENDLE_V4_ROUTER, "0x888888888889758F76e7103c6CbF23ABbF58F946");
});

test("fair-value quote returns PT spot price from impliedApy + maturity", () => {
  const q = buildPendleFairValueQuote({
    impliedApyDecimal: 0.15,
    expiryMs: NOW + SIX_MONTHS_MS,
    now: NOW,
    notionalUsd: 10,
    marketTvlUsd: 2_000_000,
  });
  assert.equal(q.source, "pendle_fair_value_model");
  assert.ok(q.ptPriceInAsset > 0.9 && q.ptPriceInAsset < 1.0, `pt price ${q.ptPriceInAsset}`);
  assert.ok(q.ytPriceInAsset > 0 && q.ytPriceInAsset < 0.1, `yt price ${q.ytPriceInAsset}`);
  assert.equal(q.outputUsd, 10);
  assert.ok(q.depthUsd >= 10);
  assert.ok(q.slippageBps >= 5);
});

test("fair-value quote rejects missing implied apy", () => {
  const q = buildPendleFairValueQuote({
    impliedApyDecimal: null,
    expiryMs: NOW + SIX_MONTHS_MS,
    now: NOW,
  });
  assert.equal(q.error, "impliedApy_missing");
});

test("fair-value quote rejects missing expiry", () => {
  const q = buildPendleFairValueQuote({
    impliedApyDecimal: 0.10,
    expiryMs: null,
    now: NOW,
  });
  assert.equal(q.error, "expiry_missing");
});

test("longer maturity widens the PT discount and YT value share", () => {
  const sixMonth = buildPendleFairValueQuote({
    impliedApyDecimal: 0.10,
    expiryMs: NOW + SIX_MONTHS_MS,
    now: NOW,
  });
  const twoYear = buildPendleFairValueQuote({
    impliedApyDecimal: 0.10,
    expiryMs: NOW + 2 * 365 * 24 * 3600 * 1000,
    now: NOW,
  });
  assert.ok(twoYear.ytPriceInAsset > sixMonth.ytPriceInAsset);
  assert.ok(twoYear.ptPriceInAsset < sixMonth.ptPriceInAsset);
});

test("higher TVL reduces slippage bps for a fixed notional", () => {
  const small = buildPendleFairValueQuote({
    impliedApyDecimal: 0.10,
    expiryMs: NOW + SIX_MONTHS_MS,
    now: NOW,
    notionalUsd: 10,
    marketTvlUsd: 100_000,
  });
  const large = buildPendleFairValueQuote({
    impliedApyDecimal: 0.10,
    expiryMs: NOW + SIX_MONTHS_MS,
    now: NOW,
    notionalUsd: 10,
    marketTvlUsd: 100_000_000,
  });
  assert.ok(large.slippageBps <= small.slippageBps);
});
