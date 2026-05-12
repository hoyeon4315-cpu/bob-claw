import { resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const KNIP_BIN_PATH = resolve(ROOT_DIR, "node_modules/knip/bin/knip.js");
const IGNORED_ISSUE_KEYS = new Set([
  // Local Playwright scratch helpers are tracked for manual verification only, not repo-supported entrypoints.
  "unlisted dependency:deploy-verify.cjs:playwright",
  "unlisted dependency:test-local.cjs:playwright",
  "unlisted dependency:test-local2.cjs:playwright",
]);

function stableIssueKey(issue) {
  return `${issue.kind}:${issue.file}:${issue.name}`;
}

function sortIssues(issues) {
  return [...issues].sort((left, right) => stableIssueKey(left).localeCompare(stableIssueKey(right)));
}

function collectDependencyIssues(entry, file, propertyName, kind) {
  return (entry?.[propertyName] ?? [])
    .map((dependency) => String(dependency?.name || "").trim())
    .filter(Boolean)
    .map((name) => ({ kind, file, name }));
}

export function normalizeKnipDependencyIssues(report) {
  const entries = Array.isArray(report?.issues) ? report.issues : [];
  const normalized = [];

  for (const entry of entries) {
    const file = String(entry?.file || "").trim();
    if (!file) continue;
    normalized.push(
      ...collectDependencyIssues(entry, file, "dependencies", "unused dependency"),
      ...collectDependencyIssues(entry, file, "devDependencies", "unused devDependency"),
      ...collectDependencyIssues(entry, file, "optionalPeerDependencies", "unused optionalPeerDependency"),
      ...collectDependencyIssues(entry, file, "unlisted", "unlisted dependency"),
    );
  }

  return sortIssues(
    normalized.filter(
      (issue, index, collection) =>
        collection.findIndex((candidate) => stableIssueKey(candidate) === stableIssueKey(issue)) === index,
    ),
  );
}

export function filterIgnoredIssues(issues) {
  return issues.filter((issue) => !IGNORED_ISSUE_KEYS.has(stableIssueKey(issue)));
}

function runKnipDependencyCheck() {
  const result = spawnSync(
    process.execPath,
    [KNIP_BIN_PATH, "--no-progress", "--include", "dependencies,unlisted", "--reporter", "json", "--no-exit-code"],
    {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `knip exited with status ${result.status}`);
  }

  return JSON.parse(result.stdout || '{"issues":[]}');
}

function printIssues(issues) {
  for (const issue of issues) {
    console.error(`${issue.kind}: ${issue.name} (${issue.file})`);
  }
}

function main() {
  const issues = filterIgnoredIssues(normalizeKnipDependencyIssues(runKnipDependencyCheck()));

  if (issues.length > 0) {
    printIssues(issues);
    console.error(`Unused dependency check failed: ${issues.length} issue(s) detected by knip.`);
    process.exitCode = 1;
    return;
  }

  console.log("Unused dependency check passed: 0 issues detected by knip.");
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
