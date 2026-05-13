import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("repository exposes substantive staged-file pre-commit checks", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const preCommitHelper = await readFile(new URL("../scripts/pre-commit-staged-checks.mjs", import.meta.url), "utf8");
  assert.equal(packageJson.scripts?.prepare, "husky");
  assert.match(packageJson.devDependencies?.husky || "", /^\^?\d+\.\d+\.\d+/u);
  assert.match(packageJson.devDependencies?.["lint-staged"] || "", /^\^?\d+\.\d+\.\d+/u);
  assert.ok(packageJson["lint-staged"], "lint-staged configuration must exist");
  assert.match(
    preCommitHelper,
    /scripts\/check-large-files\.mjs/u,
    "staged-file hook must prevent oversized source files before commit",
  );
});

test("staged-file helper excludes generated outputs and keeps source checks", async () => {
  const { classifyStagedFiles } = await import("../scripts/pre-commit-staged-checks.mjs");
  const plan = classifyStagedFiles([
    "src/executor/policy/index.mjs",
    "test/executor-policy-index.test.mjs",
    "dashboard/public/app.jsx",
    "dashboard/public/dashboard-status.json",
    "logs/signer-audit.jsonl",
    "data/all-chain-autopilot-latest.json",
    "docs/system-map.md",
    "package.json",
  ]);

  assert.deepEqual(plan.excludedFiles, [
    "dashboard/public/dashboard-status.json",
    "logs/signer-audit.jsonl",
    "data/all-chain-autopilot-latest.json",
  ]);
  assert.deepEqual(plan.nodeCheckFiles, ["src/executor/policy/index.mjs", "test/executor-policy-index.test.mjs"]);
  assert.deepEqual(plan.nodeTestFiles, ["test/executor-policy-index.test.mjs"]);
  assert.deepEqual(plan.prettierFiles, [
    "src/executor/policy/index.mjs",
    "test/executor-policy-index.test.mjs",
    "dashboard/public/app.jsx",
    "docs/system-map.md",
    "package.json",
  ]);
});
