import {
  buildAaveProtocolCanaryPlan,
  executeAaveProtocolCanaryPlan,
} from "./aave-protocol-canary.mjs";

function queueItemFromCandidate(candidate = {}) {
  return {
    queueId: `representative:${candidate.templateId || candidate.chain}`,
    opportunityId: candidate.templateId,
    chain: candidate.chain,
    protocolId: candidate.protocolId,
    name: candidate.label || candidate.templateId,
    mappedStrategyId: candidate.strategyId || "gateway_native_asset_conversion_sleeve",
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: candidate.bindingKind,
      resolvedBinding: {
        poolAddress: candidate.poolAddress || null,
        poolAddressProviderAddress: candidate.poolAddressProviderAddress || null,
        assetAddress: candidate.assetAddress,
        aTokenAddress: candidate.aTokenAddress || candidate.shareTokenAddress,
        assetSymbol: candidate.assetSymbol || "USDC",
        assetDecimals: candidate.assetDecimals,
        aTokenSymbol: candidate.aTokenSymbol || candidate.shareTokenSymbol || "aUSDC",
        marketName: candidate.marketName || candidate.protocolId || null,
        referralCode: candidate.referralCode ?? 0,
      },
    },
  };
}

export async function buildAaveV3SupplyCanaryPlan({
  candidate,
  senderAddress,
  amount,
  ...options
} = {}) {
  if (!candidate) throw new Error("candidate is required");
  const plan = await buildAaveProtocolCanaryPlan({
    queueItem: queueItemFromCandidate(candidate),
    senderAddress,
    amount,
    ...options,
  });
  return {
    ...plan,
    templateId: candidate.templateId,
    shareTokenAddress: plan.shareTokenAddress,
    aTokenAddress: plan.shareTokenAddress,
  };
}

export const executeAaveV3SupplyCanaryPlan = executeAaveProtocolCanaryPlan;
