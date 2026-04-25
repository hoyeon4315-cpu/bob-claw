import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSimulationSummary, selectSimulationTargets, simulateQuoteMechanicalPath } from "../src/prelive/execution-sim.mjs";

const WBTC = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

function routeKey(srcChain, dstChain) {
  return `${srcChain}:${WBTC}->${dstChain}:${WBTC}`;
}

function quote(srcChain, dstChain, observedAt, amount = "10000") {
  return {
    observedAt,
    routeKey: routeKey(srcChain, dstChain),
    amount,
    route: {
      srcChain,
      dstChain,
      srcToken: WBTC,
      dstToken: WBTC,
    },
    txTo: "0x1111111111111111111111111111111111111111",
    txData: "0x1234",
    txValueWei: "0",
    txDataBytes: 2,
  };
}

test("simulation target selection prefers latest objective quotes", () => {
  const older = quote("ethereum", "base", "2026-04-12T10:00:00.000Z");
  const newer = quote("ethereum", "base", "2026-04-12T10:05:00.000Z");
  const discovery = quote("ethereum", "unichain", "2026-04-12T10:06:00.000Z");
  const selected = selectSimulationTargets({
    quotes: [older, newer, discovery],
    shadowCycle: {
      objectivePlans: {
        executionReview: {
          routeKey: routeKey("ethereum", "base"),
          amount: "10000",
          label: "ethereum->base",
          selectionCode: "measured_leader_under_review",
          nextActionCode: "simulate_execution_path",
        },
        discovery: {
          routeKey: routeKey("ethereum", "unichain"),
          amount: "10000",
          label: "ethereum->unichain",
          source: "strategy_discovery",
          selectionCode: "underexplored_secondary_route",
          nextActionCode: "simulate_execution_path",
        },
      },
    },
    source: "objective",
  });

  assert.equal(selected.length, 2);
  assert.equal(selected[0].quote.observedAt, newer.observedAt);
  assert.equal(selected[0].source, "objective_execution_review");
  assert.equal(selected[1].source, "objective_discovery");
});

test("simulation target selection deprioritizes candidates with known wallet shortfalls", () => {
  const executionReview = quote("base", "ethereum", "2026-04-12T10:05:00.000Z");
  const discovery = quote("avalanche", "soneium", "2026-04-12T10:06:00.000Z");
  const selected = selectSimulationTargets({
    quotes: [executionReview, discovery],
    walletReadiness: [
      {
        observedAt: "2026-04-12T10:07:00.000Z",
        address: "0x000000000000000000000000000000000000dEaD",
        routeKey: routeKey("base", "ethereum"),
        amount: "10000",
        overallReady: false,
      },
      {
        observedAt: "2026-04-12T10:08:00.000Z",
        address: "0x000000000000000000000000000000000000dEaD",
        routeKey: routeKey("avalanche", "soneium"),
        amount: "10000",
        overallReady: true,
      },
    ],
    address: "0x000000000000000000000000000000000000dEaD",
    shadowCycle: {
      objectivePlans: {
        executionReview: {
          routeKey: routeKey("base", "ethereum"),
          amount: "10000",
          label: "base->ethereum",
          selectionCode: "check_wallet_readiness",
          nextActionCode: "simulate_execution_path",
        },
        discovery: {
          routeKey: routeKey("avalanche", "soneium"),
          amount: "10000",
          label: "avalanche->soneium",
          source: "strategy_discovery",
          selectionCode: "underexplored_secondary_route",
          nextActionCode: "simulate_execution_path",
        },
      },
    },
    source: "objective",
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].routeKey, routeKey("avalanche", "soneium"));
});

