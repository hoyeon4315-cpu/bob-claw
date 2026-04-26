#!/usr/bin/env node

import {
  buildGitOpsPlan,
  defaultRunGitCommand,
  DEFAULT_GIT_OPS_EXCLUDE_PATHS,
  parseGitStatus,
} from "../session/git-ops-automation.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    includePaths: options.include ? options.include.split(",").map((item) => item.trim()).filter(Boolean) : [],
    excludePaths: options.exclude ? options.exclude.split(",").map((item) => item.trim()).filter(Boolean) : DEFAULT_GIT_OPS_EXCLUDE_PATHS,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [branchResult, statusResult] = await Promise.all([
    defaultRunGitCommand({ args: ["branch", "--show-current"] }),
    defaultRunGitCommand({ args: ["status", "--short"] }),
  ]);
  if (!branchResult.ok) throw new Error(branchResult.stderr || "git_branch_failed");
  if (!statusResult.ok) throw new Error(statusResult.stderr || "git_status_failed");
  const plan = buildGitOpsPlan({
    branch: branchResult.stdout.trim(),
    statusEntries: parseGitStatus(statusResult.stdout),
    includePaths: args.includePaths,
    excludePaths: args.excludePaths,
  });

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`branch=${plan.branch || "detached"}`);
  console.log(`commitReady=${plan.commitReady}`);
  console.log(`pushReady=${plan.pushReady}`);
  console.log(`includedPaths=${plan.includedPathCount}`);
  console.log(`excludedPaths=${plan.excludedPathCount}`);
  console.log(`generatedArtifacts=${plan.generatedArtifactPaths.join(",") || "none"}`);
  for (const path of plan.includedPaths) console.log(`include=${path}`);
  for (const path of plan.excludedPaths) console.log(`exclude=${path}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
