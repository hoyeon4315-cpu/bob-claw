import { applyRewardHaircut } from "../../config/small-capital-campaign-mode.mjs";
import { canonicalGatewayChain } from "../../config/gateway-destinations.mjs";
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
  return Boolean(candidate.rewardToken || candidate.rewardTokenSymbol || candidate.rewardTokenAddress || candidate.rewardAsset);
}

function finiteOptional(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function roundUsd(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

export function pnlEvGateP90Breakdown(costLedger = {}, chain = null, candidate = {}) {
  const canonicalChain = canonicalGatewayChain(chain ?? candidate.chain);
  const rewardTokenPresent = hasRewardToken(candidate);
  const p90GasFallbackUsd = tinyCanarySameChainRoundTripCostUsd({
    chain: canonicalChain,
    estimatedGasCostUsd: candidate.estimatedGasCostUsd,
  });
  const p90BridgeUsd = callCost(
    costLedger,
    "p90BridgeCostUsdForRoute",
    candidate.entryRoute ?? candidate.executionPath,
    finiteOptional(candidate.p90BridgeCostUsd ?? candidate.estimatedBridgeCostUsd) ?? 0,
  );
  const p90GasUsd = Math.max(
    callCost(costLedger, "p90GasCostUsdForChain", canonicalChain, p90GasFallbackUsd),
    p90GasFallbackUsd,
  );
  const p90ClaimUsd = rewardTokenPresent
    ? callCost(
        costLedger,
        "p90ClaimCostUsdForProtocol",
        candidate.protocol ?? candidate.protocolId,
        finiteOptional(candidate.p90ClaimCostUsd ?? candidate.estimatedClaimCostUsd) ?? 0.2,
      )
    : 0;
  const p90SwapUsd = rewardTokenPresent && candidate.rewardTokenType !== "stable"
    ? callCost(
        costLedger,
        "p90RewardSwapCostUsdForToken",
        candidate.rewardToken ?? candidate.rewardTokenSymbol ?? candidate.rewardAsset,
        finiteOptional(candidate.p90RewardSwapCostUsd ?? candidate.estimatedRewardSwapCostUsd) ?? 0.3,
      )
    : 0;
  const componentCostUsd = p90BridgeUsd + p90GasUsd + p90ClaimUsd + p90SwapUsd;
  const explicitRoundTripUsd = finiteOptional(candidate.p90RoundTripCostUsd);
  const totalUsd = roundUsd(Math.max(componentCostUsd, explicitRoundTripUsd ?? 0));
  return {
    totalUsd,
    canonicalChain,
    p90BridgeUsd,
    p90GasUsd,
    p90ClaimUsd,
    p90RewardSwapUsd: p90SwapUsd,
    rewardExitCostUsd: roundUsd(p90ClaimUsd + p90SwapUsd),
    explicitRoundTripUsd,
  };
}

export function pnlEvGateP90(costLedger = {}, chain = null, candidate = {}) {
  return pnlEvGateP90Breakdown(costLedger, chain, candidate).totalUsd;
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
  const rewardTokenPresent = hasRewardToken(candidate);
  const haircutRewardUsd = rewardTokenPresent
    ? applyRewardHaircut(candidate.rewardTokenType, grossRewardUsd)
    : grossRewardUsd;

  const canonicalChain = canonicalGatewayChain(candidate.chain);
  const p90BridgeUsd = callCost(
    costLedger,
    "p90BridgeCostUsdForRoute",
    candidate.entryRoute ?? candidate.executionPath,
    0,
  );
  const p90GasFallbackUsd = tinyCanarySameChainRoundTripCostUsd({
    chain: canonicalChain,
    estimatedGasCostUsd: candidate.estimatedGasCostUsd,
  });
  const p90GasUsd = Math.max(
    callCost(costLedger, "p90GasCostUsdForChain", canonicalChain, p90GasFallbackUsd),
    p90GasFallbackUsd,
  );
  const p90ClaimUsd = rewardTokenPresent
    ? callCost(
        costLedger,
        "p90ClaimCostUsdForProtocol",
        candidate.protocol ?? candidate.protocolId,
        0.2,
      )
    : 0;
  const p90SwapUsd = rewardTokenPresent && candidate.rewardTokenType !== "stable"
    ? callCost(
        costLedger,
        "p90RewardSwapCostUsdForToken",
        candidate.rewardToken ?? candidate.rewardTokenSymbol ?? candidate.rewardAsset,
        0.3,
      )
    : 0;
  const expectedCostUsd = p90BridgeUsd + p90GasUsd + p90ClaimUsd + p90SwapUsd;
  const expectedNetUsd = haircutRewardUsd - expectedCostUsd;
  const requiredBufferUsd = finiteNumber(costVarianceBufferUsd);
  const ok = expectedNetUsd > requiredBufferUsd;

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
    expectedNetUsd,
    requiredBufferUsd,
    btcAccountingRequired: true,
    paybackConversionRequired: true,
  };
}
