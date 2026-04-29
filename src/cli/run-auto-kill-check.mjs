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
    priceSamplesPath: options["price-samples-path"] || "data/price-samples.json",
    clStatusPath: options["cl-status-path"] || "data/anchor-position-health.json",
    activeProtocolsPath: options["active-protocols-path"] || "data/active-protocols.json",
    campaignStatusPath: options["campaign-status-path"] || "data/campaign-status.json",
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

function buildClStatusFromAnchorHealth(payload) {
  if (!payload || !Array.isArray(payload.positions)) return {};
  let sum = 0;
  let count = 0;
  let ilExceedsFeesHours = null;
  for (const pos of payload.positions) {
    const rawTimeInRange =
      typeof pos.timeInRange === "string"
        ? pos.timeInRange.replace("%", "")
        : pos.timeInRange;
    const v = Number(rawTimeInRange);
    if (Number.isFinite(v)) {
      sum += v > 1 ? v / 100 : v;
      count += 1;
    }
    const rawIlHours = Number(pos.ilExceedsFeesHours ?? pos.health?.ilExceedsFeesHours);
    if (Number.isFinite(rawIlHours)) {
      ilExceedsFeesHours = Math.max(ilExceedsFeesHours ?? 0, rawIlHours);
    }
  }
  const timeInRangePct24h = count > 0 ? sum / count : null;
  return { timeInRangePct24h, ilExceedsFeesHours };
}

function deriveActiveProtocols(anchorHealth) {
  if (!anchorHealth || !Array.isArray(anchorHealth.positions) || anchorHealth.positions.length === 0) {
    return [];
  }
  return ["aerodrome"];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const auditRecords = await readSignerAuditLog();
  const heartbeatPayload = await readJsonIfExists(args.heartbeatPath);
  const heartbeatAtMs = heartbeatPayload?.observedAtMs
    || (heartbeatPayload?.observedAt ? new Date(heartbeatPayload.observedAt).getTime() : null);
  const oraclePayload = await readJsonIfExists(args.oraclesPath);
  const oracleSamples = Array.isArray(oraclePayload?.samples) ? oraclePayload.samples : [];

  const priceSamplesPayload = await readJsonIfExists(args.priceSamplesPath);
  const priceSamples = Array.isArray(priceSamplesPayload)
    ? priceSamplesPayload
    : (priceSamplesPayload?.samples || []);

  const clStatusPayload = await readJsonIfExists(args.clStatusPath);
  const clStatus = buildClStatusFromAnchorHealth(clStatusPayload);

  const activeProtocolsPayload = await readJsonIfExists(args.activeProtocolsPath);
  const activeProtocols = Array.isArray(activeProtocolsPayload)
    ? activeProtocolsPayload
    : (Array.isArray(activeProtocolsPayload?.protocols)
        ? activeProtocolsPayload.protocols
        : deriveActiveProtocols(clStatusPayload));

  const campaignStatusPayload = await readJsonIfExists(args.campaignStatusPath);
  const campaignStatus = campaignStatusPayload || {};

  const result = await runAutoKillCheck({
    auditRecords,
    oracleSamples,
    heartbeatAtMs,
    operatingCapitalUsd: args.operatingCapitalUsd,
    priceSamples,
    clStatus,
    activeProtocols,
    campaignStatus,
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
