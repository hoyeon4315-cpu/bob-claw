import { readFileSync, statSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const DEFAULT_MAX_BYTES = 128 * 1024;
const DEFAULT_MAX_LINES = 4096;

// 128 KiB or 4096 lines catches genuinely oversized source files without
// flagging the repo's current large-but-legit modules. Generated/runtime trees
// stay excluded so snapshots and build artifacts do not churn this check.
const EXCLUDED_PREFIXES = Object.freeze([
  ".cache/",
  ".cloudflare/",
  ".playwright-cli/",
  ".wrangler/",
  "build/",
  "coverage/",
  "data/",
  "dist/",
  "graphify-out/",
  "logs/",
  "node_modules/",
  "out/",
  "src/graphify-out/",
  "tmp/",
]);
const EXCLUDED_DASHBOARD_PUBLIC_NAMES = new Set(["_headers", "index.html"]);
// Legitimate large files that grow over time but are not "oversized source modules":
// package lock, changelog history, and readiness baseline data files.
const EXCLUDED_EXACT_BASENAMES = new Set(["package-lock.json", "CHANGELOG.md"]);
const EXCLUDED_READINESS_BASELINE_RE = /^docs\/readiness\/.*-baseline\.json$/u;
const EXCLUDED_ARCHIVE_PREFIXES = Object.freeze(["docs/_archive/"]);
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".toml",
  ".txt",
  ".yaml",
  ".yml",
]);
const NO_EXTENSION_SOURCE_FILES = new Set(["Dockerfile", "Jenkinsfile", "Makefile", "Procfile", "Justfile"]);

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function isExcludedPath(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return true;
  }
  if (EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  if (normalized.startsWith("dashboard/public/")) {
    const extension = extname(normalized);
    const name = basename(normalized);
    return !(extension === ".jsx" || EXCLUDED_DASHBOARD_PUBLIC_NAMES.has(name));
  }
  const baseName = basename(normalized);
  if (EXCLUDED_EXACT_BASENAMES.has(baseName)) {
    return true;
  }
  if (EXCLUDED_READINESS_BASELINE_RE.test(normalized)) {
    return true;
  }
  if (EXCLUDED_ARCHIVE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return false;
}

function isSourceCandidate(filePath) {
  const normalized = normalizePath(filePath);
  if (isExcludedPath(normalized)) {
    return false;
  }
  const extension = extname(normalized).toLowerCase();
  if (SOURCE_EXTENSIONS.has(extension)) {
    return true;
  }
  return NO_EXTENSION_SOURCE_FILES.has(basename(normalized));
}

function toRepoPath(filePath) {
  const resolved = resolve(ROOT, filePath);
  const repoRelative = normalizePath(relative(ROOT, resolved));
  if (repoRelative && !repoRelative.startsWith("../")) {
    return repoRelative;
  }
  return normalizePath(resolved);
}

function runGitFilesCommand(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "buffer",
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.toString("utf8") || result.stdout?.toString("utf8") || `git ${args.join(" ")} failed`,
    );
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .map((filePath) => filePath.trim())
    .filter(Boolean);
}

function countLines(text) {
  if (text.length === 0) {
    return 0;
  }
  const lineBreaks = text.match(/\r\n|\r|\n/g);
  return (lineBreaks?.length ?? 0) + 1;
}

function parseArgs(argv) {
  const files = [];
  let json = false;
  let maxBytes = DEFAULT_MAX_BYTES;
  let maxLines = DEFAULT_MAX_LINES;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--max-bytes") {
      const raw = argv[index + 1] ?? "";
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`invalid --max-bytes value: ${raw}`);
      }
      maxBytes = parsed;
      index += 1;
      continue;
    }
    if (arg === "--max-lines") {
      const raw = argv[index + 1] ?? "";
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`invalid --max-lines value: ${raw}`);
      }
      maxLines = parsed;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true, files: [], json, maxBytes, maxLines };
    }
    files.push(arg);
  }

  return { help: false, files, json, maxBytes, maxLines };
}

function collectFiles(explicitFiles) {
  if (explicitFiles.length > 0) {
    return [...new Set(explicitFiles.map((filePath) => toRepoPath(filePath)))].map((repoPath) => ({
      absolutePath: resolve(ROOT, repoPath),
      repoPath,
    }));
  }
  return [...new Set(runGitFilesCommand(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]))].map(
    (repoPath) => ({
      absolutePath: resolve(ROOT, repoPath),
      repoPath: normalizePath(repoPath),
    }),
  );
}

function scanFile(file, limits) {
  const stat = statSync(file.absolutePath);
  const text = readFileSync(file.absolutePath, "utf8");
  const bytes = stat.size;
  const lines = countLines(text);
  return {
    bytes,
    displayPath: file.repoPath,
    filePath: file.absolutePath,
    lines,
    maxBytes: limits.maxBytes,
    maxLines: limits.maxLines,
    overBytes: bytes > limits.maxBytes,
    overLines: lines > limits.maxLines,
  };
}

export function buildLargeFileReport(explicitFiles = [], limits = {}) {
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxLines = limits.maxLines ?? DEFAULT_MAX_LINES;
  const allFiles = collectFiles(explicitFiles);
  const files = allFiles.filter((file) => isSourceCandidate(file.repoPath));
  const scanned = [];
  const violations = [];

  for (const file of files) {
    const result = scanFile(file, { maxBytes, maxLines });
    scanned.push(result);
    if (result.overBytes || result.overLines) {
      violations.push(result);
    }
  }

  return {
    excludedCount: allFiles.length - files.length,
    filesScanned: scanned.length,
    maxBytes,
    maxLines,
    violations,
  };
}

function formatViolation(violation) {
  const reasons = [];
  if (violation.overBytes) {
    reasons.push(`${violation.bytes} bytes > ${violation.maxBytes}`);
  }
  if (violation.overLines) {
    reasons.push(`${violation.lines} lines > ${violation.maxLines}`);
  }
  return `${violation.displayPath}: ${reasons.join(", ")}`;
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/check-large-files.mjs [file ...] [--json] [--max-bytes N] [--max-lines N]",
      "If no files are passed, the script scans tracked and untracked source candidates from git.",
      "Generated/runtime paths such as data/, logs/, build artifacts, dependency folders, caches, and dashboard/public generated slices are excluded.",
    ].join("\n"),
  );
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const report = buildLargeFileReport(options.files, {
    maxBytes: options.maxBytes,
    maxLines: options.maxLines,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.violations.length === 0) {
    console.log(
      `Large file check passed: ${report.filesScanned} source files scanned, 0 violations, threshold ${report.maxBytes} bytes or ${report.maxLines} lines.`,
    );
    console.log(
      "Exclusions: data/, logs/, dashboard/public generated slices, build artifacts, dependency folders, coverage, dist/, cache folders, and graphify outputs.",
    );
  } else {
    console.error(
      `Large file check failed: ${report.violations.length} violation(s) across ${report.filesScanned} source files (threshold ${report.maxBytes} bytes or ${report.maxLines} lines).`,
    );
    for (const violation of report.violations) {
      console.error(`- ${formatViolation(violation)}`);
    }
  }

  return report.violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
