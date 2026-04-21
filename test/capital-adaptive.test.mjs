import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPITAL_ADAPTIVE_RATIOS,
  deriveCaps,
  projectToUsd,
} from "../src/config/capital-adaptive.mjs";

test("ratios are frozen (invariant #5: cap = commit)", () => {
  assert.throws(() => {
    CAPITAL_ADAPTIVE_RATIOS.perTxBtcShare = 0.5;
  });
});

test("deriveCaps: rejects non-integer or negative sats", () => {
  assert.throws(() => deriveCaps(-1));
  assert.throws(() => deriveCaps(1.5));
  assert.throws(() => deriveCaps("100"));
});

test("deriveCaps: zero balance => zero caps, below floor, no new entries", () => {
  const c = deriveCaps(0);
  assert.equal(c.perTxBtcSats, 0);
  assert.equal(c.perDayBtcSats, 0);
  assert.equal(c.maxDailyLossBtcSats, 0);
  assert.equal(c.newEntriesAllowed, false);
  assert.equal(c.belowOperatingFloor, true);
});

test("deriveCaps: 1 BTC => 5M / 20M / 3M sats", () => {
  const oneBtc = 100_000_000;
  const c = deriveCaps(oneBtc);
  assert.equal(c.perTxBtcSats, 5_000_000);
  assert.equal(c.perDayBtcSats, 20_000_000);
  assert.equal(c.maxDailyLossBtcSats, 3_000_000);
  assert.equal(c.newEntriesAllowed, true);
});

test("deriveCaps: balance just above floor enables new entries", () => {
  const c = deriveCaps(50_000);
  assert.equal(c.belowOperatingFloor, false);
  assert.equal(c.newEntriesAllowed, true);
});

test("deriveCaps: balance just below floor blocks new entries", () => {
  const c = deriveCaps(49_999);
  assert.equal(c.belowOperatingFloor, true);
  assert.equal(c.newEntriesAllowed, false);
});

test("deriveCaps: per-strategy caps scale with balance and sum to ratios total", () => {
  const oneBtc = 100_000_000;
  const c = deriveCaps(oneBtc);
  const total = Object.values(c.perStrategyBtcSats).reduce((a, b) => a + b, 0);
  const ratioTotal = Object.values(CAPITAL_ADAPTIVE_RATIOS.perStrategyShares)
    .reduce((a, b) => a + b, 0);
  const expected = Math.floor(oneBtc * ratioTotal);
  // floor-rounding each share can drop a few sats; allow small tolerance
  assert.ok(Math.abs(total - expected) < Object.keys(c.perStrategyBtcSats).length);
});

test("deriveCaps: result is frozen", () => {
  const c = deriveCaps(100_000_000);
  assert.throws(() => {
    c.perTxBtcSats = 999;
  });
  assert.throws(() => {
    c.perStrategyBtcSats.newThing = 1;
  });
});

test("deriveCaps: doubling balance doubles caps (linear)", () => {
  const a = deriveCaps(100_000_000);
  const b = deriveCaps(200_000_000);
  assert.equal(b.perTxBtcSats, 2 * a.perTxBtcSats);
  assert.equal(b.perDayBtcSats, 2 * a.perDayBtcSats);
});

test("projectToUsd: display-only conversion", () => {
  const caps = deriveCaps(100_000_000);
  const usd = projectToUsd(caps, 100_000);
  assert.equal(usd.operatingUsd, 100_000);
  assert.equal(usd.perTxUsd, 5_000);
  assert.equal(usd.projectionOnly, true);
});

test("projectToUsd: rejects bad price", () => {
  const caps = deriveCaps(100_000_000);
  assert.throws(() => projectToUsd(caps, 0));
  assert.throws(() => projectToUsd(caps, -1));
  assert.throws(() => projectToUsd(caps, NaN));
});
