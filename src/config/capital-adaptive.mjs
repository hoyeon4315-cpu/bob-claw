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
  minOperatingFloorSats: 0,
  capTiers: Object.freeze({
    probe: Object.freeze({ perTxBtcShare: 0.0025, perDayBtcShare: 0.01, maxDailyLossBtcShare: 0.0025 }),
    tiny: Object.freeze({ perTxBtcShare: 0.01, perDayBtcShare: 0.05, maxDailyLossBtcShare: 0.01 }),
    pilot: Object.freeze({ perTxBtcShare: 0.05, perDayBtcShare: 0.20, maxDailyLossBtcShare: 0.03 }),
    operating: Object.freeze({ perTxBtcShare: 0.10, perDayBtcShare: 0.35, maxDailyLossBtcShare: 0.05 }),
  }),
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

  const belowFloor = operatingBtcSats > 0 && operatingBtcSats < ratios.minOperatingFloorSats;

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
  const capTiers = {};
  for (const [tier, tierRatios] of Object.entries(ratios.capTiers || {})) {
    capTiers[tier] = Object.freeze({
      perTxBtcSats: floorSats(operatingBtcSats * tierRatios.perTxBtcShare),
      perDayBtcSats: floorSats(operatingBtcSats * tierRatios.perDayBtcShare),
      maxDailyLossBtcSats: floorSats(operatingBtcSats * tierRatios.maxDailyLossBtcShare),
    });
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
    capTiers: Object.freeze(capTiers),
    newEntriesAllowed: operatingBtcSats > 0 && !belowFloor,
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
  const capTiersUsd = {};
  for (const [tier, values] of Object.entries(caps.capTiers || {})) {
    capTiersUsd[tier] = {
      perTxUsd: satsToUsd(values.perTxBtcSats),
      perDayUsd: satsToUsd(values.perDayBtcSats),
      maxDailyLossUsd: satsToUsd(values.maxDailyLossBtcSats),
    };
  }
  return {
    operatingUsd: satsToUsd(caps.operatingBtcSats),
    perTxUsd: satsToUsd(caps.perTxBtcSats),
    perDayUsd: satsToUsd(caps.perDayBtcSats),
    maxDailyLossUsd: satsToUsd(caps.maxDailyLossBtcSats),
    maxFailedGasCost24hUsd: satsToUsd(caps.maxFailedGasCost24hBtcSats),
    perStrategyUsd,
    capTiersUsd,
    btcPriceUsd,
    projectionOnly: true,
  };
}
