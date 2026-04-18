import { buildSimulationSummary } from "./execution-sim.mjs";
import { buildForkExecutionSummary } from "./fork-execution.mjs";
import { defaultRunCommand, parseWhitelistedRefreshCommand, runParsedRefreshSteps } from "../session/shadow-refresh-runner.mjs";

export const DEFAULT_PRELIVE_EVIDENCE_FOLLOW_UP_COMMANDS = [
  "npm run report:prelive-readiness -- --write",
  "npm run build:prelive-review-package -- --write",
  "npm run status:dashboard",
  "npm run write:session-handoff",
];

function refreshBatchCommand(limit = 1) {
  const batchLimit = Math.max(4, Number(limit) || 1);
  return `npm run run:shadow-refresh-batch -- --execute --continue-on-failure --limit=${batchLimit}`;
}

export const DEFAULT_PRELIVE_EVIDENCE_ALLOWED_SCRIPTS = new Set([
  "analyze:ethereum-routes",
  "audit:eth-family-overfit",
  "run:shadow-refresh-batch",
  "run:prelive-simulation-loop",
  "run:prelive-simulations",
  "plan:prelive-fork-execution",
  "report:prelive-readiness",
  "build:prelive-review-package",
  "status:dashboard",
  "write:session-handoff",
]);

function latestByPlanId(records = []) {
  const latest = new Map();
  for (const record of records) {
    if (!record?.planId) continue;
    const current = latest.get(record.planId);
    if (!current || new Date(record.observedAt) > new Date(current.observedAt)) {
      latest.set(record.planId, record);
    }
  }
  return [...latest.values()];
}

function latestByObservedAt(records = []) {
  return [...records].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
}

function replacePlaceholder(command, placeholder, value) {
  if (!command || !value) return command;
  return String(command).replaceAll(placeholder, value);
}

function openPlannedCycle(plans = [], submissions = [], receipts = []) {
  const submittedIds = new Set(latestByPlanId(submissions).map((item) => item.planId));
  const receiptIds = new Set(latestByPlanId(receipts).map((item) => item.planId));
  return latestByObservedAt(
    latestByPlanId(plans).filter((item) => item.status === "planned" && !submittedIds.has(item.planId) && !receiptIds.has(item.planId)),
  );
}

function openSubmittedCycle(submissions = [], receipts = []) {
  const receiptIds = new Set(latestByPlanId(receipts).map((item) => item.planId));
  return latestByObservedAt(
    latestByPlanId(submissions).filter((item) => item.submissionStatus === "submitted" && !receiptIds.has(item.planId)),
  );
}

function action({
  code,
  label,
  status,
  automated,
  reason = null,
  blockers = [],
  command = null,
  details = {},
}) {
  return {
    code,
    label,
    status,
    automated,
    reason,
    blockers,
    command,
    details,
  };
}

function isShadowReplayPolicyGate(blockers = []) {
  if (!blockers.length) return false;
  return blockers.every(
    (blocker) => blocker === "manual_canary_review_not_ready" || String(blocker).startsWith("audit:"),
  );
}

