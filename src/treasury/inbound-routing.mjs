import { createHash } from "node:crypto";
import { ASSET_CLASSES, classifyInboundEvent } from "./asset-classifier.mjs";
import { OPERATING_CAPITAL_INGRESS_FLOW, OPERATING_CAPITAL_SOURCE } from "./inventory-watcher.mjs";

export const INBOUND_ROUTING_POLICY = Object.freeze({
  bitcoinOnrampTargetChain: "base",
  btcLikeHubChain: "base",
  stableStrategyId: "gateway_native_asset_conversion_sleeve",
  btcFundingStrategyId: "gateway-btc-funding-transfer",
  btcOnrampStrategyId: "gateway-btc-onramp",
  ethCandidateStrategyId: "eth_destination_deployment",
  tokenizedReserveStrategyId: "tokenized_reserve_sleeve",
  otherBluechipStrategyId: "macro_asset_rotation",
});

function deterministicId(prefix, payload) {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 20);
  return `${prefix}:${hash}`;
}

function baseJob({ event, classification, strategyId, routeType, targetChain, status = "planned", reviewReasons = [] }) {
  const payload = {
    sourceEventId: event.eventId || null,
    chain: event.chain,
    token: event.token || null,
    amount: event.amount,
    routeType,
    targetChain,
    strategyId,
  };
  return {
    schemaVersion: 1,
    jobId: deterministicId("inbound", payload),
    createdAt: event.observedAt || new Date().toISOString(),
    sourceEventId: event.eventId || null,
    status,
    requiresManualReview: reviewReasons.length > 0,
    reviewReasons,
    priority: routeType === "native_btc_onramp" ? "high" : "medium",
    type: "inbound_route",
    routeType,
    executionMethod: routeType,
    chain: event.chain,
    token: event.token || null,
    asset: classification.ticker,
    assetClass: classification.assetClass,
    targetChain,
    targetStrategyId: strategyId,
    targetAmount: event.amount,
    targetAmountDecimal: event.amountDecimal,
    estimatedAssetValueUsd: event.estimatedUsd ?? null,
    capitalSource: event.capitalSource || OPERATING_CAPITAL_SOURCE,
    capitalFlow: event.capitalFlow || OPERATING_CAPITAL_INGRESS_FLOW,
    paybackExclusion: event.paybackExclusion !== false,
    paybackExclusionReason: event.paybackExclusionReason || OPERATING_CAPITAL_INGRESS_FLOW,
    strategyPolicy: {
      id: `${strategyId}_inbound_deposit`,
      category: "inbound_capital_routing",
      actionType: "route_deposit_to_strategy_float",
      strategyType: strategyId,
    },
    policy: {
      newTokenAutoWhitelist: false,
      signerRequired: true,
      deterministicPolicyApprovalRequired: true,
      paybackExclusion: true,
    },
  };
}

export function pendingWhitelistRecord({ event, classification }) {
  return {
    schemaVersion: 1,
    event: "unknown_token_detected",
    observedAt: event.observedAt || new Date().toISOString(),
    sourceEventId: event.eventId || null,
    chain: event.chain,
    token: event.token || null,
    ticker: classification.ticker,
    assetClass: classification.assetClass,
    amount: event.amount,
    amountDecimal: event.amountDecimal,
    estimatedUsd: event.estimatedUsd ?? null,
    capitalSource: event.capitalSource || OPERATING_CAPITAL_SOURCE,
    capitalFlow: event.capitalFlow || OPERATING_CAPITAL_INGRESS_FLOW,
    paybackExclusion: true,
    paybackExclusionReason: event.paybackExclusionReason || OPERATING_CAPITAL_INGRESS_FLOW,
    reviewReason: classification.reviewReason,
    requiredAction: "commit_token_whitelist_or_leave_manual_only",
  };
}

