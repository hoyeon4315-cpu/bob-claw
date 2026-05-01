#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  buildDashboardLaunchAgentSpecs,
  defaultLaunchctlRunner,
  readLaunchAgentStatus,
  renderLaunchAgentPlist,
  writeDashboardLaunchAgents,
} from "../runtime/launchd.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...parts] = item.slice(2).split("=");
        return [key, parts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    print: flags.has("--print"),
    write: flags.has("--write"),
    install: flags.has("--install"),
    status: flags.has("--status"),
    rootDir: options["root-dir"] || process.cwd(),
    nodePath: options["node-path"] || process.execPath,
    launchAgentsDir: options["launch-agents-dir"],
    logDir: options["log-dir"],
    uid: options.uid ? Number(options.uid) : (typeof process.getuid === "function" ? process.getuid() : null),
  };
}

function launchctl(args) {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null,
  };
}

function actionFromArgs(args) {
  if (args.install) return "install";
  if (args.status) return "status";
  if (args.print) return "print";
  if (args.write) return "write";
  return "write";
}

function toleratedBootoutFailure(output = "") {
  return /Could not find service|service could not be found|No such process/i.test(output);
}

export function retryableBootstrapFailure(output = "") {
  return /Bootstrap failed:\s*5|Input\/output error/i.test(output);
}

function runLaunchctlOrThrow(args, { tolerateNotLoaded = false } = {}) {
  const result = launchctl(args);
  if (result.error) throw result.error;
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (result.status !== 0 && !(tolerateNotLoaded && toleratedBootoutFailure(combined))) {
    throw new Error(`launchctl ${args.join(" ")} failed: ${combined || `exit ${result.status}`}`);
  }
  return {
    ...result,
    combined,
  };
}

async function collectStatus(specs, uid) {
  return Promise.all(
    specs.map((spec) =>
      readLaunchAgentStatus(spec, {
        uid,
        launchctlRunner: defaultLaunchctlRunner,
      }),
    ),
  );
}

async function installSpecs(specs, uid) {
  if (!Number.isInteger(uid)) {
    throw new Error("launchd install requires a numeric macOS user id");
  }
  const operations = [];
  for (const spec of specs) {
    operations.push({
      id: spec.id,
      step: "bootout",
      ...runLaunchctlOrThrow(["bootout", `gui/${uid}/${spec.label}`], { tolerateNotLoaded: true }),
    });
    await delay(1000);
    try {
      operations.push({
        id: spec.id,
        step: "bootstrap",
        ...runLaunchctlOrThrow(["bootstrap", `gui/${uid}`, spec.plistPath]),
      });
    } catch (error) {
      if (!retryableBootstrapFailure(error.message)) throw error;
      await delay(1500);
      operations.push({
        id: spec.id,
        step: "bootstrap_retry",
        ...runLaunchctlOrThrow(["bootstrap", `gui/${uid}`, spec.plistPath]),
      });
    }
    operations.push({
      id: spec.id,
      step: "kickstart",
      ...runLaunchctlOrThrow(["kickstart", "-k", `gui/${uid}/${spec.label}`]),
    });
  }
  return operations;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const action = actionFromArgs(args);
  const specOptions = {
    rootDir: args.rootDir,
    nodePath: args.nodePath,
    ...(args.launchAgentsDir ? { launchAgentsDir: args.launchAgentsDir } : {}),
    ...(args.logDir ? { logDir: args.logDir } : {}),
  };
  const specs = buildDashboardLaunchAgentSpecs(specOptions);

  if (action === "print") {
    const payload = specs.map((spec) => ({
      id: spec.id,
      label: spec.label,
      plistPath: spec.plistPath,
      plist: renderLaunchAgentPlist(spec),
    }));
    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    for (const item of payload) {
      console.log(`### ${item.id} (${item.label}) -> ${item.plistPath}`);
      process.stdout.write(item.plist);
    }
    return;
  }

  let writeResult = null;
  if (action === "write" || action === "install") {
    writeResult = await writeDashboardLaunchAgents(specOptions);
  }

  let installOperations = null;
  if (action === "install") {
    installOperations = await installSpecs(specs, args.uid);
  }

  const statuses = action === "status" || action === "install"
    ? await collectStatus(specs, args.uid)
    : null;

  const payload = {
    action,
    writes: writeResult?.writes || [],
    installOperations,
    statuses,
  };
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`action=${action}`);
  for (const write of payload.writes) {
    console.log(`write:${write.id}=changed:${write.changed} plist:${write.plistPath}`);
  }
  for (const operation of payload.installOperations || []) {
    console.log(`install:${operation.id}:${operation.step}=exit:${operation.status}`);
  }
  for (const status of payload.statuses || []) {
    console.log(`status:${status.id}=state:${status.status} loaded:${status.loaded} running:${status.running} pid:${status.pid ?? "n/a"} plist:${status.plistPresent}`);
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
