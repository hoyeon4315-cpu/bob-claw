import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { readRadarJsonl } from "../src/strategy/radar/jsonl.mjs";
import { syncMerklQueueToRadar } from "../src/strategy/radar/merkl-queue-sync.mjs";

function merklQueue(overrides = {}) {
  return {
    generatedAt: "2026-05-01T08:30:00.000Z",
    summary: { queueCount: 1 },
    queue: [
      {
        queueId: "merkl:opp_sync_1",
        opportunityId: "opp_sync_1",
        chain: "base",
        protocolId: "yo",
        protocolName: "YO",
        poolOrMarket: "base:0xvault",
        name: "Deposit USDC to YO",
        family: "stable_treasury_carry",
        executionSurface: "stableCarry",
        canaryKind: "deposit_withdraw_tiny_stable_carry",
        queueStatus: "ready_for_tiny_live_canary",
        aprPct: 250,
        campaignRemainingHours: 24 * 21,
        tvlUsd: 20_000_000,
        executionReadiness: {
          matchedToken: { ticker: "USDC", estimatedUsd: 30 },
        },
        protocolBindingPlan: {
          bindingKind: "erc4626_vault_supply_withdraw",
          canaryActions: ["deposit_asset_for_shares", "withdraw_or_redeem_shares"],
        },
        autoEntry: {
          autoExecute: true,
        },
        ...overrides,
      },
    ],
  };
}

test("syncMerklQueueToRadar creates radar observations and candidates from ready Merkl queue items", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-merkl-sync-"));

  const first = await syncMerklQueueToRadar({ dataDir, merklQueue: merklQueue() });
  const second = await syncMerklQueueToRadar({ dataDir, merklQueue: merklQueue() });

  assert.equal(first.observationsWritten, 1);
  assert.equal(first.candidatesWritten, 1);
  assert.equal(second.observationsWritten, 0);
  assert.equal(second.candidatesWritten, 0);

  const observations = await readRadarJsonl(dataDir, "opportunity-observations");
  const candidates = await readRadarJsonl(dataDir, "executable-candidates");

  assert.equal(observations.length, 1);
  assert.equal(observations[0].obsId, "merkl:opp_sync_1");
  assert.equal(observations[0].chain, "base");
  assert.equal(observations[0].protocolId, "yo");

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].candidateId, "merkl:opp_sync_1");
  assert.equal(candidates[0].familyKey, "same_chain_stable_carry");
  assert.equal(candidates[0].executionPath, "base_native_evm");
  assert.equal(candidates[0].rewardTokenType, "stable");
  assert.equal(candidates[0].killSwitchState, "running");
});

test("syncMerklQueueToRadar appends a new candidate version when gate state changes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-merkl-sync-"));

  const blocked = await syncMerklQueueToRadar({
    dataDir,
    merklQueue: merklQueue({
      queueStatus: "queued_for_tiny_live_canary_preflight",
      executionReadiness: {
        matchedToken: { ticker: "USDC", estimatedUsd: 1 },
      },
    }),
  });
  const executable = await syncMerklQueueToRadar({
    dataDir,
    merklQueue: merklQueue({
      generatedAt: "2026-05-01T09:00:00.000Z",
      queueStatus: "ready_for_tiny_live_canary",
      executionReadiness: {
        matchedToken: { ticker: "USDC", estimatedUsd: 100 },
      },
    }),
  });

  assert.equal(blocked.candidatesWritten, 1);
  assert.equal(executable.candidatesWritten, 1);

  const candidates = await readRadarJsonl(dataDir, "executable-candidates");
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].candidateId, "merkl:opp_sync_1");
  assert.equal(candidates[0].gateStatus, "blocked");
  assert.equal(candidates[1].candidateId, "merkl:opp_sync_1");
  assert.equal(candidates[1].gateStatus, "executable");
  assert.deepEqual(candidates[1].blockers, []);
});

test("syncMerklQueueToRadar lets tiny canary EV decide below the generic position floor", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-merkl-sync-"));

  const result = await syncMerklQueueToRadar({
    dataDir,
    merklQueue: merklQueue({
      aprPct: 10_000,
      campaignRemainingHours: 24 * 30,
      executionReadiness: {
        matchedToken: { ticker: "USDC", estimatedUsd: 5 },
      },
    }),
  });

  assert.equal(result.candidatesWritten, 1);

  const candidates = await readRadarJsonl(dataDir, "executable-candidates");
  assert.equal(candidates[0].gateStatus, "executable");
  assert.equal(candidates[0].blockers.includes("position_below_min_position_usd"), false);
});

test("syncMerklQueueToRadar observes but does not candidate unsupported Merkl families", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-merkl-sync-"));

  const result = await syncMerklQueueToRadar({
    dataDir,
    merklQueue: merklQueue({
      opportunityId: "opp_sync_reserve",
      queueId: "merkl:opp_sync_reserve",
      family: "tokenized_gold_rotation",
      executionSurface: "reserveAllocation",
      canaryKind: "enter_exit_tiny_reserve_asset",
    }),
  });

  assert.equal(result.observationsWritten, 1);
  assert.equal(result.candidatesWritten, 0);
  assert.deepEqual(result.skippedCandidates, [{
    opportunityId: "opp_sync_reserve",
    reason: "radar_family_binding_unsupported",
  }]);
});
