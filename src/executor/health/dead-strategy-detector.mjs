// Dead-strategy detector — pauses strategies that touch protocols flagged in
// the incident feed or that have position-bleed exit actions.
//
// Compatible with position-action-engine.mjs action shape.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PRIORITY = {
  exit: 1,
  unwind: 2,
  pause: 3,
  review: 4,
};

export function featureEnabled(profile = {}) {
  return profile.deadStrategyDetector !== false;
}

function dedupeKey({ strategyId, type, reasonCode, windowBucket }) {
  const h = createHash("sha1").update([strategyId, type, reasonCode, windowBucket].join("|")).digest("hex");
  return h.slice(0, 16);
}

function windowBucket(now = new Date(), bucketMs = 5 * 60 * 1000) {
  return Math.floor(new Date(now).getTime() / bucketMs);
}

function readIncidentFeed(incidentFeed) {
  if (Array.isArray(incidentFeed)) return incidentFeed;
  if (typeof incidentFeed === "string") {
    try {
      const raw = readFileSync(incidentFeed, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      const protocols = new Set();
      for (const line of lines) {
        const parsed = JSON.parse(line);
        if (Array.isArray(parsed)) {
          for (const p of parsed) protocols.add(p);
        }
      }
      return Array.from(protocols);
    } catch {
      return [];
    }
  }
  return [];
}

export function evaluateDeadStrategy({
  strategyId,
  protocols = [],
  incidentFeed = [],
  positionActions = [],
  now = new Date(),
} = {}) {
  const actions = [];
  if (!featureEnabled()) return actions;
  if (!strategyId) return actions;

  const feedProtocols = readIncidentFeed(incidentFeed);
  const touchedIncident = protocols.some((p) => feedProtocols.includes(p));

  const hasBleedExit = positionActions.some(
    (a) => a.type === "exit" && a.reasonCode === "position_bleed"
  );

  if (touchedIncident || hasBleedExit) {
    const wb = windowBucket(now);
    const incidentProtocols = protocols.filter((p) => feedProtocols.includes(p));
    actions.push({
      type: "pause",
      strategyId,
      positionId: null,
      priority: PRIORITY.pause,
      reasonCode: "dead_strategy",
      reason: touchedIncident
        ? `strategy touches incident-flagged protocol(s): ${incidentProtocols.join(", ")}`
        : `position bleed detected for strategy ${strategyId}`,
      estimatedCostUsd: 0,
      estimatedRecoveryUsd: 0,
      dedupeKey: dedupeKey({ strategyId, type: "pause", reasonCode: "dead_strategy", windowBucket: wb }),
    });
  }

  return actions;
}
