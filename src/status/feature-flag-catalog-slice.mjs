import { buildFeatureFlagCatalogSummary, isFeatureEnabled } from "../config/feature-flags.mjs";

export function buildFeatureFlagCatalogSlice({ manifest = undefined, profile = null } = {}) {
  const catalogIncluded = isFeatureEnabled("report.feature_flag_catalog_slice", {
    manifest,
    profile,
  });
  return Object.freeze({
    ...buildFeatureFlagCatalogSummary({
      manifest,
      includeFlags: catalogIncluded,
      profile,
    }),
    readOnly: true,
    catalogIncluded,
    runtimeAuthority: "none",
    policyNote:
      "Feature flags are committed non-live rollout metadata only; they do not change policy, signer, caps, kill-switch, payback, readiness, or live execution behavior.",
  });
}
