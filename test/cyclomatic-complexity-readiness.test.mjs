import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

test("repository documents and wires cyclomatic complexity enforcement", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    packageJson.scripts?.["report:complexity"],
    "node scripts/report-cyclomatic-complexity.mjs",
    "package.json must expose a repo-wide cyclomatic complexity report command",
  );
  assert.equal(
    packageJson.scripts?.["validate:complexity"],
    "node scripts/validate-cyclomatic-complexity.mjs --base origin/main",
    "package.json must expose a changed-files cyclomatic complexity validator",
  );
  assert.match(packageJson.devDependencies?.eslint || "", /^\^?\d+\.\d+\.\d+/u);

  const guidePath = "docs/cyclomatic-complexity.md";
  const guide = readFileSync(guidePath, "utf8");
  assert.match(guide, /Threshold and enforcement/u);
  assert.match(guide, /Excluded surfaces/u);
  assert.match(guide, /Changed-file gate/u);

  const preCommitChecks = readFileSync("scripts/pre-commit-staged-checks.mjs", "utf8");
  assert.match(
    preCommitChecks,
    /validate-cyclomatic-complexity\.mjs/u,
    "pre-commit checks must invoke cyclomatic complexity validation for staged source files",
  );
});

test("cyclomatic complexity validator enforces the configured threshold on explicit files", () => {
  const fixtureDir = mkdtempSync(join(process.cwd(), "test/.tmp-cyclomatic-complexity-"));
  try {
    const simpleFile = join(fixtureDir, "simple.mjs");
    writeFileSync(simpleFile, "export function identity(value) {\n  return value;\n}\n");
    const simpleRun = spawnSync(process.execPath, ["scripts/validate-cyclomatic-complexity.mjs", "--json", simpleFile], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(simpleRun.status, 0, simpleRun.stderr || simpleRun.stdout);
    const simpleReport = JSON.parse(simpleRun.stdout);
    assert.equal(simpleReport.filesChecked, 1);
    assert.equal(simpleReport.errorCount, 0);

    const complexFile = join(fixtureDir, "too-complex.mjs");
    writeFileSync(
      complexFile,
      [
        "export function tooComplex(value) {",
        "  if (value === 0) return 0;",
        "  if (value === 1) return 1;",
        "  if (value === 2) return 2;",
        "  if (value === 3) return 3;",
        "  if (value === 4) return 4;",
        "  if (value === 5) return 5;",
        "  if (value === 6) return 6;",
        "  if (value === 7) return 7;",
        "  if (value === 8) return 8;",
        "  if (value === 9) return 9;",
        "  if (value === 10) return 10;",
        "  if (value === 11) return 11;",
        "  if (value === 12) return 12;",
        "  if (value === 13) return 13;",
        "  if (value === 14) return 14;",
        "  if (value === 15) return 15;",
        "  if (value === 16) return 16;",
        "  if (value === 17) return 17;",
        "  if (value === 18) return 18;",
        "  if (value === 19) return 19;",
        "  if (value === 20) return 20;",
        "  return value;",
        "}",
        "",
      ].join("\n"),
    );
    const complexRun = spawnSync(
      process.execPath,
      ["scripts/validate-cyclomatic-complexity.mjs", "--json", complexFile],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    assert.equal(complexRun.status, 1, "validator must fail once complexity exceeds the configured maximum");
    const complexReport = JSON.parse(complexRun.stdout);
    assert.equal(complexReport.filesChecked, 1);
    assert.ok(complexReport.errorCount >= 1);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("cyclomatic complexity report inspects repository files and surfaces baseline offenders", () => {
  const reportRun = spawnSync(process.execPath, ["scripts/report-cyclomatic-complexity.mjs", "--json", "--limit", "5"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(reportRun.status, 0, reportRun.stderr || reportRun.stdout);
  const report = JSON.parse(reportRun.stdout);
  assert.ok(report.filesChecked > 0, "complexity report must inspect tracked source files");
  assert.ok(report.offenderCount > 0, "complexity report must surface real baseline offenders");
  assert.ok(report.topOffenders.length > 0, "complexity report must list top offenders");
});
