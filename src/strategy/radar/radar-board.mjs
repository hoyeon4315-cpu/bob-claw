import { summarizeRealizationRecords } from "./realization-record-ingest.mjs";

function countBlockers(candidates = []) {
  const counts = {};
  for (const candidate of candidates) {
    for (const blocker of candidate.blockers || []) {
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
      topCandidateBlocker: topCountKey(blockerCounts),
      strategyRealizedCount: realizationSummary.strategyRealizedCount,
      positiveRealizedPnlCount: realizationSummary.positiveRealizedPnlCount,
      paybackDeliveredCount: realizationSummary.paybackDeliveredCount,
      totalNetRealizedPnlUsd: realizationSummary.totalNetRealizedPnlUsd,
      totalNetRealizedPnlSats: realizationSummary.totalNetRealizedPnlSats,
    },
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
