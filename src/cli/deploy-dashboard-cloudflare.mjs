#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DASHBOARD_DIR = resolve(ROOT, "dashboard/public");
const LOCAL_CF_HOME = resolve(ROOT, ".cloudflare/home");
const LOCAL_CF_XDG = resolve(ROOT, ".cloudflare/xdg");

function getEnv(name, fallback = null) {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function parseArgs(argv) {
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
    projectName: options["project-name"] || getEnv("BOB_CLAW_CF_PAGES_PROJECT"),
    productionBranch: options["production-branch"] || getEnv("BOB_CLAW_CF_PRODUCTION_BRANCH", "main"),
  };
}

function assertRequiredEnv(name) {
  if (!getEnv(name)) {
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertRequiredEnv("CLOUDFLARE_API_TOKEN");
  if (!args.projectName) {
    throw new Error("BOB_CLAW_CF_PAGES_PROJECT or --project-name is required");
  }

  await mkdir(LOCAL_CF_HOME, { recursive: true });
  await mkdir(LOCAL_CF_XDG, { recursive: true });

  const env = {
    ...process.env,
    HOME: LOCAL_CF_HOME,
    XDG_CONFIG_HOME: LOCAL_CF_XDG,
  };

  if (!args.skipStatus) {
    await run("node", ["src/cli/status-dashboard.mjs"], env);
  }

  if (args.createProject) {
    await run(
      "wrangler",
      ["pages", "project", "create", args.projectName, "--production-branch", args.productionBranch],
      env,
    );
  }

  await run(
    "wrangler",
    ["pages", "deploy", DASHBOARD_DIR, "--project-name", args.projectName, "--branch", args.productionBranch],
    env,
  );

  const url = `https://${args.projectName}.pages.dev`;
  console.log(`Deployed to ${url}`);
  console.log(`Verify cache headers: curl -I ${url}/dashboard-status.json`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
