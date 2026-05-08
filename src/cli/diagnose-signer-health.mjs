#!/usr/bin/env node

import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { diagnoseSignerHealth } from "../executor/signer/health-check.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

export function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
  };
}

function printText(report) {
  console.log(`cause=${report.cause}`);
  console.log(`readiness.readyForBroadcast=${report.readiness?.readyForBroadcast}`);
  console.log(`readiness.telemetryComplete=${report.readiness?.telemetryComplete}`);
  console.log(`readiness.limitations=${report.readiness?.limitations?.length ? report.readiness.limitations.join(",") : "none"}`);
  console.log(`process.daemonRunning=${report.process.daemonRunning}`);
  console.log(`process.watchdogRunning=${report.process.watchdogRunning}`);
  console.log(`heartbeat.status=${report.heartbeat.status}`);
  console.log(`heartbeat.ageMs=${report.heartbeat.ageMs ?? "n/a"}`);
  console.log(`socket.ok=${report.socket.ok}`);
  console.log(`btcRpc.ok=${report.btcRpc.ok}`);
  const failedRpc = (report.rpc.chains || []).filter((item) => !item.ok).map((item) => item.chain);
  console.log(`evmRpc.failed=${failedRpc.length ? failedRpc.join(",") : "none"}`);
  console.log(`nonceManagers.ok=${report.nonceManagers.ok}`);
  console.log(`signerAudit.lastStage=${report.signerAudit.lastStage || "n/a"}`);
  console.log(`signerAudit.lastTimestamp=${report.signerAudit.lastTimestamp || "n/a"}`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = await diagnoseSignerHealth();
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }
  return report;
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
