import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildMeasurementRecord,
  formatDurationMs,
  readMeasurementRecords,
  writeMeasurementRecord,
  writeSummaryFiles,
} from "./track-build-performance.mjs";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_ARTIFACT_DIR = resolve(ROOT_DIR, "artifacts/build-performance");
const DEFAULT_SUMMARY_BASENAME = "test-performance-summary";
const DEFAULT_RAW_LOG_BASENAME = "test-performance.tap";

function parseCliArgs(argv = []) {
  const args = [...argv];
  let label = "test";
  let artifactDir = DEFAULT_ARTIFACT_DIR;
  let scriptName = "test";
  let commandString = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--label=")) {
      label = arg.slice("--label=".length);
      continue;
    }
    if (arg === "--label") {
      label = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact-dir=")) {
      artifactDir = resolve(ROOT_DIR, arg.slice("--artifact-dir=".length));
      continue;
    }
    if (arg === "--artifact-dir") {
      artifactDir = resolve(ROOT_DIR, args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--script=")) {
      scriptName = arg.slice("--script=".length);
      continue;
    }
    if (arg === "--script") {
      scriptName = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--command-string=")) {
      commandString = arg.slice("--command-string=".length);
      continue;
    }
    if (arg === "--command-string") {
      commandString = args[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument: ${arg}`);
  }

  return {
    label,
    artifactDir,
    scriptName,
    commandString,
  };
}

function readPackageScripts() {
  const packageJsonPath = resolve(ROOT_DIR, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return packageJson?.scripts || {};
}

function withTapReporter(commandString) {
  if (!/\bnode\b/.test(commandString) || !/\s--test(?:\s|$)/.test(commandString))
    return { commandString, usesTapReporter: false };
  if (/\s--test-reporter(?:=|\s+)/.test(commandString)) return { commandString, usesTapReporter: true };
  return {
    commandString: commandString.replace(/\s--test(\s|$)/, " --test --test-reporter tap$1"),
    usesTapReporter: true,
  };
}

function resolveCommandString({ scriptName, commandString }) {
  if (commandString) {
    const resolved = withTapReporter(commandString);
    return {
      source: "direct-command",
      commandString: resolved.commandString,
      usesTapReporter: resolved.usesTapReporter,
    };
  }

  const scripts = readPackageScripts();
  const scriptCommand = scripts[scriptName];
  if (!scriptCommand) throw new Error(`package.json script not found: ${scriptName}`);
  const resolved = withTapReporter(scriptCommand);
  return {
    source: `package-script:${scriptName}`,
    commandString: resolved.commandString,
    usesTapReporter: resolved.usesTapReporter,
  };
}

export function parseTapOutput(stdout = "") {
  const lines = String(stdout).split(/\r?\n/);
  const tests = [];
  const counts = {};
  let current = null;
  let suiteDurationMs = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("# Subtest: ")) {
      current = {
        name: line.slice("# Subtest: ".length),
        durationMs: null,
        type: null,
      };
      continue;
    }

    if (current) {
      const durationMatch = line.match(/^\s*duration_ms:\s*([0-9.]+)/);
      if (durationMatch) {
        current.durationMs = Number(durationMatch[1]);
        continue;
      }

      const typeMatch = line.match(/^\s*type:\s*'([^']+)'/);
      if (typeMatch) {
        current.type = typeMatch[1];
        continue;
      }

      if (line.trim() === "...") {
        tests.push(current);
        current = null;
        continue;
      }
    }

    const summaryDurationMatch = line.match(/^# duration_ms\s+([0-9.]+)/);
    if (summaryDurationMatch) {
      suiteDurationMs = Number(summaryDurationMatch[1]);
      continue;
    }

    const countMatch = line.match(/^# (tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)/);
    if (countMatch) {
      counts[countMatch[1]] = Number(countMatch[2]);
    }
  }

  const measuredTests = tests
    .filter((item) => Number.isFinite(item.durationMs))
    .sort((left, right) => Number(right.durationMs) - Number(left.durationMs));

  return {
    suiteDurationMs,
    suiteDurationSeconds: suiteDurationMs == null ? null : Number((suiteDurationMs / 1000).toFixed(3)),
    counts,
    tests: measuredTests,
    slowestTests: measuredTests.slice(0, 10),
  };
}

function buildTestSummary({
  label,
  scriptName,
  source,
  commandString,
  startedAt,
  finishedAt,
  exitCode,
  signal,
  error,
  stdout,
  stderr,
  durationMs,
  tapSummary,
} = {}) {
  return {
    label,
    scriptName,
    source,
    commandString,
    startedAt,
    finishedAt,
    durationMs,
    durationSeconds: Number((durationMs / 1000).toFixed(3)),
    exitCode,
    signal,
    ok: exitCode === 0 && signal == null && error == null,
    error,
    reporter: tapSummary?.suiteDurationMs != null ? "tap" : "unparsed",
    suiteDurationMs: tapSummary?.suiteDurationMs ?? null,
    suiteDurationSeconds: tapSummary?.suiteDurationSeconds ?? null,
    counts: tapSummary?.counts || {},
    slowestTests: tapSummary?.slowestTests || [],
    measuredTestCount: tapSummary?.tests?.length || 0,
    stdoutBytes: Buffer.byteLength(stdout || "", "utf8"),
    stderrBytes: Buffer.byteLength(stderr || "", "utf8"),
  };
}

function buildTestSummaryMarkdown(summary) {
  const lines = [
    "# Test Performance Tracking",
    "",
    `Label: \`${summary.label}\``,
    `Source: \`${summary.source}\``,
    `Command: \`${summary.commandString}\``,
    `Wall-clock duration: ${formatDurationMs(summary.durationMs)}`,
    `Runner-reported suite duration: ${summary.suiteDurationMs == null ? "unavailable" : formatDurationMs(summary.suiteDurationMs)}`,
    `Result: ${summary.ok ? "success" : "failure"} (exit ${summary.exitCode ?? summary.signal ?? "n/a"})`,
    "",
  ];

  const countEntries = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"]
    .filter((key) => summary.counts?.[key] != null)
    .map((key) => `${key}=${summary.counts[key]}`);
  if (countEntries.length > 0) {
    lines.push(`Counts: ${countEntries.join(", ")}`);
    lines.push("");
  }

  if (!summary.slowestTests?.length) {
    lines.push("No TAP per-test durations were parsed from the runner output.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("| Slowest Test | Duration | Type |");
  lines.push("| --- | --- | --- |");
  for (const item of summary.slowestTests) {
    lines.push(
      `| ${item.name.replace(/\|/g, "\\|")} | ${formatDurationMs(item.durationMs)} | ${item.type || "test"} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function writeTestArtifacts({ artifactDir, summary, stdout }) {
  mkdirSync(artifactDir, { recursive: true });
  const summaryJsonPath = join(artifactDir, `${DEFAULT_SUMMARY_BASENAME}.json`);
  const summaryMarkdownPath = join(artifactDir, `${DEFAULT_SUMMARY_BASENAME}.md`);
  const rawLogPath = join(artifactDir, DEFAULT_RAW_LOG_BASENAME);
  writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(summaryMarkdownPath, buildTestSummaryMarkdown(summary));
  writeFileSync(rawLogPath, stdout);
  return { summaryJsonPath, summaryMarkdownPath, rawLogPath };
}

export async function runMeasuredNodeTest({
  label = "test",
  artifactDir = DEFAULT_ARTIFACT_DIR,
  scriptName = "test",
  commandString = null,
  cwd = ROOT_DIR,
} = {}) {
  const resolved = resolveCommandString({ scriptName, commandString });
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  let stdout = "";
  let stderr = "";

  const child = spawn(resolved.commandString, {
    cwd,
    shell: true,
    env: process.env,
  });

  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(chunk);
  });

  const result = await new Promise((resolvePromise) => {
    child.on("error", (error) => resolvePromise({ exitCode: 1, signal: null, error }));
    child.on("close", (exitCode, signal) =>
      resolvePromise({ exitCode: exitCode ?? 1, signal: signal ?? null, error: null }),
    );
  });

  const finishedMs = Date.now();
  const finishedAt = new Date(finishedMs).toISOString();
  const durationMs = finishedMs - startedMs;
  const tapSummary = resolved.usesTapReporter ? parseTapOutput(stdout) : null;

  const record = buildMeasurementRecord({
    label,
    command: resolved.commandString,
    args: [],
    cwd,
    startedAt,
    finishedAt,
    durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    error: result.error ? result.error.message : null,
  });

  writeMeasurementRecord(record, artifactDir);
  const records = readMeasurementRecords(artifactDir);
  writeSummaryFiles(records, artifactDir);

  const summary = buildTestSummary({
    label,
    scriptName,
    source: resolved.source,
    commandString: resolved.commandString,
    startedAt,
    finishedAt,
    exitCode: result.exitCode,
    signal: result.signal,
    error: result.error ? result.error.message : null,
    stdout,
    stderr,
    durationMs,
    tapSummary,
  });
  const artifactPaths = writeTestArtifacts({ artifactDir, summary, stdout });
  return { record, summary, artifactPaths };
}

async function main() {
  const { label, artifactDir, scriptName, commandString } = parseCliArgs(process.argv.slice(2));
  const { record } = await runMeasuredNodeTest({ label, artifactDir, scriptName, commandString });
  process.exitCode = Number.isInteger(record.exitCode) ? record.exitCode : 1;
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
