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
  const executableCount = candidates.filter((candidate) => candidate.gateStatus === "executable").length;
  return {
    schemaVersion: 1,
    generatedAt,
    summary: {
      observedCount: observations.length,
      strategyEpisodeCount: episodes.length,
      portablePacketCount: packets.length,
      executableCount,
      strategyRealizedCount: realizationSummary.strategyRealizedCount,
      paybackDeliveredCount: realizationSummary.paybackDeliveredCount,
      totalNetRealizedPnlSats: realizationSummary.totalNetRealizedPnlSats,
    },
    blockerCounts: countBlockers(candidates),
    observations: observations.map(safeObservation),
    episodes: episodes.map((episode) => ({
      episodeId: episode.episodeId || null,
      pnlClosureStatus: episode.pnlClosureStatus || null,
    })),
    packets: packets.map((packet) => ({ packetId: packet.packetId || null })),
    candidates: candidates.map((candidate) => ({
      candidateId: candidate.candidateId || null,
      gateStatus: candidate.gateStatus || null,
      blockers: candidate.blockers || [],
    })),
  };
}
