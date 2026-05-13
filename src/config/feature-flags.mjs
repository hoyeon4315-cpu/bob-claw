// Committed feature flags for safe, non-live rollout surfaces only.
// This module intentionally has no env, dashboard, Telegram, runtime-file, or
// LLM override path. Live authority remains owned by committed caps, policy,
// signer approval, kill-switch, and payback config.

export const ALLOWED_FEATURE_FLAG_SCOPES = Object.freeze(
  new Set(["dev", "report", "dashboard", "scaffold", "non_live_rollout"]),
);

export const ALLOWED_FEATURE_FLAG_PROFILES = Object.freeze(
  new Set(["ci", "dashboard_preview", "local_dev", "non_live_rollout", "report_snapshot", "scaffold_review"]),
);

export const FORBIDDEN_FEATURE_FLAG_AUTHORITY = Object.freeze([
  "autoExecute",
  "capital",
  "caps",
  "kill_switch",
  "live_runtime",
  "payback",
  "policy",
  "readiness_blocker",
  "signer",
]);

const FEATURE_FLAG_SCHEMA_VERSION = 1;

function freezeProfileOverrides(profileOverrides = {}) {
  return Object.freeze({ ...profileOverrides });
}

function freezeDefinition(flagId, definition) {
  return Object.freeze({
    id: flagId,
    owner: definition.owner,
    scope: definition.scope,
    defaultEnabled: definition.defaultEnabled,
    description: definition.description,
    safetyBoundary: definition.safetyBoundary,
    createdAt: definition.createdAt || null,
    reviewCadence: definition.reviewCadence || null,
    profileOverrides: freezeProfileOverrides(definition.profileOverrides),
  });
}

export const FEATURE_FLAGS = Object.freeze({
  "report.feature_flag_catalog_slice": freezeDefinition("report.feature_flag_catalog_slice", {
    owner: "ops-harness",
    scope: "report",
    defaultEnabled: true,
    description: "Includes the committed feature flag catalog in the read-only feature flag status slice.",
    safetyBoundary: "report-only metadata; no live execution, policy, signer, caps, kill-switch, or payback authority",
    createdAt: "2026-05-12",
    reviewCadence: "quarterly",
  }),
  "non_live_rollout.feature_flag_profile_overrides_preview": freezeDefinition(
    "non_live_rollout.feature_flag_profile_overrides_preview",
    {
      owner: "ops-harness",
      scope: "non_live_rollout",
      defaultEnabled: false,
      description:
        "Enables profile-specific rollout preview metadata for read-only feature flag consumers in approved non-live profiles.",
      safetyBoundary:
        "preview-only metadata; no live execution, policy, signer, caps, kill-switch, payback, or readiness authority",
      createdAt: "2026-05-13",
      reviewCadence: "quarterly",
      profileOverrides: {
        dashboard_preview: true,
        non_live_rollout: true,
        report_snapshot: true,
      },
    },
  ),
});

