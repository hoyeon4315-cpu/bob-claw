import test from "node:test";
import assert from "node:assert/strict";

import { checkDeploymentObservability } from "../scripts/check-deployment-observability.mjs";

test("deployment observability references stay wired to real repo surfaces", () => {
  const result = checkDeploymentObservability();

  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
  assert.equal(result.failures.length, 0);
  assert.ok(
    result.packageScripts.some((entry) => entry.name === "verify:dashboard-publish" && entry.exists),
    "verify:dashboard-publish script should stay available",
  );
  assert.ok(
    result.workflowSnippets.some((entry) => entry.snippet === "dashboard-status.json" && entry.found),
    "deploy workflow should continue verifying dashboard-status.json",
  );
});
