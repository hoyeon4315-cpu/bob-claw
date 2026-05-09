import assert from "node:assert/strict";
import test from "node:test";

import {
  diagnoseMerklQueueReadiness,
  merklQueueItemToRadarCandidate,
} from "../../../src/strategy/radar/merkl-queue-sync.mjs";

function queueItem(overrides = {}) {
  return {
    opportunityId: "opp-queue",
    queueId: "queue-1",
    observedAt: "2026-05-09T00:00:00.000Z",
    chain: "base",
    protocolId: "morpho",
    family: "stable_treasury_carry",
    aprPct: 120,
    queueStatus: "blocked",
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind: "erc4626_vault_supply_withdraw",
      canaryActions: ["deposit", "withdraw"],
    },
    executionReadiness: {
      status: "executor_missing",
      matchedToken: { ticker: "USDC", estimatedUsd: 30 },
    },
    autoEntry: {
      autoExecute: false,
      blockers: ["executor_missing"],
    },
    ...overrides,
  };
}

test("Merkl queue not-ready persists as manual review with diagnosis after refresh", () => {
  const diagnosis = diagnoseMerklQueueReadiness(queueItem());
  assert.equal(diagnosis.code, "manual_operator_review_required");
  assert.equal(diagnosis.originalBlocker, "merkl_queue_not_ready_for_tiny_live_canary");
  assert.match(diagnosis.diagnosis, /queue_status:blocked/);
  assert.match(diagnosis.diagnosis, /inventory:executor_missing/);

  const { candidate } = merklQueueItemToRadarCandidate(
    { generatedAt: "2026-05-09T00:00:00.000Z", queue: [] },
    queueItem(),
  );
  assert.equal(candidate.gateStatus, "blocked");
  assert.ok(candidate.blockers.includes("manual_operator_review_required"));
  assert.equal(candidate.blockers.includes("merkl_queue_not_ready_for_tiny_live_canary"), false);
  assert.equal(
    candidate.metadata.queueReadinessDiagnosis.originalBlocker,
    "merkl_queue_not_ready_for_tiny_live_canary",
  );
});

test("ready Merkl queue items do not carry manual queue diagnosis", () => {
  const { candidate } = merklQueueItemToRadarCandidate(
    { generatedAt: "2026-05-09T00:00:00.000Z", queue: [] },
    queueItem({
      queueStatus: "ready_for_tiny_live_canary",
      executionReadiness: {
        status: "inventory_ready",
        matchedToken: { ticker: "USDC", estimatedUsd: 30 },
      },
      autoEntry: { autoExecute: true, blockers: [] },
    }),
  );

  assert.equal(candidate.metadata.queueReadinessDiagnosis, null);
  assert.equal(candidate.blockers.includes("manual_operator_review_required"), false);
});
