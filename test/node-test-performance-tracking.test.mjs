import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseTapOutput, runMeasuredNodeTest } from "../scripts/track-node-test-performance.mjs";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("parseTapOutput extracts suite duration, counts, and slowest tests from TAP output", () => {
  const tapOutput = [
    "TAP version 13",
    "# Subtest: fast test",
    "ok 1 - fast test",
    "  ---",
    "  duration_ms: 12.5",
    "  type: 'test'",
    "  ...",
    "# Subtest: slow test",
    "ok 2 - slow test",
    "  ---",
    "  duration_ms: 48.125",
    "  type: 'test'",
    "  ...",
    "1..2",
    "# tests 2",
    "# suites 0",
    "# pass 2",
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
    "# duration_ms 90.625",
    "",
  ].join("\n");

  const summary = parseTapOutput(tapOutput);
  assert.equal(summary.suiteDurationMs, 90.625);
  assert.equal(summary.counts.tests, 2);
  assert.equal(summary.counts.pass, 2);
  assert.equal(summary.slowestTests[0].name, "slow test");
  assert.equal(summary.slowestTests[0].durationMs, 48.125);
});

test("track-node-test-performance writes artifacts for successful commands even without TAP parsing", async (t) => {
  const artifactDir = mkdtempSync(join(tmpdir(), "node-test-performance-"));
  t.after(() => rmSync(artifactDir, { recursive: true, force: true }));

  const result = await runMeasuredNodeTest({
    label: "test",
    artifactDir,
    commandString: `${process.execPath} -e "console.log('plain stdout without tap')"`,
    cwd: ROOT_DIR,
  });

  assert.equal(result.record.exitCode, 0);
  assert.equal(result.summary.ok, true);
  assert.equal(result.summary.reporter, "unparsed");
  assert.match(readFileSync(result.artifactPaths.summaryMarkdownPath, "utf8"), /No TAP per-test durations were parsed/);
  assert.match(readFileSync(result.artifactPaths.rawLogPath, "utf8"), /plain stdout without tap/);
});

test("track-node-test-performance preserves nonzero exit codes while writing timing artifacts", async (t) => {
  const artifactDir = mkdtempSync(join(tmpdir(), "node-test-performance-fail-"));
  t.after(() => rmSync(artifactDir, { recursive: true, force: true }));

  const result = await runMeasuredNodeTest({
    label: "test",
    artifactDir,
    commandString: `${process.execPath} -e "process.exit(7)"`,
    cwd: ROOT_DIR,
  });

  assert.equal(result.record.exitCode, 7);
  assert.equal(result.summary.ok, false);
  assert.match(readFileSync(result.artifactPaths.summaryJsonPath, "utf8"), /"exitCode": 7/);
});
