import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeMoonwellSnapshot } from "../src/strategy/snapshots/moonwell-snapshot.mjs";

const NOW = Date.parse("2026-04-21T00:00:00Z");
const BASE_BLOCKS_PER_YEAR = 15_768_000;

const FULL_INPUT = Object.freeze({
  market: {
    address: "0x1111111111111111111111111111111111111111",
    asset: "cbBTC",
    chainId: 8453,
    blocksPerYear: BASE_BLOCKS_PER_YEAR,
  },
  comptroller: { address: "0x2222222222222222222222222222222222222222" },
  position: { collateralUsd: 100, borrowUsd: 50 },
  // ratePerBlockMantissa: 1e18-scaled.  1e10 / 1e18 * 15.7M ≈ 1.577e-1 → 1577 bps
  rates: {
    supplyRatePerBlockMantissa: 1e10,
    borrowRatePerBlockMantissa: 2e10,
  },
  reserves: {
    cashRaw: 30,
    totalBorrowsRaw: 70,
    totalReservesRaw: 0,
    exchangeRateMantissa: 2e26,
  },
  comptrollerMarket: { collateralFactorMantissa: 8e17, isListed: true },
  fetchedAtMs: NOW,
});

describe("moonwell snapshot — pure normalizer", () => {
  test("full happy path: not partial, all fields populated", () => {
    const s = normalizeMoonwellSnapshot(FULL_INPUT);
    assert.equal(s.partial, false);
    assert.deepEqual([...s.missing], []);
    assert.equal(s.source, "moonwell");
    assert.equal(s.chainId, 8453);
    assert.equal(s.asset, "cbBTC");
    assert.equal(s.collateralFactorBps, 8000);
    // utilization = 70 / (30+70-0) = 0.7 → 7000 bps
    assert.equal(s.utilizationBps, 7000);
    assert.equal(s.supplyApyBps, 1577);
    assert.equal(s.borrowApyBps, 3154);
    // HF = 100 * 0.8 / 50 = 1.6
    assert.equal(s.healthFactor, 1.6);
    assert.equal(s.liquidationBufferPct, 0.6);
  });

  test("requires fetchedAtMs", () => {
    assert.throws(() => normalizeMoonwellSnapshot({ market: {} }), /fetchedAtMs/);
  });

  test("requires market object", () => {
    assert.throws(() => normalizeMoonwellSnapshot({ fetchedAtMs: NOW }), /market/);
  });

  test("missing rates → partial with explicit gaps, not silent zero", () => {
    const s = normalizeMoonwellSnapshot({ ...FULL_INPUT, rates: null });
    assert.equal(s.partial, true);
    assert.equal(s.supplyApyBps, null);
    assert.equal(s.borrowApyBps, null);
    assert.ok(s.missing.includes("rates.supplyRatePerBlockMantissa"));
    assert.ok(s.missing.includes("rates.borrowRatePerBlockMantissa"));
  });

  test("missing position → HF null + recorded in missing[]", () => {
    const s = normalizeMoonwellSnapshot({ ...FULL_INPUT, position: null });
    assert.equal(s.healthFactor, null);
    assert.equal(s.liquidationBufferPct, null);
    assert.ok(s.missing.includes("position.{collateralUsd,borrowUsd}"));
    assert.equal(s.partial, true);
  });

  test("zero borrow → HF null (no leverage to evaluate)", () => {
    const s = normalizeMoonwellSnapshot({
      ...FULL_INPUT,
      position: { collateralUsd: 100, borrowUsd: 0 },
    });
    assert.equal(s.healthFactor, null);
    assert.ok(s.missing.includes("position.{collateralUsd,borrowUsd}"));
  });

  test("HF clamps liquidation buffer to [0,1]", () => {
    // CF=80%, collateral=100, borrow=10 → HF=8 → buffer clamped to 1
    const high = normalizeMoonwellSnapshot({
      ...FULL_INPUT,
      position: { collateralUsd: 100, borrowUsd: 10 },
    });
    assert.equal(high.healthFactor, 8);
    assert.equal(high.liquidationBufferPct, 1);

    // CF=80%, collateral=10, borrow=50 → HF=0.16 → buffer 0
    const low = normalizeMoonwellSnapshot({
      ...FULL_INPUT,
      position: { collateralUsd: 10, borrowUsd: 50 },
    });
    assert.equal(low.healthFactor, 0.16);
    assert.equal(low.liquidationBufferPct, 0);
  });

  test("zero supply (cash+borrows-reserves=0) → utilization 0", () => {
    const s = normalizeMoonwellSnapshot({
      ...FULL_INPUT,
      reserves: { cashRaw: 0, totalBorrowsRaw: 0, totalReservesRaw: 0, exchangeRateMantissa: 1 },
    });
    assert.equal(s.utilizationBps, 0);
  });

  test("delisted market flagged in missing[]", () => {
    const s = normalizeMoonwellSnapshot({
      ...FULL_INPUT,
      comptrollerMarket: { collateralFactorMantissa: 8e17, isListed: false },
    });
    assert.equal(s.partial, true);
    assert.ok(s.missing.includes("comptrollerMarket.isListed=true"));
  });

  test("blocksPerYear missing → APYs null", () => {
    const s = normalizeMoonwellSnapshot({
      ...FULL_INPUT,
      market: { ...FULL_INPUT.market, blocksPerYear: 0 },
    });
    assert.equal(s.supplyApyBps, null);
    assert.equal(s.borrowApyBps, null);
    assert.ok(s.missing.includes("market.blocksPerYear"));
  });

  test("snapshot is frozen", () => {
    const s = normalizeMoonwellSnapshot(FULL_INPUT);
    assert.ok(Object.isFrozen(s));
    assert.ok(Object.isFrozen(s.missing));
  });
});
