import { applyRewardHaircut } from "../../config/small-capital-campaign-mode.mjs";

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function callCost(costLedger, methodName, argument, fallback) {
  const method = costLedger?.[methodName];
  if (typeof method !== "function") return fallback;
  return finiteNumber(method(argument), fallback);
}

export function computeRealizedPnlEv({
  candidate = {},
  positionUsd,
  holdDays,
  costLedger = {},
  costVarianceBufferUsd = 0,
} = {}) {
  const notionalUsd = finiteNumber(positionUsd);
  const effectiveHoldDays = Math.max(0, finiteNumber(holdDays));
  const displayedAprPct = finiteNumber(
    candidate.effectiveAprPct ?? candidate.displayedAprPct ?? candidate.displayedApr ?? candidate.apr
  );
  const grossRewardUsd = notionalUsd * (displayedAprPct / 100) * (effectiveHoldDays / 365);
  const haircutRewardUsd = applyRewardHaircut(candidate.rewardTokenType, grossRewardUsd);

  const p90BridgeUsd = callCost(
    costLedger,
    "p90BridgeCostUsdForRoute",
    candidate.entryRoute ?? candidate.executionPath,
    0
  );
  const p90GasUsd = callCost(costLedger, "p90GasCostUsdForChain", candidate.chain, 0.5);
  const p90ClaimUsd = callCost(
    costLedger,
    "p90ClaimCostUsdForProtocol",
    candidate.protocol ?? candidate.protocolId,
    0.2
  );
  const p90SwapUsd = callCost(
    costLedger,
    "p90RewardSwapCostUsdForToken",
    candidate.rewardToken ?? candidate.rewardTokenSymbol,
    0.3
  );
  const expectedCostUsd = p90BridgeUsd + p90GasUsd + p90ClaimUsd + p90SwapUsd;
  const expectedNetPnlUsd = haircutRewardUsd - expectedCostUsd;
  const requiredBufferUsd = finiteNumber(costVarianceBufferUsd);
  const ok = expectedNetPnlUsd > requiredBufferUsd;

  return {
    ok,
    blocker: ok ? null : "realized_pnl_ev_insufficient",
    notionalUsd,
    holdDays: effectiveHoldDays,
    displayedAprPct,
    grossRewardUsd,
    haircutRewardUsd,
    p90BridgeUsd,
    p90GasUsd,
    p90ClaimUsd,
    p90SwapUsd,
    expectedCostUsd,
    expectedNetPnlUsd,
    requiredBufferUsd,
    btcAccountingRequired: true,
    paybackConversionRequired: true,
  };
}
