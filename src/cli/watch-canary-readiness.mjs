#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { config } from "../config/env.mjs";
import { loadCanaryState } from "../estimator/load-canary-state.mjs";
import { decisionFingerprint, formatCanaryWatchSummary, notifyCanaryDecision } from "../watch/canary-readiness-watch.mjs";

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
    address: options.address || config.estimateFrom,
    intervalSeconds: options["interval-seconds"] ? Number(options["interval-seconds"]) : 60,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const intervalMs = Number.isFinite(args.intervalSeconds) && args.intervalSeconds > 0 ? args.intervalSeconds * 1000 : 60_000;
  let previousFingerprint = null;

  while (true) {
    const state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
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
