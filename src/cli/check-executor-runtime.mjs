#!/usr/bin/env node

import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { collectExecutorRuntimeReadiness } from "../runtime/executor-runtime-readiness.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

export function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    strict: flags.has("--strict"),
  };
}

function printSecretFileStatus(label, status) {
  console.log(
    `${label}=present:${status.present} exists:${status.fileExists} secure:${status.securePermissions ?? "n/a"} mode:${status.mode || "n/a"} path:${status.pathDisplay || "n/a"}`,
  );
}

function printLaunchdStatus(status) {
  console.log(
    `launchd:${status.id}=status:${status.status} loaded:${status.loaded} running:${status.running} pid:${status.pid ?? "n/a"} plist:${status.plistPresent} label:${status.label}`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await collectExecutorRuntimeReadiness();
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`ready=${report.summary.ready}`);
    console.log(`envReady=${report.summary.envReady}`);
    console.log(`launchdConfigured=${report.summary.launchdConfigured}`);
    console.log(`launchdLoaded=${report.summary.launchdLoaded}`);
    console.log(`runtimeHealthy=${report.summary.runtimeHealthy}`);
    console.log(`nextAction=${report.summary.nextActionCode}`);
    if (report.summary.nextActionCommand) console.log(`nextActionCommand=${report.summary.nextActionCommand}`);
    console.log(`policyNote=${report.summary.policyNote}`);
    console.log(`envFile=present:${report.env.envFile.present} path:${report.env.envFile.pathDisplay}`);
    console.log(
      `paybackDestination=present:${report.env.required.paybackDestination.present} value:${report.env.required.paybackDestination.maskedValue || "n/a"}`,
    );
    printSecretFileStatus("evmKeyPath", report.env.required.evmKeyPath);
    printSecretFileStatus("btcKeyPath", report.env.required.btcKeyPath);
    console.log(
      `killSwitch=present:${report.env.required.killSwitchPath.present} parentDir:${report.env.required.killSwitchPath.parentDirPresent} file:${report.env.required.killSwitchPath.filePresent} path:${report.env.required.killSwitchPath.pathDisplay || "n/a"}`,
    );
    console.log(`heartbeatPath=${report.env.derived.heartbeatPath.pathDisplay}`);
    console.log(`signerSocketPath=${report.env.derived.signerSocketPath.pathDisplay}`);
    console.log(
      `runtime=status:${report.runtime.runtimeStatus} signer:${report.runtime.signerStatus} watchdog:${report.runtime.watchdog?.status || "unknown"} socket:${report.runtime.signerSocketPresent}`,
    );
    for (const status of report.launchd) {
      printLaunchdStatus(status);
    }
  }

  if (args.strict && !report.summary.ready) {
    process.exitCode = 1;
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
