#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildDashboardStatus, writeDashboardStatus } from "../status/dashboard-status.mjs";

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const [
    routesRecords,
    quotes,
    failures,
    gasSnapshots,
    gasFailures,
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
  ] = await Promise.all([
    readJsonl(config.dataDir, "gateway-routes"),
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "gateway-quote-failures"),
    readJsonl(config.dataDir, "gas-snapshots"),
    readJsonl(config.dataDir, "gas-snapshot-failures"),
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
  ]);

  const status = buildDashboardStatus({
    routesRecords,
    quotes,
    failures,
    gasSnapshots,
    gasFailures,
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
  });
  const path = await writeDashboardStatus(config.dataDir, status);
  const dashboardPath = await writeDashboardStatus("./dashboard/public", status);

  console.log(`wrote=${path}`);
  console.log(`dashboardWrote=${dashboardPath}`);
  console.log(`severity=${status.overall.severity}`);
  console.log(`liveTrading=${status.overall.liveTrading}`);
  console.log(`shadowTrading=${status.overall.shadowTrading}`);
  console.log(`gatewayRoutes=${status.gateway.routeCount}`);
  console.log(`gatewayUpdateDetected=${status.gateway.updateDetected}`);
  console.log(`probeOk=${status.gateway.probeOk}/${status.gateway.probeTotal}`);
  console.log(`auditDecision=${status.audit.decision}`);
  console.log(`blockers=${status.overall.blockers.join(",") || "none"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
