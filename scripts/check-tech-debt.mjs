import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASELINE_PATH = resolve(ROOT_DIR, "docs/readiness/tech-debt-baseline.json");
const SCAN_ROOTS = ["src", "docs", "test"];
const EXCLUDED_RELATIVE_PATHS = new Set(["docs/readiness/tech-debt-baseline.json"]);
const EXCLUDED_DIR_NAMES = new Set([
  ".cloudflare",
  ".git",
  ".playwright-cli",
  ".wrangler",
  "build",
  "coverage",
  "data",
  "dist",
  "logs",
  "node_modules",
  "out",
]);
const TECH_DEBT_MARKER_REGEX = /\b(TODO|FIXME|XXX|HACK)(?:\(([^)\r\n]+)\))?:\s*(.*)/g;

function normalizePath(filePath) {
  return String(filePath || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "");
}

function stableFingerprint(...parts) {
  return createHash("sha1")
    .update(parts.map((part) => String(part ?? "")).join("\0"))
    .digest("hex");
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sortEntries(entries) {
  return [...new Map(entries.map((entry) => [entry.fingerprint, entry])).values()].sort((left, right) => {
    const leftPath = left.path || "";
    const rightPath = right.path || "";
    if (leftPath !== rightPath) return leftPath.localeCompare(rightPath);
    if (left.line !== right.line) return left.line - right.line;
    if (left.column !== right.column) return left.column - right.column;
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    if (left.trackingTag !== right.trackingTag) {
      return String(left.trackingTag || "").localeCompare(String(right.trackingTag || ""));
    }
    return left.fingerprint.localeCompare(right.fingerprint);
  });
}

function buildTechDebtFingerprint({ path, markerText, line, kind, trackingTag, reason }) {
  return stableFingerprint(
    normalizePath(path),
    String(line ?? ""),
    String(kind ?? ""),
    String(trackingTag ?? ""),
    String(reason ?? ""),
    String(markerText ?? "").trim(),
  );
}

function buildTechDebtEntry({ path, line, column, kind, trackingTag, reason, markerText, lineText, fingerprint }) {
  const normalizedPath = normalizePath(path);
  const normalizedLine = positiveInteger(line, 0);
  const normalizedColumn = positiveInteger(column, 0);
  const normalizedKind = String(kind || "")
    .trim()
    .toUpperCase();
  const normalizedTrackingTag = String(trackingTag || "").trim() || null;
  const normalizedReason = String(reason || "").trim();
  const normalizedMarkerText = String(markerText || "").trim();
  const normalizedLineText = String(lineText || "").trim();
  const normalizedFingerprint =
    String(fingerprint || "").trim() ||
    buildTechDebtFingerprint({
      path: normalizedPath,
      markerText: normalizedMarkerText || normalizedLineText,
      line: normalizedLine,
      kind: normalizedKind,
      trackingTag: normalizedTrackingTag,
      reason: normalizedReason,
    });

  return {
    fingerprint: normalizedFingerprint,
    path: normalizedPath,
    line: normalizedLine,
    column: normalizedColumn,
    kind: normalizedKind,
    trackingTag: normalizedTrackingTag,
    reason: normalizedReason,
    markerText: normalizedMarkerText,
    lineText: normalizedLineText,
    trackedFormat: Boolean(normalizedTrackingTag && normalizedReason),
  };
}

function isExcludedDirectoryName(dirName) {
  return EXCLUDED_DIR_NAMES.has(dirName);
}

function walkFiles(startPath) {
  if (!existsSync(startPath)) {
    return [];
  }

  const files = [];
  const stack = [startPath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    let stats;
    try {
      stats = statSync(currentPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      const dirName = currentPath === startPath ? null : currentPath.split("/").pop() || currentPath.split("\\").pop();
      if (dirName && isExcludedDirectoryName(dirName)) {
        continue;
      }

      for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
        if (entry.isDirectory() && isExcludedDirectoryName(entry.name)) {
          continue;
        }
        stack.push(join(currentPath, entry.name));
      }
      continue;
    }

    if (stats.isFile()) {
      files.push(currentPath);
    }
  }

  return files.sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
}

export function scanTechDebtMarkersFromText(sourceText, relativePath) {
  const path = normalizePath(relativePath);
  const lines = String(sourceText || "").split(/\r?\n/u);
  const entries = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    TECH_DEBT_MARKER_REGEX.lastIndex = 0;

    for (const match of line.matchAll(TECH_DEBT_MARKER_REGEX)) {
      const kind = String(match[1] || "")
        .trim()
        .toUpperCase();
      const trackingTag = String(match[2] || "").trim() || null;
      const reason = String(match[3] || "").trim();
      const markerText = String(match[0] || "").trim();
      const lineText = String(line || "").trim();
      const column = positiveInteger(match.index, 0) + 1;

      entries.push(
        buildTechDebtEntry({
          path,
          line: index + 1,
          column,
          kind,
          trackingTag,
          reason,
          markerText,
          lineText,
        }),
      );
    }
  }

  return sortEntries(entries);
}

