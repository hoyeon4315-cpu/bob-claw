import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAdaptiveCapitalPlan } from "../src/executor/capital/adaptive-caps.mjs";

const SATS = 100_000_000; // 1 BTC
const PRICE = 100_000; // 1 BTC = 100k USD

const stubStatic = [
  {
    strategyId: "S1_moonwell_usdc_pendle_pt_lbtc",
    autoExecute: true,
    caps: { perTxUsd: 500, perDayUsd: 5000, maxDailyLossUsd: 250 },
  },
  {
    strategyId: "legacy-strategy",
    autoExecute: false,
    caps: { perTxUsd: 25, perDayUsd: 100, maxDailyLossUsd: 15 },
  },
];

test("rejects non-finite sats", () => {
  assert.throws(() => buildAdaptiveCapitalPlan({ operatingBtcSats: NaN, btcPriceUsd: PRICE }));
  assert.throws(() => buildAdaptiveCapitalPlan({ operatingBtcSats: -1, btcPriceUsd: PRICE }));
});

test("rejects non-positive btc price", () => {
  assert.throws(() => buildAdaptiveCapitalPlan({ operatingBtcSats: SATS, btcPriceUsd: 0 }));
  assert.throws(() => buildAdaptiveCapitalPlan({ operatingBtcSats: SATS, btcPriceUsd: -1 }));
});

test("below operating floor => halt new entries", () => {
  const plan = buildAdaptiveCapitalPlan({
    operatingBtcSats: 10_000,
    btcPriceUsd: PRICE,
    staticCaps: stubStatic,
  });
  assert.equal(plan.belowOperatingFloor, true);
  assert.equal(plan.newEntriesAllowed, false);
  for (const s of plan.strategies) {
    assert.equal(s.newEntriesAllowed, false);
  }
  assert.ok(plan.summary.haltedByFloorCount >= 1);
});

test("effective cap = min(static, adaptive)", () => {
  const plan = buildAdaptiveCapitalPlan({
    operatingBtcSats: SATS,
    btcPriceUsd: PRICE,
    staticCaps: stubStatic,
  });
  const s1 = plan.strategies.find((s) => s.strategyId === "S1_moonwell_usdc_pendle_pt_lbtc");
  assert.ok(s1);
  assert.ok(s1.effectiveCapsUsd.perTxUsd <= s1.staticCapsUsd.perTxUsd);
  assert.ok(s1.effectiveCapsUsd.perTxUsd <= s1.adaptiveCapsUsd.perTxUsd);
});

test("adaptive dominates when static is huge", () => {
  const staticCaps = [
    {
      strategyId: "S1_moonwell_usdc_pendle_pt_lbtc",
      autoExecute: true,
      caps: { perTxUsd: 1_000_000, perDayUsd: 10_000_000, maxDailyLossUsd: 500_000 },
    },
  ];
  const plan = buildAdaptiveCapitalPlan({
    operatingBtcSats: SATS,
    btcPriceUsd: PRICE,
    staticCaps,
  });
  const s1 = plan.strategies[0];
  assert.equal(s1.bindingConstraint.perTxUsd, "adaptive");
  assert.ok(s1.effectiveCapsUsd.perTxUsd < 1_000_000);
});

test("adaptive dominates even when float is huge (static neutralized)", () => {
  const plan = buildAdaptiveCapitalPlan({
    operatingBtcSats: SATS * 100,
    btcPriceUsd: PRICE,
    staticCaps: stubStatic,
  });
  const legacy = plan.strategies.find((s) => s.strategyId === "legacy-strategy");
  assert.equal(legacy.bindingConstraint.perTxUsd, "adaptive");
  assert.equal(legacy.effectiveCapsUsd.perTxUsd, 25);
});

test("unknown strategy id falls back to global ceiling, not adaptive share", () => {
  const plan = buildAdaptiveCapitalPlan({
    operatingBtcSats: SATS,
    btcPriceUsd: PRICE,
    staticCaps: [{ strategyId: "mystery", autoExecute: true, caps: { perTxUsd: 100, perDayUsd: 500, maxDailyLossUsd: 50 } }],
  });
  const s = plan.strategies[0];
  assert.equal(s.adaptiveCapsUsd.source, "global_ceiling");
  assert.equal(s.adaptiveCapsUsd.perStrategyUsd, 0);
});

test("autoExecute=false keeps newEntriesAllowed=false even above floor", () => {
  const plan = buildAdaptiveCapitalPlan({
    operatingBtcSats: SATS,
    btcPriceUsd: PRICE,
    staticCaps: stubStatic,
  });
  const legacy = plan.strategies.find((s) => s.strategyId === "legacy-strategy");
  assert.equal(legacy.newEntriesAllowed, false);
});

test("result and nested records frozen", () => {
  const plan = buildAdaptiveCapitalPlan({
    operatingBtcSats: SATS,
    btcPriceUsd: PRICE,
    staticCaps: stubStatic,
  });
  assert.throws(() => { plan.newEntriesAllowed = true; });
  assert.throws(() => { plan.strategies.push({}); });
  assert.throws(() => { plan.strategies[0].effectiveCapsUsd.perTxUsd = 9999; });
});

test("linear scale: 2x sats → 2x global ceiling sats", () => {
  const a = buildAdaptiveCapitalPlan({ operatingBtcSats: SATS, btcPriceUsd: PRICE, staticCaps: stubStatic });
  const b = buildAdaptiveCapitalPlan({ operatingBtcSats: SATS * 2, btcPriceUsd: PRICE, staticCaps: stubStatic });
  const ratio = b.globalCeilingBtcSats.perTxBtcSats / a.globalCeilingBtcSats.perTxBtcSats;
  assert.ok(ratio > 1.99 && ratio < 2.01);
});

test("summary counts consistent", () => {
  const plan = buildAdaptiveCapitalPlan({
    operatingBtcSats: SATS,
    btcPriceUsd: PRICE,
    staticCaps: stubStatic,
  });
  assert.equal(plan.summary.strategyCount, 2);
  assert.equal(plan.summary.autoExecuteCount, 1);
});