test("simulation target selection falls back to queue candidates when objective routes are wallet-blocked", () => {
  const queueCandidate = quote("avalanche", "soneium", "2026-04-12T10:06:00.000Z");
  const selected = selectSimulationTargets({
    quotes: [queueCandidate],
    walletReadiness: [
      {
        observedAt: "2026-04-12T10:07:00.000Z",
        address: "0x000000000000000000000000000000000000dEaD",
        routeKey: routeKey("base", "ethereum"),
        amount: "10000",
        overallReady: false,
      },
      {
        observedAt: "2026-04-12T10:08:00.000Z",
        address: "0x000000000000000000000000000000000000dEaD",
        routeKey: routeKey("avalanche", "soneium"),
        amount: "10000",
        overallReady: true,
      },
    ],
    address: "0x000000000000000000000000000000000000dEaD",
    shadowCycle: {
      objectivePlans: {
        executionReview: {
          routeKey: routeKey("base", "ethereum"),
          amount: "10000",
          label: "base->ethereum",
          selectionCode: "check_wallet_readiness",
          nextActionCode: "simulate_execution_path",
        },
      },
    },
    refreshPlan: {
      items: [
        {
          routeKey: routeKey("avalanche", "soneium"),
          amount: "10000",
          rank: 1,
          scope: "tx_ready_shadow",
          reason: "wallet_not_checked",
          routeLabel: "avalanche->soneium",
          code: "check_wallet_readiness",
        },
      ],
    },
    source: "objective",
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].routeKey, routeKey("avalanche", "soneium"));
  assert.equal(selected[0].source, "queue");
});

test("mechanical simulation records success and builds aggregate summary", async () => {
  const selection = {
    routeKey: routeKey("ethereum", "base"),
    amount: "10000",
    source: "objective_execution_review",
    sourceLabel: "execution_review",
    quote: quote("ethereum", "base", "2026-04-12T10:05:00.000Z"),
    score: {
      tradeReadiness: "shadow_candidate_review_only",
      netEdgeUsd: 0.6,
      executableNetEdgeUsd: 0.5,
    },
  };
  const record = await simulateQuoteMechanicalPath({
    selection,
    from: "0x000000000000000000000000000000000000dEaD",
    prices: {
      nativeByChain: {
        ethereum: 2000,
      },
    },
    getGasSnapshotImpl: async () => ({
      rpcUrl: "https://rpc.example",
      gasPriceWei: "1000000000",
    }),
    estimateGasImpl: async () => ({
      rpcUrl: "https://rpc.example",
      gasUnits: 21000,
      latencyMs: 9,
    }),
    simulateTransactionCallImpl: async () => ({
      rpcUrl: "https://rpc.example",
      blockTag: "latest",
      returnData: "0x1234",
    }),
  });

  assert.equal(record.status, "simulated_ok");
  assert.equal(record.gasEstimate.ok, true);
  assert.equal(record.call.ok, true);
  assert.equal(record.estimatedGasUsd, 0.042);

  const summary = buildSimulationSummary(
    [
      record,
      {
        ...record,
        observedAt: "2026-04-12T10:06:00.000Z",
        status: "simulation_failed",
        ok: false,
        gasEstimate: { ok: true },
        call: { ok: false, reason: "execution_reverted" },
      },
      {
        ...record,
        observedAt: "2026-04-12T10:07:00.000Z",
        routeKey: routeKey("bitcoin", "bob"),
        amount: "20000",
        status: "skipped",
        ok: false,
        skipReason: "bitcoin_source_no_evm_tx",
      },
    ],
    { targetSuccessCount: 2 },
  );

  assert.equal(summary.successCount, 1);
  assert.equal(summary.failureCount, 1);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.successRemaining, 1);
  assert.equal(summary.routeSelectionCount, 2);
  assert.equal(summary.latestFailureReason, "execution_reverted");
});

test("mechanical simulation skips unsupported payloads", async () => {
  const record = await simulateQuoteMechanicalPath({
    selection: {
      routeKey: "bitcoin:btc->bob:wbtc.oft",
      amount: "10000",
      quote: {
        routeKey: "bitcoin:btc->bob:wbtc.oft",
        amount: "10000",
        route: {
          srcChain: "bitcoin",
          dstChain: "bob",
        },
      },
    },
    from: "0x000000000000000000000000000000000000dEaD",
  });

  assert.equal(record.status, "skipped");
  assert.equal(record.skipReason, "bitcoin_source_no_evm_tx");
});
