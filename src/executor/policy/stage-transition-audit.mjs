// src/executor/policy/stage-transition-audit.mjs
// Stage transition recording: A→B, B→C, demotions

import { appendJsonlRecord } from "../../lib/jsonl-store.mjs";
import { resolve } from "node:path";

const STAGE_TRANSITIONS_PATH = resolve(process.cwd(), "logs/stage-transitions.jsonl");

export async function recordStageTransition({
  fromStage = "unknown",
  toStage = "unknown",
  timestamp = new Date().toISOString(),
  blockers = [],
  evidence = {},
  reason = "",
  actor = "system",
} = {}) {
  const record = {
    schemaVersion: 1,
    timestamp,
    fromStage,
    toStage,
    blockers,
    evidence,
    reason,
    actor,
    transitionType:
      fromStage === toStage
        ? "no_change"
        : toStage > fromStage
          ? "promote"
          : "demote",
  };

  await appendJsonlRecord(STAGE_TRANSITIONS_PATH, record);
  return record;
}

export async function getLatestStageTransition() {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(STAGE_TRANSITIONS_PATH, "utf8");
    if (!content.trim()) return null;

    const lines = content.trim().split("\n");
    if (lines.length === 0) return null;

    return JSON.parse(lines[lines.length - 1]);
  } catch (error) {
    return null;
  }
}

export async function getStageTransitionHistory(limit = 50) {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(STAGE_TRANSITIONS_PATH, "utf8");
    if (!content.trim()) return [];

    const lines = content.trim().split("\n");
    return lines.slice(-limit).map((line) => JSON.parse(line));
  } catch (error) {
    return [];
  }
}
