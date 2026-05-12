import test from "node:test";
import assert from "node:assert/strict";

import { filterIgnoredIssues, normalizeKnipDependencyIssues } from "../scripts/check-unused-dependencies.mjs";

test("normalizeKnipDependencyIssues returns sorted unique dependency findings", () => {
  const issues = normalizeKnipDependencyIssues({
    issues: [
      {
        file: "package.json",
        dependencies: [{ name: "ethers" }],
        devDependencies: [{ name: "knip" }, { name: "knip" }],
        optionalPeerDependencies: [{ name: "@types/node" }],
        unlisted: [{ name: "playwright" }],
      },
      {
        file: "src/cli/foo.mjs",
        unlisted: [{ name: "playwright" }],
      },
    ],
  });

  assert.deepEqual(issues, [
    { kind: "unlisted dependency", file: "package.json", name: "playwright" },
    { kind: "unlisted dependency", file: "src/cli/foo.mjs", name: "playwright" },
    { kind: "unused dependency", file: "package.json", name: "ethers" },
    { kind: "unused devDependency", file: "package.json", name: "knip" },
    { kind: "unused optionalPeerDependency", file: "package.json", name: "@types/node" },
  ]);
});

test("normalizeKnipDependencyIssues ignores blank names and missing arrays", () => {
  const issues = normalizeKnipDependencyIssues({
    issues: [{ file: "package.json", dependencies: [{ name: "" }, {}] }, { file: "", unlisted: [{ name: "foo" }] }, {}],
  });

  assert.deepEqual(issues, []);
});

test("filterIgnoredIssues removes only documented scratch-file Playwright findings", () => {
  const issues = filterIgnoredIssues([
    { kind: "unlisted dependency", file: "test-local.cjs", name: "playwright" },
    { kind: "unlisted dependency", file: "src/cli/foo.mjs", name: "playwright" },
  ]);

  assert.deepEqual(issues, [{ kind: "unlisted dependency", file: "src/cli/foo.mjs", name: "playwright" }]);
});
