import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("repository wires minimum coverage enforcement into package scripts and PR validation", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(
    packageJson.scripts?.["test:coverage"],
    "node --experimental-test-coverage --test-coverage-lines=80 --test-coverage-branches=65 --test-coverage-functions=80 --test-coverage-include=src/executor/policy/*.mjs --test-coverage-include=src/executor/payback/*.mjs --test-coverage-include=src/risk/auto-kill-triggers.mjs --test test/executor-policy-coverage.test.mjs test/executor-policy-index.test.mjs test/gateway-availability.test.mjs test/auto-kill-triggers.test.mjs test/payback-scheduler.test.mjs test/payback-accumulator.test.mjs test/payback-dashboard.test.mjs test/payback-quote-proof-matrix.test.mjs test/capital-audit-gate.test.mjs test/executor-approval-hygiene.test.mjs test/aggressive-velocity-policy.test.mjs",
    "package.json must expose a real coverage gate with nonzero thresholds over the documented critical source scope",
  );

  const workflow = await readFile(new URL("../.github/workflows/auto-pr-validate.yml", import.meta.url), "utf8");
  assert.match(
    workflow,
    /coverage_thresholds:/u,
    "pull request validation must define a dedicated coverage threshold job",
  );
  assert.match(
    workflow,
    /node-version:\s*"26"/u,
    "coverage threshold job must use a Node runtime that supports scoped built-in fail-under coverage flags",
  );
  assert.match(workflow, /npm run test:coverage/u, "pull request validation must execute the coverage threshold gate");

  const guide = await readFile(new URL("../docs/readiness/test-coverage-thresholds.md", import.meta.url), "utf8");
  assert.match(guide, /Thresholds/u);
  assert.match(guide, /Scoped source coverage gate/u);
  assert.match(guide, /Excluded surfaces and follow-up/u);
});