export function buildPreliveEvidenceCampaign({
  reviewPackage = null,
  shadowRefreshBatchSummary = null,
  simulationRuns = [],
  forkExecutionPlans = [],
  forkExecutionSubmissions = [],
  forkExecutionReceipts = [],
  refreshBatchLimit = 1,
  simulationLimit = 4,
  now = new Date().toISOString(),
} = {}) {
  const queueFollowUps = reviewPackage?.queueFollowUps || [];
  const shadowReplay = reviewPackage?.preliveEvidence?.shadowReplay || null;
  const mechanicalSimulation = reviewPackage?.preliveEvidence?.mechanicalSimulation || null;
  const targetSimulationSuccessCount = mechanicalSimulation?.targetSuccessCount || 50;
  const simulationSummary = buildSimulationSummary(simulationRuns, {
    targetSuccessCount: targetSimulationSuccessCount,
  });
  const targetForkConfirmedCount = reviewPackage?.preliveEvidence?.forkExecution?.targetConfirmedCount || 3;
  const forkSummary = buildForkExecutionSummary({
    plans: forkExecutionPlans,
    submissions: forkExecutionSubmissions,
    receipts: forkExecutionReceipts,
    targetConfirmedCount: targetForkConfirmedCount,
  });
  const pendingOutputCycle = forkSummary.latestPendingOutput || null;
  const plannedCycle = openPlannedCycle(forkExecutionPlans, forkExecutionSubmissions, forkExecutionReceipts);
  const submittedCycle = openSubmittedCycle(forkExecutionSubmissions, forkExecutionReceipts);
  const shadowReplayBlockers = shadowReplay?.blockers || [];
  const shadowReplayReady = shadowReplayBlockers.length === 0;
  const mechanicalReady = simulationSummary.successRemaining <= 0 && shadowReplayReady;
  const refreshExecutionProven = (shadowRefreshBatchSummary?.runCount ?? 0) > 0;
  const refreshPlateauBlocked =
    queueFollowUps.length > 0 && refreshExecutionProven && isShadowReplayPolicyGate(shadowReplayBlockers);
  const ethFamilyObservation = reviewPackage?.ethFamilyObservation || null;
  const ethFamilySurfaceAction =
    ethFamilyObservation?.nextAction && ethFamilyObservation?.surfaceChanged
      ? action({
          code: ethFamilyObservation.nextAction.code,
          label: ethFamilyObservation.nextAction.label,
          status: "ready",
          automated: true,
          reason: ethFamilyObservation.reason || "eth_family_surface_changed",
          command: ethFamilyObservation.nextAction.command || null,
          details: {
            routeCount: ethFamilyObservation.routeCount ?? 0,
            addedRoutesCount: ethFamilyObservation.addedRoutesCount ?? 0,
            removedRoutesCount: ethFamilyObservation.removedRoutesCount ?? 0,
            addedChainPairs: ethFamilyObservation.addedChainPairs || [],
          },
        })
      : null;

  const actions = [
    ...(ethFamilySurfaceAction ? [ethFamilySurfaceAction] : []),
    queueFollowUps.length
      ? refreshPlateauBlocked
        ? action({
            code: "execute_refresh_batch",
            label: "execute refresh batch",
            status: "blocked",
            automated: true,
            reason: "shadow_replay_policy_gate",
            blockers: shadowReplayBlockers,
            details: {
              queueFollowUpCount: queueFollowUps.length,
              refreshRunCount: shadowRefreshBatchSummary?.runCount ?? 0,
              latestBatchStatus: shadowRefreshBatchSummary?.latestStatus || null,
            },
          })
        : action({
            code: "execute_refresh_batch",
            label: "execute refresh batch",
            status: "ready",
            automated: true,
            reason: queueFollowUps[0]?.reason || "queue_follow_up_available",
            command: refreshBatchCommand(refreshBatchLimit),
            details: {
              queueFollowUpCount: queueFollowUps.length,
              latestBatchStatus: shadowRefreshBatchSummary?.latestStatus || null,
            },
          })
      : action({
          code: "execute_refresh_batch",
          label: "execute refresh batch",
          status: "done",
          automated: true,
          reason: "no_queue_follow_up_remaining",
          details: {
            queueFollowUpCount: 0,
          },
        }),
    simulationSummary.successRemaining > 0
      ? shadowReplayReady
        ? action({
            code: "collect_simulation_evidence",
            label: "collect simulation evidence",
            status: "ready",
            automated: true,
            reason: "shadow_replay_ready",
            command:
              `npm run run:prelive-simulation-loop -- --execute --write --source=objective ` +
              `--limit=${simulationLimit} --target-success-count=${simulationSummary.targetSuccessCount}`,
            details: {
              successCount: simulationSummary.successCount,
              targetSuccessCount: simulationSummary.targetSuccessCount,
              successRemaining: simulationSummary.successRemaining,
            },
          })
        : action({
            code: "collect_simulation_evidence",
            label: "collect simulation evidence",
            status: "blocked",
            automated: true,
            reason: "shadow_replay_not_ready",
            blockers: shadowReplay?.blockers || ["shadow_replay_not_ready"],
            details: {
              successCount: simulationSummary.successCount,
              targetSuccessCount: simulationSummary.targetSuccessCount,
              successRemaining: simulationSummary.successRemaining,
            },
          })
      : action({
          code: "collect_simulation_evidence",
          label: "collect simulation evidence",
          status: "done",
          automated: true,
          reason: "simulation_target_reached",
          details: {
            successCount: simulationSummary.successCount,
            targetSuccessCount: simulationSummary.targetSuccessCount,
            successRemaining: 0,
          },
        }),
    forkSummary.successRemaining > 0
      ? pendingOutputCycle
        ? action({
            code: "prepare_fork_cycle",
            label: "prepare fork cycle",
            status: "done",
            automated: true,
            reason: "fork_output_pending_resolution",
            details: {
              planId: pendingOutputCycle.planId,
              txHash: pendingOutputCycle.txHash || null,
            },
          })
        : plannedCycle || submittedCycle
        ? action({
            code: "prepare_fork_cycle",
            label: "prepare fork cycle",
            status: "done",
            automated: true,
            reason: plannedCycle ? "fork_plan_already_open" : "fork_cycle_already_submitted",
            details: {
              planId: plannedCycle?.planId || submittedCycle?.planId || null,
            },
          })
        : mechanicalReady
          ? action({
              code: "prepare_fork_cycle",
              label: "prepare fork cycle",
              status: "ready",
              automated: true,
              reason: "mechanical_evidence_ready",
              command: "npm run plan:prelive-fork-execution -- --source=objective --write",
              details: {
                confirmedCount: forkSummary.confirmedCount,
                targetConfirmedCount: forkSummary.targetConfirmedCount,
                successRemaining: forkSummary.successRemaining,
              },
            })
          : action({
              code: "prepare_fork_cycle",
              label: "prepare fork cycle",
              status: "blocked",
              automated: true,
              reason: "mechanical_simulation_not_ready",
              blockers: reviewPackage?.preliveEvidence?.forkExecution?.blockers || ["mechanical_simulation_not_ready"],
              details: {
                confirmedCount: forkSummary.confirmedCount,
                targetConfirmedCount: forkSummary.targetConfirmedCount,
                successRemaining: forkSummary.successRemaining,
              },
            })
      : action({
          code: "prepare_fork_cycle",
          label: "prepare fork cycle",
          status: "done",
          automated: true,
          reason: "fork_target_reached",
          details: {
            confirmedCount: forkSummary.confirmedCount,
            targetConfirmedCount: forkSummary.targetConfirmedCount,
            successRemaining: 0,
          },
        }),
    forkSummary.successRemaining > 0
      ? pendingOutputCycle
        ? action({
            code: "submit_fork_cycle",
            label: "submit fork cycle",
            status: "done",
            automated: false,
            reason: "fork_output_pending_resolution",
            details: {
              planId: pendingOutputCycle.planId,
              txHash: pendingOutputCycle.txHash || null,
            },
          })
        : submittedCycle
        ? action({
            code: "submit_fork_cycle",
            label: "submit fork cycle",
            status: "done",
            automated: false,
            reason: "fork_cycle_already_submitted",
            details: {
              planId: submittedCycle.planId,
              txHash: submittedCycle.txHash || null,
            },
          })
        : plannedCycle
          ? action({
              code: "submit_fork_cycle",
              label: "submit fork cycle",
              status: "manual",
              automated: false,
              reason: "external_signer_required",
              command: plannedCycle.commands?.submit || null,
              details: {
                planId: plannedCycle.planId,
                routeLabel: plannedCycle.routeLabel || null,
              },
            })
          : action({
              code: "submit_fork_cycle",
              label: "submit fork cycle",
              status: "blocked",
              automated: false,
              reason: "fork_plan_required_first",
              blockers: ["fork_plan_required_first"],
            })
      : action({
          code: "submit_fork_cycle",
          label: "submit fork cycle",
          status: "done",
          automated: false,
          reason: "fork_target_reached",
        }),
    forkSummary.successRemaining > 0
      ? pendingOutputCycle
        ? action({
            code: "reconcile_fork_cycle",
            label: "reconcile fork cycle",
            status: "manual",
            automated: false,
            reason: "fork_output_resolution_required",
            command: pendingOutputCycle.resolutionCommand || null,
            details: {
              planId: pendingOutputCycle.planId,
              txHash: pendingOutputCycle.txHash || null,
              outputRequirements: pendingOutputCycle.outputRequirements || null,
            },
          })
        : submittedCycle
        ? action({
            code: "reconcile_fork_cycle",
            label: "reconcile fork cycle",
            status: "manual",
            automated: false,
            reason: "fork_submission_pending_reconciliation",
            command: replacePlaceholder(
              replacePlaceholder(
                (forkExecutionPlans.find((item) => item.planId === submittedCycle.planId) || {}).commands?.reconcile || null,
                "<txHash>",
                submittedCycle.txHash || "<txHash>",
              ),
              "\"<forkRpcUrl>\"",
              "\"<forkRpcUrl>\"",
            ),
            details: {
              planId: submittedCycle.planId,
              txHash: submittedCycle.txHash || null,
            },
          })
        : plannedCycle
          ? action({
              code: "reconcile_fork_cycle",
              label: "reconcile fork cycle",
              status: "blocked",
              automated: false,
              reason: "fork_submission_required_first",
              blockers: ["fork_submission_required_first"],
              details: {
                planId: plannedCycle.planId,
              },
            })
          : action({
              code: "reconcile_fork_cycle",
              label: "reconcile fork cycle",
              status: "blocked",
              automated: false,
              reason: "fork_submission_required_first",
              blockers: ["fork_submission_required_first"],
            })
      : action({
          code: "reconcile_fork_cycle",
          label: "reconcile fork cycle",
          status: "done",
          automated: false,
          reason: "fork_target_reached",
        }),
  ];

  const readyActionCount = actions.filter((item) => item.status === "ready").length;
  const blockedActionCount = actions.filter((item) => item.status === "blocked").length;
  const manualActionCount = actions.filter((item) => item.status === "manual").length;
  const doneActionCount = actions.filter((item) => item.status === "done").length;
  const nextAction = actions.find((item) => item.status !== "done") || null;
  const overallStatus = reviewPackage?.readyForManualReview
    ? "ready_for_manual_review"
    : readyActionCount > 0
      ? "ready"
      : manualActionCount > 0
        ? "awaiting_manual"
        : "blocked";

  return {
    schemaVersion: 1,
    generatedAt: now,
    overallStatus,
    reviewPackageStatus: reviewPackage?.packageStatus || null,
    currentStage: reviewPackage?.currentStage || null,
    readyActionCount,
    blockedActionCount,
    manualActionCount,
    doneActionCount,
    simulation: {
      successCount: simulationSummary.successCount,
      targetSuccessCount: simulationSummary.targetSuccessCount,
      successRemaining: simulationSummary.successRemaining,
      failureCount: simulationSummary.failureCount,
      latestFailureReason: simulationSummary.latestFailureReason || null,
    },
    forkExecution: {
      confirmedCount: forkSummary.confirmedCount,
      targetConfirmedCount: forkSummary.targetConfirmedCount,
      successRemaining: forkSummary.successRemaining,
      planCount: forkSummary.planCount,
      submittedCount: forkSummary.submittedCount,
      failedCount: forkSummary.failedCount,
      pendingOutputCount: forkSummary.pendingOutputCount,
      latestPendingOutput: forkSummary.latestPendingOutput,
    },
    refreshBatch: {
      runCount: shadowRefreshBatchSummary?.runCount ?? 0,
      latestStatus: shadowRefreshBatchSummary?.latestStatus || null,
      latestStopReason: shadowRefreshBatchSummary?.latestStopReason || null,
      queueFollowUpCount: queueFollowUps.length,
    },
    ethFamilyObservation: ethFamilyObservation
      ? {
          status: ethFamilyObservation.status || null,
          reason: ethFamilyObservation.reason || null,
          routeCount: ethFamilyObservation.routeCount ?? 0,
          surfaceChanged: Boolean(ethFamilyObservation.surfaceChanged),
          addedRoutesCount: ethFamilyObservation.addedRoutesCount ?? 0,
          removedRoutesCount: ethFamilyObservation.removedRoutesCount ?? 0,
          chainPairs: ethFamilyObservation.chainPairs || [],
          addedChainPairs: ethFamilyObservation.addedChainPairs || [],
        }
      : null,
    nextAction: nextAction
      ? {
          code: nextAction.code,
          label: nextAction.label,
          status: nextAction.status,
          reason: nextAction.reason,
          command: nextAction.command || null,
        }
      : null,
    actions,
    followUpCommands: DEFAULT_PRELIVE_EVIDENCE_FOLLOW_UP_COMMANDS,
  };
}

