import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { access } from "node:fs/promises";
import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGzip } from "node:zlib";
import { operationalArtifactRetentionConfig } from "../config/operational-artifact-retention.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const execFileAsync = promisify(execFile);

/**
 * @param {string} value
 */
function normalizePath(value) {
  return value.split(sep).join("/");
}

/**
 * @param {string} childPath
 * @param {string} parentPath
 */
function isWithinPath(childPath, parentPath) {
  const rel = relative(parentPath, childPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * @param {string} path
 */
async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} dir
 * @param {{ skipDirectories?: string[] }} [options]
 * @returns {Promise<string[]>}
 */
async function walkFiles(dir, options = {}) {
  if (!(await pathExists(dir))) return [];
  const skipDirectories = (options.skipDirectories || []).map((item) => resolve(item));
  const stack = [resolve(dir)];
  const files = [];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (skipDirectories.some((candidate) => isWithinPath(absolutePath, candidate))) continue;
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(absolutePath);
    }
  }

  return files;
}

/**
 * @param {string} basename
 * @param {string[]} suffixes
 */
function hasAnySuffix(basename, suffixes) {
  return suffixes.some((suffix) => basename.endsWith(suffix));
}

/**
 * @param {string} basename
 */
function isAuditReceiptBasename(basename) {
  return /(^|[-_])(audit|receipt|receipts|reconciliation|reconciliations|execution|executions|proof|proofs|attribution)([-_.]|$)/u.test(
    basename,
  );
}

/**
 * @param {string} basename
 * @param {string[]} tokens
 */
function containsAnyToken(basename, tokens) {
  const normalized = basename.toLowerCase();
  return tokens.some((token) => normalized.includes(token));
}

/**
 * @param {string} filePath
 * @returns {Promise<number>}
 */
