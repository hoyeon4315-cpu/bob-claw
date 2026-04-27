#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildReceiptLedgerSummary } from "../ledger/receipt-reconciliation.mjs";
import {
  filterRecordsByReportingPnlBaseline,
  readReportingPnlBaseline,
  summarizeReportingPnlBaseline,
} from "../status/reporting-pnl-baseline.mjs";
import { buildAutonomousDiscoveryBoard, filterOfficialGatewayRoutes } from "../strategy/autonomous-discovery-board.mjs";
import { buildDexRouteUniverseSummary, buildEthRouteUniverseSummary } from "../strategy/dex-route-universe.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, ...stable } = value;
  return stable;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [
    deterministicStrategyCandidates,
    destinationResearchQueue,
    destinationPromotionGate,
    routeRecords,
    iterationRecords,
    receiptRecords,
    reportingPnlBaseline,
  ] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "deterministic-strategy-candidates.json")),
    readJsonIfExists(join(config.dataDir, "destination-research-queue.json")),
    readJsonIfExists(join(config.dataDir, "destination-promotion-gate.json")),
    readJsonl(config.dataDir, "gateway-routes"),
    readJsonl(config.dataDir, "autonomous-discovery-board-runs"),
    readJsonl(config.dataDir, "receipt-reconciliations"),
    readReportingPnlBaseline({ dataDir: config.dataDir }),
  ]);
  const latestRoutesRecord = routeRecords.at(-1) || null;
  const gatewayRoutes = filterOfficialGatewayRoutes(latestRoutesRecord?.routes || []);
  const btcRouteUniverse = buildDexRouteUniverseSummary({
    routes: gatewayRoutes,
    observedAt: latestRoutesRecord?.observedAt || null,
  });
  const ethRouteUniverse = buildEthRouteUniverseSummary({
    routes: gatewayRoutes,
    observedAt: latestRoutesRecord?.observedAt || null,
  });
  const report = buildAutonomousDiscoveryBoard({
    deterministicStrategyCandidates,
    destinationResearchQueue,
    destinationPromotionGate,
    btcRouteUniverse,
    ethRouteUniverse,
    gatewayRoutes,
    iterationRecords,
  });
  const scopedReceiptSummary = buildReceiptLedgerSummary(
    filterRecordsByReportingPnlBaseline(receiptRecords, reportingPnlBaseline),
  );
  const payload = {
    ...report,
    reportingPnl: {
      baseline: summarizeReportingPnlBaseline(reportingPnlBaseline),
      realized: {
        valueUsd:
          scopedReceiptSummary.classifications?.strategy_realized_pnl?.realizedNetPnlUsd ??
          scopedReceiptSummary.summary.realizedNetPnlUsd ??
          null,
        tradeCount:
          scopedReceiptSummary.classifications?.strategy_realized_pnl?.reconciledCount ??
          scopedReceiptSummary.summary.reconciledCount ??
          0,
        failedCount:
          scopedReceiptSummary.classifications?.strategy_realized_pnl?.failedCount ??
          scopedReceiptSummary.summary.failedCount ??
          0,
      },
    },
  };

  if (args.write) {
    const outputPath = join(config.dataDir, "autonomous-discovery-board.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(payload, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`opportunities=${payload.summary?.opportunityCount ?? 0}`);
  console.log(`readyNow=${payload.summary?.readyNowCount ?? 0}`);
  console.log(`deterministic=${payload.summary?.deterministicCount ?? 0}`);
  console.log(`destination=${payload.summary?.destinationCount ?? 0}`);
  console.log(`routeGaps=${payload.summary?.routeGapCount ?? 0}`);
  console.log(`routeDevelopment=${payload.summary?.routeDevelopmentCount ?? 0}`);
  console.log(`keep=${payload.summary?.keepCount ?? 0}`);
  console.log(`discard=${payload.summary?.discardCount ?? 0}`);
  console.log(`topOpportunity=${payload.summary?.topOpportunityId || "n/a"}`);
  console.log(`nextAction=${payload.summary?.nextAction?.code || "n/a"}`);
  console.log(`paperPnlBtc=${payload.summary?.pnl?.paper?.btc ?? "n/a"} paperPnlUsd=${payload.summary?.pnl?.paper?.usdProjection ?? "n/a"} paperPnlStatus=${payload.summary?.pnl?.paper?.status || "n/a"}`);
  console.log(`estimatedPnlBtc=${payload.summary?.pnl?.estimated?.btc ?? "n/a"} estimatedPnlUsd=${payload.summary?.pnl?.estimated?.usdProjection ?? "n/a"} estimatedPnlStatus=${payload.summary?.pnl?.estimated?.status || "n/a"}`);
  console.log(`realizedPnlBtc=${payload.summary?.pnl?.realized?.btc ?? "n/a"} realizedPnlUsd=${payload.summary?.pnl?.realized?.usdProjection ?? "n/a"} realizedPnlStatus=${payload.summary?.pnl?.realized?.status || "n/a"}`);
  if (payload.reportingPnl?.baseline?.active) {
    console.log(
      `reportingBaseline=${payload.reportingPnl.baseline.anchoredAt} reportingRealizedUsd=${payload.reportingPnl.realized.valueUsd ?? "n/a"} reportingTradeCount=${payload.reportingPnl.realized.tradeCount ?? 0}`,
    );
  }
  for (const item of (payload.opportunities || []).slice(0, 5)) {
    console.log(
      `${item.selectionRank || "n/a"} ${item.id} lane=${item.lane} status=${item.status} score=${item.priorityScore} selection=${item.selectionScore} keep=${item.researchLoop?.keepScore ?? "n/a"} discard=${item.researchLoop?.discardScore ?? "n/a"}`,
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
