import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const ROOT = process.cwd();
const ESLINT_CONFIG_PATH = fileURLToPath(new URL("../eslint.config.mjs", import.meta.url));
const DEFAULT_COMPLEXITY_THRESHOLD = 20;
const GENERATED_PREFIXES = Object.freeze([
  ".cloudflare/",
  ".playwright-cli/",
  ".wrangler/",
  "build/",
  "data/",
  "dist/",
  "logs/",
  "node_modules/",
  "out/",
]);
const REPO_SCOPE_PREFIXES = Object.freeze(["src/", "scripts/", "test/"]);
const ROOT_SCOPE_FILES = new Set(["eslint.config.mjs"]);
const CODE_EXTENSIONS = new Set([".mjs"]);

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function displayPath(filePath) {
  const repoRelativePath = normalizePath(relative(ROOT, filePath));
  return repoRelativePath && !repoRelativePath.startsWith("../") ? repoRelativePath : normalizePath(filePath);
}

function isExcludedRepoPath(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return true;
  }
  if (GENERATED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  if (normalized.startsWith("dashboard/public/")) {
    return true;
  }
  return false;
}

function isRepoScopedComplexityFile(filePath) {
  const normalized = normalizePath(filePath);
  return (
    !isExcludedRepoPath(normalized) &&
    (REPO_SCOPE_PREFIXES.some((prefix) => normalized.startsWith(prefix)) || ROOT_SCOPE_FILES.has(normalized)) &&
    CODE_EXTENSIONS.has(extname(normalized))
  );
}

function isExplicitComplexityTarget(filePath) {
  const normalized = normalizePath(filePath);
  return CODE_EXTENSIONS.has(extname(normalized)) && !normalized.includes("/node_modules/");
}

function runGitCommand(args) {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listTrackedComplexityFiles() {
  return runGitCommand(["ls-files"]).filter((filePath) => isRepoScopedComplexityFile(filePath));
}

function changedFilesSince(baseRef) {
  return runGitCommand(["diff", "--name-only", "--diff-filter=ACMR", `${baseRef}...HEAD`]).filter((filePath) =>
    isRepoScopedComplexityFile(filePath),
  );
}

function stagedComplexityFiles() {
  return runGitCommand(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).filter((filePath) =>
    isRepoScopedComplexityFile(filePath),
  );
}

function parseArgs(argv) {
  const files = [];
  let json = false;
  let staged = false;
  let baseRef = null;
  let deltaBase = null;
  let threshold = DEFAULT_COMPLEXITY_THRESHOLD;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--check") {
      continue;
    }
    if (arg === "--staged") {
      staged = true;
      continue;
    }
    if (arg === "--base") {
      baseRef = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--delta-base") {
      deltaBase = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--threshold") {
      const rawValue = argv[index + 1] ?? "";
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`invalid --threshold value: ${rawValue}`);
      }
      threshold = parsed;
      index += 1;
      continue;
    }
    files.push(arg);
  }

  return {
    baseRef,
    deltaBase,
    files,
    json,
    staged,
    threshold,
  };
}

function uniqueFiles(files) {
  return [...new Set(files.map((filePath) => resolve(ROOT, filePath)))];
}

function buildTargetFiles(options) {
  if (options.files.length > 0) {
    return uniqueFiles(options.files).filter((filePath) => isExplicitComplexityTarget(displayPath(filePath)));
  }
  if (options.staged) {
    return stagedComplexityFiles().map((filePath) => resolve(ROOT, filePath));
  }
  if (options.baseRef) {
    return changedFilesSince(options.baseRef).map((filePath) => resolve(ROOT, filePath));
  }
  return [];
}

function extractComplexityValue(message) {
  const match = message.match(/complexity of (\d+)/u);
  return match ? Number.parseInt(match[1], 10) : null;
}

function toIssue(result, message) {
  return {
    filePath: displayPath(result.filePath),
    line: message.line ?? 0,
    column: message.column ?? 0,
    message: message.message,
    complexity: extractComplexityValue(message.message),
    ruleId: message.ruleId ?? null,
  };
}

function extractFunctionName(message) {
  const named = message.match(
    /^(?:Function|Async function|Generator function|Method|Static method|Async method) '([^']+)'/u,
  );
  return named ? named[1] : null;
}

