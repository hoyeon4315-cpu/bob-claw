import { spawnSync } from "node:child_process";
import { basename, extname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PRETTIER_EXTENSIONS = new Set([".cjs", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".yaml", ".yml"]);
const NODE_CHECK_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs"]);
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

/**
 * @param {string} filePath
 */
function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

/**
 * @param {string} filePath
 */
export function isExcludedPreCommitPath(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return true;
  }
  if (GENERATED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  if (normalized.startsWith("dashboard/public/")) {
    const name = basename(normalized);
    const extension = extname(normalized);
    if (extension === ".jsx" || name === "index.html" || name === "_headers") {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * @param {string[]} files
 */
export function classifyStagedFiles(files) {
  const seen = new Set();
  const includedFiles = [];
  const excludedFiles = [];
  const prettierFiles = [];
  const nodeCheckFiles = [];
  const nodeTestFiles = [];

  for (const rawFile of files) {
    const file = normalizePath(rawFile);
    if (!file || seen.has(file)) {
      continue;
    }
    seen.add(file);

    if (isExcludedPreCommitPath(file)) {
      excludedFiles.push(file);
      continue;
    }

    includedFiles.push(file);
    const extension = extname(file);
    if (PRETTIER_EXTENSIONS.has(extension) || basename(file) === "_headers") {
      prettierFiles.push(file);
    }
    if (NODE_CHECK_EXTENSIONS.has(extension)) {
      nodeCheckFiles.push(file);
    }
    if (/^test\/.+\.test\.mjs$/u.test(file)) {
      nodeTestFiles.push(file);
    }
  }

  return {
    includedFiles,
    excludedFiles,
    prettierFiles,
    nodeCheckFiles,
    nodeTestFiles,
  };
}

/**
 * @param {string} command
 * @param {string[]} args
 */
function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  return result.status ?? 1;
}

/**
 * @param {string[]} files
 */
function runChecks(files) {
  const plan = classifyStagedFiles(files);

  if (plan.prettierFiles.length > 0) {
    const status = runCommand("npx", ["--no-install", "prettier", "--check", ...plan.prettierFiles]);
    if (status !== 0) {
      return status;
    }
  }

  for (const file of plan.nodeCheckFiles) {
    const status = runCommand(process.execPath, ["--check", file]);
    if (status !== 0) {
      return status;
    }
  }

  const namingStatus = runCommand(process.execPath, ["scripts/validate-naming-conventions.mjs", ...plan.includedFiles]);
  if (namingStatus !== 0) {
    return namingStatus;
  }

  if (plan.nodeTestFiles.length > 0) {
    const status = runCommand(process.execPath, ["--test", ...plan.nodeTestFiles]);
    if (status !== 0) {
      return status;
    }
  }

  return 0;
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const args = process.argv.slice(2);
  if (args.includes("--print-plan")) {
    const files = args.filter((arg) => arg !== "--print-plan");
    console.log(JSON.stringify(classifyStagedFiles(files), null, 2));
    process.exit(0);
  }
  process.exit(runChecks(args));
}
