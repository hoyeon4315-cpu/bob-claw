#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { loadCanaryState, readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { scanTreasuryInventory } from "../treasury/inventory.mjs";
import { buildTreasuryPlan } from "../treasury/planner.mjs";
import { buildFundingSourcePlan } from "../treasury/funding-source-planner.mjs";
import { buildTreasuryRefillJobs } from "../treasury/refill-job.mjs";
import { latestWholeWalletInventoryForAddress } from "../treasury/whole-wallet-scan.mjs";
import { buildDefaultRoutePerformancePolicy, buildRoutePerformanceRanking } from "../risk/route-performance.mjs";
import { buildExecutionRiskState } from "../risk/execution-gate.mjs";
import { buildInventoryConsistencyAudit, resolveShadowCycleContext } from "../session/shadow-cycle-context.mjs";
import { buildRouteDemandFromCanaryState, buildShadowCycleSummary, stripVolatileShadowCycleFields } from "../session/shadow-cycle.mjs";
import { buildBtcProxySpreadSummary } from "../strategy/btc-proxy-spreads.mjs";
import { buildCrossAssetArbitrageSummary } from "../strategy/cross-asset-arbitrage.mjs";

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
    write: flags.has("--write"),
    refreshInventory: flags.has("--refresh-inventory"),
    address: options.address || null,
  };
}

function summarizeEthFamilyWatch(snapshot = null) {
  if (!snapshot) return null;
  return {
    observedAt: snapshot.observedAt || null,
    routeCount: Number(snapshot?.ethFamily?.routeCount ?? snapshot?.snapshot?.ethFamilyRouteCount ?? 0),
    surfaceChanged: Boolean(snapshot?.ethFamily?.surfaceChanged),
    addedRoutes: snapshot?.ethFamily?.addedRoutes || snapshot?.diff?.addedEthFamilyRoutes || [],
    removedRoutes: snapshot?.ethFamily?.removedRoutes || snapshot?.diff?.removedEthFamilyRoutes || [],
    chainPairs: snapshot?.ethFamily?.chainPairs || snapshot?.snapshot?.ethFamilyChainPairs || [],
    addedChainPairs: snapshot?.ethFamily?.addedChainPairs || snapshot?.diff?.addedEthFamilyChainPairs || [],
    removedChainPairs: snapshot?.ethFamily?.removedChainPairs || snapshot?.diff?.removedEthFamilyChainPairs || [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = await resolveShadowCycleContext({
    dataDir: config.dataDir,
    explicitAddress: args.address,
    configuredAddress: config.estimateFrom,
  });
  const address = context.address;
  const canaryState = await loadCanaryState({ address, dataDir: config.dataDir });
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const inventory =
    !args.refreshInventory && context.inventorySnapshot
      ? context.inventorySnapshot
      : await scanTreasuryInventory({
          policy,
          address,
          prices: canaryState.prices,
        });
  const inventoryAudit = args.refreshInventory
    ? buildInventoryConsistencyAudit({
        inventory,
        expectedAddress: address,
        source: "live_scan",
      })
    : context.inventoryAudit;
  const routeDemand = buildRouteDemandFromCanaryState(canaryState.routePlan);
  const wholeWalletInventoryRecords = await readJsonl(config.dataDir, "whole-wallet-inventory").catch(() => []);
  const treasuryPlan = buildTreasuryPlan({
    policy,
    inventory,
    routeDemand,
  });
  const routeContext = canaryState.routePlan?.topCandidates?.find((item) => item.viableForPrep) || canaryState.routePlan?.topCandidates?.[0] || null;
  const supplementalInventory = latestWholeWalletInventoryForAddress(wholeWalletInventoryRecords, address);
  const fundingSourcePlan = buildFundingSourcePlan({
    plan: treasuryPlan,
    policy,
    routeContext,
    supplementalInventory,
  });
  const refillJobs = buildTreasuryRefillJobs({
    plan: treasuryPlan,
    policy,
    fundingSourcePlan,
    routeCandidates: canaryState.routePlan?.candidates || [],
  });

  const [receiptRecords, executionEvents, quotes, quoteFailures, scoreSnapshot, updateSnapshots] = await Promise.all([
    readJsonl(config.dataDir, "receipt-reconciliations"),
    readJsonl(config.dataDir, "execution-journal"),
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "gateway-quote-failures"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
    readJsonl(config.dataDir, "gateway-update-snapshots"),
  ]);
  const ethFamilyWatch = summarizeEthFamilyWatch(updateSnapshots.at(-1) || null);

  const routePerformance = buildRoutePerformanceRanking({
    receiptRecords,
    quotes,
    quoteFailures,
    scores: scoreSnapshot?.scores || [],
    policy: buildDefaultRoutePerformancePolicy(),
  });
  const riskState = buildExecutionRiskState({
    receiptRecords,
    executionEvents,
    inventory,
  });
  const summary = buildShadowCycleSummary({
    canaryState,
    treasuryPlan,
    fundingSourcePlan,
    refillJobs,
    routePerformance,
    riskState,
    quotes,
    quoteFailures,
    shadowObservations: canaryState?.shadowObservations || [],
    scoreSnapshot,
    strategy: {
      crossAssetArbitrage: buildCrossAssetArbitrageSummary(scoreSnapshot || null),
      btcProxySpreads: buildBtcProxySpreadSummary({
        dexQuotes: canaryState?.dexQuotes || [],
        routes: canaryState?.routesRecords?.at(-1)?.routes || [],
        scoreSnapshot: scoreSnapshot || null,
      }),
    },
    ethFamilyWatch,
  });
  summary.address = {
    resolved: address,
    source: context.addressSource,
  };
  summary.audit = {
    address: context.addressAudit,
    inventory: inventoryAudit,
  };

  if (args.write) {
    const path = join(config.dataDir, "shadow-cycle-latest.json");
    const result = await writeTextIfChanged(path, `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatileShadowCycleFields(JSON.parse(contents)));
      },
    });
    console.log(`${result.changed ? "wrote" : "unchanged"}=${result.path}`);
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`mode=${summary.mode}`);
  console.log(`headline=${summary.headline}`);
  console.log(`address=${summary.address?.resolved || "n/a"} source=${summary.address?.source || "n/a"}`);
  if (summary.topRoute?.label) {
    console.log(`topRoute=${summary.topRoute.label} amount=${summary.topRoute.amount}`);
  }
  if (summary.blockers.length) {
    console.log(`blockers=${summary.blockers.join(",")}`);
  }
  if (summary.audit?.address?.issues?.length) {
    console.log(`addressAuditIssues=${summary.audit.address.issues.join(",")}`);
  }
  if (summary.audit?.inventory?.issues?.length) {
    console.log(`inventoryAuditIssues=${summary.audit.inventory.issues.join(",")}`);
  }
  console.log(`canaryDecision=${summary.canary?.decision || "n/a"}`);
  console.log(`pivotDecision=${summary.pivotDecision?.decisionCode || "n/a"}`);
  if (summary.pivotDecision?.command) {
    console.log(`pivotCommand=${summary.pivotDecision.command}`);
  }
  console.log(`treasuryDecision=${summary.treasury?.decision || "n/a"}`);
  console.log(`enabledRoutes=${summary.routePerformance?.enabledCount ?? 0}`);
  console.log(`realizedRouteCount=${summary.routePerformance?.realizedRouteCount ?? 0}`);
  console.log(`walletEstimatedUsd=${summary.treasury?.estimatedWalletUsd ?? "n/a"}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