export function summarizePreliveEvidenceCampaign(campaign = null) {
  if (!campaign) return null;
  return {
    overallStatus: campaign.overallStatus || null,
    reviewPackageStatus: campaign.reviewPackageStatus || null,
    currentStage: campaign.currentStage || null,
    readyActionCount: campaign.readyActionCount ?? 0,
    blockedActionCount: campaign.blockedActionCount ?? 0,
    manualActionCount: campaign.manualActionCount ?? 0,
    doneActionCount: campaign.doneActionCount ?? 0,
    simulationSuccessCount: campaign.simulation?.successCount ?? 0,
    simulationTargetCount: campaign.simulation?.targetSuccessCount ?? 0,
    simulationRemaining: campaign.simulation?.successRemaining ?? 0,
    forkConfirmedCount: campaign.forkExecution?.confirmedCount ?? 0,
    forkTargetCount: campaign.forkExecution?.targetConfirmedCount ?? 0,
    forkRemaining: campaign.forkExecution?.successRemaining ?? 0,
    refreshRunCount: campaign.refreshBatch?.runCount ?? 0,
    ethFamilyObservation: campaign.ethFamilyObservation || null,
    nextAction: campaign.nextAction || null,
  };
}

function summarizeActionExecution(command, result, action) {
  return {
    code: action.code,
    label: action.label,
    command,
    scripts: result.steps.map((step) => step.script),
    executionStatus: result.executionStatus,
    steps: result.steps,
  };
}

