#!/usr/bin/env node
// Fix dashboard publisher: serve-only mode + separate refresh job.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { homedir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  defaultLaunchAgentsDir,
  defaultLaunchdLogDir,
  renderLaunchAgentPlist,
} from "../runtime/launchd.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { resolveNodeExecutable } from "../runtime/node-path.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    install: flags.has("--install"),
    json: flags.has("--json"),
    rootDir: process.cwd(),
    nodePath: resolveNodeExecutable(),
    launchAgentsDir: defaultLaunchAgentsDir(),
    logDir: defaultLaunchdLogDir(process.cwd()),
  };
}

function buildSpecs(options) {
  const sharedEnv = {
    PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    HOME: process.env.HOME || homedir(),
  };

  return [
    {
      id: "dashboard-public-live",
      label: "com.bobclaw.dashboard-public-live",
      description: "BOB Claw dashboard public live server (serve-only)",
      scriptPath: resolve(options.rootDir, "src/cli/run-dashboard-public-live.mjs"),
      plistPath: resolve(options.launchAgentsDir, "com.bobclaw.dashboard-public-live.plist"),
      stdoutPath: resolve(options.logDir, "dashboard-public-live.out.log"),
      stderrPath: resolve(options.logDir, "dashboard-public-live.err.log"),
      workingDirectory: resolve(options.rootDir),
      programArguments: [
        resolve(options.nodePath),
        resolve(options.rootDir, "src/cli/run-dashboard-public-live.mjs"),
        "--no-refresh",
      ],
      environmentVariables: sharedEnv,
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 10,
      processType: "Background",
    },
    {
      id: "dashboard-refresh",
      label: "com.bobclaw.dashboard-refresh",
      description: "BOB Claw dashboard status refresh (skip slow canary inputs)",
      scriptPath: resolve(options.rootDir, "src/cli/status-dashboard.mjs"),
      plistPath: resolve(options.launchAgentsDir, "com.bobclaw.dashboard-refresh.plist"),
      stdoutPath: resolve(options.logDir, "dashboard-refresh.out.log"),
      stderrPath: resolve(options.logDir, "dashboard-refresh.err.log"),
      workingDirectory: resolve(options.rootDir),
      programArguments: [
        resolve(options.nodePath),
        resolve(options.rootDir, "src/cli/status-dashboard.mjs"),
        "--skip-canary-input-refresh",
        "--skip-shadow-cycle",
        "--commit-public",
      ],
      environmentVariables: sharedEnv,
      runAtLoad: true,
      keepAlive: false,
      startInterval: 60,
      throttleInterval: 30,
      processType: "Background",
    },
  ];
}

async function main() {
  const args = parseArgs();
  const specs = buildSpecs(args);

  const writes = [];
  for (const spec of specs) {
    const result = await writeTextIfChanged(spec.plistPath, renderLaunchAgentPlist(spec));
    writes.push({ id: spec.id, changed: result.changed, plistPath: spec.plistPath });
  }

  if (args.json) {
    console.log(JSON.stringify({ writes }, null, 2));
    return;
  }

  for (const w of writes) {
    console.log(`write:${w.id}=changed:${w.changed}`);
  }

  if (args.install) {
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    if (!Number.isInteger(uid)) {
      console.error("install requires numeric uid");
      process.exitCode = 1;
      return;
    }
    for (const spec of specs) {
      spawnSync("launchctl", ["bootout", `gui/${uid}/${spec.label}`], { encoding: "utf8" });
      spawnSync("launchctl", ["bootstrap", `gui/${uid}`, spec.plistPath], { encoding: "utf8" });
      console.log(`installed=${spec.label}`);
    }
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
