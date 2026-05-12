import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCRIPT_PATH = resolve(ROOT_DIR, "scripts/track-build-performance.mjs");

test("track-build-performance records a successful command and writes summary files", (t) => {
  const artifactDir = mkdtempSync(join(tmpdir(), "build-performance-success-"));
  t.after(() => rmSync(artifactDir, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--label=dashboard-build",
      "--artifact-dir",
      artifactDir,
      "--",
      process.execPath,
      "-e",
      "setTimeout(() => process.exit(0), 10);",
    ],
    {
      cwd: ROOT_DIR,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0);

  const files = readdirSync(artifactDir).sort();
  assert.ok(files.includes("summary.json"));
  assert.ok(files.includes("summary.md"));

  const measurementFiles = files.filter((file) => file.endsWith(".json") && file !== "summary.json");
  assert.equal(measurementFiles.length, 1);

  const summary = JSON.parse(readFileSync(join(artifactDir, "summary.json"), "utf8"));
  assert.equal(summary.records.length, 1);
  assert.equal(summary.records[0].label, "dashboard-build");
  assert.equal(summary.records[0].ok, true);
  assert.equal(summary.records[0].exitCode, 0);
  assert.ok(summary.records[0].durationMs >= 0);

  const markdown = readFileSync(join(artifactDir, "summary.md"), "utf8");
  assert.match(markdown, /dashboard-build/);
});

test("track-build-performance preserves nonzero exit codes while still writing a failure record", (t) => {
  const artifactDir = mkdtempSync(join(tmpdir(), "build-performance-failure-"));
  t.after(() => rmSync(artifactDir, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [SCRIPT_PATH, "--label=test", "--artifact-dir", artifactDir, "--", process.execPath, "-e", "process.exit(7);"],
    {
      cwd: ROOT_DIR,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 7);

  const summary = JSON.parse(readFileSync(join(artifactDir, "summary.json"), "utf8"));
  assert.equal(summary.records.length, 1);
  assert.equal(summary.records[0].label, "test");
  assert.equal(summary.records[0].ok, false);
  assert.equal(summary.records[0].exitCode, 7);
});
