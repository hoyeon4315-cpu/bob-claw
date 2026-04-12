#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildBtcProxySpreadSummary } from "../strategy/btc-proxy-spreads.mjs";

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
    proxyTicker: options["proxy-ticker"] || null,
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function money(value) {
  if (!Number.isFinite(value)) return "n/a";
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

function pct(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [dexQuotes, routeRecords, scoreSnapshot] = await Promise.all([
    readJsonl(config.dataDir, "dex-quotes"),
    readJsonl(config.dataDir, "gateway-routes"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
  ]);

  const latestRoutes = routeRecords.at(-1)?.routes || [];
  const summary = buildBtcProxySpreadSummary({
    dexQuotes,
    routes: latestRoutes,
    scoreSnapshot,
  }, {
    proxyTicker: args.proxyTicker,
  });

  if (args.write) {
    const path = join(config.dataDir, "btc-proxy-spreads.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`buyQuotes=${summary.buyQuoteCount}`);
  console.log(`sellQuotes=${summary.sellQuoteCount}`);
  console.log(`freshBuyQuotes=${summary.buyFreshCount}`);
  console.log(`freshSellQuotes=${summary.sellFreshCount}`);
  console.log(`observedBuyProxyGroups=${summary.observedBuyProxyGroupCount}`);
  console.log(`observedSellProxyGroups=${summary.observedSellProxyGroupCount}`);
  console.log(`matchedProxyGroups=${summary.proxyGroupCount}`);
  console.log(`opportunities=${summary.opportunityCount}`);
  console.log(`rawPositive=${summary.rawPositiveCount}`);
  console.log(`rebalancePositive=${summary.rebalancePositiveCount}`);
  console.log(`policyReady=${summary.policyReadyCount}`);
  console.log(`overfitAssessment=${summary.overfitAssessment}`);
  console.log(`overfitRisks=${summary.overfitRisks.join(",") || "none"}`);
  console.log(`unmatchedObservedProxyGroups=${summary.unmatchedObservedProxyGroups.join(",") || "none"}`);

  if (!summary.bestRebalanceOpportunity) {
    console.log("bestRebalance=none");
    return;
  }

  const best = summary.bestRebalanceOpportunity;
  console.log(
    `bestRebalance=${best.proxyTicker} buy=${best.buyChain} sell=${best.sellChain} amount=${best.amount} raw=${money(best.rawSpreadUsd)} adjusted=${money(best.rebalanceAdjustedSpreadUsd)} required=${money(best.requiredProfitUsd)}`,
  );
  console.log(
    `bestRebalancePct raw=${pct(best.rawSpreadPct)} adjusted=${pct(best.rebalanceAdjustedSpreadPct)} amountMismatch=${pct(best.amountMismatchPct)}`,
  );
  console.log(
    `bestRebalanceRoute route=${best.rebalanceRouteKey} cost=${money(best.rebalanceKnownCostUsd)} readiness=${best.rebalanceTradeReadiness || "n/a"} policyReady=${best.policyReadyAfterRebalance}`,
  );
  console.log(`bestRebalanceBlockers=${best.blockers.join(",") || "none"}`);

  for (const item of summary.opportunities.slice(0, 10)) {
    console.log(
      [
        `spread ${item.proxyTicker}`,
        `buy=${item.buyChain}`,
        `sell=${item.sellChain}`,
        `amount=${item.amount}`,
        `buyCost=${money(item.buyStableCostUsd)}`,
        `sellOut=${money(item.sellStableRevenueUsd)}`,
        `raw=${money(item.rawSpreadUsd)}`,
        `adjusted=${money(item.rebalanceAdjustedSpreadUsd)}`,
        `policy=${item.policyReadyAfterRebalance}`,
        `blockers=${item.blockers.join("|") || "none"}`,
      ].join(" "),
    );
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
