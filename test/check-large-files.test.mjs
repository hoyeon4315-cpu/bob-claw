import test from "node:test";
import assert from "node:assert/strict";

import { buildLargeFileReport } from "../scripts/check-large-files.mjs";

test("large-file scan excludes lockfiles and readiness baselines", () => {
  const report = buildLargeFileReport(["package-lock.json", "docs/readiness/duplicate-code-baseline.json"]);

  assert.equal(report.filesScanned, 0);
  assert.equal(report.violations.length, 0);
});
