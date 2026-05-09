import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildColdStartExecuteArgs,
  buildColdStartCanaryPlan,
  executeColdStartCanary,
} from "../../src/cli/run-cold-start-canary.mjs";

const candidate = {
  candidateId: "c1",
  packetId: "p1",
  gateStatus: "executable",
  observedAt: "2026-05-09T01:00:00.000Z",
  executionPath: "base_native_evm",
  familyKey: "same_chain_stable_carry",
  chain: "base",
  sanctionsFlag: "clean",
  bridgeRouteSanctionsCheck: "clean",
  killSwitchState: "running",
  proposedSizeBtc: 0.0001,
  committedCapBtc: 0.0002,
  amountUsd: 20,
  displayedAprPct: 500,
  expectedHoldDays: 30,
  sharePriceUnwindProof: { ok: true },
};

const strategyCapsById = {
  stablecoin_spread_loop: {
    strategyId: "stablecoin_spread_loop",
    autoExecute: true,
    caps: {
      perTxUsd: 25,
      perDayUsd: 100,
      perChainUsd: { base: 100 },
      maxDailyLossUsd: 25,
      tinyLivePerTxUsd: 20,
    },
  },
};

test("cold-start canary preview selects one candidate without executing", async () => {
  const plan = await buildColdStartCanaryPlan({
    packets: [{ packetId: "p1" }],
    candidates: [candidate],
    strategyCapsById,
    guards: { ok: true, readyForLiveBroadcast: true, blockers: [] },
    autoKill: { triggered: false, triggers: [] },
    now: "2026-05-09T01:05:00.000Z",
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.selectedCandidate.candidateId, "c1");
  assert.equal(plan.eligibleCandidates.length, 1);
  assert.equal(plan.selectedIntent.amountUsd, 20);
});

test("cold-start canary execute refuses every hard gate with exit-code semantics", async () => {
  const plan = await buildColdStartCanaryPlan({
    packets: [{ packetId: "p1" }],
    candidates: [candidate],
    strategyCapsById,
    guards: { ok: false, readyForLiveBroadcast: false, blockers: ["readiness_guard_blocked"] },
    autoKill: { triggered: false, triggers: [] },
    now: "2026-05-09T01:05:00.000Z",
  });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.exitCode, 2);
  assert.ok(plan.blockers.includes("readiness_guard_blocked"));
});

test("cold-start canary execute invokes radar promote at most once and records no-broadcast outcome", async () => {
  let calls = 0;
  const result = await executeColdStartCanary({
    plan: {
      status: "ready",
      selectedCandidate: { candidateId: "c1" },
      selectedIntent: { intentHash: "hash1", strategyId: "stablecoin_spread_loop" },
    },
    runRadarPromote: async () => {
      calls += 1;
      return { ok: true, stdout: "mode=execute\nready=1\nblocked=0\nsigned=false\n" };
    },
    pollReceipt: async () => null,
    now: "2026-05-09T01:05:00.000Z",
  });

  assert.equal(calls, 1);
  assert.equal(result.outcome, "not_broadcast");
  assert.equal(result.reason, "radar_promote_did_not_return_receipt");
});

test("cold-start execute uses scoped Merkl canary autopilot live path", () => {
  const command = buildColdStartExecuteArgs({
    candidateId: "merkl:13747891056392346282",
    intent: { amountUsd: 25 },
  });

  assert.equal(command.command, "npm");
  assert.deepEqual(command.args, [
    "run",
    "executor:merkl-canary-autopilot",
    "--",
    "--execute",
    "--json",
    "--max-candidates=1",
    "--opportunity-id=13747891056392346282",
    "--max-usd=25",
  ]);
});

test("cold-start execute reports confirmed broadcast from Merkl autopilot tx hash", async () => {
  const result = await executeColdStartCanary({
    plan: {
      status: "ready",
      selectedCandidate: { candidateId: "merkl:opp-1" },
      selectedIntent: { strategyId: "stablecoin_spread_loop", opportunityId: "opp-1", amountUsd: 25 },
    },
    runRadarPromote: async () => ({
      ok: true,
      stdout: JSON.stringify({
        status: "delivered",
        execution: {
          stepResults: [
            { id: "deposit", signerResult: { broadcast: { txHash: "0xabc" } } },
          ],
        },
      }),
    }),
    pollReceipt: async ({ txHash }) => ({
      lifecycle: { stage: "confirmed" },
      broadcast: { txHash },
    }),
    now: "2026-05-09T01:05:00.000Z",
  });

  assert.equal(result.outcome, "broadcast_confirmed");
  assert.equal(result.txHash, "0xabc");
  assert.equal(result.receipt.broadcast.txHash, "0xabc");
});
