import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildLargeFileReport } from "../scripts/check-large-files.mjs";

test("large-file scan excludes lockfiles and readiness baselines", () => {
  const report = buildLargeFileReport(["package-lock.json", "docs/readiness/duplicate-code-baseline.json"]);

  assert.equal(report.filesScanned, 0);
  assert.equal(report.violations.length, 0);
});

test("large-file detection is wired into CI and readiness performance tracking", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const workflow = readFileSync(".github/workflows/auto-pr-validate.yml", "utf8");

  assert.equal(packageJson.scripts?.["check:large-files"], "node scripts/check-large-files.mjs");
  assert.match(
    packageJson.scripts?.["perf:check:large-files"] || "",
    /track-build-performance\.mjs .*npm run check:large-files/u,
  );
  assert.match(workflow, /npm run perf:check:large-files/u, "PR validation must run large-file detection");
});
