import { createHash } from "node:crypto";
import { tokenAsset } from "../assets/tokens.mjs";
import { config } from "../config/env.mjs";
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

function normalizedAddress(value) {
  return value ? String(value).toLowerCase() : null;
}

function paddedAddressNeedle(value) {
  const normalized = normalizedAddress(value);
  if (!normalized?.startsWith("0x") || normalized.length !== 42) return null;
  return normalized.slice(2).padStart(64, "0");
}

function txDataContainsAddress(txData, address) {
  const needle = paddedAddressNeedle(address);
  if (!needle || !txData) return false;
  return String(txData).toLowerCase().includes(needle);
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

function routeKey(record = null) {
  return record?.routeKey || record?.routeContext?.routeKey || null;
}

function parseRouteKey(routeKeyValue = null) {
  const [src = "", dst = ""] = String(routeKeyValue || "").split("->");
  const [srcChain, srcToken] = src.split(":");
  const [dstChain, dstToken] = dst.split(":");
  if (!srcChain || !dstChain) return null;
  return {
    srcChain,
    srcToken: srcToken || null,
    dstChain,
    dstToken: dstToken || null,
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function driftUsd(actualValue, expectedValue) {
  if (!Number.isFinite(actualValue) || !Number.isFinite(expectedValue)) return null;
  return actualValue - expectedValue;
}

export function buildForkOutputRequirements(plan = null) {
  const parsedRoute = parseRouteKey(plan?.routeKey);
  const outputChain = plan?.routeContext?.dstAsset?.chain || parsedRoute?.dstChain || plan?.dstChain || null;
  const outputToken = plan?.routeContext?.dstAsset?.token || parsedRoute?.dstToken || null;
  const outputAsset = outputChain && outputToken ? tokenAsset(outputChain, outputToken) : null;
  const canPriceFromAsset = Boolean(outputAsset?.priceKey || outputAsset?.isNative);
  return {
    needsActualOutputUnits: true,
    needsOutputAsset: !(outputChain && outputToken),
    needsOutputPriceUsd: !Number.isFinite(plan?.routeContext?.price?.dstRawUsd) && !canPriceFromAsset,
    outputChain,
    outputToken,
    outputPriceUsd: Number.isFinite(plan?.routeContext?.price?.dstRawUsd) ? plan.routeContext.price.dstRawUsd : null,
  };
}

export function buildForkOutputResolutionCommand(plan = null, txHash = "<txHash>") {
  if (!plan?.planId) return null;
  const requirements = buildForkOutputRequirements(plan);
  const command = [
    `npm run reconcile:prelive-fork-execution -- --plan-id="${plan.planId}"`,
    `--tx-hash="${txHash || "<txHash>"}"`,
    `--rpc-url="<forkRpcUrl>"`,
    `--actual-output-units="<actualOutputUnits>"`,
  ];
  if (requirements.needsOutputAsset) {
    command.push(`--output-chain="${requirements.outputChain || "<outputChain>"}"`);
    command.push(`--output-token="${requirements.outputToken || "<outputToken>"}"`);
  }
  if (requirements.needsOutputPriceUsd) {
    command.push(`--output-price-usd="${requirements.outputPriceUsd ?? "<outputPriceUsd>"}"`);
  }
  return command.join(" ");
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
  const expectedAddress = normalizedAddress(address);
  if (!quote?.route?.srcChain) blockers.push("missing_source_chain");
  if (!quote?.txTo) blockers.push("missing_tx_to");
  if (!quote?.txData) blockers.push("missing_tx_data");
  if (
    expectedAddress &&
    quote?.route?.srcChain &&
    quote.route.srcChain !== "bitcoin" &&
    quote?.sender &&
    normalizedAddress(quote.sender) !== expectedAddress
  ) {
    blockers.push("quote_sender_mismatch");
  }
  if (
    expectedAddress &&
    quote?.route?.dstChain &&
    quote.route.dstChain !== "bitcoin" &&
    quote?.recipient &&
    normalizedAddress(quote.recipient) !== expectedAddress
  ) {
    blockers.push("quote_recipient_mismatch");
  }
  if (
    expectedAddress &&
    quote?.route?.dstChain &&
    quote.route.dstChain !== "bitcoin" &&
    normalizedAddress(config.verifyRecipient) !== expectedAddress &&
    txDataContainsAddress(quote?.txData, config.verifyRecipient)
  ) {
    blockers.push("quote_verify_recipient_in_tx_data");
  }
  const plannedAt = now;
  const routeContext = buildRouteContext(selection?.score || null);
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
    routeContext,
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
          submit: `npm run submit:prelive-fork-execution -- --plan-id="${planId}" --use-signer-daemon --rpc-url="<forkRpcUrl>"`,
          reconcile: `npm run reconcile:prelive-fork-execution -- --plan-id="${planId}" --tx-hash="<txHash>" --rpc-url="<forkRpcUrl>"`,
          resolveOutput: buildForkOutputResolutionCommand(
            {
              planId,
              dstChain: quote?.route?.dstChain || null,
              routeContext,
            },
            "<txHash>",
          ),
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
  const plansById = new Map(latestPlans.map((item) => [item.planId, item]));
  const submittedCount = latestSubmissions.filter((item) => item.submissionStatus === "submitted").length;
  const submissionFailureCount = latestSubmissions.filter((item) => item.submissionStatus === "failed").length;
  const confirmedCount = latestReceipts.filter((item) => item.reconciliationStatus === "reconciled").length;
  const failedCount = latestReceipts.filter((item) => item.reconciliationStatus === "failed").length;
  const pendingOutputCount = latestReceipts.filter((item) => item.reconciliationStatus === "pending_output").length;
  const settledReceipts = latestReceipts.filter(
    (item) => item.reconciliationStatus === "reconciled" || item.reconciliationStatus === "failed",
  );
  const realizedNetPnlValues = settledReceipts.map((item) => item.realized?.realizedNetPnlUsd).filter(Number.isFinite);
  const netDriftValues = settledReceipts
    .map((item) => driftUsd(item.realized?.realizedNetPnlUsd, item.routeContext?.estimatedNetPnlUsd))
    .filter(Number.isFinite);
  const gasDriftValues = settledReceipts.map((item) => item.realized?.gasDriftUsd).filter(Number.isFinite);
  const fillDriftValues = latestReceipts
    .filter((item) => item.reconciliationStatus === "reconciled")
    .map((item) => item.realized?.realizedFillVsEstimateBps)
    .filter(Number.isFinite);
  const latestPlan = [...latestPlans].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
  const latestSubmission = [...latestSubmissions].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
  const latestReceipt = [...latestReceipts].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
  const latestPendingOutput = [...latestReceipts]
    .filter((item) => item.reconciliationStatus === "pending_output")
    .sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt))[0] || null;
  const latestPendingOutputPlan = latestPendingOutput ? plansById.get(latestPendingOutput.planId) || latestPendingOutput : null;
  const latestPendingOutputRequirements = latestPendingOutputPlan ? buildForkOutputRequirements(latestPendingOutputPlan) : null;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    planCount: latestPlans.length,
    submittedCount,
    submissionFailureCount,
    confirmedCount,
    failedCount,
    pendingOutputCount,
    realizedSampleCount: realizedNetPnlValues.length,
    realizedNetPnlUsd: realizedNetPnlValues.length ? sum(realizedNetPnlValues) : null,
    medianRealizedNetPnlUsd: median(realizedNetPnlValues),
    medianNetDriftUsd: median(netDriftValues),
    medianExecutionGasDriftUsd: median(gasDriftValues),
    medianFillDriftBps: median(fillDriftValues),
    estimatedPositiveRealizedNegativeCount: settledReceipts.filter((item) => item.flags?.estimatedPositiveButRealizedNegative).length,
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
    latestPendingOutput: latestPendingOutput
      ? {
          observedAt: latestPendingOutput.observedAt,
          planId: latestPendingOutput.planId || null,
          routeLabel: routeLabel(latestPendingOutputPlan || latestPendingOutput),
          routeKey: routeKey(latestPendingOutputPlan || latestPendingOutput),
          amount: latestPendingOutput.amount || latestPendingOutputPlan?.amount || null,
          txHash: latestPendingOutput.txHash || null,
          outputRequirements: latestPendingOutputRequirements,
          resolutionCommand: buildForkOutputResolutionCommand(
            latestPendingOutputPlan,
            latestPendingOutput.txHash || "<txHash>",
          ),
        }
      : null,
  };
}
