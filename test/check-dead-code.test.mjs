import test from "node:test";
import assert from "node:assert/strict";

import {
  compareIssueSets,
  normalizeKnipFileIssues,
  readBaselineIssues,
} from "../scripts/check-dead-code.mjs";

test("normalizeKnipFileIssues returns sorted unique file entries", () => {
  const issues = normalizeKnipFileIssues({
    issues: [
      { file: "src/cli/b.mjs" },
      { file: "src/cli/a.mjs" },
      { file: "src/cli/b.mjs" },
      { file: "" },
      {},
    ],
  });

  assert.deepEqual(issues, ["src/cli/a.mjs", "src/cli/b.mjs"]);
});

test("readBaselineIssues returns sorted unique baseline paths", () => {
  const issues = readBaselineIssues(
    JSON.stringify({
      issues: [
        { path: "src/cli/c.mjs" },
        { path: "src/cli/a.mjs" },
        { path: "src/cli/c.mjs" },
      ],
    }),
  );

  assert.deepEqual(issues, ["src/cli/a.mjs", "src/cli/c.mjs"]);
});

test("compareIssueSets distinguishes new, resolved, and unchanged issues", () => {
  const comparison = compareIssueSets({
    baselineIssues: ["src/cli/a.mjs", "src/cli/b.mjs"],
    currentIssues: ["src/cli/b.mjs", "src/cli/c.mjs"],
  });

  assert.deepEqual(comparison.newIssues, ["src/cli/c.mjs"]);
  assert.deepEqual(comparison.resolvedIssues, ["src/cli/a.mjs"]);
  assert.deepEqual(comparison.unchangedIssues, ["src/cli/b.mjs"]);
});
