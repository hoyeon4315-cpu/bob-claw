import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const NAMING_GUIDE_PATH = "docs/naming-conventions.md";
const CODE_DIRECTORIES = Object.freeze(["src/", "scripts/", "test/", "dashboard/public/"]);
const CODE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs"]);
const FILE_BASENAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FUNCTION_NAME_RE = /^_?[a-z][A-Za-z0-9]*$/u;
const CLASS_NAME_RE = /^[A-Z][A-Za-z0-9]*$/u;
const CONST_NAME_RE = /^(?:[a-z][A-Za-z0-9]*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)$/u;
const TEST_SENTINEL_RE = /^__.*(?:__)?$/u;
const EXACT_FUNCTION_EXCEPTIONS = new Set(["K_for_capital"]);
const FUNCTION_EXPORT_RE = /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gmu;
const CLASS_EXPORT_RE = /^\s*export\s+(?:default\s+)?class\s+([A-Za-z0-9_$]+)/gmu;
const CONST_EXPORT_RE = /^\s*export\s+const\s+([A-Za-z0-9_$]+)\s*=/gmu;

function relativePath(filePath) {
  return relative(ROOT, resolve(ROOT, filePath)).replaceAll("\\", "/");
}

function isCodePath(filePath) {
  return CODE_DIRECTORIES.some((prefix) => filePath.startsWith(prefix)) && CODE_EXTENSIONS.has(extname(filePath));
}

function normalizeTestBaseName(baseName) {
  return baseName.endsWith(".test") ? baseName.slice(0, -".test".length) : baseName;
}

function validateGuide(errors) {
  let namingGuide = "";
  try {
    namingGuide = readFileSync(NAMING_GUIDE_PATH, "utf8");
  } catch (error) {
    errors.push({
      file: NAMING_GUIDE_PATH,
      rule: "doc-exists",
      message: `missing naming guide: ${String(error)}`,
    });
    return;
  }

  for (const heading of ["## File naming", "## Identifier naming", "## Runtime and compatibility exceptions"]) {
    if (!namingGuide.includes(heading)) {
      errors.push({
        file: NAMING_GUIDE_PATH,
        rule: "doc-heading",
        message: `missing required section: ${heading}`,
      });
    }
  }
}

function exportedNameErrors(filePath, source) {
  const errors = [];
  let exportsChecked = 0;

  for (const match of source.matchAll(FUNCTION_EXPORT_RE)) {
    exportsChecked += 1;
    const name = match[1];
    if (!FUNCTION_NAME_RE.test(name) && !EXACT_FUNCTION_EXCEPTIONS.has(name)) {
      errors.push({
        file: filePath,
        rule: "export-function-name",
        message: `exported function "${name}" must use camelCase or _camelCase`,
      });
    }
  }

  for (const match of source.matchAll(CLASS_EXPORT_RE)) {
    exportsChecked += 1;
    const name = match[1];
    if (!CLASS_NAME_RE.test(name)) {
      errors.push({
        file: filePath,
        rule: "export-class-name",
        message: `exported class "${name}" must use PascalCase`,
      });
    }
  }

  for (const match of source.matchAll(CONST_EXPORT_RE)) {
    exportsChecked += 1;
    const name = match[1];
    if (!CONST_NAME_RE.test(name) && !TEST_SENTINEL_RE.test(name)) {
      errors.push({
        file: filePath,
        rule: "export-const-name",
        message: `exported const "${name}" must use camelCase, SCREAMING_SNAKE_CASE, or a documented test sentinel`,
      });
    }
  }

  return { errors, exportsChecked };
}

function fileNameError(filePath) {
  const extension = extname(filePath);
  const rawBaseName = basename(filePath, extension);
  const baseName = normalizeTestBaseName(rawBaseName);
  if (FILE_BASENAME_RE.test(baseName)) {
    return null;
  }
  return {
    file: filePath,
    rule: "file-name",
    message: `filename "${rawBaseName}${extension}" must use kebab-case`,
  };
}

function listTrackedCodeFiles() {
  const git = spawnSync("git", ["ls-files", "src", "scripts", "test", "dashboard/public"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (git.status !== 0) {
    throw new Error(git.stderr || git.stdout || "git ls-files failed");
  }
  return git.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((filePath) => isCodePath(filePath));
}

function buildTargetFiles(args) {
  if (args.length === 0) {
    return listTrackedCodeFiles();
  }
  return args.map((filePath) => relativePath(filePath)).filter((filePath) => isCodePath(filePath));
}

export function validateNamingConventions(args = []) {
  const files = buildTargetFiles(args);
  const errors = [];
  validateGuide(errors);

  let exportsChecked = 0;
  for (const filePath of files) {
    const fileError = fileNameError(filePath);
    if (fileError) {
      errors.push(fileError);
    }

    const source = readFileSync(filePath, "utf8");
    const result = exportedNameErrors(filePath, source);
    exportsChecked += result.exportsChecked;
    errors.push(...result.errors);
  }

  return {
    filesChecked: files.length,
    exportsChecked,
    errors,
  };
}

function printHuman(result) {
  if (result.errors.length === 0) {
    console.log(
      `Naming validation passed: ${result.filesChecked} files checked, ${result.exportsChecked} exports checked.`,
    );
    return;
  }

  for (const error of result.errors) {
    console.error(`${error.file}: ${error.rule}: ${error.message}`);
  }
  console.error(
    `Naming validation failed: ${result.errors.length} issue(s), ${result.filesChecked} files checked, ${result.exportsChecked} exports checked.`,
  );
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const filteredArgs = args.filter((arg) => arg !== "--json" && arg !== "--check");
  const result = validateNamingConventions(filteredArgs);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
  process.exit(result.errors.length === 0 ? 0 : 1);
}
