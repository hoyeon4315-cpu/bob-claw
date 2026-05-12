import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASELINE_PATH = resolve(ROOT_DIR, "docs/readiness/dead-code-baseline.json");
const KNIP_BIN_PATH = resolve(ROOT_DIR, "node_modules/knip/bin/knip.js");

export function normalizeKnipFileIssues(report) {
  const issues = Array.isArray(report?.issues) ? report.issues : [];
  return [...new Set(issues.map((issue) => String(issue?.file || "").trim()).filter(Boolean))].sort();
}

export function readBaselineIssues(sourceText) {
  const parsed = JSON.parse(sourceText);
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  return [...new Set(issues.map((issue) => String(issue?.path || "").trim()).filter(Boolean))].sort();
}

export function compareIssueSets({ baselineIssues = [], currentIssues = [] } = {}) {
  const baselineSet = new Set(baselineIssues);
  const currentSet = new Set(currentIssues);
  const newIssues = currentIssues.filter((issue) => !baselineSet.has(issue));
  const resolvedIssues = baselineIssues.filter((issue) => !currentSet.has(issue));
  const unchangedIssues = currentIssues.filter((issue) => baselineSet.has(issue));
  return {
    newIssues,
    resolvedIssues,
    unchangedIssues,
  };
}

function printCompactIssues(issues) {
  for (const issue of issues) console.log(`${issue}: ${issue}`);
}

function runKnipFileCheck() {
  const result = spawnSync(
    process.execPath,
    [KNIP_BIN_PATH, "--no-progress", "--include", "files", "--reporter", "json", "--no-exit-code"],
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

function main() {
  const baselineIssues = readBaselineIssues(readFileSync(BASELINE_PATH, "utf8"));
  const currentIssues = normalizeKnipFileIssues(runKnipFileCheck());
  const { newIssues, resolvedIssues, unchangedIssues } = compareIssueSets({
    baselineIssues,
    currentIssues,
  });

  printCompactIssues(currentIssues);

  if (newIssues.length > 0) {
    console.error(
      `Dead-code backlog regressed: ${newIssues.length} new unused-file candidate(s) exceeded the audited baseline in docs/readiness/dead-code-baseline.json.`,
    );
    process.exitCode = 1;
    return;
  }

  const resolvedCount = resolvedIssues.length;
  const unchangedCount = unchangedIssues.length;
  console.log(
    `Dead-code baseline check passed: ${unchangedCount} audited backlog item(s) remain, ${resolvedCount} baseline item(s) no longer reproduce.`,
  );
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
