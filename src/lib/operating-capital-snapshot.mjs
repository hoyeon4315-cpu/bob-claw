import { loadUnifiedOperatingCapital, operatingCapitalUsdFromUnified } from "./unified-nav-reader.mjs";

export async function loadOperatingCapitalUsd({ logger = console } = {}) {
  const unified = await loadUnifiedOperatingCapital();
  if (unified.halt && logger?.warn) {
    const isHardHalt =
      unified.flags.includes("evm_source_disagreement") && !unified.flags.includes("evm_scan_degraded");
    logger.warn(
      `operating-capital unified reader ${isHardHalt ? "halted" : "degraded"}; flags=${unified.flags.join(",")} missing=${unified.missingSources.join(",")} evmDiscrepancyPct=${unified.evmDiscrepancyPct}; ${isHardHalt ? "policy will fall back to aggressive profile." : "using best-effort aggregate."}`,
    );
  }
  return operatingCapitalUsdFromUnified(unified);
}

export async function loadOperatingCapitalSnapshot() {
  return loadUnifiedOperatingCapital();
}
