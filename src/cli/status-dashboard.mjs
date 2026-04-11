#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildDashboardStatus, writeDashboardStatus } from "../status/dashboard-status.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    skipShadowCycle: flags.has("--skip-shadow-cycle"),
  };
}

function runNodeScript(script, args = []) {
  const result = spawnSync(process.execPath, [resolve(ROOT, script), ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const error = new Error(`Command failed: node ${script} ${args.join(" ")}`.trim());
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    throw error;
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.skipShadowCycle) {
    runNodeScript("src/cli/run-shadow-cycle.mjs", ["--write"]);
  }

  const [
    routesRecords,
    quotes,
    failures,
    gasSnapshots,
    gasFailures,
    priceSnapshots,
    updateSnapshots,
    updateAlerts,
    scoreSnapshot,
    dexQuotes,
    dexFailures,
    bitcoinFeeSnapshots,
    gatewayGasEstimates,
    gatewayGasEstimateFailures,
    estimatorWalletReadiness,
    estimatorWalletReadinessFailures,
    shadowObservations,
    shadowCycle,
  ] = await Promise.all([
    readJsonl(config.dataDir, "gateway-routes"),
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "gateway-quote-failures"),
    readJsonl(config.dataDir, "gas-snapshots"),
    readJsonl(config.dataDir, "gas-snapshot-failures"),
    readJsonl(config.dataDir, "market-price-snapshots"),
    readJsonl(config.dataDir, "gateway-update-snapshots"),
    readJsonl(config.dataDir, "gateway-update-alerts"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
    readJsonl(config.dataDir, "dex-quotes"),
    readJsonl(config.dataDir, "dex-quote-failures"),
    readJsonl(config.dataDir, "bitcoin-fee-snapshots"),
    readJsonl(config.dataDir, "gateway-gas-estimates"),
    readJsonl(config.dataDir, "gateway-gas-estimate-failures"),
    readJsonl(config.dataDir, "estimator-wallet-readiness"),
    readJsonl(config.dataDir, "estimator-wallet-readiness-failures"),
    readJsonl(config.dataDir, "gateway-shadow-observations"),
    readJsonIfExists(join(config.dataDir, "shadow-cycle-latest.json")),
  ]);

  const status = buildDashboardStatus({
    routesRecords,
    quotes,
    failures,
    gasSnapshots,
    gasFailures,
    priceSnapshots,
    updateSnapshots,
    updateAlerts,
    scoreSnapshot,
    dexQuotes,
    dexFailures,
    bitcoinFeeSnapshots,
    gatewayGasEstimates,
    gatewayGasEstimateFailures,
    estimatorWalletReadiness,
    estimatorWalletReadinessFailures,
    shadowObservations,
    shadowCycle,
  });
  const output = await writeDashboardStatus(config.dataDir, status);
  const dashboardOutput = await writeDashboardStatus("./dashboard/public", status);

  console.log(`${output.changed ? "wrote" : "unchanged"}=${output.path}`);
  console.log(`${dashboardOutput.changed ? "dashboardWrote" : "dashboardUnchanged"}=${dashboardOutput.path}`);
  console.log(`severity=${status.overall.severity}`);
  console.log(`liveTrading=${status.overall.liveTrading}`);
  console.log(`shadowTrading=${status.overall.shadowTrading}`);
  console.log(`gatewayRoutes=${status.gateway.routeCount}`);
  console.log(`gatewayUpdateDetected=${status.gateway.updateDetected}`);
  console.log(`probeOk=${status.gateway.probeOk}/${status.gateway.probeTotal}`);
  console.log(`auditDecision=${status.audit.decision}`);
  console.log(`shadowCycleMode=${status.shadowCycle?.mode || "none"}`);
  console.log(`blockers=${status.overall.blockers.join(",") || "none"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
