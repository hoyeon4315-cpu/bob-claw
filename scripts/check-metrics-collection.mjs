import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DOC_PATH = "docs/readiness/metrics-collection.md";
const PACKAGE_PATH = "package.json";
const REGISTRY_PATH = "src/metrics/registry.mjs";
const CLI_METRICS_PATH = "src/metrics/cli-run.mjs";
const SNAPSHOT_CLI_PATH = "src/cli/report-metrics-snapshot.mjs";
const SIGNER_HEALTH_CLI_PATH = "src/cli/diagnose-signer-health.mjs";
const AUTOMATION_HEALTH_CLI_PATH = "src/cli/report-automation-health.mjs";

const REQUIRED_FILES = Object.freeze([
  DOC_PATH,
  PACKAGE_PATH,
  REGISTRY_PATH,
  CLI_METRICS_PATH,
  SNAPSHOT_CLI_PATH,
  SIGNER_HEALTH_CLI_PATH,
  AUTOMATION_HEALTH_CLI_PATH,
]);

const REQUIRED_PACKAGE_SCRIPTS = Object.freeze(["report:metrics-snapshot", "check:metrics-collection"]);

const REQUIRED_DOC_SNIPPETS = Object.freeze([
  "node src/cli/diagnose-signer-health.mjs --json --metrics-out=/tmp/bob-claw-metrics.prom",
  "node src/cli/report-automation-health.mjs --json --skip-runtime-probe --metrics-out=/tmp/bob-claw-automation-metrics.json --metrics-format=json",
  "node scripts/check-metrics-collection.mjs",
  "--metrics-out=/tmp/bob-claw-metrics.prom",
  "bobclaw_signer_health_ready_for_broadcast",
  "bobclaw_automation_health_queue_candidates",
]);

const REQUIRED_SIGNER_CLI_SNIPPETS = Object.freeze([
  "parseMetricsArgs",
  "metricsOut:",
  "metricsFormat:",
  "createCliMetricsSession",
  "bobclaw_signer_health_ready_for_broadcast",
]);

const REQUIRED_AUTOMATION_CLI_SNIPPETS = Object.freeze([
  "parseMetricsArgs",
  "metricsOut:",
  "metricsFormat:",
  "createCliMetricsSession",
  "bobclaw_automation_health_queue_candidates",
]);

function readText(relativePath, rootDir = ROOT_DIR) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

function hasText(haystack, needle) {
  return String(haystack).includes(needle);
}

function checkRequiredFiles(rootDir) {
  return REQUIRED_FILES.map((relativePath) => ({
    path: relativePath,
    exists: existsSync(resolve(rootDir, relativePath)),
  }));
}

function checkPackageScripts(packageText) {
  const parsed = JSON.parse(packageText);
  const scripts = parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
  return REQUIRED_PACKAGE_SCRIPTS.map((name) => ({
    name,
    exists: typeof scripts[name] === "string" && scripts[name].trim().length > 0,
    command: scripts[name] || null,
  }));
}

function checkSnippets(text, snippets, kind) {
  return snippets.map((snippet) => ({
    kind,
    snippet,
    found: hasText(text, snippet),
  }));
}

export function checkMetricsCollection({ rootDir = ROOT_DIR } = {}) {
  const fileChecks = checkRequiredFiles(rootDir);
  const packageText = readText(PACKAGE_PATH, rootDir);
  const docText = readText(DOC_PATH, rootDir);
  const signerCliText = readText(SIGNER_HEALTH_CLI_PATH, rootDir);
  const automationCliText = readText(AUTOMATION_HEALTH_CLI_PATH, rootDir);

  const packageScripts = checkPackageScripts(packageText);
  const docSnippets = checkSnippets(docText, REQUIRED_DOC_SNIPPETS, "doc");
  const signerCliSnippets = checkSnippets(signerCliText, REQUIRED_SIGNER_CLI_SNIPPETS, "signer_cli");
  const automationCliSnippets = checkSnippets(automationCliText, REQUIRED_AUTOMATION_CLI_SNIPPETS, "automation_cli");

  const failures = [
    ...fileChecks.filter((entry) => !entry.exists).map((entry) => ({ type: "missing_file", subject: entry.path })),
    ...packageScripts
      .filter((entry) => !entry.exists)
      .map((entry) => ({ type: "missing_package_script", subject: entry.name })),
    ...docSnippets
      .filter((entry) => !entry.found)
      .map((entry) => ({ type: "missing_doc_reference", subject: entry.snippet })),
    ...signerCliSnippets
      .filter((entry) => !entry.found)
      .map((entry) => ({ type: "missing_signer_cli_snippet", subject: entry.snippet })),
    ...automationCliSnippets
      .filter((entry) => !entry.found)
      .map((entry) => ({ type: "missing_automation_cli_snippet", subject: entry.snippet })),
  ];

  return {
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    rootDir,
    files: fileChecks,
    packageScripts,
    docSnippets,
    signerCliSnippets,
    automationCliSnippets,
    failures,
  };
}

function main() {
  const result = checkMetricsCollection();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
