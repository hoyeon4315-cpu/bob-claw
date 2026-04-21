// LayerZero OFT watcher. Detects Kelp/Aperture-style anomalous mint/burn.
// Pure: snapshot carries LZ explorer + on-chain totals precomputed.

import { SEVERITY, makeVerdict, isFiniteNumber } from "./types.mjs";

export const OFT_WATCHER_THRESHOLDS = Object.freeze({
  netSupplyDeviationMaxPct: 0.005, // 0.5%
  mintBurnRatioMax: 1.5,
  mintBurnRatioMin: 0.67,
  largeMintSatsThreshold: 50_000_000, // 0.5 BTC-equivalent
});

export function evaluateLayerZeroOftWatcher(snapshot, thresholds = OFT_WATCHER_THRESHOLDS) {
  const tokenId = snapshot?.tokenId || "unknown";
  const violations = [];
  const details = {};

  if (isFiniteNumber(snapshot?.netSupplyDeviationPct)) {
    details.netSupplyDeviationPct = snapshot.netSupplyDeviationPct;
    if (Math.abs(snapshot.netSupplyDeviationPct) >= thresholds.netSupplyDeviationMaxPct) {
      violations.push({
        kind: "net_supply_deviation_exceeded",
        observed: snapshot.netSupplyDeviationPct,
        max: thresholds.netSupplyDeviationMaxPct,
      });
    }
  }
  if (isFiniteNumber(snapshot?.mintBurnRatio24h)) {
    details.mintBurnRatio24h = snapshot.mintBurnRatio24h;
    if (
      snapshot.mintBurnRatio24h > thresholds.mintBurnRatioMax ||
      snapshot.mintBurnRatio24h < thresholds.mintBurnRatioMin
    ) {
      violations.push({
        kind: "mint_burn_ratio_out_of_band",
        observed: snapshot.mintBurnRatio24h,
        bandMin: thresholds.mintBurnRatioMin,
        bandMax: thresholds.mintBurnRatioMax,
      });
    }
  }
  if (isFiniteNumber(snapshot?.largestSingleMintSats) &&
      snapshot.largestSingleMintSats >= thresholds.largeMintSatsThreshold) {
    violations.push({
      kind: "large_single_mint_detected",
      observedSats: snapshot.largestSingleMintSats,
      threshold: thresholds.largeMintSatsThreshold,
    });
  }

  const ok = violations.length === 0;
  const severity = ok ? SEVERITY.INFO : SEVERITY.KILL_SWITCH;
  const action = ok ? "none" : "trigger_kill_switch_and_pause_gateway";
  return makeVerdict({
    moduleId: `layerzero-oft-watcher:${tokenId}`,
    ok, severity, action, violations, details,
  });
}
