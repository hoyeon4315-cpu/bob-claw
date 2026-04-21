#!/usr/bin/env node

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { config } from "../config/env.mjs";
import { buildCurrentDashboardContext } from "../status/current-dashboard-context.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function currentStage(state) {
  return state.stages.find((stage) => stage.id === state.currentStageId) || state.stages.find((stage) => stage.status === "in_progress") || null;
}

function packetHead(packet = null) {
  return packet?.summary?.topPacketItems?.[0] || packet?.items?.[0] || null;
}

function compactAction(action = null) {
  if (!action) return null;
  return {
    code: action.code || null,
    label: action.label || null,
    command: action.command || null,
  };
}

function allocatorCandidateById(allocatorCore = null, candidateId = null) {
  if (!candidateId) return null;
  return (allocatorCore?.candidates || []).find((item) => item.id === candidateId) || null;
}

function enrichAllocationItem(item = null, allocatorCore = null) {
  if (!item) return null;
  const candidate = allocatorCandidateById(allocatorCore, item.templateId || item.id || null);
  return {
    templateId: item.templateId || item.id || null,
    label: item.label || candidate?.label || null,
    chain: item.chain || candidate?.chain || null,
    familyId: item.familyId || null,
    assetFamily: candidate?.assetFamily || null,
    protocols: candidate?.protocols || [],
    allocationUsd: item.allocationUsd ?? null,
    estimatedNetBps: item.estimatedNetBps ?? null,
    estimatedNetUsd: item.estimatedNetUsd ?? null,
    blockers: item.blockers || candidate?.blockers || [],
    nextAction: compactAction(item.nextAction || candidate?.nextAction || null),
  };
}

function topReviewOnlyAllocations(promotionGate = null, allocatorCore = null, limit = 3) {
  return (promotionGate?.summary?.topReviewOnly || [])
    .slice(0, limit)
    .map((item) =>
      enrichAllocationItem(
        {
          templateId: item.templateId,
          label: item.label,
          chain: item.chain,
          familyId: item.familyId,
          blockers: item.blockers || [],
          nextAction: item.nextAction || null,
        },
        allocatorCore,
      ),
    )
    .filter(Boolean);
}

function authoritativeSources(surface = null) {
  return (
    surface?.executionSupport?.authoritativeSources ||
    surface?.bindingSupport?.authoritativeSources ||
    []
  )
    .slice(0, 4)
    .map((item) => ({
      label: item.label || null,
      url: item.url || null,
    }));
}

function buildPrimaryStrategyCandidate(strategyResearchBoard = null, recursiveWrappedBtcLoop = null, wrappedBtcLendingLoopSlice = null) {
  const candidate =
    (strategyResearchBoard?.candidates || []).find((item) => item.status === "receipt_backed_validation_ready") ||
    strategyResearchBoard?.candidates?.[0] ||
    null;
  if (!candidate) return null;

  const recursiveSurface =
    recursiveWrappedBtcLoop?.strategy?.id === candidate.id ? recursiveWrappedBtcLoop : null;
  const wrappedSurface =
    wrappedBtcLendingLoopSlice?.strategy?.id === candidate.id ? wrappedBtcLendingLoopSlice : null;
  const surface = recursiveSurface || wrappedSurface || null;

  return {
    id: candidate.id,
    label: candidate.label || null,
    category: candidate.category || null,
    status: candidate.status || null,
    whyNow: candidate.whyNow || null,
    chain: surface?.strategy?.chain || null,
    protocol: surface?.strategy?.protocol || null,
    collateralAsset: surface?.strategy?.collateralAsset || null,
    borrowAsset: surface?.strategy?.borrowAsset || null,
    arrivalFamily: candidate?.evidence?.arrivalFamily || null,
    perTradeCapUsd: surface?.strategy?.perTradeCapUsd ?? null,
    readyForDryRun: surface?.readiness?.readyForDryRun ?? candidate?.evidence?.readyForDryRun ?? null,
    readyForLive: surface?.readiness?.readyForLive ?? null,
    executionSupportStatus:
      surface?.executionSupport?.status ||
      surface?.bindingSupport?.status ||
      candidate?.evidence?.executionSupportStatus ||
      null,
    requiredInfrastructure: candidate.requiredInfrastructure || [],
    promotionPrerequisites: candidate.promotionPrerequisites || [],
    failureModes: candidate.failureModes || [],
    nextAction: compactAction(candidate.nextAction || null),
    authoritativeSources: authoritativeSources(surface),
  };
}