export function buildInboundRoutingDecision({
  event,
  classification = classifyInboundEvent(event),
  policy = INBOUND_ROUTING_POLICY,
} = {}) {
  if (!event) throw new Error("event is required");
  if (classification.manualReviewRequired) {
    return {
      schemaVersion: 1,
      sourceEventId: event.eventId || null,
      status: "manual_review",
      routeType: "manual_review",
      classification,
      reviewReasons: [classification.reviewReason],
      job: null,
      pendingWhitelist: pendingWhitelistRecord({ event, classification }),
    };
  }

  if (classification.assetClass === ASSET_CLASSES.BTC_LIKE && event.chain === "bitcoin") {
    const job = baseJob({
      event,
      classification,
      strategyId: policy.btcOnrampStrategyId,
      routeType: "native_btc_onramp",
      targetChain: policy.bitcoinOnrampTargetChain,
    });
    return { schemaVersion: 1, sourceEventId: event.eventId || null, status: "route_ready", routeType: job.routeType, classification, job };
  }

  if (classification.assetClass === ASSET_CLASSES.BTC_LIKE) {
    const routeType = event.chain === policy.btcLikeHubChain ? "btc_like_deploy_from_hub" : "btc_like_gateway_funding_to_hub";
    const strategyId = event.chain === policy.btcLikeHubChain ? policy.stableStrategyId : policy.btcFundingStrategyId;
    const job = baseJob({
      event,
      classification,
      strategyId,
      routeType,
      targetChain: policy.btcLikeHubChain,
    });
    return { schemaVersion: 1, sourceEventId: event.eventId || null, status: "route_ready", routeType: job.routeType, classification, job };
  }

  if (classification.assetClass === ASSET_CLASSES.STABLE) {
    const job = baseJob({
      event,
      classification,
      strategyId: policy.stableStrategyId,
      routeType: "stable_to_merkl_portfolio_float",
      targetChain: event.chain,
    });
    return { schemaVersion: 1, sourceEventId: event.eventId || null, status: "route_ready", routeType: job.routeType, classification, job };
  }

  if (classification.assetClass === ASSET_CLASSES.ETH_LIKE) {
    const job = baseJob({
      event,
      classification,
      strategyId: policy.ethCandidateStrategyId,
      routeType: "eth_yield_candidate_queue",
      targetChain: event.chain,
      status: "candidate_queue",
      reviewReasons: ["eth_lane_positive_ev_unwind_evidence_required"],
    });
    return { schemaVersion: 1, sourceEventId: event.eventId || null, status: "candidate_queue", routeType: job.routeType, classification, job };
  }

  if ([ASSET_CLASSES.TOKENIZED_GOLD, ASSET_CLASSES.TOKENIZED_RESERVE].includes(classification.assetClass)) {
    const job = baseJob({
      event,
      classification,
      strategyId: policy.tokenizedReserveStrategyId,
      routeType: "tokenized_reserve_or_gold_sleeve",
      targetChain: event.chain,
    });
    return { schemaVersion: 1, sourceEventId: event.eventId || null, status: "route_ready", routeType: job.routeType, classification, job };
  }

  const job = baseJob({
    event,
    classification,
    strategyId: policy.otherBluechipStrategyId,
    routeType: "approved_bluechip_rotation",
    targetChain: event.chain,
  });
  return { schemaVersion: 1, sourceEventId: event.eventId || null, status: "route_ready", routeType: job.routeType, classification, job };
}

export function buildInboundRoutingPlan({ events = [], policy = INBOUND_ROUTING_POLICY } = {}) {
  const decisions = events.map((event) => buildInboundRoutingDecision({ event, policy }));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      eventCount: events.length,
      routeReadyCount: decisions.filter((item) => item.status === "route_ready").length,
      manualReviewCount: decisions.filter((item) => item.status === "manual_review").length,
      candidateQueueCount: decisions.filter((item) => item.status === "candidate_queue").length,
    },
    decisions,
    jobs: decisions.map((item) => item.job).filter(Boolean),
    pendingWhitelist: decisions.map((item) => item.pendingWhitelist).filter(Boolean),
  };
}
