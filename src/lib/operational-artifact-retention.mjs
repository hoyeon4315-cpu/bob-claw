import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { operationalArtifactRetentionConfig } from "../config/operational-artifact-retention.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

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
 *   preserveLiveTruthBasenames: Set<string>,
 *   preserveLiveTruthRelativePaths: Set<string>,
 *   preserveLiveTruthSuffixes: string[],
 *   preserveAuditReceiptBasenames: Set<string>,
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

  if (rules.preserveAuditReceiptBasenames.has(basename) || isAuditReceiptBasename(basename)) {
    return {
      category: "preserve_audit_receipt",
      reason: "preserve_audit_receipt",
      ageDays,
      reclaimable: false,
      plannedAction: null,
    };
  }

  if (basename.endsWith(".jsonl") && containsAnyToken(basename, rules.archiveCandidateTokens)) {
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
 * @param {{
 *   dataDir: string,
 *   logsDir: string,
 *   dashboardDir: string,
 *   archiveDir?: string,
 *   archive?: boolean,
 *   dryRun?: boolean,
 *   now?: Date | number | string,
 *   topFilesLimit?: number,
 * }} options
 */
export async function auditOperationalArtifacts(options) {
  const dataDir = resolve(options.dataDir);
  const logsDir = resolve(options.logsDir);
  const dashboardDir = resolve(options.dashboardDir);
  const archiveDir = resolve(
    options.archiveDir || join(dataDir, ...operationalArtifactRetentionConfig.archiveDestinationSegments),
  );
  const archiveEnabled = options.archive === true;
  const dryRun = options.dryRun ?? !archiveEnabled;
  const nowMs = new Date(options.now || Date.now()).getTime();
  const topFilesLimit = options.topFilesLimit || operationalArtifactRetentionConfig.topFilesLimit;
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
          {
            nowMs,
            archiveCandidateMinAgeDays: operationalArtifactRetentionConfig.archiveCandidateMinAgeDays,
            disposableCacheMinAgeDays: operationalArtifactRetentionConfig.disposableCacheMinAgeDays,
            preserveLiveTruthBasenames: operationalArtifactRetentionConfig.preserveLiveTruthBasenames,
            preserveLiveTruthRelativePaths: operationalArtifactRetentionConfig.preserveLiveTruthRelativePaths,
            preserveLiveTruthSuffixes: operationalArtifactRetentionConfig.preserveLiveTruthSuffixes,
            preserveAuditReceiptBasenames: operationalArtifactRetentionConfig.preserveAuditReceiptBasenames,
            archiveCandidateTokens: operationalArtifactRetentionConfig.archiveCandidateTokens,
            disposablePathFragments: operationalArtifactRetentionConfig.disposablePathFragments,
            disposableBasenameSuffixes: operationalArtifactRetentionConfig.disposableBasenameSuffixes,
          },
        ),
      });
    }
  }

  const byCategory = {
    preserve_live_truth: { fileCount: 0, totalBytes: 0, reclaimableBytes: 0 },
    preserve_audit_receipt: { fileCount: 0, totalBytes: 0, reclaimableBytes: 0 },
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
    totalBytes += file.size;
    reclaimableBytes += file.reclaimable ? file.size : 0;
    byCategory[file.category].fileCount += 1;
    byCategory[file.category].totalBytes += file.size;
    byCategory[file.category].reclaimableBytes += file.reclaimable ? file.size : 0;

    if (file.plannedAction) {
      const action = {
        action: file.plannedAction,
        relativePath: file.relativePath,
        bytes: file.size,
        ageDays: Number(file.ageDays.toFixed(2)),
      };
      if (file.plannedAction === "archive_gzip") {
        action.archivePath = normalizePath(join(archiveDir, file.relativePath));
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

  if (archiveEnabled && !dryRun) {
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
  }

  const topFiles = files
    .filter((item) => item.reclaimable)
    .sort((left, right) => right.size - left.size)
    .slice(0, topFilesLimit)
    .map((item) => ({
      relativePath: item.relativePath,
      category: item.category,
      bytes: item.size,
      ageDays: Number(item.ageDays.toFixed(2)),
      plannedAction: item.plannedAction,
    }));

  return {
    dryRun,
    archiveEnabled,
    totalBytes,
    reclaimableBytes,
    archiveDir: normalizePath(archiveDir),
    thresholds: {
      archiveCandidateMinAgeDays: operationalArtifactRetentionConfig.archiveCandidateMinAgeDays,
      disposableCacheMinAgeDays: operationalArtifactRetentionConfig.disposableCacheMinAgeDays,
    },
    byCategory,
    topFiles,
    plannedActions,
    skippedReasons,
    archiveResults,
  };
}
