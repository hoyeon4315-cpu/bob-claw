import { buildFeatureFlagCatalogSummary, isFeatureEnabled } from "../config/feature-flags.mjs";

export function buildFeatureFlagCatalogSlice({ manifest = undefined, profile = null } = {}) {
  const catalogIncluded = isFeatureEnabled("report.feature_flag_catalog_slice", {
    manifest,
    profile,
  });
  const rolloutPreviewEnabled = isFeatureEnabled("non_live_rollout.feature_flag_profile_overrides_preview", {
    manifest,
    profile,
  });
  const summary = buildFeatureFlagCatalogSummary({
    manifest,
    includeFlags: catalogIncluded,
    profile,
  });
  return Object.freeze({
    ...summary,
    readOnly: true,
    catalogIncluded,
    rolloutPreviewEnabled,
    rolloutPreview: rolloutPreviewEnabled
      ? Object.freeze({
          requestedProfile: summary.requestedProfile,
          profileOverrideCount: summary.profileOverrideCount,
          enabledFlagCount: summary.enabledFlagCount,
          previewAuthority: "none",
        })
      : null,
    runtimeAuthority: "none",
    policyNote:
      "Feature flags are committed non-live rollout metadata only; they do not change policy, signer, caps, kill-switch, payback, readiness, or live execution behavior.",
  });
}
