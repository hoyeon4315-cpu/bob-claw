import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DOC_PATH = "docs/readiness/deployment-observability.md";
const WORKFLOW_PATH = ".github/workflows/deploy-dashboard-cloudflare.yml";
const PR_WORKFLOW_PATH = ".github/workflows/auto-pr-validate.yml";
const PACKAGE_PATH = "package.json";
const ENV_CONFIG_PATH = "src/config/env.mjs";
const TELEGRAM_CONFIG_PATH = "src/config/telegram.mjs";
const TELEGRAM_HELPER_PATH = "src/notify/telegram.mjs";
const LIVE_RUNTIME_PATH = "src/dashboard/live-server.mjs";

const REQUIRED_FILES = Object.freeze([
  DOC_PATH,
  WORKFLOW_PATH,
  PR_WORKFLOW_PATH,
  PACKAGE_PATH,
  ENV_CONFIG_PATH,
  TELEGRAM_CONFIG_PATH,
  TELEGRAM_HELPER_PATH,
  LIVE_RUNTIME_PATH,
  "src/cli/status-dashboard.mjs",
  "src/cli/verify-dashboard-publish.mjs",
  "src/cli/deploy-dashboard-cloudflare.mjs",
  "src/cli/run-dashboard-public-live.mjs",
  "src/cli/deploy-dashboard-public-live.mjs",
]);

const REQUIRED_PACKAGE_SCRIPTS = Object.freeze([
  "dashboard:build",
  "status:dashboard",
  "verify:dashboard-publish",
  "deploy:dashboard:cloudflare",
  "dashboard:public:run",
  "dashboard:public:launchd:status",
  "watch:gateway-updates",
]);

const REQUIRED_WORKFLOW_SNIPPETS = Object.freeze([
  "name: dashboard-production",
  "npm run dashboard:build",
  "npm run status:dashboard -- --commit-public",
  "npm run verify:dashboard-publish",
  "npm run deploy:dashboard:cloudflare",
  "dashboard-status.json",
  "pages.dev",
]);

const REQUIRED_PR_WORKFLOW_SNIPPETS = Object.freeze([
  "GITHUB_STEP_SUMMARY",
  "build-performance-tracking",
  "actions/upload-artifact@v4",
]);

const REQUIRED_DOC_SNIPPETS = Object.freeze([
  ".github/workflows/deploy-dashboard-cloudflare.yml",
  "npm run dashboard:build",
  "npm run status:dashboard -- --commit-public",
  "npm run verify:dashboard-publish",
  "npm run deploy:dashboard:cloudflare -- --skip-status",
  "dashboard/public/dashboard-status.json",
  "dashboard/public/live-runtime.json",
  "src/notify/telegram.mjs",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "transaction_only",
  "data/dashboard-live-runtime.json",
]);

function readText(relativePath, rootDir = ROOT_DIR) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

function hasText(haystack, needle) {
  return String(haystack).includes(needle);
}

function checkRequiredFiles(rootDir = ROOT_DIR) {
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

export function checkDeploymentObservability({ rootDir = ROOT_DIR } = {}) {
  const fileChecks = checkRequiredFiles(rootDir);
  const packageText = readText(PACKAGE_PATH, rootDir);
  const workflowText = readText(WORKFLOW_PATH, rootDir);
  const prWorkflowText = readText(PR_WORKFLOW_PATH, rootDir);
  const docText = readText(DOC_PATH, rootDir);
  const envConfigText = readText(ENV_CONFIG_PATH, rootDir);
  const telegramConfigText = readText(TELEGRAM_CONFIG_PATH, rootDir);

  const packageScripts = checkPackageScripts(packageText);
  const workflowSnippets = checkSnippets(workflowText, REQUIRED_WORKFLOW_SNIPPETS, "workflow");
  const prWorkflowSnippets = checkSnippets(prWorkflowText, REQUIRED_PR_WORKFLOW_SNIPPETS, "pr_workflow");
  const docSnippets = checkSnippets(docText, REQUIRED_DOC_SNIPPETS, "doc");
  const envChecks = [
    { name: "TELEGRAM_BOT_TOKEN", found: hasText(envConfigText, 'getEnv("TELEGRAM_BOT_TOKEN"') },
    { name: "TELEGRAM_CHAT_ID", found: hasText(envConfigText, 'getEnv("TELEGRAM_CHAT_ID"') },
    {
      name: 'TELEGRAM_ALERT_MODE="transaction_only"',
      found: hasText(telegramConfigText, 'export const TELEGRAM_ALERT_MODE = "transaction_only"'),
    },
  ];

  const failures = [
    ...fileChecks.filter((entry) => !entry.exists).map((entry) => ({ type: "missing_file", subject: entry.path })),
    ...packageScripts
      .filter((entry) => !entry.exists)
      .map((entry) => ({ type: "missing_package_script", subject: entry.name })),
    ...workflowSnippets
      .filter((entry) => !entry.found)
      .map((entry) => ({ type: "missing_workflow_snippet", subject: entry.snippet })),
    ...prWorkflowSnippets
      .filter((entry) => !entry.found)
      .map((entry) => ({ type: "missing_pr_workflow_snippet", subject: entry.snippet })),
    ...docSnippets
      .filter((entry) => !entry.found)
      .map((entry) => ({ type: "missing_doc_reference", subject: entry.snippet })),
    ...envChecks
      .filter((entry) => !entry.found)
      .map((entry) => ({ type: "missing_env_reference", subject: entry.name })),
  ];

  return {
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    rootDir,
    files: fileChecks,
    packageScripts,
    workflowSnippets,
    prWorkflowSnippets,
    docSnippets,
    envChecks,
    failures,
  };
}

function main() {
  const result = checkDeploymentObservability();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
