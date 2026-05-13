import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_BASELINE = ".secrets.baseline";
const EXCLUDED_PATH_PATTERNS = Object.freeze([
  /^\.cloudflare\//u,
  /^\.playwright-cli\//u,
  /^\.wrangler\//u,
  /^artifacts\//u,
  /^build\//u,
  /^coverage\//u,
  /^data\//u,
  /^dist\//u,
  /^logs\//u,
  /^node_modules\//u,
  /^out\//u,
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
export function isSecretScanExcludedPath(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized || EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  if (normalized.startsWith("dashboard/public/")) {
    const name = basename(normalized);
    const extension = extname(normalized);
    return !(extension === ".jsx" || name === "index.html" || name === "_headers");
  }
  return false;
}

/**
 * @param {string[]} files
 */
export function classifySecretScanFiles(files) {
  const plan = {
    includedFiles: [],
    excludedFiles: [],
  };
  const seen = new Set();

  for (const rawFile of files) {
    const file = normalizePath(rawFile);
    if (!file || seen.has(file)) {
      continue;
    }
    seen.add(file);

    const bucket = isSecretScanExcludedPath(file) ? "excludedFiles" : "includedFiles";
    plan[bucket].push(file);
  }

  return plan;
}

function listTrackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if ((result.status ?? 1) !== 0) {
    process.stderr.write(result.stderr || "git ls-files failed\n");
    process.exit(result.status ?? 1);
  }
  return (result.stdout || "").split("\0").filter(Boolean);
}

function runPython(moduleName, extraArgs, { captureOutput = false } = {}) {
  const python = process.env.DETECT_SECRETS_PYTHON || "python3";
  const result = spawnSync(python, ["-m", moduleName, ...extraArgs], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    if (captureOutput) {
      process.stderr.write(result.stderr || `${moduleName} failed\n`);
    }
    process.exit(result.status ?? 1);
  }
  return result;
}

function parseArgs(argv) {
  const options = {
    baseline: DEFAULT_BASELINE,
    printPlan: false,
    writeBaseline: false,
    files: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--baseline") {
      options.baseline = argv[index + 1] || DEFAULT_BASELINE;
      index += 1;
      continue;
    }
    if (arg === "--print-plan") {
      options.printPlan = true;
      continue;
    }
    if (arg === "--write-baseline") {
      options.writeBaseline = true;
      continue;
    }
    options.files.push(arg);
  }

  return options;
}

function writeBaseline(baselinePath, files) {
  const result = runPython("detect_secrets", ["scan", "--slim", ...files], {
    captureOutput: true,
  });
  const parsed = JSON.parse(result.stdout || "{}");
  writeFileSync(baselinePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function verifyBaselineExists(baselinePath) {
  try {
    readFileSync(baselinePath, "utf8");
  } catch {
    process.stderr.write(
      `Missing ${baselinePath}. Run \`node scripts/check-secret-scanning.mjs --write-baseline\` after reviewing current findings.\n`,
    );
    process.exit(1);
  }
}

function checkFiles(baselinePath, files) {
  verifyBaselineExists(baselinePath);
  if (files.length === 0) {
    console.log("secret scanning skipped: no eligible tracked files");
    return 0;
  }

  runPython("detect_secrets.pre_commit_hook", ["--baseline", baselinePath, ...files]);
  console.log(`secret scanning passed for ${files.length} files using ${baselinePath}`);
  return 0;
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const options = parseArgs(process.argv.slice(2));
  const rawFiles = options.files.length > 0 ? options.files : listTrackedFiles();
  const plan = classifySecretScanFiles(rawFiles);

  if (options.printPlan) {
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
  }

  if (options.writeBaseline) {
    writeBaseline(options.baseline, plan.includedFiles);
    console.log(`wrote ${options.baseline} with ${plan.includedFiles.length} eligible files`);
    process.exit(0);
  }

  process.exit(checkFiles(options.baseline, plan.includedFiles));
}
