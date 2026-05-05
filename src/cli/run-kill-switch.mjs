#!/usr/bin/env node

/**
 * Kill-switch toggle CLI.
 *
 * Operator-driven (or coding-LLM-on-operator-request) on/off/status of the
 * file-based kill-switch at $KILL_SWITCH_PATH. Every toggle is appended to
 * logs/kill-switch-audit.jsonl with timestamp, action, reason, actor.
 *
 * Per AGENTS.md, the runtime LLM is still NOT in the trade execution decision
 * path. This CLI is a deterministic operator tool — the LLM may invoke it on
 * an explicit operator request, but the toggle itself is a plain file
 * mutation, not a model decision.
 *
 * Usage:
 *   node src/cli/run-kill-switch.mjs --on  --reason="manual halt — investigating"
 *   node src/cli/run-kill-switch.mjs --off --reason="resume after fix" [--actor=operator]
 *   node src/cli/run-kill-switch.mjs --status [--json]
 */

import process from "node:process";
import { existsSync } from "node:fs";
import { mkdir, appendFile, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { config, getEnv } from "../config/env.mjs";
import {
  buildKillSwitchAuditRecord,
  buildKillSwitchResumeReviewPacket,
  readKillSwitchStatus,
  resolveKillSwitchPath,
} from "../executor/policy/kill-switch.mjs";
import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";
import { buildAutoKillReplayStatus } from "../risk/auto-kill-replay.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...rest] = arg.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );
  return {
    on: flags.has("--on"),
    off: flags.has("--off"),
    status: flags.has("--status"),
    resumeReview: flags.has("--resume-review"),
    json: flags.has("--json"),
    reason: options.reason || null,
    actor: options.actor || "operator-via-llm",
    killSwitchPath: options["kill-switch-path"] || getEnv("KILL_SWITCH_PATH", resolveKillSwitchPath()),
    auditPath: options["audit-path"] || getEnv("KILL_SWITCH_AUDIT_PATH", "logs/kill-switch-audit.jsonl"),
    dashboardPath:
      options["dashboard-path"] ||
      getEnv("DASHBOARD_STATUS_PATH", "dashboard/public/dashboard-status.json"),
    postmortemPath:
      options["postmortem-path"] ||
      "docs/research/parcel-16-gateway-btc-funding-postmortem.md",
  };
}

async function appendAudit(auditPath, record) {
  await mkdir(dirname(resolve(auditPath)), { recursive: true });
  await appendFile(resolve(auditPath), JSON.stringify(record) + "\n", "utf8");
}

