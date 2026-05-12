#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_RELEASE_SCRIPTS = Object.freeze([
  "release:dry-run",
  "check",
  "test",
  "status:dashboard:light",
  "report:strategy-tick-slice",
  "dashboard:build",
  "verify:dashboard-publish",
  "deploy:dashboard:cloudflare",
]);

export const RELEASE_WORKFLOW_FILES = Object.freeze([".github/workflows/release-automation.yml"]);

const REQUIRED_SECRETS = Object.freeze(["CLOUDFLARE_API_TOKEN"]);
const OPTIONAL_ENV = Object.freeze(["CLOUDFLARE_ACCOUNT_ID", "BOB_CLAW_CF_PAGES_PROJECT"]);

function hasScript(packageJson, scriptName) {
  return typeof packageJson?.scripts?.[scriptName] === "string" && packageJson.scripts[scriptName].trim();
}

function buildRequiredScripts(packageJson) {
  return REQUIRED_RELEASE_SCRIPTS.map((name) => ({
    name,
    present: Boolean(hasScript(packageJson, name)),
    command: packageJson?.scripts?.[name] || null,
  }));
}

export function buildReleaseDryRunPlan({ packageJson, workflowFiles = [], now = new Date().toISOString() } = {}) {
  const requiredScripts = buildRequiredScripts(packageJson);
  const blockers = [];
  const matchedWorkflows = workflowFiles.filter((file) => RELEASE_WORKFLOW_FILES.includes(file));

  if (matchedWorkflows.length === 0) {
    blockers.push({
      code: "missing_workflow",
      detail: `Expected release workflow: ${RELEASE_WORKFLOW_FILES.join(", ")}`,
    });
  }

  for (const script of requiredScripts) {
    if (!script.present) {
      blockers.push({
        code: "missing_script",
        detail: `Missing package.json script: ${script.name}`,
      });
    }
  }

  return {
    ok: blockers.length === 0,
    schemaVersion: 1,
    checkedAt: now,
    package: {
      name: packageJson?.name || null,
      version: packageJson?.version || null,
      private: packageJson?.private === true,
    },
    releaseTarget: "dashboard-cloudflare-pages",
    publishAllowed: false,
    workflowFiles: matchedWorkflows,
    requiredScripts,
    requiredSecrets: REQUIRED_SECRETS,
    optionalEnv: OPTIONAL_ENV,
    safety: {
      releaseMode: "dry-run preflight only; publish requires workflow_dispatch on main with deploy_dashboard=true",
      noTagCreation: true,
      noGithubReleasePublish: true,
      noDockerPublish: true,
      runtimeMutation: "none",
      excludedRuntimeSurfaces: [
        "signer daemon",
        "policy engine",
        "strategy caps",
        "kill-switch state",
        "payback scheduler",
        "capital mover",
      ],
    },
    blockers,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function listWorkflowFiles(root) {
  const workflowDir = join(root, ".github", "workflows");
  try {
    const entries = await readdir(workflowDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => `.github/workflows/${entry.name}`)
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function parseArgs(argv = []) {
  return {
    json: argv.includes("--json"),
  };
}

export async function main(argv = process.argv.slice(2), { root = process.cwd(), stdout = console.log } = {}) {
  const args = parseArgs(argv);
  const packageJson = await readJson(join(root, "package.json"));
  const workflowFiles = await listWorkflowFiles(root);
  const plan = buildReleaseDryRunPlan({ packageJson, workflowFiles });

  if (args.json) {
    stdout(JSON.stringify(plan, null, 2));
  } else {
    stdout(`release dry-run: ${plan.ok ? "ok" : "blocked"}`);
    stdout(`target: ${plan.releaseTarget}`);
    stdout(`workflow: ${plan.workflowFiles.join(", ") || "missing"}`);
    stdout(`publishAllowed: ${plan.publishAllowed}`);
    for (const blocker of plan.blockers) {
      stdout(`blocker: ${blocker.code} ${blocker.detail}`);
    }
  }

  if (!plan.ok) process.exitCode = 1;
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
