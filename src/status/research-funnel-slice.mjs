import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readJsonl } from "../lib/jsonl-read.mjs";

function freeze(value) {
  return Object.freeze(value);
}

function emptyTrack() {
  return {
    candidateCount: 0,
    oosEligibleCount: 0,
    promotionIntentCount: 0,
    latestBlocker: null,
    latestRunAt: null,
  };
}

function detectTrack(row) {
  const explicit = row?.track || row?.metadata?.track || null;
  if (explicit === "A" || explicit === "B") return explicit;
  const candidateName = row?.candidate_name || row?.candidateName || "";
  if (/^agent_/u.test(candidateName)) return "A";
  if (/^factor_/u.test(candidateName)) return "B";
  const notes = String(row?.notes || "");
  if (/\btrack\s*=\s*A\b/u.test(notes)) return "A";
  if (/\btrack\s*=\s*B\b/u.test(notes)) return "B";
  return null;
}

function latestBlocker(...runs) {
  return runs
    .flat()
    .filter(Boolean)
    .reverse()
    .find((item) => item.blocker)?.blocker || null;
}

export function parseResearchResultsTsv(text = "") {
  const lines = String(text || "").trim().split("\n").filter(Boolean);
  if (lines.length <= 1) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]));
  });
}

export async function readResearchResultsRows(resultsPath) {
  try {
    const text = await readFile(resultsPath, "utf8");
    return parseResearchResultsTsv(text);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function loadResearchFunnelSlice({ rootDir, dataDir, generatedAt }) {
  const [resultsRows, promotionIntents, trackARuns, trackBRuns] = await Promise.all([
    readResearchResultsRows(join(rootDir, "research", "results.tsv")),
    readJsonl(dataDir, "research-promotion-intents"),
    readJsonl(dataDir, "research-track-a-runs"),
    readJsonl(dataDir, "research-track-b-runs"),
  ]);
  return buildResearchFunnelSlice({
    resultsRows,
    promotionIntents,
    trackARuns,
    trackBRuns,
    generatedAt,
  });
}

export function buildResearchFunnelSlice({
  resultsRows = [],
  promotionIntents = [],
  trackARuns = [],
  trackBRuns = [],
  generatedAt = null,
} = {}) {
  const tracks = {
    A: emptyTrack(),
    B: emptyTrack(),
  };

  const candidateSets = {
    A: new Set(),
    B: new Set(),
  };

  for (const row of resultsRows) {
    const track = detectTrack(row);
    if (!track) continue;
    const candidateName = row.candidate_name || row.candidateName || null;
    if (candidateName) candidateSets[track].add(candidateName);
  }

  tracks.A.candidateCount = candidateSets.A.size;
  tracks.B.candidateCount = candidateSets.B.size;
  tracks.A.latestRunAt = trackARuns.at(-1)?.observedAt || null;
  tracks.B.latestRunAt = trackBRuns.at(-1)?.observedAt || null;
  tracks.A.latestBlocker = latestBlocker(trackARuns);
  tracks.B.latestBlocker = latestBlocker(trackBRuns);
  tracks.B.oosEligibleCount = trackBRuns.at(-1)?.oosEligibleCount ?? 0;

  for (const intent of promotionIntents) {
    const track = intent?.track === "A" || intent?.track === "B" ? intent.track : detectTrack(intent);
    if (!track) continue;
    tracks[track].promotionIntentCount += 1;
  }

  const available =
    resultsRows.length > 0 || promotionIntents.length > 0 || trackARuns.length > 0 || trackBRuns.length > 0;
  const summary = {
    candidateCount: tracks.A.candidateCount + tracks.B.candidateCount,
    oosEligibleCount: tracks.A.oosEligibleCount + tracks.B.oosEligibleCount,
    promotionIntentCount: tracks.A.promotionIntentCount + tracks.B.promotionIntentCount,
    latestBlocker: latestBlocker(trackBRuns, trackARuns),
    latestRunAt: [tracks.A.latestRunAt, tracks.B.latestRunAt].filter(Boolean).sort().at(-1) || null,
  };

  return freeze({
    available,
    generatedAt: generatedAt || summary.latestRunAt,
    summary: freeze(summary),
    tracks: freeze({
      A: freeze(tracks.A),
      B: freeze(tracks.B),
    }),
  });
}
