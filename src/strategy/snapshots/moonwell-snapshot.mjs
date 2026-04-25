/**
 * moonwell-snapshot.mjs
 *
 * Pure normalizer that turns raw Moonwell (Compound v2 fork) on-chain
 * read results into the BTC-denominated lending-loop market slice that
 * `evaluateRecursiveWrappedBtcLendingLoopAdapter`,
 * `evaluateBeefyFoldingAdapter`, and the wrapped-btc-loop adapter
 * consume.
 *
 * Inputs are already-decoded numbers (so this module stays pure and
 * does not reach for ethers). The async fetcher CLI handles RPC,
 * decoding, and writes the snapshot to disk.
 *
 * Output snapshot fields (all optional; missing[] reports gaps):
 *   - utilizationBps        : borrow / supply (bps)
 *   - supplyApyBps          : supplyRatePerBlock annualized (bps)
 *   - borrowApyBps          : borrowRatePerBlock annualized (bps)
 *   - collateralFactorBps   : Comptroller market collateralFactor (bps)
 *   - healthFactor          : sum(collateral × CF × price) / sum(borrow × price)
 *   - liquidationBufferPct  : (HF − 1) clamped to [0, 1]
 *   - exchangeRateMantissa  : mToken exchangeRate (used for unwind path)
 *   - blocksPerYear         : config-injected (Base ≈ 15_768_000 @ 2s)
 *   - fetchedAtMs           : caller timestamp
 *   - partial / missing[]   : explicit gaps
 *
 * No "default" fallbacks. A missing field is reported as `missing[]`,
 * not silently zeroed — adapters block on missing inputs by design.
 */

const BPS = 10_000;

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function ratePerBlockToApyBps(ratePerBlockMantissa, blocksPerYear) {
  if (!Number.isFinite(ratePerBlockMantissa) || ratePerBlockMantissa < 0) return null;
  if (!Number.isFinite(blocksPerYear) || blocksPerYear <= 0) return null;
  // Compound rate is 1e18-scaled per-block. APR = ratePerBlock * blocksPerYear.
  const aprDecimal = (ratePerBlockMantissa / 1e18) * blocksPerYear;
  if (!Number.isFinite(aprDecimal) || aprDecimal < 0) return null;
  return Math.round(aprDecimal * BPS);
}

function utilizationBps({ totalBorrowsRaw, cashRaw, totalReservesRaw }) {
  if (
    !isFiniteNonNegative(totalBorrowsRaw) ||
    !isFiniteNonNegative(cashRaw) ||
    !isFiniteNonNegative(totalReservesRaw)
  ) {
    return null;
  }
  const supply = cashRaw + totalBorrowsRaw - totalReservesRaw;
  if (!(supply > 0)) return 0;
  const u = totalBorrowsRaw / supply;
  if (!Number.isFinite(u) || u < 0) return null;
  return Math.round(Math.min(1, u) * BPS);
}

function healthFactorFromPositions({
  collateralUsd,
  collateralFactorBps,
  borrowUsd,
}) {
  if (
    !Number.isFinite(collateralUsd) ||
    !Number.isFinite(collateralFactorBps) ||
    !Number.isFinite(borrowUsd) ||
    collateralUsd < 0 ||
    collateralFactorBps < 0 ||
    borrowUsd < 0
  ) {
    return null;
  }
  if (borrowUsd === 0) {
    // No borrow → HF effectively infinite. Adapters should treat this as
    // "no leverage to evaluate", not "safe at any size". Return null so
    // the calling adapter sees `missing` and blocks.
    return null;
  }
  const hf = (collateralUsd * (collateralFactorBps / BPS)) / borrowUsd;
  if (!Number.isFinite(hf) || hf <= 0) return null;
  // Round to 4 decimals — sufficient for HF floor checks (e.g. 1.05).
  return Math.round(hf * 10_000) / 10_000;
}

