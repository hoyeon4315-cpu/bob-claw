#!/usr/bin/env node

import process from "node:process";
import { getNumberEnv, getEnv } from "../config/env.mjs";
import { resolveDefaultHeartbeatPath } from "../executor/runtime-paths.mjs";
import { runWatchdogLoop } from "../executor/watchdog/runner.mjs";
import { resolveKillSwitchPath } from "../executor/policy/kill-switch.mjs";
// TODO(blocker-resolver): monitor logs/blocker-resolver-audit.jsonl heartbeat
// alongside signer heartbeat once the resolver loop is launchd-managed.

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
    once: flags.has("--once"),
    heartbeatPath: options["heartbeat-path"] || getEnv("EXECUTOR_HEARTBEAT_PATH", resolveDefaultHeartbeatPath()),
    killSwitchPath: options["kill-switch-path"] || getEnv("KILL_SWITCH_PATH", resolveKillSwitchPath()),
    intervalMs: options["interval-ms"]
      ? Number(options["interval-ms"])
      : getNumberEnv("EXECUTOR_WATCHDOG_INTERVAL_MS", 15_000),
    ttlMs: options["ttl-ms"] ? Number(options["ttl-ms"]) : getNumberEnv("EXECUTOR_WATCHDOG_TTL_MS", 60_000),
    startupGraceMs: options["startup-grace-ms"]
      ? Number(options["startup-grace-ms"])
      : getNumberEnv("EXECUTOR_WATCHDOG_STARTUP_GRACE_MS", getNumberEnv("EXECUTOR_WATCHDOG_TTL_MS", 60_000)),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const printIteration = async (result) => {
    if (args.json && !args.once) {
      console.log(JSON.stringify(result));
      return;
    }
    if (!args.json) {
      console.log(`status=${result.evaluation.status}`);
      console.log(`stale=${result.evaluation.stale}`);
      if (Number.isFinite(result.evaluation.ageMs)) console.log(`ageMs=${result.evaluation.ageMs}`);
      console.log(`halted=${result.halted}`);
    }
  };

  const result = await runWatchdogLoop({
    once: args.once,
    heartbeatPath: args.heartbeatPath,
    killSwitchPath: args.killSwitchPath,
    intervalMs: args.intervalMs,
    ttlMs: args.ttlMs,
    startupGraceMs: args.startupGraceMs,
    onIteration: printIteration,
  });

  if (args.once && args.json) {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
