#!/usr/bin/env node
// Launchd manager for alpha-to-canary bridge cadence (every 4h).

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { homedir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  defaultLaunchAgentsDir,
  defaultLaunchdLogDir,
  renderLaunchAgentPlist,
  writeTextIfChanged,
} from "../runtime/launchd.mjs";
import { resolveNodeExecutable } from "../runtime/node-path.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    install: flags.has("--install"),
    print: flags.has("--print"),
    json: flags.has("--json"),
    rootDir: process.cwd(),
    nodePath: resolveNodeExecutable(),
    launchAgentsDir: defaultLaunchAgentsDir(),
    logDir: defaultLaunchdLogDir(process.cwd()),
  };
}

function buildSpec(options) {
  const label = "com.bobclaw.alpha-to-canary-bridge";
  return {
    id: "alpha-to-canary-bridge",
    label,
    description: "BOB Claw alpha-to-canary bridge cadence",
    scriptPath: resolve(options.rootDir, "src/cli/run-alpha-to-canary-bridge.mjs"),
    plistPath: resolve(options.launchAgentsDir, `${label}.plist`),
    stdoutPath: resolve(options.logDir, "alpha-to-canary-bridge.out.log"),
    stderrPath: resolve(options.logDir, "alpha-to-canary-bridge.err.log"),
    workingDirectory: resolve(options.rootDir),
    programArguments: [
      resolve(options.nodePath),
      resolve(options.rootDir, "src/cli/run-alpha-to-canary-bridge.mjs"),
      "--json",
      "--write",
    ],
    environmentVariables: {
      PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      HOME: process.env.HOME || homedir(),
    },
    runAtLoad: true,
    keepAlive: false,
    startInterval: 14_400, // 4 hours
    throttleInterval: 60,
    processType: "Background",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const spec = buildSpec(args);

  if (args.print) {
    const plist = renderLaunchAgentPlist(spec);
    if (args.json) {
      console.log(JSON.stringify({ spec, plist }, null, 2));
      return;
    }
    console.log(plist);
    return;
  }

  const writeResult = await writeTextIfChanged(spec.plistPath, renderLaunchAgentPlist(spec));
  if (args.json) {
    console.log(JSON.stringify({ spec, changed: writeResult.changed }, null, 2));
    return;
  }

  console.log(`plist=${spec.plistPath} changed=${writeResult.changed}`);

  if (args.install) {
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    if (!Number.isInteger(uid)) {
      console.error("install requires numeric uid");
      process.exitCode = 1;
      return;
    }
    spawnSync("launchctl", ["bootout", `gui/${uid}/${spec.label}`], { encoding: "utf8" });
    spawnSync("launchctl", ["bootstrap", `gui/${uid}`, spec.plistPath], { encoding: "utf8" });
    console.log(`installed=${spec.label}`);
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
