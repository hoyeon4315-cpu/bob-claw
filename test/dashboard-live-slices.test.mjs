import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAllChainAutopilotDashboardSlice } from "../src/status/all-chain-autopilot-slice.mjs";
import { buildMerklActivePositions } from "../src/status/merkl-active-slice.mjs";
import { buildTreasuryHoldingsSlice } from "../src/status/treasury-holdings-slice.mjs";

test("all-chain autopilot dashboard slice keeps only public execution status", () => {
  const slice = buildAllChainAutopilotDashboardSlice({
    observedAt: "2026-04-25T03:13:42.514Z",
    mode: "execute",
    status: "completed_with_blockers",
    blockedReason: null,
    chains: ["ethereum", "bob", "base"],
    summary: {
      officialChainCount: 11,
      refillJobCount: 14,
      autoRefillJobCount: 3,
      refillAttemptedCount: 1,
      refillExecutedCount: 0,
      canarySweep: {
        status: "completed",
        executedCount: 9,
        deliveredCount: 9,
        blockedCount: 24,
        chainsTouched: ["base", "ethereum", "base"],
      },
      merklCanary: { status: "blocked", blockedReason: "no_autopilot_candidate_ready" },
      portfolio: {
        status: "positions_opened",
        allocator: {
          deployments: [
            { opportunityId: "137", status: "position_opened", txHash: "0xabc" },
            { opportunityId: "skip", status: "blocked", txHash: null },
          ],
        },
      },
      strategyDispatch: {
        batchStatus: "succeeded",
        selectedCount: 8,
        successCount: 14,
        failedCount: 0,
        liveEligibleCount: 0,
        missingExecutorCount: 0,
      },
      payback: {
        status: "carry",
        reason: "planned_payback_below_minimum",
        pendingCarrySats: 601,
      },
    },
    refillExecutions: [
      {
        chain: "optimism",
        asset: "wBTC.OFT",
        selectedExecutionMethod: "lifi",
        previewBlockedReason: "lifi_quote_rejected",
        attempted: false,
        executed: false,
      },
    ],
  });

  assert.equal(slice.present, true);
  assert.equal(slice.officialChainCount, 11);
  assert.equal(slice.canary.deliveredCount, 9);
  assert.deepEqual(slice.canary.chainsTouched, ["base", "ethereum"]);
  assert.equal(slice.portfolio.openedCount, 1);
  assert.equal(slice.payback.pendingCarrySats, 601);
  assert.equal(slice.refill.blockedCount, 1);
  assert.equal(slice.topBlockers.some((item) => item.reason === "lifi_quote_rejected"), true);
  assert.equal(slice.nextAction, "resolve_refill_routes");
});

test("Merkl active positions aggregate open live-capital entries", () => {
  const slice = buildMerklActivePositions(
    [
      {
        event: "position_opened",
        status: "open",
        opportunityId: "a",
        chain: "base",
        protocolId: "yo",
        name: "USDC Vault on Base",
        amountUsd: 5.1,
        observedAt: "2026-04-25T01:00:00.000Z",
      },
      {
        event: "position_opened",
        status: "open",
        opportunityId: "a",
        chain: "base",
        protocolId: "yo",
        name: "USDC Vault on Base",
        amountUsd: 1.2,
        observedAt: "2026-04-25T02:00:00.000Z",
      },
      {
        event: "position_closed",
        status: "closed",
        opportunityId: "b",
        chain: "ethereum",
        protocolId: "morpho",
        amountUsd: 10,
        observedAt: "2026-04-25T02:00:00.000Z",
      },
    ],
    { generatedAt: "2026-04-25T03:00:00.000Z" },
  );

  assert.equal(slice.activeCount, 1);
  assert.equal(slice.items[0].id, "merkl_a");
  assert.equal(slice.items[0].capUsd, 6.3);
  assert.deepEqual(slice.items[0].pair, ["usdc"]);
});

test("treasury holdings slice normalizes latest inventory into dashboard balances", () => {
  const slice = buildTreasuryHoldingsSlice(
    [
      {
        observedAt: "2026-04-25T01:00:00.000Z",
        summary: { estimatedWalletUsd: 1, activeChainCount: 1, supportedChainCount: 1 },
        native: [],
        tokens: [],
      },
      {
        observedAt: "2026-04-25T02:00:00.000Z",
        summary: {
          estimatedWalletUsd: 20.5,
          activeChainCount: 2,
          supportedChainCount: 3,
          nativeRefillRequiredCount: 1,
          tokenRefillRequiredCount: 2,
        },
        native: [{ chain: "base", asset: "ETH", actualDecimal: 0.01, estimatedUsd: 10, status: "ready" }],
        tokens: [{ chain: "base", ticker: "wBTC.OFT", actualDecimal: 0.0001, estimatedUsd: 7, status: "below_target" }],
      },
    ],
    { generatedAt: "2026-04-25T03:00:00.000Z" },
  );

  assert.equal(slice.pending, false);
  assert.equal(slice.totalUsd, 20.5);
  assert.equal(slice.activeChainCount, 2);
  assert.equal(slice.refillRequiredCount, 3);
  assert.deepEqual(slice.items.map((item) => item.sym), ["eth", "wbtc"]);
});
