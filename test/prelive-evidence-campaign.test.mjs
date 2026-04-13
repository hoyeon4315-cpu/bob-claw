import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPreliveEvidenceCampaign,
  buildPreliveEvidenceCampaignSummary,
  executePreliveEvidenceCampaign,
} from "../src/prelive/evidence-campaign.mjs";

test("evidence campaign prioritizes refresh work before blocked simulation and fork steps", () => {
  const campaign = buildPreliveEvidenceCampaign({
    reviewPackage: {
      packageStatus: "not_ready_for_manual_review",
      readyForManualReview: false,
      currentStage: "shadow_replay",
      queueFollowUps: [
        {
          rank: 1,
          scope: "canary",
          reason: "scheduled_readiness_check",
        },
      ],
      preliveEvidence: {
        shadowReplay: {
          blockers: ["audit:LIVE_BLOCKED"],
        },
        mechanicalSimulation: {
          targetSuccessCount: 50,
        },
        forkExecution: {
          targetConfirmedCount: 3,
        },
      },
    },
    simulationRuns: [],
    forkExecutionPlans: [],
    forkExecutionSubmissions: [],
    forkExecutionReceipts: [],
  });

  assert.equal(campaign.overallStatus, "ready");
  assert.equal(campaign.actions[0].code, "execute_refresh_batch");
  assert.equal(campaign.actions[0].status, "ready");
  assert.equal(campaign.actions[1].code, "collect_simulation_evidence");
  assert.equal(campaign.actions[1].status, "blocked");
  assert.equal(campaign.actions[2].status, "blocked");
  assert.equal(campaign.nextAction.code, "execute_refresh_batch");
});

test("evidence campaign blocks repeated refresh execution when only audit or manual review gates remain", () => {
  const campaign = buildPreliveEvidenceCampaign({
    reviewPackage: {
      packageStatus: "not_ready_for_manual_review",
      readyForManualReview: false,
      currentStage: "shadow_replay",
      queueFollowUps: [
        {
          rank: 1,
          scope: "canary",
          reason: "scheduled_readiness_check",
        },
      ],
      preliveEvidence: {
        shadowReplay: {
          blockers: ["audit:LIVE_BLOCKED", "manual_canary_review_not_ready"],
        },
        mechanicalSimulation: {
          targetSuccessCount: 50,
        },
        forkExecution: {
          targetConfirmedCount: 3,
        },
      },
    },
    shadowRefreshBatchSummary: {
      runCount: 3,
      successCount: 3,
      latestStatus: "succeeded",
    },
    simulationRuns: [],
    forkExecutionPlans: [],
    forkExecutionSubmissions: [],
    forkExecutionReceipts: [],
  });

  assert.equal(campaign.overallStatus, "blocked");
  assert.equal(campaign.actions[0].code, "execute_refresh_batch");
  assert.equal(campaign.actions[0].status, "blocked");
  assert.equal(campaign.actions[0].reason, "shadow_replay_policy_gate");
  assert.deepEqual(campaign.actions[0].blockers, ["audit:LIVE_BLOCKED", "manual_canary_review_not_ready"]);
  assert.equal(campaign.nextAction.code, "execute_refresh_batch");
  assert.equal(campaign.nextAction.status, "blocked");
});

test("evidence campaign switches to awaiting manual when fork plan is ready for external signer", () => {
  const campaign = buildPreliveEvidenceCampaign({
    reviewPackage: {
      packageStatus: "not_ready_for_manual_review",
      readyForManualReview: false,
      currentStage: "fork_execution",
      queueFollowUps: [],
      preliveEvidence: {
        shadowReplay: {
          blockers: [],
        },
        mechanicalSimulation: {
          targetSuccessCount: 2,
        },
        forkExecution: {
          targetConfirmedCount: 2,
        },
      },
    },
    simulationRuns: [
      { observedAt: "2026-04-12T10:00:00.000Z", status: "simulated_ok" },
      { observedAt: "2026-04-12T10:05:00.000Z", status: "simulated_ok" },
    ],
    forkExecutionPlans: [
      {
        observedAt: "2026-04-12T10:06:00.000Z",
        planId: "plan-1",
        status: "planned",
        routeLabel: "ethereum->base",
        commands: {
          submit: 'npm run submit:prelive-fork-execution -- --plan-id="plan-1" --signed-tx="<signedTx>" --rpc-url="<forkRpcUrl>"',
          reconcile: 'npm run reconcile:prelive-fork-execution -- --plan-id="plan-1" --tx-hash="<txHash>" --rpc-url="<forkRpcUrl>"',
        },
      },
    ],
    forkExecutionSubmissions: [],
    forkExecutionReceipts: [],
  });

  assert.equal(campaign.overallStatus, "awaiting_manual");
  assert.equal(campaign.actions[0].status, "done");
  assert.equal(campaign.actions[1].status, "done");
  assert.equal(campaign.actions[2].status, "done");
  assert.equal(campaign.actions[3].code, "submit_fork_cycle");
  assert.equal(campaign.actions[3].status, "manual");
  assert.match(campaign.actions[3].command, /submit:prelive-fork-execution/);
  assert.equal(campaign.actions[4].status, "blocked");
});

