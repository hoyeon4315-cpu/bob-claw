// Adaptive-caps overlay for the Capital Manager.
//
// Plan §2 T4. The static per-strategy caps in src/config/strategy-caps.mjs
// are committed USD upper bounds; `deriveCaps()` in
// src/config/capital-adaptive.mjs produces BTC-denominated adaptive
// targets that scale with the operator's actual BTC operating float.
//
// This module overlays the two: effective cap = min(static, adaptive),
// converting the adaptive BTC side to USD via the current BTC/USD
// oracle reading. The result is what the Capital Manager's tick
// consumes instead of the raw static caps.
//
// Pure function. No I/O. Caller passes in:
//   - operatingBtcSats  (from BTC Accumulator)
//   - btcPriceUsd       (from pinned oracle snapshot)
//   - staticCaps        (listStrategyCaps())
// Returns a frozen plan the rebalancer can read.

import { deriveCaps, projectToUsd } from "../../config/capital-adaptive.mjs";
import { listStrategyCaps } from "../../config/strategy-caps.mjs";

function finitePositive(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function minOrZero(a, b) {
  const aa = finitePositive(a);
  const bb = finitePositive(b);
  return Math.min(aa, bb);
}

export function buildAdaptiveCapitalPlan({
  operatingBtcSats,
  btcPriceUsd,
  staticCaps = listStrategyCaps(),
  observedAt = new Date().toISOString(),
} = {}) {
  if (!Number.isFinite(operatingBtcSats) || operatingBtcSats < 0) {
    throw new TypeError("operatingBtcSats must be a non-negative finite number");
  }
  if (!Number.isFinite(btcPriceUsd) || btcPriceUsd <= 0) {
    throw new TypeError("btcPriceUsd must be a positive finite number");
  }

  const adaptive = deriveCaps(operatingBtcSats);
  const adaptiveUsd = projectToUsd(adaptive, btcPriceUsd);

  // Global ceilings (enforced across all strategies in aggregate).
  const globalCeilingUsd = Object.freeze({
    perTxUsd: adaptiveUsd.perTxUsd,
    perDayUsd: adaptiveUsd.perDayUsd,
    maxDailyLossUsd: adaptiveUsd.maxDailyLossUsd,
    maxFailedGasCost24hUsd: adaptiveUsd.maxFailedGasCost24hUsd,
  });

  // Per-strategy effective caps = min(static, adaptive projection).
  // Unknown strategies (not in adaptive ratios) fall back to the static
  // cap unchanged but still clipped by the global perTx/perDay ceilings.
  const perStrategyAdaptiveUsd = adaptiveUsd.perStrategyUsd || {};
  const effective = staticCaps.map((strategy) => {
    const strategyId = strategy.strategyId;
    const staticPerTx = finitePositive(strategy.caps?.perTxUsd);
    const staticPerDay = finitePositive(strategy.caps?.perDayUsd);
    const staticMaxLoss = finitePositive(strategy.caps?.maxDailyLossUsd);

    const adaptivePerStrategyUsd = finitePositive(perStrategyAdaptiveUsd[strategyId]);
    const hasAdaptive = strategyId in perStrategyAdaptiveUsd;

    // Adaptive strategy slice: per-strategy USD budget scales with float.
    // Per-tx is further clipped to the global per-tx ceiling.
    const adaptivePerTxUsd = hasAdaptive
      ? Math.min(adaptivePerStrategyUsd, globalCeilingUsd.perTxUsd)
      : globalCeilingUsd.perTxUsd;

    const adaptivePerDayUsd = hasAdaptive
      ? Math.min(adaptivePerStrategyUsd, globalCeilingUsd.perDayUsd)
      : globalCeilingUsd.perDayUsd;

    const effectivePerTxUsd = minOrZero(staticPerTx, adaptivePerTxUsd);
    const effectivePerDayUsd = minOrZero(staticPerDay, adaptivePerDayUsd);
    const effectiveMaxLossUsd = minOrZero(staticMaxLoss, globalCeilingUsd.maxDailyLossUsd);

    const newEntriesAllowed = adaptive.newEntriesAllowed && strategy.autoExecute === true;

    return Object.freeze({
      strategyId,
      autoExecute: strategy.autoExecute === true,
      newEntriesAllowed,
      staticCapsUsd: Object.freeze({
        perTxUsd: staticPerTx,
        perDayUsd: staticPerDay,
        maxDailyLossUsd: staticMaxLoss,
      }),
      adaptiveCapsUsd: Object.freeze({
        perStrategyUsd: adaptivePerStrategyUsd,
        perTxUsd: adaptivePerTxUsd,
        perDayUsd: adaptivePerDayUsd,
        source: hasAdaptive ? "adaptive_share" : "global_ceiling",
      }),
      effectiveCapsUsd: Object.freeze({
        perTxUsd: effectivePerTxUsd,
        perDayUsd: effectivePerDayUsd,
        maxDailyLossUsd: effectiveMaxLossUsd,
      }),
      bindingConstraint: Object.freeze({
        perTxUsd: "adaptive",
        perDayUsd: "adaptive",
      }),
    });
  });

  return Object.freeze({
    schemaVersion: 1,
    observedAt,
    operatingBtcSats,
    btcPriceUsd,
    belowOperatingFloor: adaptive.belowOperatingFloor,
    newEntriesAllowed: adaptive.newEntriesAllowed,
    globalCeilingBtcSats: Object.freeze({
      perTxBtcSats: adaptive.perTxBtcSats,
      perDayBtcSats: adaptive.perDayBtcSats,
      maxDailyLossBtcSats: adaptive.maxDailyLossBtcSats,
      maxFailedGasCost24hBtcSats: adaptive.maxFailedGasCost24hBtcSats,
    }),
    globalCeilingUsd,
    strategies: Object.freeze(effective),
    summary: Object.freeze({
      strategyCount: effective.length,
      autoExecuteCount: effective.filter((s) => s.autoExecute).length,
      haltedByFloorCount: effective.filter((s) => !s.newEntriesAllowed).length,
    }),
  });
}
