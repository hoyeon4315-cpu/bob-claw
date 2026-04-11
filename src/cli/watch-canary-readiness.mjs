#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { planNextReadinessRefresh } from "../estimator/readiness-refresh.mjs";
import { loadCanaryState } from "../estimator/load-canary-state.mjs";
import {
  buildCanaryInputRefreshDexArgs,
  buildCanaryInputRefreshExactGasArgs,
  buildCanaryInputRefreshGasSnapshotArgs,
  buildCanaryInputRefreshScoringArgs,
  buildCanaryInputRefreshVerifyArgs,
  buildBlockedScoreRefreshScoringArgs,
  buildDexGatewayCoverageDexQuoteArgs,
  buildDexGatewayCoverageScoringArgs,
  buildDexGatewayCoverageVerifyArgs,
  buildDexEnvironmentRefreshQuoteArgs,
  buildGasRefreshScoringArgs,
  buildGasRefreshSnapshotArgs,
  buildDexRefreshScoringArgs,
  describeBlockedScoreRefreshSelection,
  decisionFingerprint,
  formatCanaryWatchSummary,
  notifyCanaryDecision,
  planCanaryInputRefresh,
  planBlockedScoreRefresh,
  planDexEnvironmentRefresh,
  planDexGatewayCoverageRefresh,
  planDexPriceRefresh,
  planGasRefresh,
  planQuoteDecayRefresh,
  summarizeShadowArtifactRefresh,
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
    decayWindowsSeconds: options["decay-windows-seconds"]
      ? options["decay-windows-seconds"].split(",").map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
      : [5, 15, 30],
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

function refreshShadowArtifacts(address, options = {}) {
  let priceOutput = "skipped=not_requested";
  if (!options.skipPriceSnapshot) {
    try {
      priceOutput = runNodeScript("src/cli/price-snapshot.mjs");
    } catch (error) {
      priceOutput = "failed=price_snapshot";
      console.log("refresh=shadow-artifacts price=failed");
      if (error.stderr) console.log(error.stderr.trim());
    }
  }
  const shadowOutput = runNodeScript("src/cli/run-shadow-cycle.mjs", ["--write", `--address=${address}`]);
  const dashboardOutput = runNodeScript("src/cli/status-dashboard.mjs", ["--skip-shadow-cycle"]);
  console.log(summarizeShadowArtifactRefresh({ priceOutput, shadowOutput, dashboardOutput }));
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
      console.log(`refresh=wallet-readiness routeKey=${routeKey} amount=${amount} reason=${readinessRefresh.reason}`);
      runNodeScript("src/cli/check-estimator-wallet.mjs", readinessRefresh.args);
      refreshShadowArtifacts(args.address, { skipPriceSnapshot: true });
      state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    } else if (readinessRefresh.args) {
      const routeKey = readinessRefresh.args.find((item) => item.startsWith("--route-key="))?.slice("--route-key=".length) || "unknown";
      const amount = readinessRefresh.args.find((item) => item.startsWith("--amount="))?.slice("--amount=".length) || "unknown";
      const ageSeconds = Number.isFinite(readinessRefresh.ageMs) ? Math.round(readinessRefresh.ageMs / 1000) : "unknown";
      console.log(`skip=wallet-readiness routeKey=${routeKey} amount=${amount} reason=${readinessRefresh.reason} ageSeconds=${ageSeconds}`);
    }

    const canaryInputRefresh = planCanaryInputRefresh(state);
    if (canaryInputRefresh.shouldRefresh) {
      console.log(
        `refresh=canary-inputs routeKey=${canaryInputRefresh.routeKey || "unknown"} amount=${canaryInputRefresh.amount || "unknown"} inputs=${canaryInputRefresh.inputKeys.join(",") || "none"} reason=${canaryInputRefresh.reason}`,
      );
      if (canaryInputRefresh.inputKeys.includes("market")) {
        runNodeScript("src/cli/price-snapshot.mjs");
      }
      if (canaryInputRefresh.inputKeys.includes("gateway_quote")) {
        runNodeScript("src/cli/verify-gateway.mjs", buildCanaryInputRefreshVerifyArgs(canaryInputRefresh) || []);
      }
      if (canaryInputRefresh.inputKeys.includes("src_gas")) {
        runNodeScript("src/cli/gas-snapshot.mjs", buildCanaryInputRefreshGasSnapshotArgs(canaryInputRefresh) || []);
      }
      if (canaryInputRefresh.inputKeys.includes("exact_gas")) {
        runNodeScript("src/cli/estimate-gateway-gas.mjs", buildCanaryInputRefreshExactGasArgs(canaryInputRefresh, args.address) || []);
      }
      if (canaryInputRefresh.inputKeys.includes("dex_quote")) {
        runNodeScript("src/cli/quote-dex.mjs", buildCanaryInputRefreshDexArgs(canaryInputRefresh) || []);
      }
      if (canaryInputRefresh.inputKeys.includes("bitcoin_fee")) {
        runNodeScript("src/cli/bitcoin-fee-snapshot.mjs");
      }
      runNodeScript("src/cli/score-gateway.mjs", buildCanaryInputRefreshScoringArgs(canaryInputRefresh));
      refreshShadowArtifacts(args.address, { skipPriceSnapshot: true });
      state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    } else if (canaryInputRefresh.routeKey) {
      console.log(
        `skip=canary-inputs routeKey=${canaryInputRefresh.routeKey} amount=${canaryInputRefresh.amount} reason=${canaryInputRefresh.reason}`,
      );
    }

    const gasRefresh = planGasRefresh(state);
    if (gasRefresh.shouldRefresh) {
      console.log(
        `refresh=stale-gas chains=${gasRefresh.chains.join(",")} routeKey=${gasRefresh.routeKey || "unknown"} amount=${gasRefresh.amount || "unknown"} reason=${gasRefresh.reason}`,
      );
      runNodeScript("src/cli/gas-snapshot.mjs", buildGasRefreshSnapshotArgs(gasRefresh));
      runNodeScript("src/cli/score-gateway.mjs", buildGasRefreshScoringArgs(gasRefresh));
      refreshShadowArtifacts(args.address, { skipPriceSnapshot: true });
      state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    } else if (gasRefresh.routeKey) {
      console.log(
        `skip=stale-gas chains=${gasRefresh.chains.join(",") || "none"} routeKey=${gasRefresh.routeKey} amount=${gasRefresh.amount} reason=${gasRefresh.reason}`,
      );
    }

    const dexRefresh = planDexPriceRefresh(state);
    if (dexRefresh.shouldRefresh && dexRefresh.chains.length > 0) {
      console.log(
        `refresh=dex-price chains=${dexRefresh.chains.join(",")} routeKey=${dexRefresh.routeKey || "unknown"} amount=${dexRefresh.amount || "unknown"} reason=${dexRefresh.reason}`,
      );
      runNodeScript("src/cli/quote-dex.mjs", [
        `--chains=${dexRefresh.chains.join(",")}`,
        ...(dexRefresh.routeKey ? [`--route-key=${dexRefresh.routeKey}`] : []),
        ...(dexRefresh.amount ? [`--amount=${dexRefresh.amount}`] : []),
      ]);
      runNodeScript("src/cli/score-gateway.mjs", buildDexRefreshScoringArgs(dexRefresh));
      refreshShadowArtifacts(args.address, { skipPriceSnapshot: true });
      state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    } else if (dexRefresh.chains.length > 0) {
      console.log(`skip=dex-price chains=${dexRefresh.chains.join(",")} reason=${dexRefresh.reason}`);
    }

    const gatewayCoverageRefresh = planDexGatewayCoverageRefresh(state);
    if (gatewayCoverageRefresh.shouldRefresh && gatewayCoverageRefresh.targetRouteCount > 0) {
      console.log(
        `refresh=gateway-coverage reason=${gatewayCoverageRefresh.reason} targets=${gatewayCoverageRefresh.targetRouteCount} chains=${gatewayCoverageRefresh.touchChains.join(",") || "none"}`,
      );
      for (const target of gatewayCoverageRefresh.targetRoutes) {
        console.log(`refresh=gateway-coverage-route routeKey=${target.routeKey} class=${target.classification}`);
        runNodeScript("src/cli/verify-gateway.mjs", buildDexGatewayCoverageVerifyArgs(target, gatewayCoverageRefresh));
        runNodeScript("src/cli/quote-dex.mjs", buildDexGatewayCoverageDexQuoteArgs(target));
      }
      runNodeScript("src/cli/score-gateway.mjs", buildDexGatewayCoverageScoringArgs(gatewayCoverageRefresh));
      refreshShadowArtifacts(args.address, { skipPriceSnapshot: true });
      state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    } else if (gatewayCoverageRefresh.targetRouteCount > 0) {
      console.log(
        `skip=gateway-coverage reason=${gatewayCoverageRefresh.reason} targets=${gatewayCoverageRefresh.targetRouteCount}`,
      );
    }

    const dexEnvironmentRefresh = planDexEnvironmentRefresh(state);
    if (dexEnvironmentRefresh.shouldRefresh) {
      console.log(
        `refresh=dex-environment routeKey=${dexEnvironmentRefresh.routeKey || "unknown"} amount=${dexEnvironmentRefresh.amount || "unknown"} class=${dexEnvironmentRefresh.classification || "unknown"} reason=${dexEnvironmentRefresh.reason} targets=${dexEnvironmentRefresh.targetRouteCount || 0}`,
      );
      runNodeScript("src/cli/quote-dex.mjs", buildDexEnvironmentRefreshQuoteArgs(dexEnvironmentRefresh));
      runNodeScript(
        "src/cli/score-gateway.mjs",
        dexEnvironmentRefresh.routeKey && dexEnvironmentRefresh.amount
          ? ["--write", `--route-key=${dexEnvironmentRefresh.routeKey}`, `--amount=${dexEnvironmentRefresh.amount}`]
          : ["--write"],
      );
      refreshShadowArtifacts(args.address, { skipPriceSnapshot: true });
      state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    } else if (dexEnvironmentRefresh.routeKey || dexEnvironmentRefresh.targetRouteCount > 0) {
      console.log(
        `skip=dex-environment routeKey=${dexEnvironmentRefresh.routeKey || "unknown"} amount=${dexEnvironmentRefresh.amount || "unknown"} class=${dexEnvironmentRefresh.classification || "unknown"} reason=${dexEnvironmentRefresh.reason}`,
      );
    }

    const scoreRefresh = planBlockedScoreRefresh(state);
    if (scoreRefresh.shouldRefresh) {
      const blockedSelection = describeBlockedScoreRefreshSelection(scoreRefresh, state.nextStep?.route || null);
      console.log(
        `refresh=blocked-score scope=${blockedSelection.scope} chains=${blockedSelection.chains.join(",") || "none"} routeKey=${scoreRefresh.routeKey || "unknown"} amount=${scoreRefresh.amount || "unknown"} reason=${scoreRefresh.reason} inputs=${scoreRefresh.changedInputs.join(",") || "unknown"}`,
      );
      runNodeScript("src/cli/score-gateway.mjs", buildBlockedScoreRefreshScoringArgs(scoreRefresh, state.nextStep?.route || null));
      refreshShadowArtifacts(args.address, { skipPriceSnapshot: true });
      state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    } else if (scoreRefresh.routeKey) {
      console.log(
        `skip=blocked-score routeKey=${scoreRefresh.routeKey} amount=${scoreRefresh.amount} reason=${scoreRefresh.reason}`,
      );
    }

    const decayRefresh = planQuoteDecayRefresh(state, {
      windowsSeconds: args.decayWindowsSeconds,
    });
    if (decayRefresh.shouldRefresh) {
      console.log(
        `refresh=quote-decay routeKey=${decayRefresh.routeKey || "unknown"} amount=${decayRefresh.amount || "unknown"} window=${decayRefresh.pendingWindowSeconds || "unknown"} reason=${decayRefresh.reason}`,
      );
      runNodeScript("src/cli/score-gateway.mjs", [
        "--write",
        `--route-key=${decayRefresh.routeKey}`,
        `--amount=${decayRefresh.amount}`,
        "--shadow-rollover-ms=0",
      ]);
      refreshShadowArtifacts(args.address, { skipPriceSnapshot: true });
      state = await loadCanaryState({ address: args.address, dataDir: config.dataDir });
    } else if (decayRefresh.routeKey) {
      console.log(
        `skip=quote-decay routeKey=${decayRefresh.routeKey} amount=${decayRefresh.amount} reason=${decayRefresh.reason}${decayRefresh.pendingWindowSeconds ? ` window=${decayRefresh.pendingWindowSeconds}` : ""}`,
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
      console.log("advance=canary");
      runNodeScript("src/cli/advance-canary.mjs", [`--address=${args.address}`]);
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
