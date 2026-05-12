import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALLOWED_FEATURE_FLAG_SCOPES,
  buildFeatureFlagCatalogSummary,
  getFeatureFlagDefinition,
  isFeatureEnabled,
  validateFeatureFlagManifest,
} from "../src/config/feature-flags.mjs";
import { buildFeatureFlagCatalogSlice } from "../src/status/feature-flag-catalog-slice.mjs";

test("feature flag manifest exposes only non-live safe scopes", () => {
  assert.deepEqual([...ALLOWED_FEATURE_FLAG_SCOPES].sort(), [
    "dashboard",
    "dev",
    "non_live_rollout",
    "report",
    "scaffold",
  ]);

  const summary = buildFeatureFlagCatalogSummary();
  assert.equal(summary.configured, true);
  assert.equal(summary.runtimeOverrideSupported, false);
  assert.ok(summary.flagCount >= 1);
  assert.ok(summary.forbiddenAuthority.includes("signer"));
  assert.ok(summary.forbiddenAuthority.includes("payback"));
  assert.ok(summary.flags.every((flag) => ALLOWED_FEATURE_FLAG_SCOPES.has(flag.scope)));
});

test("committed lookup returns the configured default and metadata", () => {
  assert.equal(isFeatureEnabled("report.feature_flag_catalog_slice"), true);

  const definition = getFeatureFlagDefinition("report.feature_flag_catalog_slice");
  assert.equal(definition.scope, "report");
  assert.equal(definition.defaultEnabled, true);
  assert.equal(definition.owner, "ops-harness");
  assert.match(definition.safetyBoundary, /report-only/);
});

test("report-only feature flag catalog slice consumes the committed lookup", () => {
  const slice = buildFeatureFlagCatalogSlice();
  assert.equal(slice.readOnly, true);
  assert.equal(slice.runtimeAuthority, "none");
  assert.equal(slice.catalogIncluded, true);
  assert.equal(slice.runtimeOverrideSupported, false);
  assert.ok(slice.flags.some((flag) => flag.id === "report.feature_flag_catalog_slice"));
  assert.match(slice.policyNote, /do not change policy/);
});

test("unknown flags fail closed instead of inventing a default", () => {
  assert.throws(() => isFeatureEnabled("policy.override_caps"), /Unknown feature flag: policy\.override_caps/);
});

test("manifest validation rejects missing owner, invalid defaults, and live scopes", () => {
  assert.throws(
    () =>
      validateFeatureFlagManifest({
        "report.missing_owner": {
          scope: "report",
          defaultEnabled: false,
          description: "Missing owner should not validate.",
          safetyBoundary: "report-only",
        },
      }),
    /missing owner/,
  );

  assert.throws(
    () =>
      validateFeatureFlagManifest({
        "report.invalid_default": {
          owner: "ops-harness",
          scope: "report",
          defaultEnabled: "false",
          description: "Invalid boolean should not validate.",
          safetyBoundary: "report-only",
        },
      }),
    /defaultEnabled must be boolean/,
  );

  assert.throws(
    () =>
      validateFeatureFlagManifest({
        "policy.live_bypass": {
          owner: "ops-harness",
          scope: "policy",
          defaultEnabled: false,
          description: "Policy scope is intentionally forbidden.",
          safetyBoundary: "would change policy authority",
        },
      }),
    /scope policy is not allowed/,
  );
});
