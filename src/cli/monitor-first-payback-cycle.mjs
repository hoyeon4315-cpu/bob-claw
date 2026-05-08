#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { defaultRunCommand } from "../session/shadow-refresh-runner.mjs";

const IS_MAIN = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

export function parseArgs(argv = []) {
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
    intervalSec: Number.isFinite(Number(options["interval-sec"])) ? Math.max(0, Number(options["interval-sec"])) : 300,
    maxTicks: Number.isFinite(Number(options["max-ticks"])) ? Math.max(1, Number(options["max-ticks"])) : null,
    commandTimeoutMs: Number.isFinite(Number(options["command-timeout-ms"])) ? Math.max(1, Number(options["command-timeout-ms"])) : null,
  };
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractJsonObject(text) {
  const value = String(text || "");
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("stdout_json_missing");
  return JSON.parse(value.slice(first, last + 1));
}

function summarizePaybackStatus(payload, observedAt) {
  const pendingSats = finiteNumber(payload?.payback?.accumulatorPendingSats) ?? 0;
  const effectiveMinSats =
    finiteNumber(payload?.payback?.scheduler?.minimumPaybackProgress?.minPaybackSats) ??
    finiteNumber(payload?.payback?.scheduler?.previewAfterDestination?.minPaybackSats) ??
    finiteNumber(payload?.policy?.minPaybackSats) ??
    null;
  const progress =
    finiteNumber(payload?.payback?.scheduler?.minimumPaybackProgress?.progressToMinimumRatio) ??
    finiteNumber(payload?.payback?.scheduler?.previewAfterDestination?.progressToMinimumRatio) ??
    (effectiveMinSats && effectiveMinSats > 0 ? pendingSats / effectiveMinSats : null);
  const reached =
    (effectiveMinSats !== null && pendingSats >= effectiveMinSats) ||
    (progress !== null && progress >= 1);
  return {
    observedAt,
    pendingSats,
    effectiveMinSats,
    progress,
    reached,
    decisionStatus: payload?.decision?.status || null,
    decisionReason: payload?.decision?.reason || null,
  };
}

function buildTrajectory(ticks = []) {
  const first = ticks[0] || null;
  const last = ticks.at(-1) || null;
  if (!first || !last) {
    return {
      deltaPendingSats: 0,
      deltaProgress: 0,
      averageSatsPerDay: null,
    };
  }
  const firstMs = Date.parse(first.observedAt || "");
  const lastMs = Date.parse(last.observedAt || "");
  const elapsedDays =
    Number.isFinite(firstMs) && Number.isFinite(lastMs) && lastMs > firstMs
      ? (lastMs - firstMs) / 86_400_000
      : null;
  const deltaPendingSats = last.pendingSats - first.pendingSats;
  return {
    deltaPendingSats,
    deltaProgress:
      first.progress !== null && last.progress !== null
        ? last.progress - first.progress
        : null,
    averageSatsPerDay:
      elapsedDays && elapsedDays > 0
        ? deltaPendingSats / elapsedDays
        : null,
  };
}

async function readPaybackStatus({
  runCommandImpl,
  commandTimeoutMs,
  cwd = process.cwd(),
  env = process.env,
  now,
} = {}) {
  const result = await runCommandImpl({
    command: "npm",
    args: ["run", "report:payback-status", "--", "--json"],
    cwd,
    env,
    timeoutMs: commandTimeoutMs,
    step: {
      id: "payback_status",
      label: "payback status",
    },
  });
  if (!result.ok) {
    return {
      ok: false,
      tick: null,
      error: {
        reason: "payback_status_command_failed",
        exitCode: result.exitCode ?? null,
        signal: result.signal ?? null,
      },
    };
  }
  try {
    return {
      ok: true,
      tick: summarizePaybackStatus(extractJsonObject(result.stdout), now()),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      tick: null,
      error: {
        reason: error.message || "payback_status_json_parse_failed",
      },
    };
  }
}

function nextActionGuide(ready) {
  if (ready) {
    return {
      command: "npm run executor:payback-scheduler:once -- --json",
      note: "Operator must run this manually; this monitor never triggers payback.",
    };
  }
  return {
    command: "npm run monitor:first-payback-cycle -- --json",
    note: "Continue observing until the effective minimum is reached.",
  };
}

function renderJson(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function renderText(payload) {
  return [
    `status=${payload.status}`,
    `ticks=${payload.ticks.length}`,
    `autoTriggeredPayback=${payload.autoTriggeredPayback}`,
    `next=${payload.nextActionGuide.command}`,
  ].join("\n") + "\n";
}

export async function runMonitorFirstPaybackCycleCli(
  argv = process.argv.slice(2),
  {
    runCommandImpl = defaultRunCommand,
    sleepImpl = sleep,
    cwd = process.cwd(),
    env = process.env,
    now = () => new Date().toISOString(),
  } = {},
) {
  const args = parseArgs(argv);
  const ticks = [];
  let error = null;

  for (let tickIndex = 0; args.maxTicks === null || tickIndex < args.maxTicks; tickIndex += 1) {
    if (tickIndex > 0 && args.intervalSec > 0) {
      await sleepImpl(args.intervalSec * 1000);
    }
    const result = await readPaybackStatus({
      runCommandImpl,
      commandTimeoutMs: args.commandTimeoutMs,
      cwd,
      env,
      now,
    });
    if (!result.ok) {
      error = result.error;
      break;
    }
    ticks.push(result.tick);
    if (result.tick.reached) break;
  }

  const ready = ticks.some((tick) => tick.reached);
  const payload = {
    schemaVersion: 1,
    observedAt: now(),
    status: error ? "monitor_blocked" : ready ? "first_delivery_candidate_ready" : "monitor_waiting",
    autoTriggeredPayback: false,
    error,
    ticks,
    latest: ticks.at(-1) || null,
    trajectory: buildTrajectory(ticks),
    nextActionGuide: nextActionGuide(ready),
  };
  return {
    exitCode: error ? 2 : 0,
    stdout: args.json ? renderJson(payload) : renderText(payload),
    stderr: "",
    payload,
  };
}

async function main() {
  const result = await runMonitorFirstPaybackCycleCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