export function collectTechDebtMarkers({ rootDir = ROOT_DIR, scanRoots = SCAN_ROOTS } = {}) {
  const entries = [];

  for (const scanRoot of scanRoots) {
    const startPath = resolve(rootDir, scanRoot);
    for (const filePath of walkFiles(startPath)) {
      const relativePath = normalizePath(relative(rootDir, filePath));
      if (EXCLUDED_RELATIVE_PATHS.has(relativePath)) {
        continue;
      }
      const sourceText = readFileSync(filePath, "utf8");
      entries.push(...scanTechDebtMarkersFromText(sourceText, relativePath));
    }
  }

  return sortEntries(entries);
}

export function readTechDebtBaseline(sourceText) {
  const parsed = JSON.parse(sourceText);
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  return sortEntries(
    issues
      .map((entry) =>
        buildTechDebtEntry({
          fingerprint: entry?.fingerprint,
          path: entry?.path,
          line: entry?.line,
          column: entry?.column,
          kind: entry?.kind,
          trackingTag: entry?.trackingTag,
          reason: entry?.reason,
          markerText: entry?.markerText,
          lineText: entry?.lineText,
        }),
      )
      .filter((entry) => entry.fingerprint),
  );
}

export function compareTechDebtMarkers({ baselineEntries = [], currentEntries = [] } = {}) {
  const baselineByFingerprint = new Map(baselineEntries.map((entry) => [entry.fingerprint, entry]));
  const currentByFingerprint = new Map(currentEntries.map((entry) => [entry.fingerprint, entry]));

  const newEntries = [];
  const resolvedEntries = [];
  const unchangedEntries = [];

  for (const entry of currentEntries) {
    if (baselineByFingerprint.has(entry.fingerprint)) {
      unchangedEntries.push(entry);
      continue;
    }
    newEntries.push(entry);
  }

  for (const entry of baselineEntries) {
    if (!currentByFingerprint.has(entry.fingerprint)) {
      resolvedEntries.push(entry);
    }
  }

  return {
    newEntries,
    resolvedEntries,
    unchangedEntries,
  };
}

function formatMarker(entry) {
  const tracking = entry.trackingTag ? `(${entry.trackingTag})` : "";
  const reason = entry.reason ? `: ${entry.reason}` : "";
  return `${entry.path}:${entry.line}:${entry.column} ${entry.kind}${tracking}${reason}`;
}

function printHelp() {
  console.log(`Usage: npm run check:tech-debt

Scan scope:
  - src/
  - docs/
  - test/

Excluded by scope:
  - generated/runtime outputs
  - dashboard public JSON
  - logs/
  - data snapshots
  - build artifacts
  - coverage/
  - dependency/cache folders
  - docs/readiness/tech-debt-baseline.json (audited baseline artifact)

Tracked marker format:
  - TODO(ISSUE-123): reason
  - TODO(owner): reason
  - FIXME(ISSUE-123): reason
  - XXX(owner): reason
  - HACK(owner): reason

Current audited backlog lives in:
  - docs/readiness/tech-debt-baseline.json
`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const baselinePath = BASELINE_PATH;
  const baselineEntries = existsSync(baselinePath) ? readTechDebtBaseline(readFileSync(baselinePath, "utf8")) : [];
  const currentEntries = collectTechDebtMarkers();
  const { newEntries, resolvedEntries, unchangedEntries } = compareTechDebtMarkers({
    baselineEntries,
    currentEntries,
  });
  const newUntrackedEntries = newEntries.filter((entry) => !entry.trackedFormat);
  const trackedCurrentCount = currentEntries.filter((entry) => entry.trackedFormat).length;
  const untrackedCurrentCount = currentEntries.length - trackedCurrentCount;

  for (const entry of currentEntries) {
    console.log(formatMarker(entry));
  }

  if (newUntrackedEntries.length > 0) {
    console.error(
      `Technical-debt tracking failed: ${newUntrackedEntries.length} new untracked marker(s) were found outside ${relative(
        ROOT_DIR,
        baselinePath,
      )}.`,
    );
    for (const entry of newUntrackedEntries) {
      console.error(`- ${formatMarker(entry)}`);
    }
    console.error(
      "New debt markers must use a tracked form like TODO(ISSUE-123): reason or TODO(owner): reason, then be reviewed into the baseline.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Technical-debt baseline check passed: ${unchangedEntries.length} audited marker(s) remain, ${resolvedEntries.length} baseline marker(s) no longer appear, ${newEntries.length} new tracked marker(s) detected, ${trackedCurrentCount} tracked-format marker(s) total, ${untrackedCurrentCount} legacy marker(s) total.`,
  );
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

export { main };
