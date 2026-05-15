import test from "node:test";
import assert from "node:assert/strict";

import {
  getDefinedFeatureFlagIds,
  extractFeatureFlagCallIds,
  scanFeatureFlagUsage,
} from "../scripts/check-dead-feature-flags.mjs";

const SAMPLE_MANIFEST = Object.freeze({
  "report.alpha": { owner: "test", scope: "report", defaultEnabled: true, description: "a", safetyBoundary: "x" },
  "dev.beta": { owner: "test", scope: "dev", defaultEnabled: false, description: "b", safetyBoundary: "y" },
});

test("getDefinedFeatureFlagIds returns sorted keys from manifest", () => {
  const ids = getDefinedFeatureFlagIds(SAMPLE_MANIFEST);
  assert.deepEqual(ids, ["dev.beta", "report.alpha"]);
});

test("getDefinedFeatureFlagIds handles empty or invalid manifest", () => {
  assert.deepEqual(getDefinedFeatureFlagIds(null), []);
  assert.deepEqual(getDefinedFeatureFlagIds({}), []);
  // explicit undefined triggers the default (real FEATURE_FLAGS) — this is intentional for call sites
  const withUndef = getDefinedFeatureFlagIds(undefined);
  assert.ok(Array.isArray(withUndef) && withUndef.length >= 1);
});

test("extractFeatureFlagCallIds finds isFeatureEnabled and getFeatureFlagDefinition calls", () => {
  const content = `
    const a = isFeatureEnabled("report.alpha");
    const b = getFeatureFlagDefinition("dev.beta", { manifest });
    const c = isFeatureEnabled("report.alpha", { manifest: custom });
    // ignore non-calls
    const d = someOther("report.alpha");
    const e = isFeatureEnabled(\`report.alpha\`);
  `;
  const ids = extractFeatureFlagCallIds(content);
  assert.deepEqual([...ids].sort(), ["dev.beta", "report.alpha"]);
});

test("extractFeatureFlagCallIds ignores malformed ids and non-flag calls", () => {
  const content = `
    isFeatureEnabled("not.a.valid.id!");
    isFeatureEnabled("also bad");
    getFeatureFlagDefinition(42);
    isFeatureEnabled(variable);
  `;
  const ids = extractFeatureFlagCallIds(content);
  assert.equal(ids.size, 0);
});

test("scanFeatureFlagUsage detects the committed live flag and reports no dead/stale in real repo", () => {
  const result = scanFeatureFlagUsage();
  assert.ok(result.definedCount >= 1);
  assert.ok(Array.isArray(result.deadFlags));
  assert.ok(Array.isArray(result.staleFlagRefs));
  assert.equal(result.deadFlags.length, 0, "no dead flags expected with current manifest + consumers");
  // The one real flag must be detected as live via its consumer in src/status and test/
  assert.ok(
    result.usage["report.feature_flag_catalog_slice"] &&
      result.usage["report.feature_flag_catalog_slice"].fileCount >= 2,
    "catalog flag must have at least the slice + test references",
  );
  assert.ok(result.scannedFileCount > 100, "should scan a meaningful number of source files");
});

test("scanFeatureFlagUsage returns consistent shape and includes definitionFile", () => {
  const result = scanFeatureFlagUsage();
  assert.equal(typeof result.definitionFile, "string");
  assert.ok(result.definitionFile.includes("feature-flags.mjs"));
  assert.ok(typeof result.usage === "object");
});
