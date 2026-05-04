import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { JsonlStore } from "../../lib/jsonl-store.mjs";

const STAGE_ORDER = Object.freeze({
  unknown: 0,
  A: 1,
  B: 2,
  C: 3,
});

export async function recordStageTransition({
  logsDir = join(process.cwd(), "logs"),
  fromStage = "unknown",
  toStage = "unknown",
  timestamp = new Date().toISOString(),
  blockers = [],
  evidence = {},
  reason = "",
  actor = "system",
} = {}) {
  const fromOrder = STAGE_ORDER[fromStage] ?? STAGE_ORDER.unknown;
  const toOrder = STAGE_ORDER[toStage] ?? STAGE_ORDER.unknown;
  const record = {
    schemaVersion: 1,
    timestamp,
    fromStage,
    toStage,
    blockers,
    evidence,
    reason,
    actor,
    transitionType: fromStage === toStage ? "no_change" : toOrder > fromOrder ? "promote" : "demote",
  };

  await new JsonlStore(logsDir).append("stage-transitions", record);
  return record;
}

async function readStageTransitions(logsDir = join(process.cwd(), "logs")) {
  try {
    const content = await readFile(join(logsDir, "stage-transitions.jsonl"), "utf8");
    if (!content.trim()) return [];
    return content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function getLatestStageTransition({ logsDir = join(process.cwd(), "logs") } = {}) {
  const history = await readStageTransitions(logsDir);
  return history.at(-1) || null;
}

export async function getStageTransitionHistory({ logsDir = join(process.cwd(), "logs"), limit = 50 } = {}) {
  const history = await readStageTransitions(logsDir);
  return history.slice(-limit);
}

export async function syncStageTransitionAudit({
  logsDir = join(process.cwd(), "logs"),
  stageEvaluation = null,
  observedAt = new Date().toISOString(),
  actor = "dashboard_status",
} = {}) {
  const nextStage = stageEvaluation?.currentStage || null;
  if (!nextStage) {
    return {
      changed: false,
      latest: await getLatestStageTransition({ logsDir }),
    };
  }

  const latest = await getLatestStageTransition({ logsDir });
  if (latest?.toStage === nextStage) {
    return {
      changed: false,
      latest,
    };
  }

  const record = await recordStageTransition({
    logsDir,
    fromStage: latest?.toStage || "unknown",
    toStage: nextStage,
    timestamp: observedAt,
    blockers: [...(stageEvaluation?.blockers || [])],
    evidence: stageEvaluation?.evidence || {},
    reason: (stageEvaluation?.blockers || []).join(",") || "stage_transition",
    actor,
  });

  return {
    changed: true,
    latest: record,
  };
}