test("evidence campaign routes pending output into manual resolution before new fork cycles", () => {
  const campaign = buildPreliveEvidenceCampaign({
    reviewPackage: {
      packageStatus: "not_ready_for_manual_review",
      readyForManualReview: false,
      currentStage: "fork_execution",
      queueFollowUps: [],
      preliveEvidence: {
        shadowReplay: {
          blockers: [],
        },
        mechanicalSimulation: {
          targetSuccessCount: 2,
        },
        forkExecution: {
          targetConfirmedCount: 2,
        },
      },
    },
    simulationRuns: [
      { observedAt: "2026-04-12T10:00:00.000Z", status: "simulated_ok" },
      { observedAt: "2026-04-12T10:05:00.000Z", status: "simulated_ok" },
    ],
    forkExecutionPlans: [
      {
        observedAt: "2026-04-12T10:06:00.000Z",
        planId: "plan-1",
        status: "planned",
        routeLabel: "ethereum->base",
        dstChain: "base",
        routeContext: {
          routeKey: "ethereum:btc->base:btc",
          dstAsset: { chain: "base", token: "0x0555" },
          price: { dstRawUsd: 73000 },
        },
        commands: {
          submit: 'npm run submit:prelive-fork-execution -- --plan-id="plan-1" --signed-tx="<signedTx>" --rpc-url="<forkRpcUrl>"',
          reconcile: 'npm run reconcile:prelive-fork-execution -- --plan-id="plan-1" --tx-hash="<txHash>" --rpc-url="<forkRpcUrl>"',
          resolveOutput:
            'npm run reconcile:prelive-fork-execution -- --plan-id="plan-1" --tx-hash="<txHash>" --rpc-url="<forkRpcUrl>" --actual-output-units="<actualOutputUnits>"',
        },
      },
    ],
    forkExecutionSubmissions: [
      {
        observedAt: "2026-04-12T10:07:00.000Z",
        planId: "plan-1",
        submissionStatus: "submitted",
        txHash: "0xabc",
      },
    ],
    forkExecutionReceipts: [
      {
        observedAt: "2026-04-12T10:08:00.000Z",
        planId: "plan-1",
        routeLabel: "ethereum->base",
        amount: "10000",
        txHash: "0xabc",
        reconciliationStatus: "pending_output",
        routeContext: {
          routeKey: "ethereum:btc->base:btc",
          dstAsset: { chain: "base", token: "0x0555" },
          price: { dstRawUsd: 73000 },
        },
        flags: { failed: false },
      },
    ],
  });

  assert.equal(campaign.overallStatus, "awaiting_manual");
  assert.equal(campaign.actions[2].code, "prepare_fork_cycle");
  assert.equal(campaign.actions[2].status, "done");
  assert.equal(campaign.actions[2].reason, "fork_output_pending_resolution");
  assert.equal(campaign.actions[3].status, "done");
  assert.equal(campaign.actions[4].status, "manual");
  assert.equal(campaign.actions[4].reason, "fork_output_resolution_required");
  assert.match(campaign.actions[4].command, /actual-output-units/);
  assert.equal(campaign.forkExecution.pendingOutputCount, 1);
});

test("evidence campaign executes automated actions and follow-up refresh commands", async () => {
  const calls = [];
  const record = await executePreliveEvidenceCampaign({
    campaign: {
      overallStatus: "ready",
      actions: [
        {
          code: "execute_refresh_batch",
          label: "execute refresh batch",
          status: "ready",
          automated: true,
          command: "npm run run:shadow-refresh-batch -- --execute --limit=1",
        },
        {
          code: "collect_simulation_evidence",
          label: "collect simulation evidence",
          status: "ready",
          automated: true,
          command: "npm run run:prelive-simulations -- --source=objective --limit=2 --write",
        },
        {
          code: "submit_fork_cycle",
          label: "submit fork cycle",
          status: "manual",
          automated: false,
          command: 'npm run submit:prelive-fork-execution -- --plan-id="plan-1" --signed-tx="<signedTx>" --rpc-url="<forkRpcUrl>"',
        },
      ],
    },
    execute: true,
    followUpCommands: ["npm run status:dashboard", "npm run write:session-handoff"],
    runCommand: async ({ step }) => {
      calls.push(step.script);
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 8,
        stdout: "ok",
        stderr: "",
      };
    },
  });

  assert.equal(record.executionStatus, "succeeded");
  assert.equal(record.actionResults.length, 2);
  assert.equal(record.followUps.length, 2);
  assert.deepEqual(calls, ["run:shadow-refresh-batch", "run:prelive-simulations", "status:dashboard", "write:session-handoff"]);
});

test("evidence campaign summary aggregates preview and execute outcomes", () => {
  const summary = buildPreliveEvidenceCampaignSummary([
    {
      observedAt: "2026-04-12T12:00:00.000Z",
      campaignId: "c1",
      mode: "execute",
      finalStatus: "ready",
      stopReason: null,
      finalCampaign: {
        currentStage: "shadow_replay",
        readyActionCount: 1,
        blockedActionCount: 2,
        manualActionCount: 0,
        simulation: { successRemaining: 50 },
        forkExecution: { successRemaining: 3 },
      },
    },
    {
      observedAt: "2026-04-12T12:01:00.000Z",
      campaignId: "c2",
      mode: "execute",
      finalStatus: "awaiting_manual",
      stopReason: null,
      finalCampaign: {
        currentStage: "fork_execution",
        readyActionCount: 0,
        blockedActionCount: 1,
        manualActionCount: 1,
        simulation: { successRemaining: 0 },
        forkExecution: { successRemaining: 2 },
      },
    },
    {
      observedAt: "2026-04-12T12:02:00.000Z",
      campaignId: "c3",
      mode: "preview",
      finalStatus: "preview",
      stopReason: null,
      campaignSnapshot: {
        currentStage: "shadow_replay",
        nextAction: { code: "execute_refresh_batch" },
      },
    },
  ]);

  assert.equal(summary.runCount, 2);
  assert.equal(summary.previewCount, 1);
  assert.equal(summary.readyCount, 1);
  assert.equal(summary.awaitingManualCount, 1);
  assert.equal(summary.latestStatus, "preview");
  assert.equal(summary.recentCampaigns[0].campaignId, "c3");
});
