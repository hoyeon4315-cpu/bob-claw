import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { refreshCanaryInputsIfNeeded } from "../src/cli/status-dashboard.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function writeJsonl(baseDir, name, records) {
  await mkdir(baseDir, { recursive: true });
  const path = join(baseDir, `${name}.jsonl`);
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

test("status dashboard refresh helper reruns stale canary inputs through existing scripts", () => {
  const calls = [];
  const result = refreshCanaryInputsIfNeeded({
    state: {
      address: "0x1111111111111111111111111111111111111111",
      nextStep: {
        route: {
          label: "avalanche->ethereum wBTC.OFT->WBTC",
          routeKey: "avalanche:0x0555->ethereum:0x2260",
          amount: "10000",
          srcChain: "avalanche",
          dstChain: "ethereum",
        },
      },
      dashboardStatus: {
        canaryInputs: {
          routeLabel: "avalanche->ethereum wBTC.OFT->WBTC",
          routeKey: "avalanche:0x0555->ethereum:0x2260",
          amount: "10000",
          gatewayQuote: { state: "stale" },
          exactGas: { state: "stale" },
          srcGas: { state: "stale" },
          dexQuote: { state: "fresh" },
          bitcoinFee: { state: "not_needed" },
          marketSnapshot: { state: "stale" },
        },
      },
    },
    address: "0x1111111111111111111111111111111111111111",
    runScript: (script, args = []) => {
      calls.push([script, args]);
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.refreshed, true);
  assert.deepEqual(calls, [
    ["src/cli/price-snapshot.mjs", []],
    ["src/cli/verify-gateway.mjs", ["--route-key=avalanche:0x0555->ethereum:0x2260", "--amounts=10000"]],
    ["src/cli/gas-snapshot.mjs", ["--chains=avalanche"]],
    ["src/cli/estimate-gateway-gas.mjs", ["--from=0x1111111111111111111111111111111111111111", "--route-key=avalanche:0x0555->ethereum:0x2260", "--amount=10000"]],
    ["src/cli/score-gateway.mjs", ["--write", "--route-key=avalanche:0x0555->ethereum:0x2260", "--amount=10000"]],
  ]);
});

test("status dashboard refresh helper tolerates targeted gateway refresh route misses", () => {
  const calls = [];
  const result = refreshCanaryInputsIfNeeded({
    state: {
      address: "0x1111111111111111111111111111111111111111",
      nextStep: {
        route: {
          label: "ethereum->bsc WBTC->wBTC.OFT",
          routeKey: "ethereum:0x2260->bsc:0x0555",
          amount: "150000",
          srcChain: "ethereum",
          dstChain: "bsc",
        },
      },
      dashboardStatus: {
        canaryInputs: {
          routeLabel: "ethereum->bsc WBTC->wBTC.OFT",
          routeKey: "ethereum:0x2260->bsc:0x0555",
          amount: "150000",
          gatewayQuote: { state: "missing" },
          exactGas: { state: "fresh" },
          srcGas: { state: "fresh" },
          dexQuote: { state: "fresh" },
          bitcoinFee: { state: "not_needed" },
          marketSnapshot: { state: "fresh" },
        },
      },
    },
    address: "0x1111111111111111111111111111111111111111",
    runScript: (script, args = []) => {
      calls.push([script, args]);
      if (script === "src/cli/verify-gateway.mjs") {
        const error = new Error("Command failed: node src/cli/verify-gateway.mjs");
        error.stderr = "Error: No Gateway routes matched the selected filters. Review route selection before continuing.";
        throw error;
      }
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.refreshed, true);
  assert.deepEqual(calls, [
    ["src/cli/verify-gateway.mjs", ["--route-key=ethereum:0x2260->bsc:0x0555", "--amounts=150000"]],
    ["src/cli/score-gateway.mjs", ["--write", "--route-key=ethereum:0x2260->bsc:0x0555", "--amount=150000"]],
  ]);
});

test("status dashboard refreshes shadow cycle before writing public status", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-status-"));
  const dataDir = join(cwd, "data");
  await mkdir(join(cwd, "dashboard", "public"), { recursive: true });

  await writeJsonl(dataDir, "treasury-inventory", [
    {
      observedAt: "2026-04-11T02:03:25.161Z",
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      supportedChains: ["bob"],
      activeChains: ["bob"],
      native: [],
      tokens: [],
      allowances: [],
      summary: {
        estimatedWalletUsd: 25.01,
      },
    },
  ]);
  await writeJsonl(dataDir, "merkl-portfolio-positions", [
    {
      event: "position_opened",
      status: "open",
      opportunityId: "merkl-test-1",
      strategyId: "gateway_native_asset_conversion_sleeve",
      chain: "base",
      protocolId: "yo",
      name: "USDC Vault on Base",
      amountUsd: 5,
      observedAt: "2026-04-11T02:04:00.000Z",
    },
  ]);
  await writeJsonl(dataDir, "execution-journal", [
    {
      eventType: "execution_funding_outcome",
      settlementStatus: "delivered",
      strategyId: "wrapped-btc-loop-base-moonwell",
      observedAt: "2026-04-11T02:05:30.000Z",
      chain: "base",
      asset: "cbBTC",
      amountUsd: 25.5,
      txHashes: ["0xabc"],
    },
  ]);
  await writeFile(
    join(dataDir, "wrapped-btc-lending-loop-slice.json"),
    `${JSON.stringify({
      strategy: {
        id: "wrapped-btc-loop-base-moonwell",
        chain: "base",
        protocol: "moonwell",
        targetHealthFactor: 1.8,
        healthFactorMin: 1.3,
        liquidationBufferPct: 12.5,
      },
      entryPlan: {
        projectedHealthFactor: 1.78,
        projectedLiquidationBufferPct: 15.2,
      },
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(dataDir, "all-chain-autopilot-latest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      observedAt: "2026-04-11T02:04:30.000Z",
      mode: "execute",
      status: "completed_with_blockers",
      blockedReason: null,
      chains: ["ethereum", "bob", "base"],
      summary: {
        officialChainCount: 11,
        refillJobCount: 1,
        autoRefillJobCount: 1,
        refillAttemptedCount: 0,
        refillExecutedCount: 0,
        canarySweep: {
          status: "completed",
          executedCount: 1,
          deliveredCount: 1,
          blockedCount: 0,
          chainsTouched: ["base"],
        },
        merklCanary: { status: "blocked", blockedReason: "no_autopilot_candidate_ready" },
        portfolio: { status: "positions_opened", allocator: { deployments: [] } },
        strategyDispatch: {
          batchStatus: "succeeded",
          selectedCount: 8,
          successCount: 8,
          failedCount: 0,
          liveEligibleCount: 0,
          missingExecutorCount: 0,
        },
        payback: { status: "carry", reason: "planned_payback_below_minimum", pendingCarrySats: 601 },
      },
      refillExecutions: [
        {
          chain: "optimism",
          asset: "wBTC.OFT",
          previewBlockedReason: "lifi_quote_rejected",
          executed: false,
        },
      ],
    })}\n`,
    "utf8",
  );
  await writeJsonl(dataDir, "connected-refresh-runs", [
    {
      observedAt: "2026-04-11T02:00:00.000Z",
      runId: "run-execute",
      mode: "execute",
      executionStatus: "succeeded",
      selectedRefreshCount: 5,
      selectedReevaluationCount: 2,
      finalPackage: {
        summary: {
          requiredRefreshCount: 0,
        },
        nextAction: {
          code: "advance_canary",
        },
      },
    },
    {
      observedAt: "2026-04-11T02:05:00.000Z",
      runId: "run-preview",
      mode: "preview",
      executionStatus: "preview",
      selectedRefreshCount: 1,
      selectedReevaluationCount: 0,
      stopReason: "remaining_refresh_steps_before_reevaluation",
      packageSnapshot: {
        summary: {
          requiredRefreshCount: 5,
        },
        nextAction: {
          code: "refresh_gateway_quote",
        },
      },
    },
  ]);
  await writeJsonl(dataDir, "current-route-prelive-passes", [
    {
      observedAt: "2026-04-11T02:10:00.000Z",
      runId: "pass-preview",
      mode: "preview",
      executionStatus: "preview",
      finalStatus: "connected_refresh_required",
      nextAction: {
        code: "execute_connected_refresh",
      },
      initialPass: {
        nextAction: {
          code: "execute_connected_refresh",
          command: "npm run run:connected-refresh-package -- --execute",
        },
      },
    },
  ]);
  await writeJsonl(dataDir, "shadow-refresh-batches", [
    {
      observedAt: "2026-04-11T02:11:00.000Z",
      batchId: "batch-failed",
      mode: "execute",
      batchStatus: "failed",
      stopReason: "queue_item_failed",
      selectedCount: 1,
      queueResults: [
        {
          executionStatus: "failed",
          routeLabel: "soneium->bob wBTC.OFT->wBTC.OFT",
          outcomeCategory: "rpc_unavailable",
          transientFailure: true,
        },
      ],
      followUps: [],
      circuitBreaker: { blocked: false },
    },
  ]);

  const result = spawnSync(process.execPath, [join(ROOT, "src/cli/status-dashboard.mjs")], {
    cwd,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
      PAYBACK_BTC_DEST_ADDR: "bc1qtestaddrxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    result.stdout,
    /paybackScheduler=defer reason=reserve_asset_missing next=none pendingSats=\d+ lastSettledSats=n\/a/,
  );
  assert.match(result.stdout, /paybackGrossProfitSatsPeriod=\d+ paidBackSatsLifetime=0/);
  assert.match(result.stdout, /opportunityPositiveInsufficient=count:\d+ top:[^ ]+ net:[^ ]+ gap:[^ \n]+/);
  assert.match(result.stdout, /formulaAudit=implemented:\d+ partial:\d+ missing:\d+ topGap:.+/);
  assert.match(result.stdout, /gasFreshness=missing:\d+ stale:\d+ staleChains=.*/);
  assert.equal(result.stdout.includes("paybackPreviewAfterDestination="), false);
  assert.match(result.stdout, /liveBaseline=blocked stage=shadow_replay refreshInputs=\d+ operator=\d+ technical=\d+ objective=\d+/);
  assert.match(result.stdout, /liveBaselineRefresh=.* next=.*/);

  const shadowCycle = JSON.parse(await readFile(join(dataDir, "shadow-cycle-latest.json"), "utf8"));
  const publicStatus = JSON.parse(await readFile(join(cwd, "dashboard/public/dashboard-status.json"), "utf8"));

  assert.equal(typeof shadowCycle.mode, "string");
  assert.equal(publicStatus.dataCounts.shadowCyclePresent, 1);
  assert.equal(publicStatus.dataCounts.liveBaselinePresent, 1);
  assert.equal(publicStatus.dataCounts.preliveSimulationRuns, 0);
  assert.equal(publicStatus.dataCounts.preliveForkPlans, 0);
  assert.equal(publicStatus.dataCounts.shadowRefreshExecutions, 0);
  assert.equal(publicStatus.dataCounts.shadowRefreshBatches, 1);
  assert.equal(publicStatus.shadowCycle.mode, shadowCycle.mode);
  assert.equal(typeof publicStatus.shadowCycle?.refreshExecution?.runCount, "number");
  assert.equal(Array.isArray(publicStatus.shadowCycle?.refreshExecution?.recentExecutions), true);
  assert.equal(typeof publicStatus.shadowCycle?.refreshBatch?.runCount, "number");
  assert.equal(Array.isArray(publicStatus.shadowCycle?.refreshBatch?.recentBatches), true);
  assert.equal(publicStatus.shadowCycle?.refreshBatch?.latestFailureCategory, "rpc_unavailable");
  assert.equal(publicStatus.shadowCycle?.refreshBatch?.latestFailureRouteLabel, "soneium->bob wBTC.OFT->wBTC.OFT");
  assert.equal(typeof publicStatus.prelive?.currentStage, "string");
  assert.equal(typeof publicStatus.liveBaseline?.status, "string");
  assert.equal(typeof publicStatus.liveBaseline?.counts?.requiredRefreshCount, "number");
  assert.equal(Array.isArray(publicStatus.liveBaseline?.blockers?.operator), true);
  assert.equal(
    publicStatus.strategy?.strategySnapshot?.researchBoard == null ||
      typeof publicStatus.strategy?.strategySnapshot?.researchBoard?.candidateCount === "number",
    true,
  );
  assert.equal(
    publicStatus.strategy?.strategySnapshot?.formulaAudit == null ||
      typeof publicStatus.strategy?.strategySnapshot?.formulaAudit?.summary?.missingCount === "number",
    true,
  );
  assert.equal(
    publicStatus.payback?.scheduler?.previewAfterDestination == null ||
      typeof publicStatus.payback?.scheduler?.previewAfterDestination?.status === "string",
    true,
  );
  assert.equal(publicStatus.payback?.scheduler?.previewAfterDestination?.reason ?? null, null);
  assert.equal(typeof publicStatus.prelive?.shadowReplay?.status, "string");
  assert.equal(typeof publicStatus.prelive?.mechanicalSimulation?.targetSuccessCount, "number");
  assert.equal(typeof publicStatus.prelive?.forkExecution?.targetConfirmedCount, "number");
  assert.equal(typeof publicStatus.prelive?.executionAudit?.status, "string");
  assert.equal(Array.isArray(publicStatus.prelive?.executionAudit?.recentTransitions), true);
  assert.equal(typeof publicStatus.prelive?.tinyLiveCanary?.status, "string");
  assert.equal(typeof publicStatus.prelive?.reviewPackage?.packageStatus, "string");
  assert.equal(typeof publicStatus.prelive?.reviewPackage?.readyForManualReview, "boolean");
  assert.equal(Array.isArray(publicStatus.prelive?.reviewPackage?.reviewBlockers), true);
  assert.equal(
    publicStatus.prelive?.connectedRefresh == null || typeof publicStatus.prelive?.connectedRefresh?.status === "string",
    true,
  );
  assert.equal(
    publicStatus.prelive?.connectedRefresh == null || typeof publicStatus.prelive?.connectedRefresh?.requiredRefreshCount === "number",
    true,
  );
  assert.equal(
    publicStatus.prelive?.connectedRefresh == null ||
      typeof publicStatus.prelive?.connectedRefresh?.runnerExecuteCommand === "string",
    true,
  );
  assert.equal(
    publicStatus.prelive?.connectedRefreshExecution == null ||
      typeof publicStatus.prelive?.connectedRefreshExecution?.runCount === "number",
    true,
  );
  assert.equal(
    publicStatus.prelive?.connectedRefreshExecution == null ||
      typeof publicStatus.prelive?.connectedRefreshExecution?.latestStatus === "string",
    true,
  );
  assert.equal(
    publicStatus.prelive?.currentRoutePrelivePass == null ||
      typeof publicStatus.prelive?.currentRoutePrelivePass?.runCount === "number",
    true,
  );
  assert.equal(
    publicStatus.prelive?.currentRoutePrelivePass == null ||
      typeof publicStatus.prelive?.currentRoutePrelivePass?.latestStatus === "string",
    true,
  );
  assert.equal(
    publicStatus.prelive?.exactRouteForkPackage == null || typeof publicStatus.prelive?.exactRouteForkPackage?.status === "string",
    true,
  );
  assert.equal(
    publicStatus.prelive?.exactRouteForkPackage == null || typeof publicStatus.prelive?.exactRouteForkPackage?.technicalStatus === "string",
    true,
  );
  assert.equal(
    publicStatus.prelive?.operationalJudgmentReview == null ||
      typeof publicStatus.prelive?.operationalJudgmentReview?.status === "string",
    true,
  );
  assert.equal(
    publicStatus.prelive?.operationalJudgmentReview == null ||
      typeof publicStatus.prelive?.operationalJudgmentReview?.issueCount === "number",
    true,
  );
  assert.equal(
    publicStatus.prelive?.evidenceCampaign?.latestStatus == null ||
      typeof publicStatus.prelive?.evidenceCampaign?.latestStatus === "string",
    true,
  );
  assert.equal(typeof publicStatus.prelive?.evidenceCampaign?.runCount, "number");
  assert.equal(typeof publicStatus.prelive?.evidenceCampaign?.current?.overallStatus, "string");
  if (publicStatus.canaryInputs) {
    assert.equal(typeof publicStatus.canaryInputs.routeLabel, "string");
    assert.equal(typeof publicStatus.canaryInputs.gatewayQuote?.state, "string");
    assert.equal(typeof publicStatus.canaryInputs.exactGas?.state, "string");
    assert.equal(Array.isArray(publicStatus.canaryInputs.blockers), true);
  } else {
    assert.equal(publicStatus.canaryInputs, null);
  }
  assert.equal(typeof publicStatus.watchers?.canaryInputs?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.canaryInputs?.reasonLabel, "string");
  assert.equal(Array.isArray(publicStatus.watchers?.canaryInputs?.inputLabels), true);
  assert.equal(typeof publicStatus.watchers?.gasRefresh?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.gasRefresh?.reasonLabel, "string");
  assert.equal(typeof publicStatus.watchers?.dexRefresh?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.dexRefresh?.reasonLabel, "string");
  assert.equal(typeof publicStatus.watchers?.dexRefresh?.targetRouteCount, "number");
  assert.equal(Array.isArray(publicStatus.watchers?.dexRefresh?.targetRoutes), true);
  assert.equal(typeof publicStatus.watchers?.blockedScore?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.blockedScore?.scope, "string");
  assert.equal(typeof publicStatus.watchers?.blockedScore?.targetRouteCount, "number");
  assert.equal(Array.isArray(publicStatus.watchers?.blockedScore?.targetRoutes), true);
  assert.equal(Array.isArray(publicStatus.watchers?.blockedScore?.changedInputLabels), true);
  assert.equal(typeof publicStatus.watchers?.quoteDecay?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.quoteDecay?.reasonLabel, "string");
  assert.equal(typeof publicStatus.watchers?.dexEnvironment?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.dexEnvironment?.reasonLabel, "string");
  assert.equal(typeof publicStatus.watchers?.dexEnvironment?.targetRouteCount, "number");
  assert.equal(Array.isArray(publicStatus.watchers?.dexEnvironment?.targetRoutes), true);
  assert.equal(typeof publicStatus.watchers?.gatewayCoverage?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.gatewayCoverage?.reasonLabel, "string");
  assert.equal(typeof publicStatus.watchers?.gatewayCoverage?.targetRouteCount, "number");
  assert.equal(Array.isArray(publicStatus.watchers?.gatewayCoverage?.targetRoutes), true);
  assert.equal(Array.isArray(publicStatus.gateway?.btcWatchlist?.observedTickers), true);
  assert.equal(Array.isArray(publicStatus.gateway?.btcWatchlist?.missingTickers), true);
  assert.equal(typeof publicStatus.gateway?.btcWatchlist?.unknownAssetCount, "number");
  assert.equal(
    publicStatus.strategy?.canarySelectionGap == null || typeof publicStatus.strategy?.canarySelectionGap?.selectionCode === "string",
    true,
  );
  assert.equal(
    publicStatus.strategy?.canarySelectionGap == null ||
      Array.isArray(publicStatus.strategy?.canarySelectionGap?.reviewPlan?.actionLabels),
    true,
  );
  assert.equal(
    publicStatus.strategy?.objectivePlans == null ||
      publicStatus.strategy?.objectivePlans?.executionReview == null ||
      typeof publicStatus.strategy?.objectivePlans?.executionReview?.nextActionCode === "string",
    true,
  );
  assert.equal(
    publicStatus.shadowCycle?.objectivePlans == null ||
      publicStatus.shadowCycle?.objectivePlans?.discovery == null ||
      typeof publicStatus.shadowCycle?.objectivePlans?.discovery?.nextActionCode === "string",
    true,
  );
  assert.equal(typeof publicStatus.dataCounts?.preliveReviewPackagePresent, "number");
  assert.equal(typeof publicStatus.dataCounts?.connectedRefreshRuns, "number");
  assert.equal(typeof publicStatus.dataCounts?.currentRoutePrelivePasses, "number");
  assert.equal(publicStatus.operations?.allChainAutopilot?.present, true);
  assert.equal(publicStatus.operations?.allChainAutopilot?.canary?.deliveredCount, 1);
  assert.equal(publicStatus.operations?.allChainAutopilot?.refill?.blockers?.[0]?.reason, "lifi_quote_rejected");
  assert.equal(publicStatus.strategy?.merklActivePositions?.activeCount, 1);
  assert.equal(publicStatus.walletHoldings?.pending, false);
  assert.equal(publicStatus.flow?.metrics?.assetValueUsd, 30.01);
  assert.equal(Array.isArray(publicStatus.flow?.recentActivities), true);
  assert.equal(publicStatus.flow?.recentActivities?.[0]?.kind, "execution");
  assert.equal(publicStatus.flow?.recentActivities?.[1]?.kind, "position");
  assert.equal(publicStatus.flow?.strategyRiskById?.["wrapped-btc-loop-base-moonwell"]?.projectedHealthFactor, 1.78);
  assert.equal(publicStatus.dataCounts?.allChainAutopilotPresent, 1);
  assert.equal(publicStatus.dataCounts?.merklActivePositionCount, 1);
  assert.equal(publicStatus.dataCounts?.treasuryInventoryRecords, 1);
  assert.equal(publicStatus.dataCounts?.flowPresent, 1);
});
