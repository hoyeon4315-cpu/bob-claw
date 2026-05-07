export {
  OFFICIAL_GATEWAY_DESTINATION_CHAINS,
  OFFICIAL_GATEWAY_ROUTE_CHAINS,
} from "../config/gateway-destinations.mjs";
import {
  OFFICIAL_GATEWAY_DESTINATION_CHAINS,
  OFFICIAL_GATEWAY_ROUTE_CHAINS,
} from "../config/gateway-destinations.mjs";
import { analyzeDexRouteSupport, routeMatchesDexFamily } from "./dex-route-universe.mjs";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countBy(items = [], selector) {
  return (items || []).reduce((counts, item) => {
    const key = selector(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function byTemplateId(items = []) {
  return new Map((items || []).filter((item) => item?.templateId).map((item) => [item.templateId, item]));
}

const SUPPORTED_GATEWAY_DESTINATION_CHAINS = new Set(OFFICIAL_GATEWAY_DESTINATION_CHAINS);
const OFFICIAL_GATEWAY_ROUTE_CHAIN_SET = new Set(OFFICIAL_GATEWAY_ROUTE_CHAINS);

export function isOfficialGatewayRoute(route = null) {
  return OFFICIAL_GATEWAY_ROUTE_CHAIN_SET.has(route?.srcChain) && OFFICIAL_GATEWAY_ROUTE_CHAIN_SET.has(route?.dstChain);
}

export function filterOfficialGatewayRoutes(routes = []) {
  return (routes || []).filter((route) => isOfficialGatewayRoute(route));
}

export function summarizeOfficialGatewayRouteSurface(routes = []) {
  const observedRoutes = routes || [];
  const supportedRoutes = filterOfficialGatewayRoutes(observedRoutes);
  const ignoredRoutes = observedRoutes.filter((route) => !isOfficialGatewayRoute(route));
  return {
    observedRouteCount: observedRoutes.length,
    supportedRouteCount: supportedRoutes.length,
    ignoredRouteCount: ignoredRoutes.length,
    unsupportedChains: unique(
      ignoredRoutes.flatMap((route) => [
        OFFICIAL_GATEWAY_ROUTE_CHAIN_SET.has(route?.srcChain) ? null : route?.srcChain || null,
        OFFICIAL_GATEWAY_ROUTE_CHAIN_SET.has(route?.dstChain) ? null : route?.dstChain || null,
      ]),
    ),
  };
}

const DETERMINISTIC_STATUS_WEIGHT = Object.freeze({
  repo_auto_build_supported: 0.98,
  planning_adapter_ready: 0.9,
  design_scaffold: 0.72,
  research_blocked: 0.38,
  unsupported_venue_profile: 0.24,
});

const RESEARCH_STATUS_WEIGHT = Object.freeze({
  receipt_backed_validation_ready: 0.08,
  dry_run_evidence_recorded: 0.06,
  candidate_for_validation: 0.05,
  candidate_for_design: 0.03,
  research_priority: 0.02,
  research_backlog: -0.02,
  deferred: -0.04,
});

const DESTINATION_RESEARCH_COMMANDS = Object.freeze({
  collect_source_metadata: "npm run report:destination-input-workbench -- --write",
  document_platform_surface: "npm run report:destination-registry -- --write",
  hold_below_policy: "npm run report:destination-estimated-economics -- --write",
  measure_numeric_economics: "npm run report:destination-economics-queue -- --write",
  mark_score_ready_for_allocation_review: "npm run report:destination-promotion-gate -- --write",
  run_allowlist_review: "npm run report:destination-allowlist-board -- --write",
  satisfy_evidence_policy: "npm run report:destination-evidence-policy -- --write",
  seed_source_metadata: "npm run seed:destination-source-metadata -- --write",
  wait_blocked_destination_venue: "npm run report:destination-venue-template -- --write",
});

const ROUTE_DEVELOPMENT_STATUS_WEIGHT = Object.freeze({
  composed_route_ready: 0.86,
  unwind_remediation_required: 0.8,
  destination_scaffold_required: 0.76,
  dex_remediation_required: 0.72,
  gateway_route_missing: 0.68,
  unsupported_gateway_destination: 0.24,
});

function defaultPnlStatus(overrides = {}) {
  return {
    paper: {
      btc: null,
      usdProjection: null,
      status: overrides.paperStatus || "research_hypothesis_only",
    },
    estimated: {
      btc: null,
      usdProjection: null,
      status: overrides.estimatedStatus || "estimated_btc_pnl_unmeasured",
    },
    realized: {
      btc: null,
      usdProjection: null,
      status: overrides.realizedStatus || "realized_btc_pnl_unavailable",
    },
  };
}

function deterministicPriority(candidate = null) {
  if (!candidate) return 0;
  const base = DETERMINISTIC_STATUS_WEIGHT[candidate.deterministicStatus] ?? 0.2;
  const research = RESEARCH_STATUS_WEIGHT[candidate.status] ?? 0;
  const dryRunBoost = candidate.readyForDryRun === true ? 0.04 : 0;
  const receiptBoost = candidate.dryRunReceiptRecorded === true ? 0.05 : 0;
  const signerBoost = (candidate.signerBackedRunCount ?? 0) > 0 ? 0.08 : 0;
  const blockerPenalty = (candidate.blockers || []).length * 0.01;
  const evidencePenalty = (candidate.missingEvidence || []).length * 0.008;
  return round(Math.max(0, base + research + dryRunBoost + receiptBoost + signerBoost - blockerPenalty - evidencePenalty));
}

function buildDeterministicOpportunities(report = null) {
  return (report?.candidates || []).map((candidate) => ({
    id: candidate.id,
    type: "deterministic_strategy",
    lane: "strategy",
    label: candidate.label || candidate.id,
    status: candidate.deterministicStatus || candidate.status || "unknown",
    priorityScore: deterministicPriority(candidate),
    blockers: unique(candidate.blockers || []),
    reason: candidate.status || candidate.deterministicStatus || null,
    nextAction: candidate.nextAction || null,
    pnl: defaultPnlStatus({
      estimatedStatus:
        candidate.readyForDryRun === true ? "dry_run_ready_but_btc_pnl_not_measured" : "estimated_btc_pnl_unmeasured",
      realizedStatus:
        (candidate.signerBackedRunCount ?? 0) > 0 ? "receipts_recorded_but_realized_btc_pnl_not_ingested" : "no_realized_strategy_receipts",
    }),
    evidence: {
      category: candidate.category || null,
      repoAutoBuildSupported: candidate.repoAutoBuildSupported === true,
      readyForDryRun: candidate.readyForDryRun === true,
      dryRunReceiptRecorded: candidate.dryRunReceiptRecorded === true,
      signerBackedRunCount: candidate.signerBackedRunCount ?? 0,
      protocolAdapterId: candidate.protocolAdapterId || null,
    },
  }));
}

function destinationStatus({ queueItem = null, promotionItem = null } = {}) {
  const allocationStatus = promotionItem?.allocationGate?.status || null;
  if (allocationStatus === "allocation_ready") return "allocation_ready";
  if (allocationStatus === "review_only") return "review_only";
  if (promotionItem?.gate?.status === "promotable") return "promotable";
  if (queueItem?.economicsStatus === "blocked") return "blocked";
  return "research_queue";
}

function destinationPriority({ queueItem = null, promotionItem = null } = {}) {
  const allocationStatus = promotionItem?.allocationGate?.status || null;
  const gateStatus = promotionItem?.gate?.status || null;
  const queueScore = Number(queueItem?.queueScore || 0);
  const base =
    allocationStatus === "allocation_ready"
      ? 0.9
      : allocationStatus === "review_only"
        ? 0.72
        : gateStatus === "promotable"
          ? 0.68
          : 0.44;
  const queueBoost = Math.min(0.12, queueScore * 0.12);
  const readinessBoost = Number.isFinite(queueItem?.readinessScore) ? queueItem.readinessScore * 0.04 : 0;
  const missingPenalty = (queueItem?.missingFields || []).length * 0.01;
  const blockerPenalty = (promotionItem?.gate?.blockers || []).length * 0.008;
  return round(Math.max(0, base + queueBoost + readinessBoost - missingPenalty - blockerPenalty));
}

function destinationNextAction({ queueItem = null, promotionItem = null } = {}) {
  if (promotionItem?.allocationGate?.status === "allocation_ready") {
    return {
      code: "review_destination_allocation_plan",
      command: "npm run report:destination-allocation-plan -- --write",
    };
  }
  if (promotionItem?.allocationGate?.nextAction) {
    return promotionItem.allocationGate.nextAction;
  }
  if (queueItem?.nextAction) {
    return {
      code: queueItem.nextAction,
      command: DESTINATION_RESEARCH_COMMANDS[queueItem.nextAction] || "npm run report:destination-research-queue -- --write",
    };
  }
  if (promotionItem?.gate?.status === "promotable") {
    return {
      code: "review_destination_promotion_gate",
      command: "npm run report:destination-promotion-gate -- --write",
    };
  }
  return null;
}

function buildDestinationOpportunities({ researchQueue = null, promotionGate = null } = {}) {
  const queueByTemplate = byTemplateId(researchQueue?.queue);
  const promotionByTemplate = byTemplateId(promotionGate?.items);
  const templateIds = unique([...queueByTemplate.keys(), ...promotionByTemplate.keys()]);
  return templateIds.map((templateId) => {
    const queueItem = queueByTemplate.get(templateId) || null;
    const promotionItem = promotionByTemplate.get(templateId) || null;
    return {
      id: templateId,
      type: "destination_candidate",
      lane: "destination",
      label: queueItem?.label || promotionItem?.label || templateId,
      chain: queueItem?.chain || promotionItem?.chain || null,
      familyId: queueItem?.familyId || promotionItem?.familyId || null,
      status: destinationStatus({ queueItem, promotionItem }),
      priorityScore: destinationPriority({ queueItem, promotionItem }),
      blockers: unique([
        ...(queueItem?.unmetPolicyInputs || []),
        ...(promotionItem?.gate?.blockers || []),
        ...(promotionItem?.allocationGate?.blockers || []),
      ]),
      reason:
        queueItem?.reason ||
        promotionItem?.allocationGate?.blockers?.[0] ||
        promotionItem?.gate?.blockers?.[0] ||
        null,
      nextAction: destinationNextAction({ queueItem, promotionItem }),
      pnl: defaultPnlStatus({
        estimatedStatus: queueItem?.economicsStatus === "ready" ? "economics_ready_but_btc_projection_missing" : "destination_economics_not_measured_in_btc",
        realizedStatus: "no_realized_destination_receipts",
      }),
      evidence: {
        queueScore: queueItem?.queueScore ?? null,
        readinessScore: queueItem?.readinessScore ?? null,
        economicsStatus: queueItem?.economicsStatus || null,
        gateStatus: promotionItem?.gate?.status || null,
        allocationStatus: promotionItem?.allocationGate?.status || null,
      },
    };
  });
}

function routeGapAction({ family = "btc", blocker = null, classification = null } = {}) {
  if (String(blocker || "").includes("odos_chain_not_supported") || String(blocker || "").includes("no_supported_router_for_chain")) {
    return {
      code: "extend_destination_venue_support",
      command: "npm run report:destination-venue-template -- --write",
    };
  }
  if (String(blocker || "").includes("stable_missing")) {
    return {
      code: "seed_destination_source_metadata",
      command: "npm run seed:destination-source-metadata -- --write",
    };
  }
  if (classification === "double_provider_gap") {
    return {
      code: `audit_${family}_asset_coverage`,
      command: "npm run verify:gateway:asset-coverage",
    };
  }
  return {
    code: `scan_${family}_quote_surface`,
    command: `npm run scan:quote-surface -- --family=${family}`,
  };
}

function measurableRoutePriority(summary = null) {
  const count = summary?.fullyMeasurableRouteCount ?? 0;
  return round(Math.min(0.86, 0.72 + count * 0.02));
}

function routeGapPriority(summary = null, gapRoute = null) {
  const gapCount = (summary?.singleProviderGapCount ?? 0) + (summary?.doubleProviderGapCount ?? 0);
  const base = gapRoute?.classification === "double_provider_gap" ? 0.74 : 0.68;
  return round(Math.min(0.84, base + Math.min(0.1, gapCount * 0.015)));
}

function buildRouteGapOpportunities(summary = null, family = "btc") {
  if (!summary) return [];
  const opportunities = [];
  if ((summary.fullyMeasurableRouteCount ?? 0) > 0) {
    const topRoute = summary.fullyMeasurableRoutes?.[0] || null;
    opportunities.push({
      id: `${family}_measurable_route_surface`,
      type: "route_surface",
      lane: "route_gap",
      label: `${family.toUpperCase()} measurable route surface`,
      status: "measurable_surface_available",
      priorityScore: measurableRoutePriority(summary),
      blockers: [],
      reason: "measurable_routes_available",
      nextAction: {
        code: `scan_${family}_quote_surface`,
        command: `npm run scan:quote-surface -- --family=${family}`,
      },
      pnl: defaultPnlStatus({
        paperStatus: "route_surface_only",
        estimatedStatus: "route_measurement_required",
        realizedStatus: "no_route_receipts",
      }),
      evidence: {
        familyRouteCount: summary.familyRouteCount ?? summary.btcFamilyRouteCount ?? summary.ethFamilyRouteCount ?? 0,
        fullyMeasurableRouteCount: summary.fullyMeasurableRouteCount ?? 0,
        topRouteKey: topRoute?.routeKey || null,
      },
    });
  }
  const topGap = summary.gapRoutes?.[0] || null;
  const topBlocker = topGap?.blockers?.[0] || summary.blockerCounts?.[0]?.key || null;
  if (topGap || (summary.singleProviderGapCount ?? 0) > 0 || (summary.doubleProviderGapCount ?? 0) > 0) {
    opportunities.push({
      id: `${family}_route_gap_${summary.topGapChain?.chain || "unknown"}`,
      type: "route_gap",
      lane: "route_gap",
      label: `${family.toUpperCase()} route gap${summary.topGapChain?.chain ? ` (${summary.topGapChain.chain})` : ""}`,
      chain: summary.topGapChain?.chain || null,
      status: topGap?.classification || ((summary.doubleProviderGapCount ?? 0) > 0 ? "double_provider_gap" : "single_provider_gap"),
      priorityScore: routeGapPriority(summary, topGap),
      blockers: unique(topGap?.blockers || (summary.blockerCounts || []).slice(0, 3).map((item) => item.key)),
      reason: topBlocker || "route_gap_detected",
      nextAction: routeGapAction({
        family,
        blocker: topBlocker,
        classification: topGap?.classification || null,
      }),
      pnl: defaultPnlStatus({
        paperStatus: "route_gap_only",
        estimatedStatus: "gap_prevents_estimated_btc_pnl",
        realizedStatus: "no_gap_remediation_receipts",
      }),
      evidence: {
        familyRouteCount: summary.familyRouteCount ?? summary.btcFamilyRouteCount ?? summary.ethFamilyRouteCount ?? 0,
        singleProviderGapCount: summary.singleProviderGapCount ?? 0,
        doubleProviderGapCount: summary.doubleProviderGapCount ?? 0,
        topGapChain: summary.topGapChain?.chain || null,
        topGapRouteKey: topGap?.routeKey || null,
      },
    });
  }
  return opportunities;
}

function familyFromValue(value = null) {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) return "btc";
  if (normalized.includes("eth")) return "eth";
  if (normalized.includes("stable")) return "stable";
  if (normalized.includes("btc")) return "btc";
  return "btc";
}

function compareInboundAnalysis(left, right) {
  const leftReady = left?.exit?.ok === true ? 1 : 0;
  const rightReady = right?.exit?.ok === true ? 1 : 0;
  if (rightReady !== leftReady) return rightReady - leftReady;
  return String(left?.routeKey || "").localeCompare(String(right?.routeKey || ""));
}

function compareOutboundAnalysis(left, right) {
  const leftReady = left?.entry?.ok === true ? 1 : 0;
  const rightReady = right?.entry?.ok === true ? 1 : 0;
  if (rightReady !== leftReady) return rightReady - leftReady;
  return String(left?.routeKey || "").localeCompare(String(right?.routeKey || ""));
}

function routeDevelopmentAction({
  family = "btc",
  missingLink = null,
  blocker = null,
} = {}) {
  if (missingLink === "unsupported_gateway_destination") {
    return {
      code: "document_platform_surface",
      command: "npm run report:destination-registry -- --write",
    };
  }
  if (missingLink === "destination_scaffold_required") {
    return {
      code: "collect_source_metadata",
      command: "npm run report:destination-input-workbench -- --write",
    };
  }
  if (String(blocker || "").includes("no_supported_router_for_chain") || String(blocker || "").includes("odos_chain_not_supported")) {
    return {
      code: "extend_destination_venue_support",
      command: "npm run report:destination-venue-template -- --write",
    };
  }
  if (String(blocker || "").includes("stable_missing")) {
    return {
      code: "seed_destination_source_metadata",
      command: "npm run seed:destination-source-metadata -- --write",
    };
  }
  if (missingLink === "composed_route_ready") {
    return {
      code: "review_destination_allocation_plan",
      command: "npm run report:destination-allocation-plan -- --write",
    };
  }
  return {
    code: `scan_${family}_quote_surface`,
    command: `npm run scan:quote-surface -- --family=${family}`,
  };
}

function routeDevelopmentPriority({
  status = null,
  queueItem = null,
  promotionItem = null,
  inboundCount = 0,
  outboundCount = 0,
} = {}) {
  const base = ROUTE_DEVELOPMENT_STATUS_WEIGHT[status] ?? 0.3;
  const queueBoost = Number.isFinite(queueItem?.queueScore) ? Math.min(0.08, queueItem.queueScore * 0.08) : 0;
  const readinessBoost = Number.isFinite(queueItem?.readinessScore) ? Math.min(0.06, queueItem.readinessScore * 0.05) : 0;
  const allocationBoost = promotionItem?.allocationGate?.status === "allocation_ready"
    ? 0.06
    : promotionItem?.allocationGate?.status === "review_only"
      ? 0.04
      : 0;
  const coverageBoost = Math.min(0.04, (inboundCount + outboundCount) * 0.01);
  return round(Math.max(0, Math.min(0.98, base + queueBoost + readinessBoost + allocationBoost + coverageBoost)));
}

function routeDevelopmentStatus({
  chain = null,
  destinationReady = false,
  inboundRoutes = [],
  outboundRoutes = [],
  bestInbound = null,
  bestOutbound = null,
} = {}) {
  if (!SUPPORTED_GATEWAY_DESTINATION_CHAINS.has(chain)) return "unsupported_gateway_destination";
  if (!inboundRoutes.length) return "gateway_route_missing";
  if (bestInbound?.exit?.ok !== true) return "dex_remediation_required";
  if (!destinationReady) return "destination_scaffold_required";
  if (!outboundRoutes.length || bestOutbound?.entry?.ok !== true) return "unwind_remediation_required";
  return "composed_route_ready";
}

function routeMissingLink({
  chain = null,
  destinationReady = false,
  inboundRoutes = [],
  outboundRoutes = [],
  bestInbound = null,
  bestOutbound = null,
} = {}) {
  if (!SUPPORTED_GATEWAY_DESTINATION_CHAINS.has(chain)) return "unsupported_gateway_destination";
  if (!inboundRoutes.length) return "gateway_route_missing";
  if (bestInbound?.exit?.ok !== true) return "destination_dex_missing";
  if (!destinationReady) return "destination_scaffold_required";
  if (!outboundRoutes.length) return "unwind_route_missing";
  if (bestOutbound?.entry?.ok !== true) return "unwind_dex_missing";
  return null;
}

function destinationReadyForRouteDevelopment({ queueItem = null, promotionItem = null } = {}) {
  return new Set(["allocation_ready", "review_only", "promotable"]).has(destinationStatus({ queueItem, promotionItem }));
}

function buildRouteDevelopmentOpportunities({
  researchQueue = null,
  promotionGate = null,
  gatewayRoutes = [],
} = {}) {
  const queueByTemplate = byTemplateId(researchQueue?.queue);
  const promotionByTemplate = byTemplateId(promotionGate?.items);
  const templateIds = unique([...queueByTemplate.keys(), ...promotionByTemplate.keys()]);
  return templateIds.map((templateId) => {
    const queueItem = queueByTemplate.get(templateId) || null;
    const promotionItem = promotionByTemplate.get(templateId) || null;
    const chain = queueItem?.chain || promotionItem?.chain || null;
    const family = familyFromValue(queueItem?.familyId || promotionItem?.familyId || templateId);
    const inboundRoutes = (gatewayRoutes || [])
      .filter((route) => route?.dstChain === chain)
      .filter((route) => routeMatchesDexFamily(route, family));
    const outboundRoutes = (gatewayRoutes || [])
      .filter((route) => route?.srcChain === chain && route?.dstChain === "bitcoin")
      .filter((route) => routeMatchesDexFamily(route, family));
    const bestInbound = inboundRoutes.map(analyzeDexRouteSupport).sort(compareInboundAnalysis)[0] || null;
    const bestOutbound = outboundRoutes.map(analyzeDexRouteSupport).sort(compareOutboundAnalysis)[0] || null;
    const destinationReady = destinationReadyForRouteDevelopment({ queueItem, promotionItem });
    const status = routeDevelopmentStatus({
      chain,
      destinationReady,
      inboundRoutes,
      outboundRoutes,
      bestInbound,
      bestOutbound,
    });
    const missingLink = routeMissingLink({
      chain,
      destinationReady,
      inboundRoutes,
      outboundRoutes,
      bestInbound,
      bestOutbound,
    });
    const blocker = bestInbound?.blockers?.find((item) => item.startsWith("dst_"))
      || bestOutbound?.blockers?.find((item) => item.startsWith("src_"))
      || missingLink;
    const nextAction = routeDevelopmentAction({ family, missingLink: missingLink || status, blocker });
    return {
      id: `${templateId}:route_development`,
      type: "route_development",
      lane: "route_development",
      label: `${queueItem?.label || promotionItem?.label || templateId} route composition`,
      chain,
      familyId: queueItem?.familyId || promotionItem?.familyId || null,
      status,
      priorityScore: routeDevelopmentPriority({
        status,
        queueItem,
        promotionItem,
        inboundCount: inboundRoutes.length,
        outboundCount: outboundRoutes.length,
      }),
      blockers: unique([
        missingLink,
        ...(bestInbound?.blockers?.filter((item) => item.startsWith("dst_")) || []),
        ...(bestOutbound?.blockers?.filter((item) => item.startsWith("src_")) || []),
        ...(promotionItem?.allocationGate?.blockers || []),
      ]),
      reason: blocker || missingLink || null,
      nextAction,
      pnl: defaultPnlStatus({
        paperStatus: "route_composition_only",
        estimatedStatus: "route_costs_require_deterministic_measurement",
        realizedStatus: "no_route_composition_receipts",
      }),
      routeDevelopment: {
        family,
        missingLink,
        primitives: {
          gateway: {
            status: inboundRoutes.length ? "ready" : "missing",
            routeCount: inboundRoutes.length,
          },
          dexEntry: {
            status: !inboundRoutes.length ? "route_missing" : bestInbound?.exit?.ok === true ? "ready" : "remediation_required",
            blocker: bestInbound?.blockers?.find((item) => item.startsWith("dst_")) || null,
          },
          destination: {
            status: destinationReady ? "ready" : "scaffold_required",
            allocationStatus: promotionItem?.allocationGate?.status || null,
            gateStatus: promotionItem?.gate?.status || null,
          },
          unwind: {
            status: !outboundRoutes.length ? "missing_route" : bestOutbound?.entry?.ok === true ? "ready" : "remediation_required",
            blocker: bestOutbound?.blockers?.find((item) => item.startsWith("src_")) || null,
            routeCount: outboundRoutes.length,
          },
        },
        selectedInboundRoute: bestInbound
          ? {
              routeKey: bestInbound.routeKey,
              classification: bestInbound.classification,
            }
          : null,
        selectedOutboundRoute: bestOutbound
          ? {
              routeKey: bestOutbound.routeKey,
              classification: bestOutbound.classification,
            }
          : null,
      },
      evidence: {
        queueScore: queueItem?.queueScore ?? null,
        readinessScore: queueItem?.readinessScore ?? null,
        allocationStatus: promotionItem?.allocationGate?.status || null,
        gateStatus: promotionItem?.gate?.status || null,
        inboundRouteCount: inboundRoutes.length,
        outboundRouteCount: outboundRoutes.length,
      },
    };
  });
}

function attemptHistoryByOpportunity(iterationRecords = []) {
  return (iterationRecords || []).reduce((map, record) => {
    const key = record?.opportunityId;
    if (!key) return map;
    const items = map.get(key) || [];
    items.push(record);
    map.set(key, items);
    return map;
  }, new Map());
}

function consecutiveFailures(records = []) {
  let count = 0;
  for (const record of records) {
    if (record?.executionStatus === "failed" || record?.executionStatus === "invalid") count += 1;
    else break;
  }
  return count;
}

function summarizeIterationHistory(records = []) {
  const sorted = [...(records || [])].sort((left, right) => new Date(right?.observedAt || 0) - new Date(left?.observedAt || 0));
  const successCount = sorted.filter((item) => item.executionStatus === "succeeded").length;
  const failureCount = sorted.filter((item) => item.executionStatus === "failed").length;
  const invalidCount = sorted.filter((item) => item.executionStatus === "invalid").length;
  const previewCount = sorted.filter((item) => item.executionStatus === "preview").length;
  const keepCount = sorted.filter((item) => item.outcomeSignal === "keep").length;
  const discardCount = sorted.filter((item) => item.outcomeSignal === "discard").length;
  return {
    runCount: sorted.length,
    successCount,
    failureCount,
    invalidCount,
    previewCount,
    keepCount,
    discardCount,
    consecutiveFailureCount: consecutiveFailures(sorted),
    latestObservedAt: sorted[0]?.observedAt || null,
    latestStatus: sorted[0]?.executionStatus || null,
    latestOutcomeSignal: sorted[0]?.outcomeSignal || null,
  };
}

function readyStatus(status = null) {
  return new Set([
    "allocation_ready",
    "composed_route_ready",
    "dry_run_evidence_recorded",
    "measurable_surface_available",
    "planning_adapter_ready",
    "receipt_backed_validation_ready",
    "repo_auto_build_supported",
    "review_only",
  ]).has(status);
}

function decorateOpportunityWithResearchLoop(opportunity = null, history = null) {
  if (!opportunity) return null;
  const safeHistory = history || summarizeIterationHistory([]);
  const readyBoost = readyStatus(opportunity.status) ? 0.06 : 0;
  const routeReadyBoost = opportunity.routeDevelopment?.missingLink ? 0 : 0.04;
  const keepScore = round(Math.max(
    0,
    (opportunity.priorityScore ?? 0)
      + readyBoost
      + routeReadyBoost
      + safeHistory.successCount * 0.12
      + safeHistory.keepCount * 0.08
      + safeHistory.previewCount * 0.01
      - safeHistory.failureCount * 0.1
      - safeHistory.invalidCount * 0.12
      - safeHistory.consecutiveFailureCount * 0.04
      - (opportunity.blockers || []).length * 0.008,
  ));
  const discardScore = round(Math.max(
    0,
    safeHistory.failureCount * 0.16
      + safeHistory.invalidCount * 0.2
      + safeHistory.discardCount * 0.08
      + safeHistory.consecutiveFailureCount * 0.06
      + (opportunity.blockers || []).length * 0.012
      - safeHistory.successCount * 0.04
      - safeHistory.keepCount * 0.05,
  ));
  const decision = keepScore >= discardScore + 0.08 ? "keep" : discardScore > keepScore + 0.08 ? "discard" : "watch";
  const selectionScore = round(Math.max(
    0,
    (opportunity.priorityScore ?? 0)
      + safeHistory.keepCount * 0.04
      + safeHistory.successCount * 0.03
      - safeHistory.discardCount * 0.04
      - safeHistory.failureCount * 0.05
      - safeHistory.invalidCount * 0.05
      - safeHistory.consecutiveFailureCount * 0.03,
  ));
  return {
    ...opportunity,
    selectionScore,
    researchLoop: {
      keepScore,
      discardScore,
      recommendedDecision: decision,
      runCount: safeHistory.runCount,
      successCount: safeHistory.successCount,
      failureCount: safeHistory.failureCount,
      invalidCount: safeHistory.invalidCount,
      previewCount: safeHistory.previewCount,
      keepCount: safeHistory.keepCount,
      discardCount: safeHistory.discardCount,
      consecutiveFailureCount: safeHistory.consecutiveFailureCount,
      latestObservedAt: safeHistory.latestObservedAt,
      latestStatus: safeHistory.latestStatus,
      latestOutcomeSignal: safeHistory.latestOutcomeSignal,
    },
  };
}

function compareOpportunity(left, right) {
  if ((right.selectionScore ?? 0) !== (left.selectionScore ?? 0)) {
    return (right.selectionScore ?? 0) - (left.selectionScore ?? 0);
  }
  if ((right.priorityScore ?? 0) !== (left.priorityScore ?? 0)) {
    return (right.priorityScore ?? 0) - (left.priorityScore ?? 0);
  }
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function boardSummaryPnl(opportunities = []) {
  const realizedSignals = opportunities.filter((item) => item?.researchLoop?.successCount > 0).length;
  return defaultPnlStatus({
    paperStatus: "board_priority_surface_only",
    estimatedStatus: opportunities.length ? "per_opportunity_estimated_btc_pnl_pending" : "no_opportunities",
    realizedStatus: realizedSignals > 0 ? "receipts_exist_but_board_realized_btc_pnl_not_aggregated" : "no_realized_board_receipts",
  });
}

export function selectAutonomousDiscoveryOpportunities(
  report = null,
  {
    rank = null,
    ids = [],
    lanes = [],
    limit = 1,
  } = {},
) {
  let opportunities = report?.opportunities || [];
  if (Number.isFinite(rank)) {
    opportunities = opportunities.filter((item) => item.selectionRank === rank);
  }
  const idSet = new Set((ids || []).filter(Boolean));
  if (idSet.size > 0) {
    opportunities = opportunities.filter((item) => idSet.has(item.id));
  }
  const laneSet = new Set((lanes || []).filter(Boolean));
  if (laneSet.size > 0) {
    opportunities = opportunities.filter((item) => laneSet.has(item.lane));
  }
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
  return opportunities.slice(0, safeLimit);
}

export function buildAutonomousDiscoveryExecutionSummary(records = [], now = new Date().toISOString()) {
  const sorted = [...(records || [])].sort((left, right) => new Date(right?.observedAt || 0) - new Date(left?.observedAt || 0));
  const latest = sorted[0] || null;
  return {
    schemaVersion: 1,
    generatedAt: now,
    runCount: sorted.length,
    successCount: sorted.filter((item) => item.executionStatus === "succeeded").length,
    failureCount: sorted.filter((item) => item.executionStatus === "failed").length,
    invalidCount: sorted.filter((item) => item.executionStatus === "invalid").length,
    previewCount: sorted.filter((item) => item.executionStatus === "preview").length,
    keepCount: sorted.filter((item) => item.outcomeSignal === "keep").length,
    discardCount: sorted.filter((item) => item.outcomeSignal === "discard").length,
    laneCounts: countBy(sorted, (item) => item.lane),
    typeCounts: countBy(sorted, (item) => item.type),
    latestObservedAt: latest?.observedAt || null,
    latestStatus: latest?.executionStatus || null,
    latestOpportunityId: latest?.opportunityId || null,
    pnl: defaultPnlStatus({
      paperStatus: "execution_summary_tracks_actions_not_pnl",
      estimatedStatus: "execution_summary_has_no_estimated_btc_pnl_model",
      realizedStatus: "execution_summary_has_no_realized_btc_pnl_aggregation",
    }),
    recentExecutions: sorted.slice(0, 5).map((item) => ({
      observedAt: item.observedAt,
      opportunityId: item.opportunityId,
      lane: item.lane || null,
      type: item.type || null,
      executionStatus: item.executionStatus || null,
      outcomeSignal: item.outcomeSignal || null,
      scripts: (item.steps || []).map((step) => step.script),
      invalidReason: item.invalidReason || null,
      stepCount: item.stepCount ?? 0,
    })),
  };
}

export function buildAutonomousDiscoveryBoard({
  deterministicStrategyCandidates = null,
  destinationResearchQueue = null,
  destinationPromotionGate = null,
  btcRouteUniverse = null,
  ethRouteUniverse = null,
  gatewayRoutes = [],
  iterationRecords = [],
  now = null,
} = {}) {
  const historyByOpportunity = attemptHistoryByOpportunity(iterationRecords);
  const opportunities = [
    ...buildDeterministicOpportunities(deterministicStrategyCandidates),
    ...buildDestinationOpportunities({
      researchQueue: destinationResearchQueue,
      promotionGate: destinationPromotionGate,
    }),
    ...buildRouteDevelopmentOpportunities({
      researchQueue: destinationResearchQueue,
      promotionGate: destinationPromotionGate,
      gatewayRoutes,
    }),
    ...buildRouteGapOpportunities(btcRouteUniverse, "btc"),
    ...buildRouteGapOpportunities(ethRouteUniverse, "eth"),
  ]
    .map((opportunity) => decorateOpportunityWithResearchLoop(opportunity, summarizeIterationHistory(historyByOpportunity.get(opportunity.id) || [])))
    .sort(compareOpportunity)
    .map((opportunity, index) => ({
      ...opportunity,
      selectionRank: index + 1,
    }));
  const topOpportunity = opportunities[0] || null;
  const executionQueue = opportunities.slice(0, 10).map((item) => ({
    selectionRank: item.selectionRank,
    id: item.id,
    label: item.label,
    lane: item.lane,
    type: item.type,
    status: item.status,
    priorityScore: item.priorityScore,
    selectionScore: item.selectionScore,
    keepScore: item.researchLoop?.keepScore ?? null,
    discardScore: item.researchLoop?.discardScore ?? null,
    recommendedDecision: item.researchLoop?.recommendedDecision || null,
    nextAction: item.nextAction || null,
    pnl: item.pnl,
  }));
  return {
    schemaVersion: 2,
    generatedAt: now || new Date().toISOString(),
    summary: {
      opportunityCount: opportunities.length,
      readyNowCount: opportunities.filter((item) => readyStatus(item.status)).length,
      deterministicCount: opportunities.filter((item) => item.type === "deterministic_strategy").length,
      destinationCount: opportunities.filter((item) => item.type === "destination_candidate").length,
      routeGapCount: opportunities.filter((item) => item.type === "route_gap" || item.type === "route_surface").length,
      routeDevelopmentCount: opportunities.filter((item) => item.type === "route_development").length,
      keepCount: opportunities.filter((item) => item.researchLoop?.recommendedDecision === "keep").length,
      discardCount: opportunities.filter((item) => item.researchLoop?.recommendedDecision === "discard").length,
      statusCounts: countBy(opportunities, (item) => item.status),
      laneCounts: countBy(opportunities, (item) => item.lane),
      typeCounts: countBy(opportunities, (item) => item.type),
      topOpportunityId: topOpportunity?.id || null,
      nextAction: topOpportunity?.nextAction || null,
      pnl: boardSummaryPnl(opportunities),
    },
    executionQueue,
    opportunities,
  };
}

export function summarizeAutonomousDiscoveryBoard(report = null) {
  if (!report) return null;
  const topOpportunity =
    report.opportunities?.find((item) => item.id === report.summary?.topOpportunityId) ||
    report.opportunities?.[0] ||
    null;
  return {
    opportunityCount: report.summary?.opportunityCount ?? 0,
    readyNowCount: report.summary?.readyNowCount ?? 0,
    deterministicCount: report.summary?.deterministicCount ?? 0,
    destinationCount: report.summary?.destinationCount ?? 0,
    routeGapCount: report.summary?.routeGapCount ?? 0,
    routeDevelopmentCount: report.summary?.routeDevelopmentCount ?? 0,
    keepCount: report.summary?.keepCount ?? 0,
    discardCount: report.summary?.discardCount ?? 0,
    pnl: report.summary?.pnl || defaultPnlStatus(),
    topOpportunity: topOpportunity
      ? {
          id: topOpportunity.id || null,
          label: topOpportunity.label || null,
          type: topOpportunity.type || null,
          lane: topOpportunity.lane || null,
          status: topOpportunity.status || null,
          priorityScore: topOpportunity.priorityScore ?? null,
          selectionScore: topOpportunity.selectionScore ?? null,
          keepScore: topOpportunity.researchLoop?.keepScore ?? null,
          discardScore: topOpportunity.researchLoop?.discardScore ?? null,
          recommendedDecision: topOpportunity.researchLoop?.recommendedDecision || null,
        }
      : null,
    nextAction: report.summary?.nextAction || null,
  };
}
