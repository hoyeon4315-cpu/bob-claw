export function evaluateGatewayNativeAssetConversionSleeveAdapter({ config, market, receipts, now }) {
  const signerBacked = (receipts || []).filter(
    (r) => r.source === "signer" || r.broadcast?.txHash || r.lifecycle?.txHash,
  );
  const hasEvidence = signerBacked.length >= 2;
  return {
    strategyId: config.id,
    mode: hasEvidence ? "live" : "shadow",
    shadowReady: !hasEvidence,
    liveReady: hasEvidence,
    blockers: hasEvidence ? [] : ["insufficient_signer_backed_receipts"],
    candidateCount: 0,
    allowCount: 0,
    denyCount: 0,
    signerBackedCount: signerBacked.length,
  };
}

export function buildDefaultGatewayNativeAssetConversionSleeveConfig() {
  return { id: "gateway_native_asset_conversion_sleeve" };
}
