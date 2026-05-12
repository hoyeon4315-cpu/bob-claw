import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("repository documents and validates naming conventions", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    packageJson.scripts?.["validate:naming"],
    "node scripts/validate-naming-conventions.mjs --check",
    "package.json must expose a dedicated naming validation command",
  );

  const namingGuidePath = "docs/naming-conventions.md";
  assert.equal(existsSync(namingGuidePath), true, "docs/naming-conventions.md must exist");

  const namingGuide = readFileSync(namingGuidePath, "utf8");
  assert.match(namingGuide, /File naming/u);
  assert.match(namingGuide, /Identifier naming/u);
  assert.match(namingGuide, /Runtime and compatibility exceptions/u);

  const preCommitChecks = readFileSync("scripts/pre-commit-staged-checks.mjs", "utf8");
  assert.match(
    preCommitChecks,
    /validate-naming-conventions\.mjs/u,
    "pre-commit checks must invoke naming validation for staged files",
  );

  const validator = spawnSync(process.execPath, ["scripts/validate-naming-conventions.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(validator.status, 0, validator.stderr || validator.stdout);

  const report = JSON.parse(validator.stdout);
  assert.ok(report.filesChecked > 0, "naming validator must inspect real repo files");
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors, null, 2));
});
