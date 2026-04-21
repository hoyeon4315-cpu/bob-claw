// Capital-adaptive cap derivation.
//
// Cap is a *function* committed to code, not a value tuned at runtime.
// Invariant #5 (cap = commit): ratio constants change only via committed diff.
// The runtime input is observed operating-capital BTC (in sats). No LLM.
//
// Reference: plan §5. Caps scale with operator balance so the system works
// unchanged whether deposit is 0.001 BTC or 1 BTC.

export const CAPITAL_ADAPTIVE_RATIOS = Object.freeze({
  perTxBtcShare: 0.05,
  perDayBtcShare: 0.20,
  maxDailyLossBtcShare: 0.03,
  maxFailedGasCost24hShare: 0.01,
  minOperatingFloorSats: 50_000,
  perStrategyShares: Object.freeze({
    S1_moonwell_usdc_pendle_pt_lbtc: 0.25,
    S2_pendle_pt_solvbtc_bbn: 0.20,
    S3_aerodrome_cl_cbbtc_lbtc: 0.15,
    S4_aerodrome_cl_cbbtc_usdc: 0.15,
    S5_berachain_btc_lst_bgt: 0.20,
    S6_gmx_perp_basis: 0.15,
    S7_beefy_folding: 0.10,
    S9_k3capital_euler_loop: 0.10,
  }),
});

function floorSats(n) {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function assertSats(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer (sats)`);
  }
}

export function deriveCaps(operatingBtcSats, ratios = CAPITAL_ADAPTIVE_RATIOS) {
  assertSats(operatingBtcSats, "operatingBtcSats");

  const belowFloor = operatingBtcSats < ratios.minOperatingFloorSats;

  const perTxBtcSats = floorSats(operatingBtcSats * ratios.perTxBtcShare);
  const perDayBtcSats = floorSats(operatingBtcSats * ratios.perDayBtcShare);
  const maxDailyLossBtcSats = floorSats(
    operatingBtcSats * ratios.maxDailyLossBtcShare,
  );
  const maxFailedGasCost24hBtcSats = floorSats(
    operatingBtcSats * ratios.maxFailedGasCost24hShare,
  );

  const perStrategyBtcSats = {};
  for (const [id, share] of Object.entries(ratios.perStrategyShares)) {
    perStrategyBtcSats[id] = floorSats(operatingBtcSats * share);
  }

  return Object.freeze({
    operatingBtcSats,
    belowOperatingFloor: belowFloor,
    minOperatingFloorSats: ratios.minOperatingFloorSats,
    perTxBtcSats,
    perDayBtcSats,
    maxDailyLossBtcSats,
    maxFailedGasCost24hBtcSats,
    perStrategyBtcSats: Object.freeze(perStrategyBtcSats),
    newEntriesAllowed: !belowFloor,
    appliedRatios: ratios,
  });
}

export function projectToUsd(caps, btcPriceUsd) {
  if (!Number.isFinite(btcPriceUsd) || btcPriceUsd <= 0) {
    throw new TypeError("btcPriceUsd must be a positive finite number");
  }
  const satsToUsd = (sats) => (sats / 1e8) * btcPriceUsd;
  const perStrategyUsd = {};
  for (const [id, sats] of Object.entries(caps.perStrategyBtcSats)) {
    perStrategyUsd[id] = satsToUsd(sats);
  }
  return {
    operatingUsd: satsToUsd(caps.operatingBtcSats),
    perTxUsd: satsToUsd(caps.perTxBtcSats),
    perDayUsd: satsToUsd(caps.perDayBtcSats),
    maxDailyLossUsd: satsToUsd(caps.maxDailyLossBtcSats),
    maxFailedGasCost24hUsd: satsToUsd(caps.maxFailedGasCost24hBtcSats),
    perStrategyUsd,
    btcPriceUsd,
    projectionOnly: true,
  };
}