export async function executePreliveEvidenceCampaign({
  campaign,
  execute = false,
  stopOnFailure = true,
  cwd = process.cwd(),
  env = process.env,
  runCommand = defaultRunCommand,
  allowedScripts = DEFAULT_PRELIVE_EVIDENCE_ALLOWED_SCRIPTS,
  followUpCommands = DEFAULT_PRELIVE_EVIDENCE_FOLLOW_UP_COMMANDS,
  now = new Date().toISOString(),
} = {}) {
  const campaignId = `${new Date(now).toISOString()}-${Math.random().toString(16).slice(2, 10)}`;
  const record = {
    schemaVersion: 1,
    observedAt: now,
    campaignId,
    mode: execute ? "execute" : "preview",
    stopOnFailure,
    campaignSnapshot: campaign,
    actionResults: [],
    followUps: [],
    executionStatus: execute ? "succeeded" : "preview",
    stopReason: null,
    finalStatus: execute ? campaign?.overallStatus || "unknown" : "preview",
  };

  if (!execute) {
    return record;
  }

  const readyAutomatedActions = (campaign?.actions || []).filter((item) => item.status === "ready" && item.automated && item.command);
  let executedAny = false;
  for (const item of readyAutomatedActions) {
    const steps = parseWhitelistedRefreshCommand(item.command, { allowedScripts });
    const result = await runParsedRefreshSteps(steps, { cwd, env, runCommand });
    executedAny = true;
    record.actionResults.push(summarizeActionExecution(item.command, result, item));
    if (stopOnFailure && result.executionStatus !== "succeeded") {
      record.executionStatus = "failed";
      record.finalStatus = "failed";
      record.stopReason = `${item.code}_failed`;
      return record;
    }
  }

  if (!executedAny) {
    record.executionStatus = campaign?.overallStatus === "awaiting_manual" ? "awaiting_manual" : campaign?.overallStatus || "blocked";
    record.finalStatus = record.executionStatus;
    record.stopReason = campaign?.nextAction?.reason || null;
    return record;
  }

  for (const command of followUpCommands) {
    const steps = parseWhitelistedRefreshCommand(command, { allowedScripts });
    const result = await runParsedRefreshSteps(steps, { cwd, env, runCommand });
    record.followUps.push({
      command,
      scripts: result.steps.map((step) => step.script),
      executionStatus: result.executionStatus,
      steps: result.steps,
    });
    if (stopOnFailure && result.executionStatus !== "succeeded") {
      record.executionStatus = "failed";
      record.finalStatus = "failed";
      record.stopReason = "campaign_follow_up_failed";
      return record;
    }
  }

  record.executionStatus = "succeeded";
  return record;
}

