#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DASHBOARD_DIR = resolve(ROOT, "dashboard/public");
const LOCAL_CF_HOME = resolve(ROOT, ".cloudflare/home");
const LOCAL_CF_XDG = resolve(ROOT, ".cloudflare/xdg");
const CLOUDFLARE_API_ROOT = "https://api.cloudflare.com/client/v4";
const DEFAULT_PAGES_PROJECT = "bob-claw-dashboard";
const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function getEnv(name, fallback = null, env = process.env) {
  const value = env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function parseArgs(argv, env = process.env) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--") && !arg.includes("=")));
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...value] = arg.slice(2).split("=");
        return [key, value.join("=")];
      }),
  );

  return {
    createProject: flags.has("--create-project"),
    skipStatus: flags.has("--skip-status"),
    projectName: options["project-name"] || getEnv("BOB_CLAW_CF_PAGES_PROJECT", null, env),
    productionBranch: options["production-branch"] || getEnv("BOB_CLAW_CF_PRODUCTION_BRANCH", "main", env),
  };
}

function assertRequiredEnv(name, env = process.env) {
  if (!getEnv(name, null, env)) {
    throw new Error(`${name} is required`);
  }
}

function run(command, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: "inherit",
    });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

async function requestCloudflareApi(path, { apiToken, fetchFn = globalThis.fetch }) {
  if (typeof fetchFn !== "function") {
    throw new Error("Cloudflare discovery requires fetch support");
  }
  const response = await fetchFn(`${CLOUDFLARE_API_ROOT}${path}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });
  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    const details = Array.isArray(payload?.errors)
      ? payload.errors.map((entry) => entry?.message || JSON.stringify(entry)).join("; ")
      : `HTTP ${response.status}`;
    throw new Error(`Cloudflare API request failed for ${path}: ${details}`);
  }
  return payload;
}

async function listCloudflareAccounts({ apiToken, fetchFn }) {
  const accounts = [];
  let page = 1;
  while (true) {
    const payload = await requestCloudflareApi(`/accounts?page=${page}&per_page=100`, { apiToken, fetchFn });
    const batch = Array.isArray(payload?.result) ? payload.result : [];
    accounts.push(...batch);
    const totalPages = Math.max(1, Number(payload?.result_info?.total_pages || 1));
    if (page >= totalPages || batch.length === 0) {
      return accounts;
    }
    page += 1;
  }
}

async function listCloudflarePagesProjects({ accountId, apiToken, fetchFn }) {
  const payload = await requestCloudflareApi(`/accounts/${accountId}/pages/projects`, {
    apiToken,
    fetchFn,
  });
  return Array.isArray(payload?.result) ? payload.result : [];
}

function describeProjectCandidate(candidate) {
  const accountLabel = candidate.accountName ? `${candidate.accountName} (${candidate.accountId})` : candidate.accountId;
  return `${candidate.projectName} @ ${accountLabel}`;
}

function buildProjectSelectionError(reason, candidates) {
  const suffix =
    candidates.length > 0
      ? ` Candidates: ${candidates.map((candidate) => describeProjectCandidate(candidate)).join(", ")}.`
      : "";
  return new Error(
    `${reason}.${suffix} Set BOB_CLAW_CF_PAGES_PROJECT/--project-name to choose explicitly.`,
  );
}

function buildAccountSelectionError(reason, accounts) {
  const suffix =
    accounts.length > 0
      ? ` Accounts: ${accounts.map((account) => `${account.name || "unnamed"} (${account.id})`).join(", ")}.`
      : "";
  return new Error(`${reason}.${suffix} Set CLOUDFLARE_ACCOUNT_ID to choose explicitly.`);
}

function selectExistingProject(candidates, requestedProjectName) {
  if (requestedProjectName) {
    const exactMatches = candidates.filter((candidate) => candidate.projectName === requestedProjectName);
    if (exactMatches.length === 1) {
      return { candidate: exactMatches[0], projectSource: "explicit" };
    }
    if (exactMatches.length > 1) {
      throw buildProjectSelectionError(
        `Pages project "${requestedProjectName}" matched multiple Cloudflare accounts`,
        exactMatches,
      );
    }
    return null;
  }

  const defaultMatches = candidates.filter((candidate) => candidate.projectName === DEFAULT_PAGES_PROJECT);
  if (defaultMatches.length === 1) {
    return { candidate: defaultMatches[0], projectSource: "default" };
  }
  if (defaultMatches.length > 1) {
    throw buildProjectSelectionError(
      `Default Pages project "${DEFAULT_PAGES_PROJECT}" matched multiple Cloudflare accounts`,
      defaultMatches,
    );
  }
  if (candidates.length === 1) {
    return { candidate: candidates[0], projectSource: "single_candidate" };
  }
  return null;
}

export async function resolveDeployPreflight({
  args,
  env = process.env,
  fetchFn = globalThis.fetch,
} = {}) {
  const apiToken = getEnv("CLOUDFLARE_API_TOKEN", null, env);
  assertRequiredEnv("CLOUDFLARE_API_TOKEN", env);
  const explicitAccountId = getEnv("CLOUDFLARE_ACCOUNT_ID", null, env);

  if (explicitAccountId) {
    const projects = await listCloudflarePagesProjects({ accountId: explicitAccountId, apiToken, fetchFn });
    const candidates = projects.map((project) => ({
      accountId: explicitAccountId,
      accountName: null,
      projectName: project.name,
    }));
    const selected = selectExistingProject(candidates, args.projectName);
    if (selected) {
      return {
        accountId: explicitAccountId,
        accountName: null,
        accountSource: "env",
        projectName: selected.candidate.projectName,
        projectSource: selected.projectSource,
        projectExists: true,
      };
    }
    if (args.projectName && args.createProject) {
      return {
        accountId: explicitAccountId,
        accountName: null,
        accountSource: "env",
        projectName: args.projectName,
        projectSource: "explicit",
        projectExists: false,
      };
    }
    if (!args.projectName && args.createProject && candidates.length === 0) {
      return {
        accountId: explicitAccountId,
        accountName: null,
        accountSource: "env",
        projectName: DEFAULT_PAGES_PROJECT,
        projectSource: "default",
        projectExists: false,
      };
    }
    if (args.projectName) {
      throw buildProjectSelectionError(`Pages project "${args.projectName}" was not found in account ${explicitAccountId}`, candidates);
    }
    if (candidates.length === 0) {
      throw new Error(
        `No Pages projects were found in account ${explicitAccountId}. Re-run with --create-project or set BOB_CLAW_CF_PAGES_PROJECT/--project-name.`,
      );
    }
    throw buildProjectSelectionError("Unable to determine which Pages project to deploy", candidates);
  }

  const accounts = await listCloudflareAccounts({ apiToken, fetchFn });
  if (accounts.length === 0) {
    throw new Error("Cloudflare API token did not return any accessible accounts");
  }

  const accountsWithProjects = await Promise.all(
    accounts.map(async (account) => ({
      ...account,
      projects: await listCloudflarePagesProjects({ accountId: account.id, apiToken, fetchFn }),
    })),
  );
  const candidates = accountsWithProjects.flatMap((account) =>
    account.projects.map((project) => ({
      accountId: account.id,
      accountName: account.name || null,
      projectName: project.name,
    })),
  );

  const selected = selectExistingProject(candidates, args.projectName);
  if (selected) {
    return {
      accountId: selected.candidate.accountId,
      accountName: selected.candidate.accountName,
      accountSource: "api",
      projectName: selected.candidate.projectName,
      projectSource: selected.projectSource,
      projectExists: true,
    };
  }

  if (args.projectName && args.createProject) {
    if (accounts.length === 1) {
      return {
        accountId: accounts[0].id,
        accountName: accounts[0].name || null,
        accountSource: "api",
        projectName: args.projectName,
        projectSource: "explicit",
        projectExists: false,
      };
    }
    throw buildAccountSelectionError(
      `Pages project "${args.projectName}" was not found and multiple Cloudflare accounts are accessible`,
      accounts,
    );
  }

  if (!args.projectName && args.createProject) {
    if (accounts.length === 1 && candidates.length === 0) {
      return {
        accountId: accounts[0].id,
        accountName: accounts[0].name || null,
        accountSource: "api",
        projectName: DEFAULT_PAGES_PROJECT,
        projectSource: "default",
        projectExists: false,
      };
    }
    if (accounts.length > 1 && candidates.length === 0) {
      throw buildAccountSelectionError(
        `No Pages projects were found and multiple Cloudflare accounts are accessible`,
        accounts,
      );
    }
  }

  if (args.projectName) {
    throw buildProjectSelectionError(`Pages project "${args.projectName}" was not found`, candidates);
  }
  if (candidates.length === 0) {
    throw new Error("No Pages projects were found for the accessible Cloudflare accounts");
  }
  throw buildProjectSelectionError("Unable to determine which Pages project to deploy", candidates);
}

export function formatPreflightSummary({ preflight, args }) {
  const createProjectState = args.createProject
    ? preflight.projectExists
      ? "skip-existing"
      : "create"
    : "off";
  return `Cloudflare preflight: account=${preflight.accountId} (${preflight.accountSource}) project=${preflight.projectName} (${preflight.projectSource}) branch=${args.productionBranch} createProject=${createProjectState}`;
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  fetchFn = globalThis.fetch,
  runCommand = run,
  logger = console,
} = {}) {
  const args = parseArgs(argv, env);
  const preflight = await resolveDeployPreflight({ args, env, fetchFn });

  await mkdir(LOCAL_CF_HOME, { recursive: true });
  await mkdir(LOCAL_CF_XDG, { recursive: true });

  const commandEnv = {
    ...env,
    HOME: LOCAL_CF_HOME,
    XDG_CONFIG_HOME: LOCAL_CF_XDG,
  };

  logger.log(formatPreflightSummary({ preflight, args }));

  if (!args.skipStatus) {
    await runCommand("node", ["src/cli/inventory-treasury.mjs"], commandEnv);
    await runCommand("node", ["src/cli/status-dashboard.mjs"], commandEnv);
  }

  if (args.createProject && !preflight.projectExists) {
    await runCommand(
      "wrangler",
      ["pages", "project", "create", preflight.projectName, "--production-branch", args.productionBranch],
      commandEnv,
    );
  }

  await runCommand(
    "wrangler",
    ["pages", "deploy", DASHBOARD_DIR, "--project-name", preflight.projectName, "--branch", args.productionBranch],
    commandEnv,
  );

  const url = `https://${preflight.projectName}.pages.dev`;
  logger.log(`Deployed to ${url}`);
  logger.log(`Verify cache headers: curl -I ${url}/dashboard-status.json`);
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