function buildPaybackGate(payback = null) {
  const scheduler = payback?.scheduler || null;
  const minimum = scheduler?.minimumPaybackProgress || null;
  const carry = payback?.carry || null;
  const expansion = payback?.expansionGate || null;

  return {
    status: scheduler?.status || null,
    reason: scheduler?.reason || null,
    pendingSats: carry?.pendingSats ?? payback?.accumulatorPendingSats ?? null,
    remainingSatsToMinimum: carry?.remainingSatsToMinimum ?? minimum?.satsToMinimumPayback ?? null,
    progressToMinimumRatio: carry?.progressToMinimumRatio ?? minimum?.progressToMinimumRatio ?? null,
    requiredGrossProfitSats: minimum?.requiredGrossProfitSats ?? null,
    roundTripEfficiencyPeriod: carry?.roundTripEfficiencyPeriod ?? payback?.kpi?.roundTripEfficiencyPeriod ?? null,
    reserveChain: expansion?.reserveChain || null,
    expansionEligible: expansion?.eligible ?? null,
    expansionPeriodsRemaining: expansion?.periodsRemaining ?? null,
    nextAction: scheduler?.nextAction || null,
  };
}

function buildDepositReadiness({ state = null, nativeBtcOpportunitySurface = null, paybackGate = null, primaryStrategy = null, activeAllocation = null } = {}) {
  const liveSurface = nativeBtcOpportunitySurface?.liveSurface || null;
  const reserveChain = paybackGate?.reserveChain || null;
  return {
    nativeBtcRouteCount: liveSurface?.nativeBtcRouteCount ?? state?.groundTruth?.nativeBtcRouteCount ?? 0,
    destinationChains: liveSurface?.destinationChains || state?.groundTruth?.destinationChains || [],
    wrappedBtcRouteCount: liveSurface?.destinationFamilies?.wrappedBtc ?? state?.groundTruth?.wrappedBtcRouteCount ?? 0,
    stablecoinRouteCount: liveSurface?.destinationFamilies?.stablecoin ?? state?.groundTruth?.stablecoinRouteCount ?? 0,
    ethLikeRouteCount: liveSurface?.destinationFamilies?.ethLike ?? state?.groundTruth?.ethLikeRouteCount ?? 0,
    preferredLandingChain: reserveChain || primaryStrategy?.chain || activeAllocation?.chain || null,
    preferredLandingFamily: primaryStrategy?.arrivalFamily || activeAllocation?.assetFamily || null,
    reserveChainAlignedWithPrimary: Boolean(reserveChain && primaryStrategy?.chain && reserveChain === primaryStrategy.chain),
    currentCanaryEconomicStatus: state?.groundTruth?.currentCanaryEconomicStatus || null,
    proxySpreadStatus: state?.groundTruth?.proxySpreadStatus || null,
  };
}

function buildProfitabilityFramework({ state = null, primaryStrategy = null } = {}) {
  return {
    accountingUnit: "sats_first",
    displayOrder: ["btc_first", "usd_projection_second"],
    netRule:
      "expected_yield_sats - (onramp_fee_sats + destination_gas_sats + offramp_fee_sats + slippage_buffer_sats)",
    evidenceOrder: ["paper", "estimated", "realized"],
    currentBlockers: {
      exactRoute: state?.groundTruth?.currentCanaryEconomicStatus || null,
      proxySpread: state?.groundTruth?.proxySpreadStatus || null,
      primaryStrategy: {
        id: primaryStrategy?.id || null,
        status: primaryStrategy?.status || null,
        readyForDryRun: primaryStrategy?.readyForDryRun ?? null,
        readyForLive: primaryStrategy?.readyForLive ?? null,
      },
    },
  };
}