function latestCampaignFromRecord(record) {
  return record?.finalCampaign || record?.campaignSnapshot || null;
}

function statusForRecord(record) {
  return record?.finalStatus || record?.executionStatus || record?.mode || null;
}

export function buildPreliveEvidenceCampaignSummary(records = [], now = new Date().toISOString()) {
  const sorted = [...records].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt));
  const latest = sorted[0] || null;
  const executeRecords = sorted.filter((item) => item.mode === "execute");
  const previewCount = sorted.filter((item) => item.mode === "preview").length;
  const readyCount = executeRecords.filter((item) => statusForRecord(item) === "ready").length;
  const reviewReadyCount = executeRecords.filter((item) => statusForRecord(item) === "ready_for_manual_review").length;
  const awaitingManualCount = executeRecords.filter((item) => statusForRecord(item) === "awaiting_manual").length;
  const blockedCount = executeRecords.filter((item) => statusForRecord(item) === "blocked").length;
  const failureCount = executeRecords.filter((item) => statusForRecord(item) === "failed").length;
  return {
    schemaVersion: 1,
    generatedAt: now,
    runCount: executeRecords.length,
    previewCount,
    readyCount,
    reviewReadyCount,
    awaitingManualCount,
    blockedCount,
    failureCount,
    latestObservedAt: latest?.observedAt || null,
    latestStatus: statusForRecord(latest),
    latestMode: latest?.mode || null,
    latestStopReason: latest?.stopReason || null,
    nextAction: latestCampaignFromRecord(latest)?.nextAction || null,
    recentCampaigns: sorted.slice(0, 5).map((item) => {
      const campaign = latestCampaignFromRecord(item);
      return {
        observedAt: item.observedAt,
        campaignId: item.campaignId,
        mode: item.mode,
        finalStatus: statusForRecord(item),
        stopReason: item.stopReason,
        currentStage: campaign?.currentStage || null,
        readyActionCount: campaign?.readyActionCount ?? 0,
        blockedActionCount: campaign?.blockedActionCount ?? 0,
        manualActionCount: campaign?.manualActionCount ?? 0,
        simulationRemaining: campaign?.simulation?.successRemaining ?? 0,
        forkRemaining: campaign?.forkExecution?.successRemaining ?? 0,
        ethFamilyRouteCount: campaign?.ethFamilyObservation?.routeCount ?? 0,
        ethFamilySurfaceChanged: Boolean(campaign?.ethFamilyObservation?.surfaceChanged),
      };
    }),
  };
}
