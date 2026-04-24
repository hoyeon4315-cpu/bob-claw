import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMerklPositionExit } from "../src/executor/merkl-portfolio-exit.mjs";

function position(overrides = {}) {
  return {
    event: "position_opened",
    status: "open",
    positionId: "p1",
    opportunityId: "opp-1",
    chain: "base",
    protocolId: "yo",
    bindingKind: "erc4626_vault_supply_withdraw",
    strategyId: "gateway_native_asset_conversion_sleeve",
    amount: "250000",
    amountUsd: 0.25,
    shareDelta: "239017",
    assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
    minHoldUntil: "2026-04-24T06:46:49.813Z",
    ...overrides,
  };
}

function queueItem(overrides = {}) {
  return {
    opportunityId: "opp-1",
    chain: "base",
    protocolId: "yo",
    priorityScore: 105,
    campaignRemainingHours: 120,
    aprPct: 12,
    tvlUsd: 20_000_000,
    overfitRisk: "low",
    capabilityGaps: [],
    ...overrides,
  };
}

test("exit evaluator holds before min hold expires", () => {
  const result = evaluateMerklPositionExit({
    position: position(),
    queue: { queue: [queueItem({ campaignRemainingHours: 1 })] },
    now: "2026-04-24T06:20:00.000Z",
  });

  assert.equal(result.status, "hold");
  assert.ok(result.triggers.includes("campaign_expires_inside_exit_lookahead"));
  assert.ok(result.blockers.includes("min_hold_not_elapsed"));
});

test("exit evaluator marks position ready when opportunity disappears after min hold", () => {
  const result = evaluateMerklPositionExit({
    position: position(),
    queue: { queue: [] },
    now: "2026-04-24T06:50:00.000Z",
  });

  assert.equal(result.status, "exit_ready");
  assert.ok(result.triggers.includes("opportunity_missing_from_merkl_queue"));
});

test("force exit bypasses min hold blocker", () => {
  const result = evaluateMerklPositionExit({
    position: position(),
    queue: { queue: [queueItem()] },
    now: "2026-04-24T06:20:00.000Z",
    force: true,
  });

  assert.equal(result.status, "exit_ready");
  assert.ok(result.triggers.includes("force_exit_requested"));
  assert.equal(result.blockers.length, 0);
});