function buildResearchReferences(primaryStrategy = null) {
  return {
    localDocs: [
      {
        kind: "rules",
        path: "AGENTS.md",
        focus: "BTC-first accounting, round-trip cost deduction, supported chains, payback and cap rules",
      },
      {
        kind: "research",
        path: "docs/research/bob-ecosystem.md",
        focus: "Gateway mechanics, official destination chains, round-trip cost ranges, ecosystem facts",
      },
      {
        kind: "research",
        path: "docs/research/ops-costs.md",
        focus: "gas float, variance floor, overfit checks, refresh cadence",
      },
      {
        kind: "research",
        path: "docs/research/strategies-and-risk.md",
        focus: "loop math, protocol risk, allocation guardrails, BTCfi venue context",
      },
      {
        kind: "research",
        path: "docs/research/payback-rationale.md",
        focus: "payback defaults, multiplier rationale, KPI bands, revalidation triggers",
      },
    ],
    primaryProtocolSources: primaryStrategy?.authoritativeSources || [],
  };
}

function simpleKoreanSummary({ primaryStrategy = null, activeAllocation = null, paybackGate = null, depositReadiness = null } = {}) {
  return [
    primaryStrategy?.label
      ? `전략 1순위는 ${primaryStrategy.label}`
      : "전략 1순위는 아직 비어 있고",
    activeAllocation?.label
      ? `즉시 allocator 기준 active-ready는 ${activeAllocation.label}`
      : "즉시 active-ready allocation은 없고",
    paybackGate?.reason
      ? `payback은 ${paybackGate.reason} 상태이며`
      : "payback 상태는 추가 확인이 필요하며",
    depositReadiness?.preferredLandingChain
      ? `현재 기준 기본 착지 체인은 ${depositReadiness.preferredLandingChain}입니다.`
      : "기본 착지 체인은 아직 고정되지 않았습니다.",
  ].join(" ");
}

function stageBlockers(stage = null, { packet = null, promotionGate = null, allocationPlan = null } = {}) {
  if (!stage) return [];

  if (stage.id === "stage_5_destination_scoring") {
    const blockers = [];
    if (Number.isFinite(packet?.summary?.itemCount) && packet.summary.itemCount > 0) {
      blockers.push(`economics_packet_remaining:${packet.summary.itemCount}`);
    }
    if (Number.isFinite(promotionGate?.summary?.reviewOnlyCount) && promotionGate.summary.reviewOnlyCount > 0) {
      blockers.push(`allocation_review_only:${promotionGate.summary.reviewOnlyCount}`);
    }
    return blockers;
  }

  if (stage.id === "stage_6_overfit_and_truthfulness_gates") {
    const blockers = [];
    if (Number.isFinite(promotionGate?.summary?.reviewOnlyCount) && promotionGate.summary.reviewOnlyCount > 0) {
      blockers.push(`review_only_candidates:${promotionGate.summary.reviewOnlyCount}`);
    }
    for (const item of promotionGate?.summary?.topAllocationBlockers || []) {
      blockers.push(`${item.blocker}:${item.count}`);
    }
    return blockers;
  }

  if (stage.id === "stage_7_allocation_planner") {
    const blockers = [];
    if ((allocationPlan?.summary?.allocationReadyCount || 0) <= 0) blockers.push("no_allocation_ready_candidates");
    if ((allocationPlan?.summary?.activeAllocationCount || 0) <= 0) blockers.push("no_active_allocations");
    return blockers;
  }

  if (stage.id === "stage_8_reviewable_agent_loop") {
    return packetHead(packet) ? ["next_action_should_be_persisted_from_packet_head"] : ["allocator_next_action_unknown"];
  }

  if (stage.id === "stage_9_execution_admission_preparation") {
    return (allocationPlan?.summary?.allocationReadyCount || 0) > 0
      ? ["allocator_candidates_need_manual_admission_review"]
      : ["no_allocator_candidate_ready_for_admission"];
  }

  return [];
}

