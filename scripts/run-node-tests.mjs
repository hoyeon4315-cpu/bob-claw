import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TEST_DIR = resolve(ROOT_DIR, "test");
const INTEGRATION_DIR = resolve(TEST_DIR, "integration");

function parseArgs(argv = []) {
  let scope = "all";
  const passthrough = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      passthrough.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith("--scope=")) {
      scope = arg.slice("--scope=".length);
      continue;
    }
    if (arg === "--scope") {
      scope = argv[index + 1];
      index += 1;
      continue;
    }
    passthrough.push(arg);
  }

  if (!["all", "unit", "integration"].includes(scope)) {
    throw new Error(`Unsupported test scope: ${scope}`);
  }

  return { scope, passthrough };
}

function collectTests(dir) {
  const files = [];

  function visit(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
        files.push(fullPath);
      }
    }
  }

  visit(dir);
  return files.sort((left, right) => left.localeCompare(right));
}

function isInIntegration(filePath) {
  const rel = relative(INTEGRATION_DIR, filePath);
  return rel && !rel.startsWith("..") && !rel.startsWith(sep);
}

function selectTests(scope) {
  const allTests = collectTests(TEST_DIR);
  if (scope === "all") return allTests;
  if (scope === "integration") return allTests.filter(isInIntegration);
  return allTests.filter((filePath) => !isInIntegration(filePath));
}

const { scope, passthrough } = parseArgs(process.argv.slice(2));
const testFiles = selectTests(scope);

if (testFiles.length === 0) {
  console.error(`No ${scope} test files found under ${relative(ROOT_DIR, TEST_DIR)}`);
  process.exit(1);
}

const relativeTests = testFiles.map((filePath) => relative(ROOT_DIR, filePath));
const result = spawnSync(process.execPath, ["--test", ...passthrough, ...relativeTests], {
  cwd: ROOT_DIR,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
