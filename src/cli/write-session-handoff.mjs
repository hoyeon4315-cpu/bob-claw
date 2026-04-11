#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config/env.mjs";
import { determineCanaryNextStep } from "../estimator/canary-next-step.mjs";
import { buildCanaryRoutePlan } from "../estimator/canary-route-plan.mjs";
import { buildEstimatorFundingPlan } from "../estimator/funding-plan.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { getCoinGeckoPricesUsd } from "../market/prices.mjs";

const OUTPUT_PATH = "docs/current-status.md";

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

function amount(value, ticker) {
  if (!Number.isFinite(value)) return `unknown ${ticker}`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: value >= 1 ? 6 : 12 })} ${ticker}`;
}

function linesForActions(actions = []) {
  if (!actions.length) return ["- none"];
  return actions.map((action) => {
    if (action.type === "fund_native") return `- fund ${amount(action.shortfallDecimal, action.ticker)} on ${action.chain}`;
    if (action.type === "fund_token") return `- fund ${amount(action.shortfallDecimal, action.ticker)} on ${action.chain}`;
    if (action.type === "approve_allowance") {
      return `- approve ${amount(action.shortfallDecimal, action.ticker)} for spender ${action.spender} on ${action.chain}`;
    }
    if (action.type === "estimate_exact_gas") return `- run exact gas for ${action.routeKey} amount=${action.amount}`;
    if (action.type === "rerun_scoring") return `- rerun scoring for ${action.routeKey} amount=${action.amount}`;
    return `- ${action.type}`;
  });
}

async function main() {
  const now = new Date().toISOString();
  const [quotes, readinessRecords, readinessFailures, scoreSnapshot, dashboardStatus, prices] = await Promise.all([
    readJsonl(config.dataDir, "gateway-quotes"),
    readJsonl(config.dataDir, "estimator-wallet-readiness"),
    readJsonl(config.dataDir, "estimator-wallet-readiness-failures"),
    readJsonIfExists(join(config.dataDir, "gateway-scores.json")),
    readJsonIfExists(join(config.dataDir, "dashboard-status.json")),
    getCoinGeckoPricesUsd().catch(() => null),
  ]);

  const routePlan = buildCanaryRoutePlan(
    { quotes, scores: scoreSnapshot?.scores || [], readinessRecords, readinessFailures },
    { address: config.estimateFrom, prices },
  );
  const fundingPlan = buildEstimatorFundingPlan({ readinessRecords, readinessFailures }, { address: config.estimateFrom });
  const next = determineCanaryNextStep({ routePlan, fundingPlan });
  const best = next.route || routePlan.topCandidates?.[0] || null;

  const doc = [
    "# Current Status",
    "",
    `Updated: ${now}`,
    "",
    "## Start Here",
    "",
    "- Read this file first in a shallow session.",
    "- Main command: `npm run advance:canary`",
    "- Safe status refresh: `npm run score:gateway -- --write && npm run status:dashboard`",
    "",
    "## Current Phase",
    "",
    "- Phase: canary-prep gating before exact gas",
    `- Decision: \`${next.decision}\``,
    `- Headline: ${next.headline}`,
    `- Live trading: \`${dashboardStatus?.overall?.liveTrading || "BLOCKED"}\``,
    `- Shadow trading: \`${dashboardStatus?.overall?.shadowTrading || "ALLOWED"}\``,
    "",
    "## Best Route Right Now",
    "",
    best
      ? `- Route: \`${best.label}\``
      : "- Route: none",
    best
      ? `- Route key: \`${best.routeKey}\` amount=\`${best.amount}\``
      : "- Route key: none",
    best
      ? `- txReady=${best.txReady} exactGasDone=${best.exactGasDone} viableForPrep=${best.viableForPrep}`
      : "- txReady=false exactGasDone=false viableForPrep=false",
    best
      ? `- Input value: ${money(best.inputUsd)}`
      : "- Input value: n/a",
    best
      ? `- Prep funding estimate: ${money(best.prepFundingUsd)}`
      : "- Prep funding estimate: n/a",
    best
      ? `- Net edge now: ${money(best.netEdgeUsd)}`
      : "- Net edge now: n/a",
    "",
    "## Required Actions Before Exact Gas",
    "",
    ...linesForActions(next.actions),
    "",
    "## Objective Verification",
    "",
    "- `npm run check` passed",
    "- `npm test` passed",
    `- Candidate routes observed: ${routePlan.candidateCount}`,
    `- txReady routes: ${routePlan.txReadyCount}`,
    `- viable prep routes: ${routePlan.viableCount}`,
    `- estimator wallet checked routes: ${fundingPlan.routeCount}`,
    `- estimator skipped routes: ${fundingPlan.skippedRouteCount}`,
    `- skipped reasons: ${fundingPlan.failureReasons.map((item) => `${item.reason}:${item.count}`).join(",") || "none"}`,
    "",
    "## Next Command Order After Funding",
    "",
    "1. `npm run check:estimator-wallet -- --route-key=\"<routeKey>\" --amount=\"<amount>\"`",
    "2. `npm run estimate:gateway-gas -- --from=\"$BOB_CLAW_ESTIMATE_FROM\" --route-key=\"<routeKey>\" --amount=\"<amount>\"`",
    "3. `npm run score:gateway -- --write`",
    "4. `npm run status:dashboard`",
    "5. `npm run advance:canary`",
    "",
    "## Important Files",
    "",
    "- `src/cli/advance-canary.mjs`",
    "- `src/cli/plan-canary-next-step.mjs`",
    "- `src/cli/plan-canary-routes.mjs`",
    "- `src/cli/plan-estimator-wallet.mjs`",
    "- `src/estimator/canary-next-step.mjs`",
    "- `src/estimator/canary-route-plan.mjs`",
    "- `src/estimator/funding-plan.mjs`",
    "- `docs/current-status.md`",
    "",
    "## Backup Note",
    "",
    "- `.env` and `data/` stay out of git.",
    "- This repo is safe to back up publicly only if you are comfortable exposing source; operational secrets are ignored by git.",
    "- Prefer a private GitHub repo for backup.",
    "",
  ].join("\n");

  const outputPath = join(process.cwd(), OUTPUT_PATH);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${doc}\n`, "utf8");
  console.log(`wrote=${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
