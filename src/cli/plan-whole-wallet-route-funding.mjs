#!/usr/bin/env node

import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { buildWholeWalletRouteFundingPlan, probeWholeWalletFundingRecommendations } from "../treasury/whole-wallet-route-funding.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd } from "../market/prices.mjs";
import { buildDefaultTreasuryPolicy, validateTreasuryPolicy } from "../treasury/policy.mjs";
import { latestWholeWalletInventoryForAddress, scanWholeWalletInventory } from "../treasury/whole-wallet-scan.mjs";
import { buildTokenDexExperimentPlan } from "../executor/helpers/token-dex-experiment.mjs";

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
    probeLive: flags.has("--probe-live"),
    refreshScan: flags.has("--refresh-scan"),
    address: options.address || null,
    routeKey: options["route-key"] || null,
    amount: options.amount || null,
  };
}

function latestReadiness(records = [], { address, routeKey, amount }) {
  return [...records]
    .filter((item) => (!address || String(item.address || "").toLowerCase() === String(address || "").toLowerCase()))
    .filter((item) => (!routeKey || item.routeKey === routeKey))
    .filter((item) => (!amount || String(item.amount) === String(amount)))
    .sort((left, right) => new Date(right.observedAt || 0) - new Date(left.observedAt || 0))[0] || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveOperationalAddress({ explicitAddress: args.address, dataDir: config.dataDir });
  const policy = validateTreasuryPolicy(buildDefaultTreasuryPolicy());
  const [readinessRecords, storedWholeWallet] = await Promise.all([
    readJsonl(config.dataDir, "estimator-wallet-readiness"),
    readJsonl(config.dataDir, "whole-wallet-inventory").catch(() => []),
  ]);
  const readiness = latestReadiness(readinessRecords, {
    address: resolved.address,
    routeKey: args.routeKey,
    amount: args.amount,
  });
  if (!readiness) {
    throw new Error("No wallet readiness record matched the requested route/amount.");
  }

  const prices = await getCoinGeckoPricesUsd().catch(() => emptyPricesUsd());
  const scan =
    !args.refreshScan && storedWholeWallet.length > 0
      ? latestWholeWalletInventoryForAddress(storedWholeWallet, resolved.address)
      : await scanWholeWalletInventory({
          address: resolved.address,
          prices,
          chains: policy.supportedChains,
        });
  const plan = buildWholeWalletRouteFundingPlan({ scan, readiness });
  if (args.probeLive) {
    plan.livePreview = await probeWholeWalletFundingRecommendations({
      plan,
      senderAddress: resolved.address,
      buildTokenDexPlanImpl: buildTokenDexExperimentPlan,
    });
  }
  const store = new JsonlStore(config.dataDir);
  await store.append("whole-wallet-route-funding-plans", plan);

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`status=${plan.status}`);
  console.log(`route=${plan.routeKey} amount=${plan.amount}`);
  console.log(`nativeShortfallWei=${plan.readiness?.nativeShortfallWei || "0"} tokenShortfall=${plan.readiness?.tokenShortfall || "0"}`);
  if (plan.livePreview?.tokenProbe) {
    console.log(`tokenProbe status=${plan.livePreview.tokenProbe.status} method=${plan.livePreview.tokenProbe.method} blocked=${plan.livePreview.tokenProbe.blockedReason || "none"} covers=${plan.livePreview.tokenProbe.coversShortfall}`);
  }
  if (plan.livePreview?.nativeProbe) {
    console.log(`nativeProbe status=${plan.livePreview.nativeProbe.status} method=${plan.livePreview.nativeProbe.method} blocked=${plan.livePreview.nativeProbe.blockedReason || "none"} covers=${plan.livePreview.nativeProbe.coversShortfall}`);
  }
  for (const item of plan.recommendations?.tokenTopUps || []) {
    console.log(`tokenCandidate ${item.chain} ${item.ticker} method=${item.method} usd=${item.estimatedUsd ?? "n/a"} reason=${item.reason}`);
  }
  for (const item of plan.recommendations?.nativeTopUps || []) {
    console.log(`nativeCandidate ${item.chain} ${item.ticker} method=${item.method} usd=${item.estimatedUsd ?? "n/a"} reason=${item.reason}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
