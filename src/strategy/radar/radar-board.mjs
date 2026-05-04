import { summarizeRealizationRecords } from "./realization-record-ingest.mjs";

const CALIBRATION_BLOCKERS = new Set([
  "radar_policy_thresholds_unresolved",
  "radar_policy_not_calibrated_aggressive",
  "manual_bridge_execution_not_supported",
]);

function countBlockers(candidates = []) {
  const counts = {};
  for (const candidate of candidates) {
    for (const blocker of candidate.blockers || []) {
      counts[blocker] = (counts[blocker] || 0) + 1;
    }
  }
  return counts;
}

function countSelectedBlockers(candidates = [], predicate = () => true) {
  const counts = {};
  for (const candidate of candidates) {
    for (const blocker of candidate.blockers || []) {
      if (!predicate(blocker, candidate)) continue;
      counts[blocker] = (counts[blocker] || 0) + 1;
    }
  }
  return counts;
}

function countGateStatuses(candidates = []) {
  const counts = {};
  for (const candidate of candidates) {
    const status = candidate.gateStatus || "unknown";
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function topCountKey(counts = {}) {
  const [top] = Object.entries(counts).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  });
  return top?.[0] || null;
}

function candidateObservedAtMs(candidate = {}) {
  const parsed = Date.parse(candidate.observedAt || candidate.metadata?.syncedAt || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestCandidatesById(candidates = []) {
  const latest = new Map();
  for (const candidate of candidates) {
    const id = candidate?.candidateId;
    if (!id) continue;
    const existing = latest.get(id);
    if (!existing || candidateObservedAtMs(candidate) >= candidateObservedAtMs(existing)) {
      latest.set(id, candidate);
    }
  }
  return [...latest.values()];
}

function countExecutionPaths(candidates = []) {
  return candidates.reduce((counts, candidate) => {
    const key = candidate.executionPath || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function isCalibrationBlocker(blocker = "") {
  return CALIBRATION_BLOCKERS.has(blocker);
}

function isCostBlocker(blocker = "") {
  return (
    blocker === "realized_pnl_ev_insufficient" ||
    blocker === "reward_exit_liquidity_unproven" ||
    blocker.startsWith("same_chain_unprofitable:")
  );
}

function buildFunnel(latestCandidates = []) {
  const produced = latestCandidates.length;
  const calibratedCandidates = latestCandidates.filter(
    (candidate) => !(candidate.blockers || []).some(isCalibrationBlocker),
  );
  const costPositiveCandidates = calibratedCandidates.filter(
    (candidate) => !(candidate.blockers || []).some(isCostBlocker),
  );
  const executableCandidates = costPositiveCandidates.filter(
    (candidate) => candidate.gateStatus === "executable",
  );
  return {
    produced,
    calibrated: calibratedCandidates.length,
    costPositive: costPositiveCandidates.length,
    executable: executableCandidates.length,
    rejectReasons: {
      calibrated: countSelectedBlockers(latestCandidates, isCalibrationBlocker),
      costPositive: countSelectedBlockers(calibratedCandidates, isCostBlocker),
      executable: countSelectedBlockers(
        costPositiveCandidates.filter((candidate) => candidate.gateStatus !== "executable"),
        (blocker) => !isCalibrationBlocker(blocker) && !isCostBlocker(blocker),
      ),
    },
  };
}

function safeObservation(item = {}) {
  return {
    obsId: item.obsId || null,
  };
}

export function buildRadarBoard({
  observations = [],
  episodes = [],
  packets = [],
  candidates = [],
  realizationRecords = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const realizationSummary = summarizeRealizationRecords(realizationRecords);
  const latestCandidates = latestCandidatesById(candidates);
  const blockerCounts = countBlockers(latestCandidates);
  const executableCount = latestCandidates.filter((candidate) => candidate.gateStatus === "executable").length;
  const blockedCandidateCount = latestCandidates.length - executableCount;
  const funnel = buildFunnel(latestCandidates);
  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      observedCount: observations.length,
      strategyEpisodeCount: episodes.length,
      portablePacketCount: packets.length,
      rawCandidateVersionCount: candidates.length,
      candidateCount: latestCandidates.length,
      executableCount,
      blockedCandidateCount,
      candidateStatusCounts: countGateStatuses(latestCandidates),
      candidateExecutionPathCounts: countExecutionPaths(latestCandidates),
      topCandidateBlocker: topCountKey(blockerCounts),
      strategyRealizedCount: realizationSummary.strategyRealizedCount,
      positiveRealizedPnlCount: realizationSummary.positiveRealizedPnlCount,
      paybackDeliveredCount: realizationSummary.paybackDeliveredCount,
      totalNetRealizedPnlUsd: realizationSummary.totalNetRealizedPnlUsd,
      totalNetRealizedPnlSats: realizationSummary.totalNetRealizedPnlSats,
    },
    funnel,
    blockerCounts,
    observations: observations.map(safeObservation),
    episodes: episodes.map((episode) => ({
      episodeId: episode.episodeId || null,
      pnlClosureStatus: episode.pnlClosureStatus || null,
    })),
    packets: packets.map((packet) => ({ packetId: packet.packetId || null })),
    candidates: latestCandidates.map((candidate) => ({
      candidateId: candidate.candidateId || null,
      gateStatus: candidate.gateStatus || null,
      blockers: candidate.blockers || [],
    })),
  };
}