function assertNonEmptyString(value, label, flagId) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Feature flag ${flagId} missing ${label}`);
  }
}

function validateProfileOverrides(flagId, profileOverrides) {
  if (profileOverrides === undefined) {
    return {};
  }
  if (!profileOverrides || typeof profileOverrides !== "object" || Array.isArray(profileOverrides)) {
    throw new Error(`Feature flag ${flagId} profileOverrides must be an object`);
  }
  const validated = {};
  for (const [profile, enabled] of Object.entries(profileOverrides)) {
    assertNonEmptyString(profile, "profile override id", flagId);
    if (!ALLOWED_FEATURE_FLAG_PROFILES.has(profile)) {
      throw new Error(`Feature flag ${flagId} profile ${profile} is not allowed`);
    }
    if (typeof enabled !== "boolean") {
      throw new Error(`Feature flag ${flagId} profile override ${profile} must be boolean`);
    }
    validated[profile] = enabled;
  }
  return validated;
}

export function validateFeatureFlagManifest(manifest = FEATURE_FLAGS) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Feature flag manifest must be an object");
  }

  const validated = {};
  for (const [flagId, definition] of Object.entries(manifest)) {
    assertNonEmptyString(flagId, "id", flagId || "<empty>");
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      throw new Error(`Feature flag ${flagId} definition must be an object`);
    }
    assertNonEmptyString(definition.owner, "owner", flagId);
    assertNonEmptyString(definition.scope, "scope", flagId);
    assertNonEmptyString(definition.description, "description", flagId);
    assertNonEmptyString(definition.safetyBoundary, "safetyBoundary", flagId);

    if (!ALLOWED_FEATURE_FLAG_SCOPES.has(definition.scope)) {
      throw new Error(`Feature flag ${flagId} scope ${definition.scope} is not allowed`);
    }
    if (typeof definition.defaultEnabled !== "boolean") {
      throw new Error(`Feature flag ${flagId} defaultEnabled must be boolean`);
    }
    if (definition.id && definition.id !== flagId) {
      throw new Error(`Feature flag ${flagId} id mismatch: ${definition.id}`);
    }

    validated[flagId] = freezeDefinition(flagId, {
      ...definition,
      profileOverrides: validateProfileOverrides(flagId, definition.profileOverrides),
    });
  }

  return Object.freeze(validated);
}

const VALIDATED_FEATURE_FLAGS = validateFeatureFlagManifest(FEATURE_FLAGS);

function validateFeatureFlagProfile(profile) {
  if (profile === undefined || profile === null) {
    return null;
  }
  assertNonEmptyString(profile, "requested profile", "<lookup>");
  if (!ALLOWED_FEATURE_FLAG_PROFILES.has(profile)) {
    throw new Error(`Unknown feature flag profile: ${profile}`);
  }
  return profile;
}

function getValidatedManifest(manifest) {
  return manifest === VALIDATED_FEATURE_FLAGS ? manifest : validateFeatureFlagManifest(manifest);
}

export function getFeatureFlagDefinition(flagId, { manifest = VALIDATED_FEATURE_FLAGS } = {}) {
  const validated = getValidatedManifest(manifest);
  const definition = validated[flagId];
  if (!definition) {
    throw new Error(`Unknown feature flag: ${flagId}`);
  }
  return definition;
}

export function resolveFeatureFlagState(flagId, { manifest = VALIDATED_FEATURE_FLAGS, profile = null } = {}) {
  const definition = getFeatureFlagDefinition(flagId, { manifest });
  const requestedProfile = validateFeatureFlagProfile(profile);
  const hasProfileOverride = requestedProfile !== null && Object.hasOwn(definition.profileOverrides, requestedProfile);
  return Object.freeze({
    id: flagId,
    enabled: hasProfileOverride ? definition.profileOverrides[requestedProfile] : definition.defaultEnabled,
    source: hasProfileOverride ? "profile_override" : "default",
    profile: requestedProfile,
    defaultEnabled: definition.defaultEnabled,
  });
}

export function isFeatureEnabled(flagId, options = {}) {
  return resolveFeatureFlagState(flagId, options).enabled;
}

export function buildFeatureFlagCatalogSummary({
  manifest = VALIDATED_FEATURE_FLAGS,
  includeFlags = true,
  profile = null,
} = {}) {
  const validated = getValidatedManifest(manifest);
  const requestedProfile = validateFeatureFlagProfile(profile);
  const flags = Object.values(validated).sort((a, b) => a.id.localeCompare(b.id));
  const resolvedFlags = flags.map((flag) =>
    Object.freeze({
      ...flag,
      ...resolveFeatureFlagState(flag.id, {
        manifest: validated,
        profile: requestedProfile,
      }),
    }),
  );
  return Object.freeze({
    schemaVersion: FEATURE_FLAG_SCHEMA_VERSION,
    configured: true,
    runtimeOverrideSupported: false,
    profileOverrideSupported: true,
    allowedScopes: [...ALLOWED_FEATURE_FLAG_SCOPES].sort(),
    allowedProfiles: [...ALLOWED_FEATURE_FLAG_PROFILES].sort(),
    requestedProfile,
    forbiddenAuthority: [...FORBIDDEN_FEATURE_FLAG_AUTHORITY],
    flagCount: flags.length,
    enabledFlagCount: resolvedFlags.filter((flag) => flag.enabled === true).length,
    profileOverrideCount: resolvedFlags.filter((flag) => flag.source === "profile_override").length,
    scopes: flags.reduce((acc, flag) => {
      acc[flag.scope] = (acc[flag.scope] || 0) + 1;
      return acc;
    }, {}),
    flags: includeFlags
      ? resolvedFlags.map((flag) => ({
          id: flag.id,
          owner: flag.owner,
          scope: flag.scope,
          defaultEnabled: flag.defaultEnabled,
          enabled: flag.enabled,
          source: flag.source,
          profile: flag.profile,
          description: flag.description,
          safetyBoundary: flag.safetyBoundary,
          createdAt: flag.createdAt,
          reviewCadence: flag.reviewCadence,
          profileOverrides: { ...flag.profileOverrides },
        }))
      : [],
  });
}
