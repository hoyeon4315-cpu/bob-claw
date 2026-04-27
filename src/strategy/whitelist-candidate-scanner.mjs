import { readFile } from "node:fs/promises";
import { classifyWhitelistRisk } from "./whitelist-risk-classifier.mjs";

const DEFAULT_CANDIDATES_PATH = "data/whitelist-candidates.jsonl";

async function readJsonlLines(path) {
  try {
    const raw = await readFile(path, "utf8");
    return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function scanWhitelistCandidates({
  candidatesPath = DEFAULT_CANDIDATES_PATH,
  minTier = "TIER_B",
} = {}) {
  const lines = await readJsonlLines(candidatesPath);
  const tierRank = { TIER_A: 3, TIER_B: 2, TIER_C: 1, REJECT: 0 };
  const minRank = tierRank[minTier] ?? 2;

  const unprocessed = lines.filter((item) => item.processed !== true);
  const qualifying = [];

  for (const candidate of unprocessed) {
    const classification = classifyWhitelistRisk(candidate);
    if (tierRank[classification.tier] >= minRank) {
      qualifying.push({
        ...candidate,
        classification,
      });
    }
  }

  return qualifying;
}
