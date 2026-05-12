import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASELINE_PATH = resolve(ROOT_DIR, "docs/readiness/duplicate-code-baseline.json");
const CONFIG_PATH = resolve(ROOT_DIR, ".jscpd.json");
const REPORT_DIR = resolve(ROOT_DIR, ".jscpd-report");
const REPORT_PATH = resolve(REPORT_DIR, "jscpd-report.json");
const JSCPD_BIN_PATH = resolve(ROOT_DIR, "node_modules/jscpd/bin/jscpd");
const JSCPD_SCOPE_PATHS = Object.freeze([
  "src",
  "scripts",
  "test",
  "dashboard/public",
  "eslint.config.mjs",
  "knip.config.js",
]);

function normalizePath(filePath) {
  return String(filePath || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "");
}

function stableFragmentHash(fragment) {
  return createHash("sha1")
    .update(String(fragment || ""))
    .digest("hex");
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

export function normalizeJscpdDuplicates(report) {
  const duplicates = Array.isArray(report?.duplicates) ? report.duplicates : [];
  const grouped = new Map();

  for (const duplicate of duplicates) {
    const files = [normalizePath(duplicate?.firstFile?.name), normalizePath(duplicate?.secondFile?.name)]
      .filter(Boolean)
      .sort();
    if (files.length === 0) {
      continue;
    }
    const format = String(duplicate?.format || "unknown").trim() || "unknown";
    const lines = positiveInteger(duplicate?.lines, 0);
    const fragmentHash = stableFragmentHash(duplicate?.fragment || "");
    const fingerprint = `${format}:${lines}:${fragmentHash}:${files.join("::")}`;
    const existing = grouped.get(fingerprint);

    if (existing) {
      existing.count += 1;
      continue;
    }

    grouped.set(fingerprint, {
      fingerprint,
      count: 1,
      format,
      lines,
      files,
      fragmentHash,
    });
  }

  return sortEntries(grouped.values());
}

export function readDuplicateBaseline(sourceText) {
  const parsed = JSON.parse(sourceText);
  const duplicates = Array.isArray(parsed?.duplicates) ? parsed.duplicates : [];
  return sortEntries(
    duplicates
      .map((entry) => ({
        fingerprint: String(entry?.fingerprint || "").trim(),
        count: positiveInteger(entry?.count, 1),
        format: String(entry?.format || "unknown").trim() || "unknown",
        lines: positiveInteger(entry?.lines, 0),
        files: Array.isArray(entry?.files)
          ? entry.files
              .map((filePath) => normalizePath(filePath))
              .filter(Boolean)
              .sort()
          : [],
        fragmentHash: String(entry?.fragmentHash || "").trim(),
      }))
      .filter((entry) => entry.fingerprint),
  );
}

export function compareDuplicateCounts({ baselineEntries = [], currentEntries = [] } = {}) {
  const baselineByFingerprint = new Map(baselineEntries.map((entry) => [entry.fingerprint, entry]));
  const currentByFingerprint = new Map(currentEntries.map((entry) => [entry.fingerprint, entry]));

  const newEntries = [];
  const resolvedEntries = [];
  const countRegressions = [];
  const countImprovements = [];
  const unchangedEntries = [];

  for (const entry of currentEntries) {
    const baselineEntry = baselineByFingerprint.get(entry.fingerprint);
    if (!baselineEntry) {
      newEntries.push(entry);
      continue;
    }
    if (entry.count > baselineEntry.count) {
      countRegressions.push({
        ...entry,
        baselineCount: baselineEntry.count,
        currentCount: entry.count,
      });
      continue;
    }
    if (entry.count < baselineEntry.count) {
      countImprovements.push({
        ...entry,
        baselineCount: baselineEntry.count,
        currentCount: entry.count,
      });
      continue;
    }
    unchangedEntries.push(entry);
  }

  for (const entry of baselineEntries) {
    if (!currentByFingerprint.has(entry.fingerprint)) {
      resolvedEntries.push(entry);
    }
  }

  return {
    newEntries,
    resolvedEntries,
    countRegressions,
    countImprovements,
    unchangedEntries,
  };
}

function readJscpdVersion() {
  const packagePath = resolve(ROOT_DIR, "node_modules/jscpd/package.json");
  if (!existsSync(packagePath)) {
    return null;
  }
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  return String(packageJson?.version || "").trim() || null;
}

function buildSummary(report, currentEntries) {
  const total = report?.statistics?.total || {};
  return {
    sources: positiveInteger(total?.sources, 0),
    lines: positiveInteger(total?.lines, 0),
    tokens: positiveInteger(total?.tokens, 0),
    clones: Array.isArray(report?.duplicates) ? report.duplicates.length : 0,
    duplicateFingerprintCount: currentEntries.length,
    percentage: Number(total?.percentage || 0),
  };
}

function buildBaselineDocument(report, currentEntries) {
  return {
    tool: "jscpd",
    version: readJscpdVersion(),
    configPath: ".jscpd.json",
    scope: JSCPD_SCOPE_PATHS,
    summary: buildSummary(report, currentEntries),
    duplicates: currentEntries,
  };
}

function runJscpd() {
  rmSync(REPORT_DIR, { recursive: true, force: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  const result = spawnSync(
    process.execPath,
    [
      JSCPD_BIN_PATH,
      ...JSCPD_SCOPE_PATHS,
      "--config",
      CONFIG_PATH,
      "--reporters",
      "json",
      "--output",
      REPORT_DIR,
      "--noTips",
    ],
    {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `jscpd exited with status ${result.status}`);
  }
  if (!existsSync(REPORT_PATH)) {
    throw new Error(`jscpd report missing: ${relative(ROOT_DIR, REPORT_PATH)}`);
  }

  return JSON.parse(readFileSync(REPORT_PATH, "utf8"));
}

function formatEntry(entry) {
  return `${entry.files.join(" <-> ")} lines=${entry.lines} count=${entry.count}`;
}

function printEntryBlock(label, entries) {
  if (entries.length === 0) {
    return;
  }
  console.error(`${label}: ${entries.length}`);
  for (const entry of entries.slice(0, 20)) {
    console.error(` - ${formatEntry(entry)}`);
  }
  if (entries.length > 20) {
    console.error(` - ... ${entries.length - 20} more`);
  }
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    reportOnly: argv.includes("--report-only"),
    writeBaseline: argv.includes("--write-baseline"),
  };
}

export async function runDuplicateCodeCheck(argv = []) {
  const options = parseArgs(argv);
  const report = runJscpd();
  const currentEntries = normalizeJscpdDuplicates(report);
  const summary = buildSummary(report, currentEntries);

  if (options.writeBaseline) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(buildBaselineDocument(report, currentEntries), null, 2)}\n`);
    return {
      summary,
      baselineWritten: true,
      reportPath: relative(ROOT_DIR, REPORT_PATH),
      baselinePath: relative(ROOT_DIR, BASELINE_PATH),
      comparison: null,
    };
  }

  if (options.reportOnly) {
    return {
      summary,
      baselineWritten: false,
      reportPath: relative(ROOT_DIR, REPORT_PATH),
      baselinePath: relative(ROOT_DIR, BASELINE_PATH),
      comparison: null,
      reportOnly: true,
    };
  }

  const baselineEntries = readDuplicateBaseline(readFileSync(BASELINE_PATH, "utf8"));
  const comparison = compareDuplicateCounts({
    baselineEntries,
    currentEntries,
  });

  return {
    summary,
    baselineWritten: false,
    reportPath: relative(ROOT_DIR, REPORT_PATH),
    baselinePath: relative(ROOT_DIR, BASELINE_PATH),
    comparison,
    reportOnly: options.reportOnly,
  };
}

function printHuman(result) {
  console.log(
    `Duplicate code scan: ${result.summary.sources} files, ${result.summary.clones} clone instances, ${result.summary.duplicateFingerprintCount} duplicate fingerprints, ${result.summary.percentage}% duplicated lines.`,
  );
  console.log(`Raw jscpd report: ${result.reportPath}`);

  if (result.baselineWritten) {
    console.log(`Duplicate baseline written: ${result.baselinePath}`);
    return;
  }

  if (result.reportOnly) {
    return;
  }

  const comparison = result.comparison;
  if (comparison.newEntries.length === 0 && comparison.countRegressions.length === 0) {
    console.log(
      `Duplicate-code baseline check passed: ${comparison.unchangedEntries.length} audited fingerprint(s) remain, ${comparison.resolvedEntries.length} fingerprint(s) no longer reproduce, ${comparison.countImprovements.length} fingerprint count improvement(s) detected.`,
    );
    return;
  }

  printEntryBlock("New duplicate fingerprints", comparison.newEntries);
  printEntryBlock("Duplicate count regressions", comparison.countRegressions);
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    const result = await runDuplicateCodeCheck(process.argv.slice(2));
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }

    if (!result.baselineWritten && !result.reportOnly) {
      const { newEntries, countRegressions } = result.comparison;
      process.exit(newEntries.length === 0 && countRegressions.length === 0 ? 0 : 1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  }
}
