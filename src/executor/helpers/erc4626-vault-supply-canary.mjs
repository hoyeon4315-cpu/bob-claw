import {
  buildErc4626ProtocolCanaryPlan,
  executeErc4626ProtocolCanaryPlan,
} from "./erc4626-protocol-canary.mjs";

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
        vaultAddress: candidate.vaultAddress || candidate.shareTokenAddress,
        assetAddress: candidate.assetAddress,
        shareTokenAddress: candidate.shareTokenAddress || candidate.vaultAddress,
        assetSymbol: candidate.assetSymbol || "USDC",
        assetDecimals: candidate.assetDecimals,
        shareTokenSymbol: candidate.shareTokenSymbol || candidate.vaultSymbol || "VaultShare",
        source: candidate.evidence?.sourceName || null,
      },
    },
  };
}

export async function buildErc4626VaultSupplyCanaryPlan({
  candidate,
  senderAddress,
  amount,
  ...options
} = {}) {
  if (!candidate) throw new Error("candidate is required");
  const plan = await buildErc4626ProtocolCanaryPlan({
    queueItem: queueItemFromCandidate(candidate),
    senderAddress,
    amount,
    ...options,
  });
  return {
    ...plan,
    templateId: candidate.templateId,
  };
}

export const executeErc4626VaultSupplyCanaryPlan = executeErc4626ProtocolCanaryPlan;