function readFileAtRef(ref, repoRelativePath) {
  const result = spawnSync("git", ["show", `${ref}:${repoRelativePath}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

async function lintFileContentForComplexity(filePath, content, threshold) {
  // Baseline lint must run with a config that matches files outside the repo's
  // src/scripts/test globs, so we use a standalone ESLint instance with an
  // inline flat config keyed on **/*.mjs. The complexity rule is purely AST-based
  // and produces identical counts regardless of project config inheritance.
  const tempDirectory = mkdtempSync(join(tmpdir(), "complexity-baseline-"));
  try {
    const repoRelative = normalizePath(relative(ROOT, filePath));
    const stagedPath = join(tempDirectory, repoRelative);
    mkdirSync(dirname(stagedPath), { recursive: true });
    writeFileSync(stagedPath, content, "utf8");
    const eslint = new ESLint({
      cwd: tempDirectory,
      errorOnUnmatchedPattern: false,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ["**/*.mjs"],
          languageOptions: { ecmaVersion: "latest", sourceType: "module" },
          rules: { complexity: ["error", threshold] },
        },
      ],
    });
    const results = await eslint.lintFiles([stagedPath]);
    const errors = [];
    for (const result of results) {
      for (const message of result.messages) {
        if (message.ruleId !== "complexity") continue;
        errors.push({
          filePath: repoRelative,
          line: message.line ?? 0,
          column: message.column ?? 0,
          message: message.message,
          complexity: extractComplexityValue(message.message),
          ruleId: message.ruleId ?? null,
        });
      }
    }
    return errors;
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

async function baselineIssuesForFile(filePath, deltaBase, threshold) {
  const repoRelative = normalizePath(relative(ROOT, filePath));
  const content = readFileAtRef(deltaBase, repoRelative);
  if (content === null) return [];
  return lintFileContentForComplexity(filePath, content, threshold);
}

function partitionByFile(issues) {
  const byFile = new Map();
  for (const issue of issues) {
    const key = normalizePath(issue.filePath);
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(issue);
  }
  return byFile;
}

export function classifyDeltaIssues(stagedIssues, baselineIssues) {
  // Named functions match by identifier. An identical or improved baseline
  // complexity for the same name is treated as unchanged; a higher staged
  // complexity for an existing name is treated as worsened and reported.
  //
  // Anonymous arrows have no durable identity across line shifts, so we use
  // a tightest-fit matching: sort baseline ascending and for each staged
  // arrow pick the smallest unconsumed baseline arrow with complexity >=
  // the staged complexity. This guarantees a higher complexity than every
  // baseline arrow surfaces as a new violation, while preserving baseline
  // arrows of comparable or higher complexity as unchanged.
  const baselineByName = new Map();
  const baselineAnonymous = [];
  for (const issue of baselineIssues) {
    const name = extractFunctionName(issue.message);
    if (name) {
      const previous = baselineByName.get(name);
      if (previous === undefined || (issue.complexity ?? 0) > previous) {
        baselineByName.set(name, issue.complexity ?? 0);
      }
      continue;
    }
    baselineAnonymous.push(issue.complexity ?? 0);
  }
  baselineAnonymous.sort((left, right) => left - right);
  const consumed = new Array(baselineAnonymous.length).fill(false);
  const deltaIssues = [];
  for (const issue of stagedIssues) {
    const stagedComplexity = issue.complexity ?? 0;
    const name = extractFunctionName(issue.message);
    if (name) {
      const baselineValue = baselineByName.get(name);
      if (baselineValue !== undefined && baselineValue >= stagedComplexity) continue;
      deltaIssues.push(issue);
      continue;
    }
    let matchIndex = -1;
    for (let index = 0; index < baselineAnonymous.length; index += 1) {
      if (consumed[index]) continue;
      if (baselineAnonymous[index] >= stagedComplexity) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex >= 0) {
      consumed[matchIndex] = true;
      continue;
    }
    deltaIssues.push(issue);
  }
  return deltaIssues;
}

async function applyDeltaFilter(report, targetFiles, deltaBase, threshold) {
  if (!deltaBase || report.errors.length === 0) return report;
  const stagedByFile = partitionByFile(report.errors);
  const remaining = [];
  for (const targetFile of targetFiles) {
    const displayKey = normalizePath(displayPath(targetFile));
    const stagedIssues = stagedByFile.get(displayKey) || [];
    if (stagedIssues.length === 0) continue;
    const baselineIssues = await baselineIssuesForFile(targetFile, deltaBase, threshold);
    const deltaIssues = classifyDeltaIssues(stagedIssues, baselineIssues);
    remaining.push(...deltaIssues);
  }
  return {
    ...report,
    errors: remaining,
    errorCount: remaining.length,
  };
}

export async function lintCyclomaticComplexity(targetFiles, threshold = DEFAULT_COMPLEXITY_THRESHOLD) {
  if (targetFiles.length === 0) {
    return {
      errorCount: 0,
      errors: [],
      filesChecked: 0,
      targetFiles: [],
      threshold,
    };
  }

  const eslint = new ESLint({
    cwd: ROOT,
    errorOnUnmatchedPattern: false,
    overrideConfig: {
      rules: {
        complexity: ["error", threshold],
      },
    },
    overrideConfigFile: ESLINT_CONFIG_PATH,
  });
  const results = await eslint.lintFiles(targetFiles);
  const errors = [];

  for (const result of results) {
    for (const message of result.messages) {
      if (message.ruleId !== "complexity") {
        continue;
      }
      errors.push(toIssue(result, message));
    }
  }

  return {
    errorCount: errors.length,
    errors,
    filesChecked: results.length,
    targetFiles: targetFiles.map((filePath) => displayPath(filePath)),
    threshold,
  };
}

export async function validateCyclomaticComplexity(argv = []) {
  const options = parseArgs(argv);
  const targetFiles = buildTargetFiles(options);
  const fullReport = await lintCyclomaticComplexity(targetFiles, options.threshold);
  const report = await applyDeltaFilter(fullReport, targetFiles, options.deltaBase, options.threshold);
  return {
    ...report,
    mode: options.files.length > 0 ? "explicit" : options.staged ? "staged" : options.baseRef ? "base-diff" : "empty",
    baseRef: options.baseRef,
    deltaBase: options.deltaBase,
    staged: options.staged,
  };
}

function printHuman(report) {
  if (report.filesChecked === 0) {
    console.log("Cyclomatic complexity validation skipped: no matching source files.");
    return;
  }
  if (report.errorCount === 0) {
    console.log(
      `Cyclomatic complexity validation passed: ${report.filesChecked} files checked, max complexity ${report.threshold}.`,
    );
    return;
  }
  for (const error of report.errors) {
    const location = `${error.filePath}:${error.line}:${error.column}`;
    console.error(`${location}: ${error.message}`);
  }
  console.error(
    `Cyclomatic complexity validation failed: ${report.errorCount} issue(s), ${report.filesChecked} files checked, max complexity ${report.threshold}.`,
  );
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  try {
    const report = await validateCyclomaticComplexity(process.argv.slice(2));
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHuman(report);
    }
    process.exit(report.errorCount === 0 ? 0 : 1);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}
