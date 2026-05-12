import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_ARTIFACT_DIR = resolve(ROOT_DIR, "artifacts/build-performance");

export function slugifyLabel(label = "command") {
  return (
    String(label)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "command"
  );
}

export function formatDurationMs(durationMs = 0) {
  return `${(Math.max(0, Number(durationMs) || 0) / 1000).toFixed(2)}s`;
}

export function buildMeasurementRecord({
  label,
  command,
  args = [],
  cwd = ROOT_DIR,
  startedAt,
  finishedAt,
  durationMs,
  exitCode,
  signal = null,
  error = null,
} = {}) {
  return {
    label,
    command,
    args,
    commandLine: [command, ...args].join(" "),
    cwd,
    startedAt,
    finishedAt,
    durationMs,
    durationSeconds: Number((durationMs / 1000).toFixed(3)),
    exitCode,
    signal,
    ok: exitCode === 0 && signal == null && error == null,
    error,
  };
}

function artifactFileName({ startedAt, label }) {
  const stamp = String(startedAt || "unknown")
    .replace(/[:.]/g, "-")
    .replace(/[^0-9A-Za-z-]/g, "_");
  return `${stamp}-${slugifyLabel(label)}.json`;
}

export function writeMeasurementRecord(record, artifactDir = DEFAULT_ARTIFACT_DIR) {
  mkdirSync(artifactDir, { recursive: true });
  const outputPath = join(artifactDir, artifactFileName(record));
  writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
  return outputPath;
}

export function readMeasurementRecords(artifactDir = DEFAULT_ARTIFACT_DIR) {
  if (!existsSync(artifactDir)) return [];

  return readdirSync(artifactDir)
    .filter((entry) => entry.endsWith(".json") && entry !== "summary.json")
    .map((entry) => JSON.parse(readFileSync(join(artifactDir, entry), "utf8")))
    .sort((left, right) => {
      const started = String(left.startedAt || "").localeCompare(String(right.startedAt || ""));
      if (started !== 0) return started;
      return String(left.label || "").localeCompare(String(right.label || ""));
    });
}

export function buildSummaryPayload(records = []) {
  const totalDurationMs = records.reduce((sum, record) => sum + Math.max(0, Number(record?.durationMs) || 0), 0);
  return {
    generatedAt: new Date().toISOString(),
    totalDurationMs,
    totalDurationSeconds: Number((totalDurationMs / 1000).toFixed(3)),
    recordCount: records.length,
    records,
  };
}

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

export function buildSummaryMarkdown(records = []) {
  const summary = buildSummaryPayload(records);
  const lines = [
    "# Build Performance Tracking",
    "",
    `Recorded commands: ${summary.recordCount}`,
    `Total duration: ${formatDurationMs(summary.totalDurationMs)}`,
    "",
  ];

  if (records.length === 0) {
    lines.push("No measurements recorded yet.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("| Label | Result | Duration | Exit | Started At | Command |");
  lines.push("| --- | --- | --- | --- | --- | --- |");

  for (const record of records) {
    lines.push(
      `| ${escapeMarkdownCell(record.label)} | ${record.ok ? "success" : "failure"} | ${formatDurationMs(record.durationMs)} | ${escapeMarkdownCell(record.exitCode ?? record.signal ?? "n/a")} | ${escapeMarkdownCell(record.startedAt)} | \`${escapeMarkdownCell(record.commandLine)}\` |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function writeSummaryFiles(records, artifactDir = DEFAULT_ARTIFACT_DIR) {
  mkdirSync(artifactDir, { recursive: true });
  const summaryJsonPath = join(artifactDir, "summary.json");
  const summaryMarkdownPath = join(artifactDir, "summary.md");
  const payload = buildSummaryPayload(records);
  writeFileSync(summaryJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(summaryMarkdownPath, buildSummaryMarkdown(records));
  return { summaryJsonPath, summaryMarkdownPath };
}

export function parseCliArgs(argv = []) {
  const args = [...argv];
  let label = null;
  let artifactDir = DEFAULT_ARTIFACT_DIR;
  const separatorIndex = args.indexOf("--");
  const optionArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
  const commandArgs = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];
    if (arg.startsWith("--label=")) {
      label = arg.slice("--label=".length);
      continue;
    }
    if (arg === "--label") {
      label = optionArgs[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact-dir=")) {
      artifactDir = resolve(ROOT_DIR, arg.slice("--artifact-dir=".length));
      continue;
    }
    if (arg === "--artifact-dir") {
      artifactDir = resolve(ROOT_DIR, optionArgs[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument: ${arg}`);
  }

  if (commandArgs.length === 0) {
    throw new Error(
      "Usage: node scripts/track-build-performance.mjs --label=<name> [--artifact-dir=<dir>] -- <command> [args...]",
    );
  }

  return {
    label: label || commandArgs[0],
    artifactDir,
    command: commandArgs[0],
    args: commandArgs.slice(1),
  };
}

export function runMeasuredCommand({
  label,
  artifactDir = DEFAULT_ARTIFACT_DIR,
  command,
  args = [],
  cwd = ROOT_DIR,
} = {}) {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });
  const finishedMs = Date.now();
  const finishedAt = new Date(finishedMs).toISOString();
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  const record = buildMeasurementRecord({
    label,
    command,
    args,
    cwd,
    startedAt,
    finishedAt,
    durationMs: finishedMs - startedMs,
    exitCode,
    signal: result.signal ?? null,
    error: result.error ? result.error.message : null,
  });

  writeMeasurementRecord(record, artifactDir);
  const records = readMeasurementRecords(artifactDir);
  writeSummaryFiles(records, artifactDir);
  return record;
}

function main() {
  const { label, artifactDir, command, args } = parseCliArgs(process.argv.slice(2));
  const record = runMeasuredCommand({ label, artifactDir, command, args });
  process.exitCode = Number.isInteger(record.exitCode) ? record.exitCode : 1;
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
