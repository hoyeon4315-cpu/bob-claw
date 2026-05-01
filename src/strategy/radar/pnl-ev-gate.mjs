import { applyRewardHaircut } from "../../config/small-capital-campaign-mode.mjs";
import { tinyCanarySameChainRoundTripCostUsd } from "../../config/sizing.mjs";

function finiteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function callCost(costLedger, methodName, argument, fallback) {
  const method = costLedger?.[methodName];
  if (typeof method !== "function") return fallback;
  return finiteNumber(method(argument), fallback);
}

function hasRewardToken(candidate = {}) {
  return Boolean(candidate.rewardToken || candidate.rewardTokenSymbol);
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
  const p90GasFallbackUsd = tinyCanarySameChainRoundTripCostUsd({
    chain: candidate.chain,
    estimatedGasCostUsd: candidate.estimatedGasCostUsd,
  });
  const p90GasUsd = Math.max(
    callCost(costLedger, "p90GasCostUsdForChain", candidate.chain, p90GasFallbackUsd),
    p90GasFallbackUsd
  );
  const rewardTokenPresent = hasRewardToken(candidate);
  const p90ClaimUsd = rewardTokenPresent
    ? callCost(
        costLedger,
        "p90ClaimCostUsdForProtocol",
        candidate.protocol ?? candidate.protocolId,
        0.2
      )
    : 0;
  const p90SwapUsd = rewardTokenPresent && candidate.rewardTokenType !== "stable"
    ? callCost(
        costLedger,
        "p90RewardSwapCostUsdForToken",
        candidate.rewardToken ?? candidate.rewardTokenSymbol,
        0.3
      )
    : 0;
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
