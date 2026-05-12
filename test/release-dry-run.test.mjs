import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleaseDryRunPlan,
  REQUIRED_RELEASE_SCRIPTS,
} from "../scripts/release-dry-run.mjs";

test("release dry-run plan requires the dashboard release pipeline scripts", () => {
  const packageJson = {
    name: "bob-claw",
    version: "0.1.0",
    private: true,
    scripts: {
      "release:dry-run": "node scripts/release-dry-run.mjs",
      check: "node --check example.mjs",
      test: "node --test",
      "status:dashboard:light": "node src/cli/status-dashboard.mjs --skip-shadow-cycle --skip-canary-input-refresh",
      "report:strategy-tick-slice": "node src/cli/report-strategy-tick-slice.mjs --write",
      "dashboard:build": "node src/cli/build-dashboard-public.mjs",
      "deploy:dashboard:cloudflare": "node src/cli/deploy-dashboard-cloudflare.mjs",
      "verify:dashboard-publish": "node src/cli/verify-dashboard-publish.mjs",
    },
  };

  const plan = buildReleaseDryRunPlan({
    packageJson,
    workflowFiles: [".github/workflows/release-automation.yml"],
  });

  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.requiredScripts.map((script) => script.name),
    REQUIRED_RELEASE_SCRIPTS,
  );
  assert.equal(plan.publishAllowed, false);
  assert.equal(plan.releaseTarget, "dashboard-cloudflare-pages");
  assert.match(plan.safety.releaseMode, /dry-run/);
});

test("release dry-run plan blocks missing release prerequisites", () => {
  const plan = buildReleaseDryRunPlan({
    packageJson: {
      name: "bob-claw",
      version: "0.1.0",
      private: true,
      scripts: {
        test: "node --test",
      },
    },
    workflowFiles: [],
  });

  assert.equal(plan.ok, false);
  assert.ok(plan.blockers.some((blocker) => blocker.code === "missing_workflow"));
  assert.ok(plan.blockers.some((blocker) => blocker.code === "missing_script"));
  assert.ok(
    plan.blockers.some((blocker) => blocker.detail.includes("verify:dashboard-publish")),
  );
});
