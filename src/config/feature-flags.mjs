// Committed feature flags for safe, non-live rollout surfaces only.
// This module intentionally has no env, dashboard, Telegram, runtime-file, or
// LLM override path. Live authority remains owned by committed caps, policy,
// signer approval, kill-switch, and payback config.

export const ALLOWED_FEATURE_FLAG_SCOPES = Object.freeze(
  new Set(["dev", "report", "dashboard", "scaffold", "non_live_rollout"]),
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
});

function assertNonEmptyString(value, label, flagId) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Feature flag ${flagId} missing ${label}`);
  }
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

    validated[flagId] = freezeDefinition(flagId, definition);
  }

  return Object.freeze(validated);
}

const VALIDATED_FEATURE_FLAGS = validateFeatureFlagManifest(FEATURE_FLAGS);

export function getFeatureFlagDefinition(flagId, { manifest = VALIDATED_FEATURE_FLAGS } = {}) {
  const validated = manifest === VALIDATED_FEATURE_FLAGS ? manifest : validateFeatureFlagManifest(manifest);
  const definition = validated[flagId];
  if (!definition) {
    throw new Error(`Unknown feature flag: ${flagId}`);
  }
  return definition;
}

export function isFeatureEnabled(flagId, options = {}) {
  return getFeatureFlagDefinition(flagId, options).defaultEnabled;
}

export function buildFeatureFlagCatalogSummary({ manifest = VALIDATED_FEATURE_FLAGS, includeFlags = true } = {}) {
  const validated = manifest === VALIDATED_FEATURE_FLAGS ? manifest : validateFeatureFlagManifest(manifest);
  const flags = Object.values(validated).sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({
    schemaVersion: FEATURE_FLAG_SCHEMA_VERSION,
    configured: true,
    runtimeOverrideSupported: false,
    allowedScopes: [...ALLOWED_FEATURE_FLAG_SCOPES].sort(),
    forbiddenAuthority: [...FORBIDDEN_FEATURE_FLAG_AUTHORITY],
    flagCount: flags.length,
    enabledFlagCount: flags.filter((flag) => flag.defaultEnabled === true).length,
    scopes: flags.reduce((acc, flag) => {
      acc[flag.scope] = (acc[flag.scope] || 0) + 1;
      return acc;
    }, {}),
    flags: includeFlags
      ? flags.map((flag) => ({
          id: flag.id,
          owner: flag.owner,
          scope: flag.scope,
          defaultEnabled: flag.defaultEnabled,
          description: flag.description,
          safetyBoundary: flag.safetyBoundary,
          createdAt: flag.createdAt,
          reviewCadence: flag.reviewCadence,
        }))
      : [],
  });
}
