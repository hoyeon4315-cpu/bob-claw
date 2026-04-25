#!/usr/bin/env node

import process from "node:process";
import { readFile } from "node:fs/promises";
import { getEnv } from "../config/env.mjs";
import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";
import { runAutoKillCheck } from "../risk/auto-kill-events.mjs";
import { buildAutoKillConfig } from "../config/auto-kill.mjs";

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
    killSwitchPath: options["kill-switch-path"] || getEnv("KILL_SWITCH_PATH", null),
    heartbeatPath: options["heartbeat-path"] || getEnv("EXECUTOR_HEARTBEAT_PATH", null),
    oraclesPath: options["oracles-path"] || null,
    operatingCapitalUsd: options["operating-capital-usd"]
      ? Number(options["operating-capital-usd"])
      : null,
  };
}

async function readJsonIfExists(path) {
  if (!path) return null;
  try {
    const contents = await readFile(path, "utf8");
    return JSON.parse(contents);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const auditRecords = await readSignerAuditLog();
  const heartbeatPayload = await readJsonIfExists(args.heartbeatPath);
  const heartbeatAtMs = heartbeatPayload?.observedAtMs
    || (heartbeatPayload?.observedAt ? new Date(heartbeatPayload.observedAt).getTime() : null);
  const oraclePayload = await readJsonIfExists(args.oraclesPath);
  const oracleSamples = Array.isArray(oraclePayload?.samples) ? oraclePayload.samples : [];

  const result = await runAutoKillCheck({
    auditRecords,
    oracleSamples,
    heartbeatAtMs,
    operatingCapitalUsd: args.operatingCapitalUsd,
    config: buildAutoKillConfig(),
    killSwitchPath: args.killSwitchPath,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`triggered=${result.triggered}`);
    if (result.triggered) {
      console.log(`killSwitchWritten=${result.killSwitchWritten} alreadyArmed=${result.alreadyArmed}`);
      for (const trigger of result.triggers) {
        console.log(`  - ${trigger.trigger}`);
      }
    }
  }
  if (result.triggered && !result.alreadyArmed) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
