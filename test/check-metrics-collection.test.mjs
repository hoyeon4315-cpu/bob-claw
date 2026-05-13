import assert from "node:assert/strict";
import test from "node:test";

import { checkMetricsCollection } from "../scripts/check-metrics-collection.mjs";

test("metrics collection readiness stays wired to real repo surfaces", () => {
  const result = checkMetricsCollection();

  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
  assert.equal(result.failures.length, 0);
  assert.ok(
    result.packageScripts.some((entry) => entry.name === "report:metrics-snapshot" && entry.exists),
    "report:metrics-snapshot script should stay available",
  );
  assert.ok(
    result.packageScripts.some((entry) => entry.name === "check:metrics-collection" && entry.exists),
    "check:metrics-collection script should stay available",
  );
  assert.ok(
    result.docSnippets.some((entry) => entry.snippet === "--metrics-out=/tmp/bob-claw-metrics.prom" && entry.found),
    "metrics doc should explain safe file export usage",
  );
});