export function normalizeMoonwellSnapshot({
  market = null,             // { address, asset, blocksPerYear }
  comptroller = null,        // { address }
  position = null,           // { collateralUsd, borrowUsd } (operator wallet)
  rates = null,              // { supplyRatePerBlockMantissa, borrowRatePerBlockMantissa }
  reserves = null,           // { cashRaw, totalBorrowsRaw, totalReservesRaw, exchangeRateMantissa }
  comptrollerMarket = null,  // { collateralFactorMantissa, isListed }
  fetchedAtMs = null,
} = {}) {
  if (!Number.isFinite(fetchedAtMs)) {
    throw new TypeError("normalizeMoonwellSnapshot: fetchedAtMs (number) required");
  }
  if (!market || typeof market !== "object") {
    throw new TypeError("normalizeMoonwellSnapshot: market (object) required");
  }

  const missing = [];

  if (!comptroller?.address) missing.push("comptroller.address");
  if (!market?.address) missing.push("market.address");
  if (!market?.asset) missing.push("market.asset");

  const blocksPerYear = Number.isFinite(market?.blocksPerYear) && market.blocksPerYear > 0
    ? market.blocksPerYear
    : null;
  if (blocksPerYear === null) missing.push("market.blocksPerYear");

  const supplyApyBps = rates?.supplyRatePerBlockMantissa !== undefined
    ? ratePerBlockToApyBps(Number(rates.supplyRatePerBlockMantissa), blocksPerYear)
    : null;
  if (supplyApyBps === null) missing.push("rates.supplyRatePerBlockMantissa");

  const borrowApyBps = rates?.borrowRatePerBlockMantissa !== undefined
    ? ratePerBlockToApyBps(Number(rates.borrowRatePerBlockMantissa), blocksPerYear)
    : null;
  if (borrowApyBps === null) missing.push("rates.borrowRatePerBlockMantissa");

  const utilization = reserves
    ? utilizationBps({
        cashRaw: Number(reserves.cashRaw),
        totalBorrowsRaw: Number(reserves.totalBorrowsRaw),
        totalReservesRaw: Number(reserves.totalReservesRaw),
      })
    : null;
  if (utilization === null) missing.push("reserves.{cash,totalBorrows,totalReserves}");

  const cfMantissa = Number(comptrollerMarket?.collateralFactorMantissa);
  const collateralFactorBps = Number.isFinite(cfMantissa) && cfMantissa >= 0
    ? Math.round((cfMantissa / 1e18) * BPS)
    : null;
  if (collateralFactorBps === null) missing.push("comptrollerMarket.collateralFactorMantissa");

  const exchangeRateMantissa = reserves?.exchangeRateMantissa !== undefined
    ? Number(reserves.exchangeRateMantissa)
    : null;
  if (exchangeRateMantissa === null) missing.push("reserves.exchangeRateMantissa");

  let healthFactor = null;
  let liquidationBufferPct = null;
  if (position && Number.isFinite(collateralFactorBps)) {
    healthFactor = healthFactorFromPositions({
      collateralUsd: Number(position.collateralUsd),
      collateralFactorBps,
      borrowUsd: Number(position.borrowUsd),
    });
    if (healthFactor === null) {
      missing.push("position.{collateralUsd,borrowUsd}");
    } else {
      const buf = healthFactor - 1;
      liquidationBufferPct = buf <= 0 ? 0 : buf >= 1 ? 1 : Math.round(buf * 10_000) / 10_000;
    }
  } else if (!position) {
    missing.push("position.{collateralUsd,borrowUsd}");
  }

  if (comptrollerMarket?.isListed === false) {
    missing.push("comptrollerMarket.isListed=true");
  }

  return Object.freeze({
    source: "moonwell",
    chainId: market?.chainId ?? null,
    marketAddress: market?.address ?? null,
    asset: market?.asset ?? null,
    comptrollerAddress: comptroller?.address ?? null,
    fetchedAtMs,
    blocksPerYear,
    supplyApyBps,
    borrowApyBps,
    utilizationBps: utilization,
    collateralFactorBps,
    exchangeRateMantissa,
    healthFactor,
    liquidationBufferPct,
    partial: missing.length > 0,
    missing: Object.freeze(missing),
  });
}