async function wcLineCount(filePath) {
  const { stdout } = await execFileAsync("sh", ["-c", 'wc -l < "$1"', "sh", filePath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return Number.parseInt(stdout.trim(), 10) || 0;
}

/**
 * @param {string} script
 * @param {string[]} args
 */
async function runShell(script, args) {
  const { stdout } = await execFileAsync("sh", ["-c", script, "sh", ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/**
 * @param {string} filePath
 * @param {number} retainLines
 */
async function inspectTailRetention(filePath, retainLines) {
  const totalLines = await wcLineCount(filePath);
  const normalizedRetainLines = Math.max(0, Math.min(retainLines, totalLines));
  const archivedLines = Math.max(0, totalLines - normalizedRetainLines);
  const retainedBytes =
    normalizedRetainLines > 0
      ? Number.parseInt(
          (
            await runShell('tail -n "$1" "$2" | wc -c', [String(normalizedRetainLines), filePath])
          ).trim(),
          10,
        ) || 0
      : 0;
  const firstArchivedLine =
    archivedLines > 0 ? (await runShell('head -n 1 "$1"', [filePath])).trimEnd() : null;
  const lastArchivedLine =
    archivedLines > 0
      ? (
          await runShell('tail -n "$1" "$2" | head -n 1', [String(normalizedRetainLines + 1), filePath])
        ).trimEnd()
      : null;
  const firstRetainedLine =
    normalizedRetainLines > 0
      ? (await runShell('tail -n "$1" "$2" | head -n 1', [String(normalizedRetainLines), filePath])).trimEnd()
      : null;
  const lastRetainedLine =
    normalizedRetainLines > 0 ? (await runShell('tail -n 1 "$1"', [filePath])).trimEnd() : null;

  return {
    totalLines,
    retainLines: normalizedRetainLines,
    archivedLines,
    retainedBytes,
    firstArchivedLine,
    lastArchivedLine,
    firstRetainedLine,
    lastRetainedLine,
  };
}

/**
 * @param {string | null} jsonlLine
 * @returns {string | null}
 */
function detectObservedAt(jsonlLine) {
  if (!jsonlLine) return null;
  try {
    const parsed = JSON.parse(jsonlLine);
    for (const key of ["observedAt", "generatedAt", "timestamp", "ts"]) {
      const value = parsed?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {string} filePath
 */
async function hashFileSha256Portable(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/**
 * @param {string} sourcePath
 * @param {string} archivePath
 */
async function gzipToArchive(sourcePath, archivePath) {
  await mkdir(dirname(archivePath), { recursive: true });
  const tempPath = `${archivePath}.${process.pid}.tmp`;
  await pipeline(createReadStream(sourcePath), createGzip(), createWriteStream(tempPath, { flags: "wx" }));
  await rename(tempPath, archivePath);
  const archivedStats = await stat(archivePath);
  await unlink(sourcePath);
  return {
    archivePath,
    gzipBytes: archivedStats.size,
  };
}

/**
 * @param {string} absolutePath
 */
function archiveSuffix(absolutePath) {
  const parsed = parse(absolutePath);
  return `${parsed.name}-tail-preserved.jsonl.gz`;
}

/**
 * @param {string} relativePath
 * @param {string} archiveDir
 */
function compactArchivePath(relativePath, archiveDir) {
  const normalizedRelative = normalizePath(relativePath);
  const parsed = parse(normalizedRelative);
  return join(archiveDir, parsed.dir, archiveSuffix(parsed.base));
}

/**
 * @param {{
 *   absolutePath: string,
 *   relativePath: string,
 *   size: number,
 *   mtimeMs: number,
 * }} item
 * @param {{
 *   nowMs: number,
 *   archiveCandidateMinAgeDays: number,
 *   disposableCacheMinAgeDays: number,
 *   compactCandidateMinBytes: number,
 *   preserveLiveTruthBasenames: Set<string>,
 *   preserveLiveTruthRelativePaths: Set<string>,
 *   preserveLiveTruthSuffixes: string[],
 *   preserveAuditReceiptBasenames: Set<string>,
 *   compactCandidateTokens: string[],
 *   archiveCandidateTokens: string[],
 *   disposablePathFragments: string[],
 *   disposableBasenameSuffixes: string[],
 * }} rules
 */
export function classifyOperationalArtifact(item, rules) {
  const basename = item.relativePath.split("/").pop() || "";
  const normalizedPath = item.relativePath.toLowerCase();
  const ageDays = (rules.nowMs - item.mtimeMs) / DAY_MS;
  const archiveEligible = ageDays >= rules.archiveCandidateMinAgeDays;
  const disposableEligible = ageDays >= rules.disposableCacheMinAgeDays;
  const isJsonl = basename.endsWith(".jsonl");
  const isProtectedAudit =
    rules.preserveAuditReceiptBasenames.has(basename) || isAuditReceiptBasename(basename);

  if (
    rules.preserveLiveTruthRelativePaths.has(item.relativePath) ||
    rules.preserveLiveTruthBasenames.has(basename) ||
    hasAnySuffix(basename, rules.preserveLiveTruthSuffixes)
  ) {
    return {
      category: "preserve_live_truth",
      reason: "preserve_live_truth",
      ageDays,
      reclaimable: false,
      plannedAction: null,
    };
  }

  if (isProtectedAudit) {
    return {
      category: "preserve_audit_receipt",
      reason: "preserve_audit_receipt",
      ageDays,
      reclaimable: false,
      plannedAction: null,
    };
  }

  if (
    item.relativePath.startsWith("data/") &&
    isJsonl &&
    item.size >= rules.compactCandidateMinBytes &&
    containsAnyToken(basename, rules.compactCandidateTokens)
  ) {
    return {
      category: "compact_candidate",
      reason: "compact_candidate_eligible",
      ageDays,
      reclaimable: true,
      plannedAction: "compact_jsonl_tail",
    };
  }

  if (isJsonl && containsAnyToken(basename, rules.archiveCandidateTokens)) {
    return {
      category: "archive_candidate",
      reason: archiveEligible ? "archive_candidate_eligible" : "below_archive_age_threshold",
      ageDays,
      reclaimable: archiveEligible,
      plannedAction: archiveEligible ? "archive_gzip" : null,
    };
  }

  if (
    rules.disposablePathFragments.some((fragment) => normalizedPath.includes(fragment)) ||
    rules.disposableBasenameSuffixes.some((suffix) => basename.endsWith(suffix))
  ) {
    return {
      category: "disposable_cache",
      reason: disposableEligible ? "disposable_cache_eligible" : "below_disposable_age_threshold",
      ageDays,
      reclaimable: disposableEligible,
      plannedAction: disposableEligible ? "delete_disposable" : null,
    };
  }

  return {
    category: "unknown_manual_review",
    reason: "unknown_manual_review",
    ageDays,
    reclaimable: false,
    plannedAction: null,
  };
}

/**
 * @param {{
 *   absolutePath: string,
 *   relativePath: string,
 *   size: number,
 *   ageDays: number,
 * }} file
 * @param {{ compactRetainLines: number }} rules
 * @param {string} archiveDir
 */
async function buildCompactionPlan(file, rules, archiveDir) {
  const inspection = await inspectTailRetention(file.absolutePath, rules.compactRetainLines);
  const reclaimableBytes = Math.max(0, file.size - inspection.retainedBytes);
  const archivePath = compactArchivePath(file.relativePath, archiveDir);

  return {
    reclaimableBytes,
    retainLines: inspection.retainLines,
    archivedLines: inspection.archivedLines,
    archivePath,
    firstObservedAt: detectObservedAt(inspection.firstArchivedLine),
    lastObservedAt: detectObservedAt(inspection.lastArchivedLine),
    firstRetainedObservedAt: detectObservedAt(inspection.firstRetainedLine),
    lastRetainedObservedAt: detectObservedAt(inspection.lastRetainedLine),
  };
}

/**
 * @param {string} manifestPath
 * @param {Record<string, unknown>} entry
 */
async function appendManifestEntry(manifestPath, entry) {
  await mkdir(dirname(manifestPath), { recursive: true });
  await appendFile(manifestPath, `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * @param {{
 *   absolutePath: string,
 *   relativePath: string,
 *   size: number,
 * }} file
 * @param {{
 *   archivePath: string,
 *   retainLines: number,
 *   archivedLines: number,
 *   firstObservedAt: string | null,
 *   lastObservedAt: string | null,
 * }} plan
 * @param {string} manifestPath
 * @param {string} observedAt
 */
async function compactJsonlTail(file, plan, manifestPath, observedAt) {
  if (plan.archivedLines <= 0) {
    return {
      relativePath: file.relativePath,
      archivePath: normalizePath(plan.archivePath),
      retainedLines: plan.retainLines,
      archivedLines: 0,
      status: "skipped_retain_window_covers_file",
    };
  }

  await mkdir(dirname(plan.archivePath), { recursive: true });
  const tempArchivePath = `${plan.archivePath}.${process.pid}.tmp`;
  const tempRetainedPath = `${file.absolutePath}.${process.pid}.retained`;

  await execFileAsync(
    "sh",
    [
      "-c",
      'head -n "$1" "$2" | gzip -c > "$3"',
      "sh",
      String(plan.archivedLines),
      file.absolutePath,
      tempArchivePath,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  await execFileAsync(
    "sh",
    [
      "-c",
      'tail -n "$1" "$2" > "$3"',
      "sh",
      String(plan.retainLines),
      file.absolutePath,
      tempRetainedPath,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );

  await rename(tempArchivePath, plan.archivePath);
  await rename(tempRetainedPath, file.absolutePath);

  const archiveStats = await stat(plan.archivePath);
  const retainedStats = await stat(file.absolutePath);
  const sha256 = await hashFileSha256Portable(plan.archivePath);

  await appendManifestEntry(manifestPath, {
    observedAt,
    mode: "compact_jsonl_tail",
    originalPath: file.relativePath,
    archivedPath: normalizePath(plan.archivePath),
    bytes: {
      original: file.size,
      archivedSource: Math.max(0, file.size - retainedStats.size),
      archivedGzip: archiveStats.size,
      retained: retainedStats.size,
    },
    retainedLines: plan.retainLines,
    archivedLines: plan.archivedLines,
    firstObservedAt: plan.firstObservedAt,
    lastObservedAt: plan.lastObservedAt,
    sha256,
  });

  return {
    relativePath: file.relativePath,
    archivePath: normalizePath(plan.archivePath),
    manifestPath: normalizePath(manifestPath),
    retainedLines: plan.retainLines,
    archivedLines: plan.archivedLines,
    gzipBytes: archiveStats.size,
    sha256,
    status: "compacted",
  };
}

/**
 * @param {{
 *   dataDir: string,
 *   logsDir: string,
 *   dashboardDir: string,
 *   archiveDir?: string,
 *   manifestPath?: string,
 *   archive?: boolean,
 *   compact?: boolean,
 *   dryRun?: boolean,
 *   now?: Date | number | string,
 *   topFilesLimit?: number,
 *   compactCandidateMinBytes?: number,
 *   compactRetainLines?: number,
 * }} options
 */
export async function auditOperationalArtifacts(options) {
  const dataDir = resolve(options.dataDir);
  const logsDir = resolve(options.logsDir);
  const dashboardDir = resolve(options.dashboardDir);
  const archiveDir = resolve(
    options.archiveDir || join(dataDir, ...operationalArtifactRetentionConfig.archiveDestinationSegments),
  );
  const manifestPath = resolve(
    options.manifestPath || join(archiveDir, operationalArtifactRetentionConfig.archiveManifestBasename),
  );
  const archiveEnabled = options.archive === true;
  const compactEnabled = options.compact === true;
  const dryRun = options.dryRun ?? !(archiveEnabled || compactEnabled);
  const nowMs = new Date(options.now || Date.now()).getTime();
  const observedAt = new Date(nowMs).toISOString();
  const topFilesLimit = options.topFilesLimit || operationalArtifactRetentionConfig.topFilesLimit;
  const rules = {
    archiveCandidateMinAgeDays: operationalArtifactRetentionConfig.archiveCandidateMinAgeDays,
    disposableCacheMinAgeDays: operationalArtifactRetentionConfig.disposableCacheMinAgeDays,
    compactCandidateMinBytes:
      options.compactCandidateMinBytes || operationalArtifactRetentionConfig.compactCandidateMinBytes,
    compactRetainLines: options.compactRetainLines || operationalArtifactRetentionConfig.compactRetainLines,
    preserveLiveTruthBasenames: operationalArtifactRetentionConfig.preserveLiveTruthBasenames,
    preserveLiveTruthRelativePaths: operationalArtifactRetentionConfig.preserveLiveTruthRelativePaths,
    preserveLiveTruthSuffixes: operationalArtifactRetentionConfig.preserveLiveTruthSuffixes,
    preserveAuditReceiptBasenames: operationalArtifactRetentionConfig.preserveAuditReceiptBasenames,
    compactCandidateTokens: operationalArtifactRetentionConfig.compactCandidateTokens,
    archiveCandidateTokens: operationalArtifactRetentionConfig.archiveCandidateTokens,
    disposablePathFragments: operationalArtifactRetentionConfig.disposablePathFragments,
    disposableBasenameSuffixes: operationalArtifactRetentionConfig.disposableBasenameSuffixes,
    nowMs,
  };
  const roots = [
    { absoluteDir: dataDir, relativeRoot: "data" },
    { absoluteDir: logsDir, relativeRoot: "logs" },
    { absoluteDir: dashboardDir, relativeRoot: "dashboard/public" },
  ];

  /** @type {Array<{
   *   absolutePath: string,
   *   relativePath: string,
   *   size: number,
   *   mtimeMs: number,
   *   category: string,
   *   reason: string,
   *   ageDays: number,
   *   reclaimable: boolean,
   *   plannedAction: string | null,
   *   reclaimableBytes?: number,
   *   compactPlan?: Record<string, unknown> | null,
   * }>} */
  const files = [];

  for (const root of roots) {
    const skipDirectories = isWithinPath(archiveDir, root.absoluteDir) ? [archiveDir] : [];
    for (const absolutePath of await walkFiles(root.absoluteDir, { skipDirectories })) {
      const stats = await stat(absolutePath);
      const relativeInsideRoot = normalizePath(relative(root.absoluteDir, absolutePath));
      const relativePath = normalizePath(join(root.relativeRoot, relativeInsideRoot));
      files.push({
        absolutePath,
        relativePath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ...classifyOperationalArtifact(
          {
            absolutePath,
            relativePath,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
          },
          rules,
        ),
      });
    }
  }

  for (const file of files.filter((item) => item.plannedAction === "compact_jsonl_tail")) {
    const compactPlan = await buildCompactionPlan(file, rules, archiveDir);
    file.compactPlan = compactPlan;
    file.reclaimableBytes = compactPlan.reclaimableBytes;
    if (compactPlan.archivedLines <= 0 || compactPlan.reclaimableBytes <= 0) {
      file.reclaimable = false;
      file.reason = "retain_tail_only_no_archive";
      file.plannedAction = null;
    }
  }

  const byCategory = {
    preserve_live_truth: { fileCount: 0, totalBytes: 0, reclaimableBytes: 0 },
    preserve_audit_receipt: { fileCount: 0, totalBytes: 0, reclaimableBytes: 0 },
    compact_candidate: { fileCount: 0, totalBytes: 0, reclaimableBytes: 0 },
    archive_candidate: { fileCount: 0, totalBytes: 0, reclaimableBytes: 0 },
    disposable_cache: { fileCount: 0, totalBytes: 0, reclaimableBytes: 0 },
    unknown_manual_review: { fileCount: 0, totalBytes: 0, reclaimableBytes: 0 },
  };
  const plannedActions = [];
  const skippedReasons = [];
  const archiveResults = [];

  let totalBytes = 0;
  let reclaimableBytes = 0;

  for (const file of files) {
    const fileReclaimableBytes = file.reclaimableBytes ?? (file.reclaimable ? file.size : 0);
    totalBytes += file.size;
    reclaimableBytes += fileReclaimableBytes;
    byCategory[file.category].fileCount += 1;
    byCategory[file.category].totalBytes += file.size;
    byCategory[file.category].reclaimableBytes += fileReclaimableBytes;

    if (file.plannedAction) {
      const action = {
        action: file.plannedAction,
        relativePath: file.relativePath,
        bytes: file.size,
        reclaimableBytes: fileReclaimableBytes,
        ageDays: Number(file.ageDays.toFixed(2)),
      };
      if (file.plannedAction === "archive_gzip") {
        action.archivePath = normalizePath(join(archiveDir, file.relativePath) + ".gz");
      }
      if (file.plannedAction === "compact_jsonl_tail" && file.compactPlan) {
        action.archivePath = normalizePath(file.compactPlan.archivePath);
        action.retainedLines = file.compactPlan.retainLines;
        action.archivedLines = file.compactPlan.archivedLines;
        action.firstObservedAt = file.compactPlan.firstObservedAt;
        action.lastObservedAt = file.compactPlan.lastObservedAt;
      }
      plannedActions.push(action);
    }

    if (!file.plannedAction || file.category.startsWith("preserve_") || file.category === "unknown_manual_review") {
      skippedReasons.push({
        relativePath: file.relativePath,
        category: file.category,
        reason: file.reason,
      });
    }
  }

  if (!dryRun) {
    for (const file of files.filter((item) => item.plannedAction === "compact_jsonl_tail" && item.compactPlan)) {
      archiveResults.push(await compactJsonlTail(file, file.compactPlan, manifestPath, observedAt));
    }

    if (archiveEnabled) {
      for (const file of files.filter((item) => item.plannedAction === "archive_gzip")) {
        const archivePath = join(archiveDir, file.relativePath) + ".gz";
        if (await pathExists(archivePath)) {
          archiveResults.push({
            relativePath: file.relativePath,
            archivePath: normalizePath(archivePath),
            status: "skipped_archive_exists",
          });
          continue;
        }
        const archiveResult = await gzipToArchive(file.absolutePath, archivePath);
        archiveResults.push({
          relativePath: file.relativePath,
          archivePath: normalizePath(archiveResult.archivePath),
          gzipBytes: archiveResult.gzipBytes,
          status: "archived",
        });
      }

      for (const file of files.filter((item) => item.plannedAction === "delete_disposable")) {
        await unlink(file.absolutePath);
        archiveResults.push({
          relativePath: file.relativePath,
          status: "deleted",
        });
      }
    }
  }

  const topFiles = files
    .filter((item) => (item.reclaimableBytes ?? 0) > 0)
    .sort((left, right) => (right.reclaimableBytes ?? 0) - (left.reclaimableBytes ?? 0))
    .slice(0, topFilesLimit)
    .map((item) => ({
      relativePath: item.relativePath,
      category: item.category,
      bytes: item.size,
      reclaimableBytes: item.reclaimableBytes ?? 0,
      ageDays: Number(item.ageDays.toFixed(2)),
      plannedAction: item.plannedAction,
      retainedLines: item.compactPlan?.retainLines ?? null,
      archivedLines: item.compactPlan?.archivedLines ?? null,
    }));

  return {
    dryRun,
    archiveEnabled,
    compactEnabled,
    totalBytes,
    reclaimableBytes,
    archiveDir: normalizePath(archiveDir),
    manifestPath: normalizePath(manifestPath),
    thresholds: {
      archiveCandidateMinAgeDays: rules.archiveCandidateMinAgeDays,
      disposableCacheMinAgeDays: rules.disposableCacheMinAgeDays,
      compactCandidateMinBytes: rules.compactCandidateMinBytes,
      compactRetainLines: rules.compactRetainLines,
    },
    byCategory,
    topFiles,
    plannedActions,
    skippedReasons,
    archiveResults,
  };
}
