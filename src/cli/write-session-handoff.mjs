#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config/env.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { loadCanaryState } from "../estimator/load-canary-state.mjs";

const OUTPUT_PATH = "docs/current-status.md";

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

function readinessRefreshLine(refresh) {
  if (!refresh) return "- Refresh status: no next readiness check";
  if (refresh.state === "ready_now") return "- Refresh status: ready to rerun the next wallet readiness check now";
  if (refresh.state === "cooldown") {
    const age = Number.isFinite(refresh.ageSeconds) ? `${refresh.ageSeconds}s ago` : "recently";
    const remaining =
      Number.isFinite(refresh.maxAgeSeconds) && Number.isFinite(refresh.ageSeconds)
        ? `${Math.max(0, refresh.maxAgeSeconds - refresh.ageSeconds)}s remaining`
        : "cooldown active";
    return `- Refresh status: last readiness observation ${age}; ${remaining}`;
  }
  return `- Refresh status: ${refresh.reason || "unknown"}`;
}

async function main() {
  const now = new Date().toISOString();
  const resolved = await resolveOperationalAddress({ dataDir: config.dataDir });
  const { routePlan, fundingPlan, nextStep: next, dashboardStatus } = await loadCanaryState({
    address: resolved.address,
    dataDir: config.dataDir,
  });
  const best = next.route || routePlan.topCandidates?.[0] || null;
  const nextReadinessCheck = dashboardStatus?.shadowCycle?.canary?.nextReadinessCheck || null;
  const nextReadinessRefresh = dashboardStatus?.shadowCycle?.canary?.nextReadinessRefresh || null;

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
    `- Address: \`${resolved.address}\``,
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
    nextReadinessCheck
      ? `- Next readiness check: \`${nextReadinessCheck.label}\` amount=\`${nextReadinessCheck.amount}\``
      : "- Next readiness check: none",
    readinessRefreshLine(nextReadinessRefresh),
    "",
    "## Required Actions Before Exact Gas",
    "",
    ...linesForActions(next.actions),
    "",
    "## Objective Verification",
    "",
    "- This file does not execute validation by itself.",
    "- Rerun `npm run check` before acting on code changes.",
    "- Rerun `npm test` before acting on behavior assumptions.",
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
    `2. \`npm run estimate:gateway-gas -- --from="${resolved.address}" --route-key="<routeKey>" --amount="<amount>"\``,
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