function nextAction(stage = null, { packet = null, promotionGate = null } = {}) {
  if (!stage) return null;

  if (stage.id === "stage_5_destination_scoring") {
    const head = packetHead(packet);
    return head
      ? {
          code: "measure_destination_economics",
          label: `measure ${head.templateId}`,
          command: head.commandSuggestion || null,
        }
      : null;
  }

  if (stage.id === "stage_6_overfit_and_truthfulness_gates") {
    const reviewOnly = promotionGate?.summary?.topReviewOnly?.[0] || null;
    return reviewOnly?.allocationGate?.nextAction || null;
  }

  if (stage.id === "stage_7_allocation_planner") {
    return {
      code: "review_destination_allocation_plan",
      label: "review destination allocation plan",
      command: "npm run report:destination-allocation-plan -- --json",
    };
  }

  if (stage.id === "stage_8_reviewable_agent_loop") {
    return {
      code: "write_session_handoff",
      label: "refresh session handoff artifacts",
      command: "npm run write:session-handoff",
    };
  }

  if (stage.id === "stage_9_execution_admission_preparation") {
    return {
      code: "build_prelive_review_package",
      label: "rebuild prelive review package",
      command: "npm run build:prelive-review-package -- --write",
    };
  }

  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const statePath = join(config.dataDir, "native-btc-capital-allocator-plan-state.json");
  const state = await readJson(statePath);
  const context = await buildCurrentDashboardContext({ dataDir: config.dataDir });
  const stage = currentStage(state);
  const [economicsPacket, nativeBtcOpportunitySurface] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "destination-economics-packet.json")),
    readJsonIfExists(join(config.dataDir, "native-btc-opportunity-surface.json")),
  ]);
  const promotionGate = context.artifacts?.destinationPromotionGate || null;
  const allocationPlan = context.artifacts?.destinationAllocationPlan || null;
  const allocatorCore = context.artifacts?.allocatorCore || null;
  const strategyResearchBoard = context.artifacts?.strategyResearchBoard || null;
  const recursiveWrappedBtcLoop = context.artifacts?.recursiveWrappedBtcLoop || null;
  const wrappedBtcLendingLoopSlice = context.artifacts?.wrappedBtcLendingLoopSlice || null;
  const paybackGate = buildPaybackGate(context.dashboardStatus?.payback || null);
  const activeAllocation = enrichAllocationItem(allocationPlan?.activePlan?.[0] || null, allocatorCore);
  const reviewOnlyAllocations = topReviewOnlyAllocations(promotionGate, allocatorCore, 3);
  const primaryStrategy = buildPrimaryStrategyCandidate(
    strategyResearchBoard,
    recursiveWrappedBtcLoop,
    wrappedBtcLendingLoopSlice,
  );
  const depositReadiness = buildDepositReadiness({
    state,
    nativeBtcOpportunitySurface,
    paybackGate,
    primaryStrategy,
    activeAllocation,
  });
  const completed = state.stages.filter((item) => item.status === "completed");
  const remaining = state.stages.filter((item) => item.status !== "completed");
  const destinationPacketHead = packetHead(economicsPacket);
  const action = nextAction(stage, { packet: economicsPacket, promotionGate, allocationPlan });

  const report = {
    schemaVersion: 1,
    statePath,
    lastReviewedAt: state.lastReviewedAt,
    currentStage: stage
      ? {
          id: stage.id,
          label: stage.label,
          status: stage.status,
          verification: stage.verification || [],
        }
      : null,
    progress: {
      completedStageCount: completed.length,
      remainingStageCount: remaining.length,
      totalStageCount: state.stages.length,
      progressPct: state.summary?.progressPct ?? null,
    },
    nextStages: remaining.slice(0, 3).map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
    })),
    stageBlockers: stageBlockers(stage, {
      packet: economicsPacket,
      promotionGate,
      allocationPlan,
    }),
    nextAction: action,
    destinationAllocator: {
      packetHead: destinationPacketHead
        ? {
            templateId: destinationPacketHead.templateId,
            chain: destinationPacketHead.chain,
            familyId: destinationPacketHead.familyId,
            label: destinationPacketHead.label,
          }
        : null,
      packetItemCount: economicsPacket?.summary?.itemCount ?? 0,
      promotableCount: promotionGate?.summary?.promotableCount ?? 0,
      allocationReadyCount: promotionGate?.summary?.allocationReadyCount ?? 0,
      reviewOnlyCount: promotionGate?.summary?.reviewOnlyCount ?? 0,
      activeAllocationCount: allocationPlan?.summary?.activeAllocationCount ?? 0,
      planningAllocationCount: allocationPlan?.summary?.planningAllocationCount ?? 0,
    },
    depositReadiness,
    allocationPriority: {
      immediateAllocationReady: activeAllocation ? [activeAllocation] : [],
      primaryStrategy,
      expansionReviewOnly: reviewOnlyAllocations,
      blockedLanes: [
        {
          id: "exact_route",
          status: state.groundTruth?.currentCanaryEconomicStatus || null,
        },
        {
          id: "proxy_spread",
          status: state.groundTruth?.proxySpreadStatus || null,
        },
      ],
    },
    profitabilityFramework: buildProfitabilityFramework({
      state,
      primaryStrategy,
    }),
    paybackGate,
    researchReferences: buildResearchReferences(primaryStrategy),
    simpleKoreanSummary: simpleKoreanSummary({
      primaryStrategy,
      activeAllocation,
      paybackGate,
      depositReadiness,
    }),
    sessionStartChecklist: state.sessionStartChecklist || [],
    groundTruth: state.groundTruth || {},
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`currentStage=${report.currentStage?.label || "n/a"} (${report.currentStage?.status || "unknown"})`);
  console.log(`progress=${report.progress.completedStageCount}/${report.progress.totalStageCount}`);
  console.log(`remainingStages=${report.progress.remainingStageCount}`);
  console.log(`progressPct=${report.progress.progressPct ?? "n/a"}`);
  console.log(`lastReviewedAt=${report.lastReviewedAt || "n/a"}`);
  console.log(`summary=${report.simpleKoreanSummary}`);
  console.log("");
  console.log("Current stage verification:");
  for (const item of report.currentStage?.verification || []) {
    console.log(`- ${item}`);
  }
  console.log("");
  console.log("Next stages:");
  for (const item of report.nextStages) {
    console.log(`- ${item.label} (${item.status})`);
  }
  console.log("");
  console.log("Allocator context:");
  console.log(`- packetHead=${report.destinationAllocator.packetHead?.templateId || "n/a"}`);
  console.log(`- packetItems=${report.destinationAllocator.packetItemCount}`);
  console.log(`- promotable=${report.destinationAllocator.promotableCount}`);
  console.log(`- allocationReady=${report.destinationAllocator.allocationReadyCount}`);
  console.log(`- reviewOnly=${report.destinationAllocator.reviewOnlyCount}`);
  console.log(`- activeAllocations=${report.destinationAllocator.activeAllocationCount}`);
  console.log("");
  console.log("Deposit readiness:");
  console.log(`- preferredLandingChain=${report.depositReadiness.preferredLandingChain || "n/a"}`);
  console.log(`- wrappedBtcRoutes=${report.depositReadiness.wrappedBtcRouteCount}`);
  console.log(`- stablecoinRoutes=${report.depositReadiness.stablecoinRouteCount}`);
  console.log(`- exactRouteStatus=${report.depositReadiness.currentCanaryEconomicStatus || "n/a"}`);
  console.log(`- proxySpreadStatus=${report.depositReadiness.proxySpreadStatus || "n/a"}`);
  if (report.allocationPriority.primaryStrategy) {
    console.log("");
    console.log("Primary strategy:");
    console.log(
      `- ${report.allocationPriority.primaryStrategy.label} status=${report.allocationPriority.primaryStrategy.status} chain=${report.allocationPriority.primaryStrategy.chain || "n/a"} protocol=${report.allocationPriority.primaryStrategy.protocol || "n/a"}`,
    );
  }
  if (report.allocationPriority.immediateAllocationReady.length > 0) {
    console.log("");
    console.log("Immediate allocation-ready:");
    for (const item of report.allocationPriority.immediateAllocationReady) {
      console.log(
        `- ${item.templateId} chain=${item.chain || "n/a"} protocols=${item.protocols?.join(",") || "n/a"} netBps=${item.estimatedNetBps ?? "n/a"}`,
      );
    }
  }
  console.log("");
  console.log("Payback gate:");
  console.log(`- status=${report.paybackGate.status || "n/a"} reason=${report.paybackGate.reason || "n/a"}`);
  console.log(`- pendingSats=${report.paybackGate.pendingSats ?? "n/a"}`);
  console.log(`- remainingSatsToMinimum=${report.paybackGate.remainingSatsToMinimum ?? "n/a"}`);
  console.log(`- reserveChain=${report.paybackGate.reserveChain || "n/a"}`);
  if (report.stageBlockers.length > 0) {
    console.log("");
    console.log("Stage blockers:");
    for (const item of report.stageBlockers) {
      console.log(`- ${item}`);
    }
  }
  if (report.nextAction) {
    console.log("");
    console.log(`nextAction=${report.nextAction.code || "n/a"} command=${report.nextAction.command || "n/a"}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