async function readJsonIfExists(path) {
  if (!path) return null;
  try {
    return JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function buildLiveKillSwitchReplay({ status, dashboardStatus, dashboardPath }) {
  if (!status?.halted) return null;
  if (status?.replay) return status.replay;

  const dataDir = config.dataDir || "./data";
  const [
    auditRecords,
    heartbeatPayload,
    oraclePayload,
    priceSamplesPayload,
    anchorHealthPayload,
    activeProtocolsPayload,
    campaignStatusPayload,
  ] = await Promise.all([
    readSignerAuditLog(),
    readJsonIfExists(getEnv("EXECUTOR_HEARTBEAT_PATH", "./state/executor-heartbeat.json")),
    readJsonIfExists(getEnv("AUTO_KILL_ORACLES_PATH", join(dataDir, "oracles", "btc-latest.json"))),
    readJsonIfExists(join(dataDir, "price-samples.json")),
    readJsonIfExists(join(dataDir, "anchor-position-health.json")),
    readJsonIfExists(join(dataDir, "active-protocols.json")),
    readJsonIfExists(join(dataDir, "campaign-status.json")),
  ]);
  const effectiveDashboardStatus = dashboardStatus || (await readJsonIfExists(dashboardPath));
  return buildAutoKillReplayStatus({
    auditRecords,
    executorRuntime: {
      observedAt: heartbeatPayload?.updatedAt || heartbeatPayload?.observedAt || null,
      killSwitch: {
        halted: status.halted,
        activeReason: status.activeReason,
        killSwitchPath: status.killSwitchPath,
      },
    },
    oraclePayload,
    priceSamplesPayload,
    anchorHealthPayload,
    activeProtocolsPayload,
    campaignStatusPayload,
    operatingCapitalUsd: effectiveDashboardStatus?.capitalSummary?.totalUsd ?? null,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.killSwitchPath) {
    console.error("KILL_SWITCH_PATH not set. Pass --kill-switch-path=... or set env.");
    process.exit(2);
  }

  const actionCount = [args.on, args.off, args.status, args.resumeReview].filter(Boolean).length;
  if (actionCount !== 1) {
    console.error("Specify exactly one of --on, --off, --status, --resume-review.");
    process.exit(2);
  }

  if ((args.on || args.off) && (!args.reason || args.reason.trim().length < 3)) {
    console.error("--reason=\"...\" required for --on / --off (min 3 chars).");
    process.exit(2);
  }

  if (args.status) {
    const dashboardStatus = await readJsonIfExists(args.dashboardPath);
    const baseStatus = await readKillSwitchStatus({
      killSwitchPath: args.killSwitchPath,
      auditPath: args.auditPath,
      dashboardStatus,
    });
    const replay = await buildLiveKillSwitchReplay({
      status: baseStatus,
      dashboardStatus,
      dashboardPath: args.dashboardPath,
    });
    const status = replay ? { ...baseStatus, replay } : baseStatus;
    if (args.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(`kill-switch: ${status.halted ? "HALTED" : "RUNNING"}`);
      console.log(`  path: ${status.killSwitchPath}`);
      if (status.fileMtime) console.log(`  mtime: ${status.fileMtime}`);
      if (status.halted && status.activeReason) {
        console.log(`  active reason: ${status.activeReason}`);
        if (status.activeActor) console.log(`  active actor: ${status.activeActor}`);
        if (status.replay) {
          console.log(`  replay triggered now: ${status.replay.triggered ? "yes" : "no"}`);
          if (status.replay.staleArm) console.log("  stale arm: yes");
        }
      }
      if (status.lastAudit) {
        console.log(`  last toggle: ${status.lastAudit.action} @ ${status.lastAudit.ts} by ${status.lastAudit.actor}`);
        console.log(`    reason: ${status.lastAudit.reason}`);
      }
    }
    return;
  }

  if (args.resumeReview) {
    const dashboardStatus = await readJsonIfExists(args.dashboardPath);
    const baseStatus = await readKillSwitchStatus({
      killSwitchPath: args.killSwitchPath,
      auditPath: args.auditPath,
      dashboardStatus,
    });
    const replay = await buildLiveKillSwitchReplay({
      status: baseStatus,
      dashboardStatus,
      dashboardPath: args.dashboardPath,
    });
    const status = replay ? { ...baseStatus, replay } : baseStatus;
    const packet = buildKillSwitchResumeReviewPacket({
      status,
      replay,
      postmortemPath: args.postmortemPath,
      postmortemExists: existsSync(args.postmortemPath),
    });
    const record = buildKillSwitchAuditRecord({
      action: "resume_review_packet",
      reason: "operator_resume_review",
      actor: args.actor,
      killSwitchPath: args.killSwitchPath,
      previousState: status.halted ? "halted" : "running",
      metadata: {
        activeReason: status.activeReason || null,
        activeSince: status.activeSince || null,
        triggers: packet.triggers,
        replay: packet.replay,
        checklist: packet.checklist,
      },
    });
    await appendAudit(args.auditPath, record);

    if (args.json) {
      console.log(JSON.stringify(packet, null, 2));
    } else {
      console.log(`kill-switch resume review: ${packet.state}`);
      console.log(`  path: ${packet.killSwitchPath}`);
      if (packet.activeReason) console.log(`  active reason: ${packet.activeReason}`);
      if (packet.activeSince) console.log(`  active since: ${packet.activeSince}`);
      for (const trigger of packet.triggers) {
        const strategy = trigger.strategyId ? ` strategy=${trigger.strategyId}` : "";
        const count = Number.isFinite(trigger.failureCount) ? ` failures=${trigger.failureCount}` : "";
        const threshold = Number.isFinite(trigger.threshold) ? ` threshold=${trigger.threshold}` : "";
        const window = Number.isFinite(trigger.windowMs) ? ` windowMs=${trigger.windowMs}` : "";
        console.log(`  trigger: ${trigger.trigger || "unknown"}${strategy}${count}${threshold}${window}`);
      }
      if (packet.replay) {
        console.log(`  replay triggered now: ${packet.replay.triggered ? "yes" : "no"}`);
        if (packet.replay.staleArm) console.log("  stale arm: yes");
      }
      console.log("  checklist:");
      for (const item of packet.checklist) {
        console.log(`    ${item.question} ${item.answer}`);
      }
      console.log("  clears kill-switch: no");
      console.log(`  audit: ${args.auditPath}`);
    }
    return;
  }

  const ts = new Date().toISOString();
  const action = args.on ? "halt" : "resume";
  const previousHalted = existsSync(args.killSwitchPath);

  if (args.on) {
    await mkdir(dirname(resolve(args.killSwitchPath)), { recursive: true });
    await writeFile(resolve(args.killSwitchPath), `halted_at=${ts}\nreason=${args.reason}\nactor=${args.actor}\n`, "utf8");
  } else {
    if (existsSync(args.killSwitchPath)) {
      await rm(resolve(args.killSwitchPath));
    }
  }

  const record = {
    ts,
    action,
    reason: args.reason,
    actor: args.actor,
    killSwitchPath: args.killSwitchPath,
    previousState: previousHalted ? "halted" : "running",
  };
  await appendAudit(args.auditPath, record);

  if (args.json) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    console.log(`kill-switch ${action} OK (was ${record.previousState}).`);
    console.log(`  reason: ${args.reason}`);
    console.log(`  audit: ${args.auditPath}`);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
