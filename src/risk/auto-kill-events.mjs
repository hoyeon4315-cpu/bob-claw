// Side-effect wrapper around the pure trigger evaluator.
// Writes the kill-switch file when any trigger fires and appends an
// event record to `data/risk/auto-kill-events.jsonl` for audit.
// The kill-switch file path comes from $KILL_SWITCH_PATH (AGENTS.md §31).
// Manual `rm` is the only resume — this module never deletes the file.

import { mkdir, writeFile, appendFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { evaluateAutoKillTriggers } from "./auto-kill-triggers.mjs";
import { buildAutoKillConfig } from "../config/auto-kill.mjs";
import {
  appendKillSwitchAuditRecord,
  buildKillSwitchAuditRecord,
  resolveKillSwitchAuditPath,
  resolveKillSwitchPath,
} from "../executor/policy/kill-switch.mjs";
import { appendSignerAuditRecord, buildSignerAuditRecord } from "../executor/signer/audit-log.mjs";

export const AUTO_KILL_EVENTS_PATH = join("data", "risk", "auto-kill-events.jsonl");

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function appendEvent(record, { rootDir = process.cwd() } = {}) {
  const path = join(rootDir, AUTO_KILL_EVENTS_PATH);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
  return path;
}

async function writeKillSwitchFile(killSwitchPath, payload) {
  await mkdir(dirname(killSwitchPath), { recursive: true });
  await writeFile(killSwitchPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return killSwitchPath;
}

function buildAutoKillAuditRecord(eventRecord) {
  return buildSignerAuditRecord({
    intent: {
      strategyId: "risk:auto-kill",
      chain: "all",
      intentId: `auto-kill:${eventRecord.evaluatedAt}`,
      intentType: "kill_switch_auto_trigger",
      amountUsd: 0,
      mode: "risk_control",
      metadata: {
        triggers: eventRecord.triggers,
        killSwitchPath: eventRecord.killSwitchPath,
        alreadyArmed: eventRecord.alreadyArmed,
      },
    },
    policyVerdict: "approved",
    lifecycle: {
      stage: "kill_switch_auto_triggered",
      killSwitchPath: eventRecord.killSwitchPath,
      alreadyArmed: eventRecord.alreadyArmed,
    },
    observedAt: eventRecord.evaluatedAt,
  });
}

function buildAutoKillKillSwitchReason(triggers = []) {
  const names = [...new Set(triggers.map((trigger) => trigger?.trigger).filter(Boolean))];
  return names.length > 0 ? `auto_kill:${names.join(",")}` : "auto_kill:triggered";
}

function resolveAuditPath(rootDir, auditPath = resolveKillSwitchAuditPath()) {
  if (!auditPath) return null;
  return isAbsolute(auditPath) ? auditPath : join(rootDir, auditPath);
}

export async function runAutoKillCheck({
  auditRecords = [],
  oracleSamples = [],
  heartbeatAtMs = null,
  operatingCapitalUsd = null,
  priceSamples = [],
  clStatus = {},
  activeProtocols = [],
  campaignStatus = {},
  config = buildAutoKillConfig(),
  killSwitchPath = resolveKillSwitchPath(),
  rootDir = process.cwd(),
  now = new Date(),
} = {}) {
  const alreadyArmed = killSwitchPath ? await fileExists(killSwitchPath) : false;
  const verdict = evaluateAutoKillTriggers({
    auditRecords,
    oracleSamples,
    heartbeatAtMs,
    operatingCapitalUsd,
    priceSamples,
    clStatus,
    activeProtocols,
    campaignStatus,
    config,
    now,
  });
  if (!verdict.triggered) {
    return {
      ...verdict,
      killSwitchPath,
      killSwitchWritten: false,
      alreadyArmed,
      killSwitchActive: alreadyArmed,
    };
  }
  const eventRecord = {
    schemaVersion: 1,
    evaluatedAt: verdict.evaluatedAt,
    triggers: verdict.triggers,
    killSwitchPath,
    alreadyArmed,
  };
  await appendEvent(eventRecord, { rootDir });
  await appendSignerAuditRecord(buildAutoKillAuditRecord(eventRecord), { rootDir });
  let killSwitchWritten = false;
  if (killSwitchPath && !alreadyArmed) {
    await writeKillSwitchFile(killSwitchPath, eventRecord);
    await appendKillSwitchAuditRecord(
      buildKillSwitchAuditRecord({
        action: "halt",
        reason: buildAutoKillKillSwitchReason(eventRecord.triggers),
        actor: "risk:auto-kill",
        killSwitchPath,
        previousState: "running",
        now: eventRecord.evaluatedAt,
        metadata: {
          source: "auto_kill",
          triggers: eventRecord.triggers,
        },
      }),
      { auditPath: resolveAuditPath(rootDir) },
    );
    killSwitchWritten = true;
  }
  return {
    ...verdict,
    killSwitchPath,
    killSwitchWritten,
    alreadyArmed,
    killSwitchActive: true,
  };
}
