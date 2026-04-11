import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { determineCanaryNextStep } from "./canary-next-step.mjs";
import { buildCanaryRoutePlan } from "./canary-route-plan.mjs";
import { buildEstimatorFundingPlan } from "./funding-plan.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { emptyPricesUsd, getCoinGeckoPricesUsd, isFreshPriceSnapshot, latestPriceSnapshot, overlayObservedPricesUsd, pricesFromSnapshot } from "../market/prices.mjs";

export async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function loadCanaryState({ address = null, dataDir = config.dataDir, getLivePrices = getCoinGeckoPricesUsd, now = null } = {}) {
  const resolved = await resolveOperationalAddress({
    explicitAddress: address,
    configuredAddress: config.estimateFrom,
    dataDir,
  });
  const [
    routesRecords,
    quotes,
    readinessRecords,
    readinessFailures,
    scoreSnapshot,
    dashboardStatus,
    priceSnapshots,
    gasSnapshots,
    bitcoinFeeSnapshots,
    gasEstimateSnapshots,
    dexQuotes,
    shadowObservations,
  ] = await Promise.all([
    readJsonl(dataDir, "gateway-routes"),
    readJsonl(dataDir, "gateway-quotes"),
    readJsonl(dataDir, "estimator-wallet-readiness"),
    readJsonl(dataDir, "estimator-wallet-readiness-failures"),
    readJsonIfExists(join(dataDir, "gateway-scores.json")),
    readJsonIfExists(join(dataDir, "dashboard-status.json")),
    readJsonl(dataDir, "market-price-snapshots"),
    readJsonl(dataDir, "gas-snapshots"),
    readJsonl(dataDir, "bitcoin-fee-snapshots"),
    readJsonl(dataDir, "gateway-gas-estimates"),
    readJsonl(dataDir, "dex-quotes"),
    readJsonl(dataDir, "gateway-shadow-observations"),
  ]);
  const latestObservedPrices = latestPriceSnapshot(priceSnapshots);
  const useObservedPrices = latestObservedPrices && isFreshPriceSnapshot(latestObservedPrices, now ? { now } : {});
  const livePrices = useObservedPrices ? null : await getLivePrices().catch(() => emptyPricesUsd());
  const basePrices = useObservedPrices ? pricesFromSnapshot(latestObservedPrices) : livePrices;
  const prices = overlayObservedPricesUsd(basePrices, { gasSnapshots, bitcoinFeeSnapshots });

  const routePlan = buildCanaryRoutePlan(
    {
      quotes,
      scores: scoreSnapshot?.scores || [],
      readinessRecords,
      readinessFailures,
    },
    { address: resolved.address, prices },
  );
  const fundingPlan = buildEstimatorFundingPlan({ readinessRecords, readinessFailures }, { address: resolved.address });
  const nextStep = determineCanaryNextStep({ routePlan, fundingPlan });

  return {
    address: resolved.address,
    addressSource: resolved.source,
    routesRecords,
    quotes,
    readinessRecords,
    readinessFailures,
    scoreSnapshot,
    dashboardStatus,
    priceSnapshots,
    prices,
    gasSnapshots,
    bitcoinFeeSnapshots,
    gasEstimateSnapshots,
    dexQuotes,
    shadowObservations,
    routePlan,
    fundingPlan,
    nextStep,
  };
}
