#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { planNextReadinessRefresh } from "../estimator/readiness-refresh.mjs";
import { loadCanaryState } from "../estimator/load-canary-state.mjs";
import {
  decisionFingerprint,
  formatCanaryWatchSummary,
  notifyCanaryDecision,
  planBlockedScoreRefresh,
  shouldRefreshGasForCanary,
} from "../watch/canary-readiness-watch.mjs";

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
    once: flags.has("--once"),
    address: options.address || null,
    intervalSeconds: options["interval-seconds"] ? Number(options["interval-seconds"]) : 60,
    readinessMaxAgeSeconds: options["readiness-max-age-seconds"] ? Number(options["readiness-max-age-seconds"]) : 300,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const error = new Error(`Command failed: node ${script} ${args.join(" ")}`.trim());
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return result.stdout.trim();
}

function refreshShadowArtifacts(address) {
  try {
    const priceOutput = runNodeScript("src/cli/price-snapshot.mjs");
    if (priceOutput) console.log(priceOutput);
  } catch (error) {
    console.log("action=price-snapshot-failed");
    if (error.stderr) console.log(error.stderr.trim());
  }
  runNodeScript("src/cli/run-shadow-cycle.mjs", ["--write", `--address=${address}`]);
  const output = runNodeScript("src/cli/status-dashboard.mjs", ["--skip-shadow-cycle"]);
  if (output) console.log(output);
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveOperationalAddress({ explicitAddress: args.address, dataDir: config.dataDir });
  args.address = resolved.address;
  const intervalMs = Number.isFinite(args.intervalSeconds) && args.intervalSeconds > 0 ? args.intervalSeconds * 1000 : 60_000;
  const readinessMaxAgeMs =
    Number.isFinite(args.readinessMaxAgeSeconds) && args.readinessMaxAgeSeconds >= 0 ? args.readinessMaxAgeSeconds * 1000 : 300_000;
  let previousFingerprint = null;
  const shadowCyclePath = join(config.dataDir, "shadow-cycle-latest.json");

  while (true) {
    refreshShadowArtifacts(args.address);
    const shadowCycle = await readJsonIfExists(shadowCyclePath);
    let state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    const readinessRefresh = planNextReadinessRefresh(
      {
        shadowCycle,
        readinessRecords: state.readinessRecords,
        readinessFailures: state.readinessFailures,
        address: args.address,
      },
      { maxAgeMs: readinessMaxAgeMs },
    );

    if (readinessRefresh.args && readinessRefresh.shouldRefresh) {
      const routeKey = readinessRefresh.args.find((item) => item.startsWith("--route-key="))?.slice("--route-key=".length) || "unknown";
      const amount = readinessRefresh.args.find((item) => item.startsWith("--amount="))?.slice("--amount=".length) || "unknown";
      console.log(`action=refresh-wallet-readiness routeKey=${routeKey} amount=${amount} reason=${readinessRefresh.reason}`);
      const output = runNodeScript("src/cli/check-estimator-wallet.mjs", readinessRefresh.args);
      if (output) console.log(output);
      refreshShadowArtifacts(args.address);
      state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    } else if (readinessRefresh.args) {
      const routeKey = readinessRefresh.args.find((item) => item.startsWith("--route-key="))?.slice("--route-key=".length) || "unknown";
      const amount = readinessRefresh.args.find((item) => item.startsWith("--amount="))?.slice("--amount=".length) || "unknown";
      const ageSeconds = Number.isFinite(readinessRefresh.ageMs) ? Math.round(readinessRefresh.ageMs / 1000) : "unknown";
      console.log(`action=skip-wallet-readiness-refresh routeKey=${routeKey} amount=${amount} reason=${readinessRefresh.reason} ageSeconds=${ageSeconds}`);
    }

    if (shouldRefreshGasForCanary(state.nextStep)) {
      console.log("action=refresh-stale-gas-and-rescore");
      const gasOutput = runNodeScript("src/cli/gas-snapshot.mjs");
      if (gasOutput) console.log(gasOutput);
      const scoreOutput = runNodeScript("src/cli/score-gateway.mjs", ["--write"]);
      if (scoreOutput) console.log(scoreOutput);
      refreshShadowArtifacts(args.address);
      state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    }

    const scoreRefresh = planBlockedScoreRefresh(state);
    if (scoreRefresh.shouldRefresh) {
      console.log(
        `action=refresh-blocked-score routeKey=${scoreRefresh.routeKey || "unknown"} amount=${scoreRefresh.amount || "unknown"} reason=${scoreRefresh.reason} inputs=${scoreRefresh.changedInputs.join(",") || "unknown"}`,
      );
      const scoreOutput = runNodeScript("src/cli/score-gateway.mjs", [
        "--write",
        `--route-key=${scoreRefresh.routeKey}`,
        `--amount=${scoreRefresh.amount}`,
      ]);
      if (scoreOutput) console.log(scoreOutput);
      refreshShadowArtifacts(args.address);
      state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    } else if (scoreRefresh.routeKey) {
      console.log(
        `action=skip-blocked-score-refresh routeKey=${scoreRefresh.routeKey} amount=${scoreRefresh.amount} reason=${scoreRefresh.reason}`,
      );
    }

    const fingerprint = decisionFingerprint(state.nextStep);
    const changed = previousFingerprint !== fingerprint;

    if (changed) {
      console.log(formatCanaryWatchSummary(state.nextStep));
      previousFingerprint = fingerprint;
      await notifyCanaryDecision({
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
        nextStep: state.nextStep,
      }).catch(() => null);
    }

    runNodeScript("src/cli/write-session-handoff.mjs");

    if (state.nextStep.decision === "RUN_EXACT_GAS" || state.nextStep.decision === "RERUN_SCORING") {
      console.log("action=advance-canary");
      const output = runNodeScript("src/cli/advance-canary.mjs", [`--address=${args.address}`]);
      if (output) console.log(output);
      runNodeScript("src/cli/write-session-handoff.mjs");
      return;
    }

    if (args.once) return;
    await sleep(intervalMs);
  }
}

main().catch((error) => {
  console.error(error.stderr || error.stack || error.message);
  process.exitCode = 1;
});
