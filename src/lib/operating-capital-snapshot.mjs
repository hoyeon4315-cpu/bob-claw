import { loadUnifiedOperatingCapital, operatingCapitalUsdFromUnified } from "./unified-nav-reader.mjs";

export async function loadOperatingCapitalUsd({ logger = console } = {}) {
  const unified = await loadUnifiedOperatingCapital();
  if (unified.halt && logger?.warn) {
    logger.warn(
      `operating-capital unified reader halted; flags=${unified.flags.join(",")} missing=${unified.missingSources.join(",")} evmDiscrepancyPct=${unified.evmDiscrepancyPct}; policy will fall back to aggressive profile.`,
    );
  }
  return operatingCapitalUsdFromUnified(unified);
}

export async function loadOperatingCapitalSnapshot() {
  return loadUnifiedOperatingCapital();
}
