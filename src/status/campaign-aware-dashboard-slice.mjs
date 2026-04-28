import { PAYBACK_CONFIG } from "../config/payback.mjs";

export function buildCampaignAwareSlice(input, options = {}) {
  const {
    smallCapitalPolicy = null,
    totalCapitalUsd = 0,
    campaignOpportunities = null,
    anchorPositions = null,
    paybackAccumulator = null,
  } = input || {};

  const now = options?.now ? new Date(options.now) : new Date();

  // Anchor lane
  let anchorStatus = "unproven";
  let anchorPositionCount = 0;
  let anchorAllocatedUsd = null;
  let anchorTopProtocol = null;
  let timeInRangePct = null;
  let ilVsFees = null;
  let emergencyExitReady = false;

  if (anchorPositions && Array.isArray(anchorPositions.positions)) {
    anchorPositionCount = anchorPositions.positions.length;
    if (anchorPositionCount > 0) {
      anchorStatus = "active";
      anchorAllocatedUsd = anchorPositions.positions.reduce(
        (sum, p) => sum + (p.allocatedUsd || 0),
        0
      );
      // Determine top protocol by allocation
      const protocolTotals = {};
      for (const p of anchorPositions.positions) {
        const key = p.protocol || "unknown";
        protocolTotals[key] = (protocolTotals[key] || 0) + (p.allocatedUsd || 0);
      }
      anchorTopProtocol = Object.entries(protocolTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      // Aggregate health if available
      const healths = anchorPositions.positions
        .map((p) => p.health)
        .filter(Boolean);
      if (healths.length > 0) {
        const avg = (arr) =>
          arr.reduce((s, v) => s + (v == null ? 0 : Number(v)), 0) / arr.length;
        const tir = healths.map((h) => h.timeInRangePct).filter((v) => v != null);
        const il = healths.map((h) => h.ilVsFees).filter((v) => v != null);
        const exit = healths.map((h) => h.emergencyExitReady).filter((v) => v != null);
        if (tir.length) timeInRangePct = avg(tir);
        if (il.length) ilVsFees = avg(il);
        if (exit.length) emergencyExitReady = exit.some(Boolean);
      }
    } else {
      anchorStatus = "candidate";
    }
  } else if (smallCapitalPolicy?.enabled) {
    anchorStatus = "candidate";
  }

  const anchorMaxUsd = smallCapitalPolicy
    ? totalCapitalUsd * (smallCapitalPolicy.anchorTargetPct?.max ?? 0)
    : 0;

  // Opportunistic lane
  const opportunisticMaxUsd = smallCapitalPolicy
    ? Math.min(
        totalCapitalUsd * (smallCapitalPolicy.opportunisticMaxPct ?? 0),
        smallCapitalPolicy.defaultBudgetsUsd?.opportunisticMaxUsd ?? 0
      )
    : 0;

  let opportunisticBudgetUsedUsd = 0;
  let opportunisticActivePositionCount = 0;
  let opportunisticTopCandidate = null;
  let opportunisticNextAction = "observe";

  if (campaignOpportunities && Array.isArray(campaignOpportunities.positions)) {
    opportunisticActivePositionCount = campaignOpportunities.positions.length;
    opportunisticBudgetUsedUsd = campaignOpportunities.positions.reduce(
      (sum, p) => sum + (p.allocatedUsd || 0),
      0
    );
  }

  if (campaignOpportunities && Array.isArray(campaignOpportunities.candidates)) {
    const sorted = [...campaignOpportunities.candidates]
      .filter((c) => c.expectedRealizedAprPct != null)
      .sort((a, b) => (b.expectedRealizedAprPct || 0) - (a.expectedRealizedAprPct || 0));
    if (sorted.length > 0) {
      const top = sorted[0];
      opportunisticTopCandidate = {
        protocol: top.protocol || null,
        chain: top.chain || null,
        expectedRealizedAprPct: top.expectedRealizedAprPct,
      };
    }
  }

  if (opportunisticTopCandidate && opportunisticActivePositionCount === 0) {
    opportunisticNextAction = "manual_confirm";
  } else if (opportunisticActivePositionCount > 0) {
    opportunisticNextAction = "auto_allowed";
  }

  // Payback
  const pendingSats = paybackAccumulator?.pendingSats || 0;
  const pendingBtc = (pendingSats / 100_000_000).toFixed(8);
  const minPaybackSats = PAYBACK_CONFIG.minPaybackSats;
  let paybackStatus = "accruing";
  if (pendingSats >= minPaybackSats) {
    paybackStatus = "ready";
  }
  // If an explicit offramp cost fraction is provided and too high, override to deferred
  const estimatedOfframpCostSats = paybackAccumulator?.estimatedOfframpCostSats || 0;
  if (
    pendingSats > 0 &&
    estimatedOfframpCostSats > pendingSats * PAYBACK_CONFIG.maxOfframpCostPctOfPayback
  ) {
    paybackStatus = "deferred";
  }

  let nextPeriodDate = null;
  try {
    const cron = PAYBACK_CONFIG.cronExpression; // "0 0 * * 1" = weekly Monday
    // Compute next Monday from now
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + ((1 + 7 - d.getUTCDay()) % 7 || 7));
    d.setUTCHours(0, 0, 0, 0);
    nextPeriodDate = d.toISOString();
  } catch {
    nextPeriodDate = null;
  }

  // Campaign queue
  const candidates = campaignOpportunities?.candidates || [];
  const candidateCount = candidates.length;
  let topBlockerLabel = null;
  let campaignQueueNextAction = "scan";

  if (candidateCount === 0) {
    topBlockerLabel = "No campaign candidates currently pass filters.";
    campaignQueueNextAction = "scan";
  } else {
    // Find first candidate with a blocker
    const blocked = candidates.find((c) => c.blocker);
    if (blocked) {
      topBlockerLabel = blocked.blocker;
      campaignQueueNextAction = "manual_review";
    } else {
      campaignQueueNextAction = "wait";
    }
  }

  // Overall top blocker
  let overallTopBlockerLabel = null;
  let overallTopBlockerMessage = null;

  if (anchorStatus === "unproven") {
    overallTopBlockerLabel = "anchor_unproven";
    overallTopBlockerMessage = "Anchor position accounting not yet verified.";
  } else if (candidateCount === 0) {
    overallTopBlockerLabel = "no_campaign_candidates";
    overallTopBlockerMessage = "No campaign candidates currently pass filters.";
  } else if (paybackStatus === "accruing" && pendingSats > 0) {
    overallTopBlockerLabel = "payback_below_minimum";
    overallTopBlockerMessage = "Payback accruing — below minimum threshold.";
  } else if (paybackStatus === "deferred") {
    overallTopBlockerLabel = "payback_deferred";
    overallTopBlockerMessage = "Payback deferred — offramp cost too high.";
  }

  return {
    anchorLane: {
      status: anchorStatus,
      positionCount: anchorPositionCount,
      allocatedUsd: anchorAllocatedUsd,
      maxUsd: anchorMaxUsd,
      topProtocol: anchorTopProtocol,
      health: {
        timeInRangePct,
        ilVsFees,
        emergencyExitReady,
      },
    },
    opportunisticLane: {
      budgetUsedUsd: opportunisticBudgetUsedUsd,
      budgetMaxUsd: opportunisticMaxUsd,
      activePositionCount: opportunisticActivePositionCount,
      topCandidate: opportunisticTopCandidate,
      nextAction: opportunisticNextAction,
    },
    payback: {
      pendingSats,
      pendingBtc,
      status: paybackStatus,
      nextPeriodDate,
    },
    campaignQueue: {
      candidateCount,
      topBlocker: topBlockerLabel,
      nextAction: campaignQueueNextAction,
    },
    topBlocker: {
      label: overallTopBlockerLabel,
      userMessage: overallTopBlockerMessage,
    },
  };
}
