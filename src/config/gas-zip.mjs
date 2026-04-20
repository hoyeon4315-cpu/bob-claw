// Gas.Zip fallback policy.
//
// Purpose: native-gas bootstrap / refill only. Strategy capital and payback
// lanes are NEVER allowed on this path. Any caller that passes a
// non-native refill action is rejected up-front.
//
// Rationale: see archived vendor review 2026-04-20 — official README caps
// a single transfer at ~$50 per chain, and no independent audit report is
// on file. We treat Gas.Zip as a last-mile gas top-up only and enforce the
// cap here in committed config so it cannot be raised at runtime.

export const GAS_ZIP_DEFAULT_POLICY = Object.freeze({
  enabled: true,
  purpose: "native_gas_only",
  perJobMaxRefuelUsd: 10,
  perChainDailyMaxRefuelUsd: 25,
  perChainMaxOpenJobs: 1,
  vendorSingleTxCapUsd: 50,
  supportedDstChains: Object.freeze([
    "ethereum",
    "bob",
    "base",
    "bsc",
    "avalanche",
    "unichain",
    "bera",
    "optimism",
    "soneium",
    "sei",
    "sonic",
  ]),
  requireDestinationNativeDelta: true,
  forbiddenRefillTypes: Object.freeze(["refill_token"]),
});

export function isGasZipSupportedChain(chain, policy = GAS_ZIP_DEFAULT_POLICY) {
  return (policy?.supportedDstChains || []).includes(String(chain || "").toLowerCase());
}

export function gasZipAcceptsAction(action, policy = GAS_ZIP_DEFAULT_POLICY) {
  if (!policy?.enabled) return { accepted: false, reason: "gas_zip_disabled" };
  if (!action || action.type !== "refill_native") {
    return { accepted: false, reason: "gas_zip_non_native_refill_forbidden" };
  }
  if ((policy.forbiddenRefillTypes || []).includes(action.type)) {
    return { accepted: false, reason: "gas_zip_forbidden_refill_type" };
  }
  if (!isGasZipSupportedChain(action.chain, policy)) {
    return { accepted: false, reason: "gas_zip_unsupported_destination" };
  }
  const estimatedUsd = Number(action.refillEstimatedUsd);
  if (!Number.isFinite(estimatedUsd) || estimatedUsd <= 0) {
    return { accepted: false, reason: "gas_zip_estimated_usd_missing" };
  }
  if (estimatedUsd > policy.perJobMaxRefuelUsd) {
    return { accepted: false, reason: "gas_zip_per_job_cap_exceeded" };
  }
  if (estimatedUsd > policy.vendorSingleTxCapUsd) {
    return { accepted: false, reason: "gas_zip_vendor_cap_exceeded" };
  }
  return { accepted: true, reason: null };
}
