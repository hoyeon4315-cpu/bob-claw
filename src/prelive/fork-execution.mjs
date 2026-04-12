import { createHash } from "node:crypto";
import { stableSerialize } from "../execution/journal.mjs";

function deterministicId(payload) {
  return createHash("sha256").update(stableSerialize(payload)).digest("hex").slice(0, 20);
}

function routeLabel(selection) {
  if (selection?.label) return selection.label;
  if (selection?.routeLabel) return selection.routeLabel;
  if (selection?.quote?.route?.srcChain && selection?.quote?.route?.dstChain) {
    return `${selection.quote.route.srcChain}->${selection.quote.route.dstChain}`;
  }
  return selection?.routeKey || null;
}

function buildRouteContext(score = null) {
  if (!score) return null;
  return {
    routeKey: score.routeKey || null,
    amount: score.amount || null,
    srcChain: score.srcChain || null,
    dstChain: score.dstChain || null,
    inputUsd: score.inputUsd ?? null,
    outputUsd: score.outputUsd ?? null,
    executableOutputUsd: score.executableOutputUsd ?? null,
    netEdgeUsd: score.netEdgeUsd ?? null,
    executableNetEdgeUsd: score.executableNetEdgeUsd ?? null,
    executionGasUsd: score.executionGasUsd ?? null,
    nativeCostUsd: score.nativeCostUsd ?? null,
    tradeReadiness: score.tradeReadiness || null,
    srcAsset: score.srcAsset || null,
    dstAsset: score.dstAsset || null,
    price: score.price || null,
  };
}

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

export function buildForkExecutionPlan({
  selection,
  address = null,
  mode = "fork",
  targetEnvironment = "external_signed_fork",
  now = new Date().toISOString(),
} = {}) {
  const quote = selection?.quote || null;
  const blockers = [];
  if (!quote?.route?.srcChain) blockers.push("missing_source_chain");
  if (!quote?.txTo) blockers.push("missing_tx_to");
  if (!quote?.txData) blockers.push("missing_tx_data");
  const plannedAt = now;
  const planId = deterministicId({
    type: "prelive_fork_plan",
    routeKey: selection?.routeKey || quote?.routeKey || null,
    amount: selection?.amount || quote?.amount || null,
    to: quote?.txTo || null,
    data: quote?.txData || null,
    valueWei: quote?.txValueWei || "0",
    mode,
  });
  const status = blockers.length ? "blocked" : "planned";
  return {
    schemaVersion: 1,
    observedAt: plannedAt,
    planId,
    status,
    blockers,
    targetEnvironment,
    mode,
    routeKey: selection?.routeKey || quote?.routeKey || null,
    routeLabel: routeLabel(selection),
    amount: selection?.amount || quote?.amount || null,
    srcChain: quote?.route?.srcChain || null,
    dstChain: quote?.route?.dstChain || null,
    address: address || null,
    selectionSource: selection?.source || null,
    selectionSourceLabel: selection?.sourceLabel || null,
    selectionReason: selection?.reason || null,
    selectionCode: selection?.code || selection?.score?.tradeReadiness || null,
    queueRank: selection?.queueRank ?? null,
    routeContext: buildRouteContext(selection?.score || null),
    transaction: {
      from: address || null,
      to: quote?.txTo || null,
      data: quote?.txData || null,
      valueWei: String(quote?.txValueWei || "0"),
      txDataBytes: quote?.txDataBytes ?? null,
    },
    signer: {
      required: true,
      mode: "external_signed_raw_tx",
      storesPrivateKey: false,
    },
    commands: blockers.length
      ? {
          plan: null,
          submit: null,
          reconcile: null,
        }
      : {
          plan: `npm run plan:prelive-fork-execution -- --route-key="${selection?.routeKey || quote?.routeKey}" --amount="${selection?.amount || quote?.amount}" --write`,
          submit: `npm run submit:prelive-fork-execution -- --plan-id="${planId}" --signed-tx="<signedTx>" --rpc-url="<forkRpcUrl>"`,
          reconcile: `npm run reconcile:prelive-fork-execution -- --plan-id="${planId}" --tx-hash="<txHash>" --rpc-url="<forkRpcUrl>"`,
        },
  };
}

export function buildForkExecutionJob(plan) {
  return {
    jobId: plan.planId,
    chain: plan.srcChain,
    type: "prelive_fork_execution",
    asset: plan.routeContext?.srcAsset?.ticker || "wBTC",
    token: plan.routeContext?.srcAsset?.token || null,
    targetAmount: plan.amount,
    targetAmountDecimal: null,
    executionMethod: "external_signed_raw_tx",
    resourceKey: `${plan.routeKey || "unknown"}|${plan.amount || "unknown"}`,
    requiresManualReview: false,
    constraints: {
      targetEnvironment: plan.targetEnvironment,
      liveTradingBlocked: true,
    },
  };
}

export function buildForkExecutionSummary({
  plans = [],
  submissions = [],
  receipts = [],
  targetConfirmedCount = 3,
} = {}) {
  const latestPlans = latestByPlanId(plans);
  const latestSubmissions = latestByPlanId(submissions);
  const latestReceipts = latestByPlanId(receipts);
  const submittedCount = latestSubmissions.filter((item) => item.submissionStatus === "submitted").length;
  const submissionFailureCount = latestSubmissions.filter((item) => item.submissionStatus === "failed").length;
  const confirmedCount = latestReceipts.filter((item) => item.reconciliationStatus === "reconciled").length;
  const failedCount = latestReceipts.filter((item) => item.reconciliationStatus === "failed").length;
  const pendingOutputCount = latestReceipts.filter((item) => item.reconciliationStatus === "pending_output").length;
  const latestPlan = [...latestPlans].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
  const latestSubmission = [...latestSubmissions].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
  const latestReceipt = [...latestReceipts].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    planCount: latestPlans.length,
    submittedCount,
    submissionFailureCount,
    confirmedCount,
    failedCount,
    pendingOutputCount,
    targetConfirmedCount,
    successRemaining: Math.max(0, targetConfirmedCount - confirmedCount),
    latestPlan: latestPlan
      ? {
          observedAt: latestPlan.observedAt,
          routeLabel: latestPlan.routeLabel,
          routeKey: latestPlan.routeKey,
          amount: latestPlan.amount,
          status: latestPlan.status,
          selectionSource: latestPlan.selectionSource,
          selectionCode: latestPlan.selectionCode,
        }
      : null,
    latestSubmission: latestSubmission
      ? {
          observedAt: latestSubmission.observedAt,
          routeLabel: latestSubmission.routeLabel || null,
          amount: latestSubmission.amount || null,
          chain: latestSubmission.chain,
          submissionStatus: latestSubmission.submissionStatus,
        }
      : null,
    latestReceipt: latestReceipt
      ? {
          observedAt: latestReceipt.observedAt,
          routeLabel: latestReceipt.routeLabel || null,
          amount: latestReceipt.amount || null,
          reconciliationStatus: latestReceipt.reconciliationStatus,
          failed: Boolean(latestReceipt.flags?.failed),
        }
      : null,
  };
}
