import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { determineCanaryNextStep } from "./canary-next-step.mjs";
import { buildCanaryRoutePlan } from "./canary-route-plan.mjs";
import { buildEstimatorFundingPlan } from "./funding-plan.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { getCoinGeckoPricesUsd } from "../market/prices.mjs";

export async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function loadCanaryState({ address = config.estimateFrom, dataDir = config.dataDir } = {}) {
  const [quotes, readinessRecords, readinessFailures, scoreSnapshot, dashboardStatus, prices] = await Promise.all([
    readJsonl(dataDir, "gateway-quotes"),
    readJsonl(dataDir, "estimator-wallet-readiness"),
    readJsonl(dataDir, "estimator-wallet-readiness-failures"),
    readJsonIfExists(join(dataDir, "gateway-scores.json")),
    readJsonIfExists(join(dataDir, "dashboard-status.json")),
    getCoinGeckoPricesUsd().catch(() => null),
  ]);

  const routePlan = buildCanaryRoutePlan(
    {
      quotes,
      scores: scoreSnapshot?.scores || [],
      readinessRecords,
      readinessFailures,
    },
    { address, prices },
  );
  const fundingPlan = buildEstimatorFundingPlan({ readinessRecords, readinessFailures }, { address });
  const nextStep = determineCanaryNextStep({ routePlan, fundingPlan });

  return {
    address,
    quotes,
    readinessRecords,
    readinessFailures,
    scoreSnapshot,
    dashboardStatus,
    prices,
    routePlan,
    fundingPlan,
    nextStep,
  };
}
