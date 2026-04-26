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
import { existsSync, statSync } from "node:fs";
import { mkdir, appendFile, writeFile, rm, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getEnv } from "../config/env.mjs";

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
    json: flags.has("--json"),
    reason: options.reason || null,
    actor: options.actor || "operator-via-llm",
    killSwitchPath: options["kill-switch-path"] || getEnv("KILL_SWITCH_PATH", null),
    auditPath: options["audit-path"] || getEnv("KILL_SWITCH_AUDIT_PATH", "logs/kill-switch-audit.jsonl"),
  };
}

async function appendAudit(auditPath, record) {
  await mkdir(dirname(resolve(auditPath)), { recursive: true });
  await appendFile(resolve(auditPath), JSON.stringify(record) + "\n", "utf8");
}

async function readLastAudit(auditPath) {
  try {
    const raw = await readFile(resolve(auditPath), "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) return null;
    return JSON.parse(lines[lines.length - 1]);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

function buildStatus(killSwitchPath, lastAudit) {
  const exists = killSwitchPath ? existsSync(killSwitchPath) : false;
  let mtime = null;
  if (exists) {
    try {
      mtime = statSync(killSwitchPath).mtime.toISOString();
    } catch {
      mtime = null;
    }
  }
  return {
    killSwitchPath,
    halted: exists,
    fileMtime: mtime,
    lastAudit,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.killSwitchPath) {
    console.error("KILL_SWITCH_PATH not set. Pass --kill-switch-path=... or set env.");
    process.exit(2);
  }

  const actionCount = [args.on, args.off, args.status].filter(Boolean).length;
  if (actionCount !== 1) {
    console.error("Specify exactly one of --on, --off, --status.");
    process.exit(2);
  }

  if ((args.on || args.off) && (!args.reason || args.reason.trim().length < 3)) {
    console.error("--reason=\"...\" required for --on / --off (min 3 chars).");
    process.exit(2);
  }

  const lastAudit = await readLastAudit(args.auditPath);

  if (args.status) {
    const status = buildStatus(args.killSwitchPath, lastAudit);
    if (args.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(`kill-switch: ${status.halted ? "HALTED" : "RUNNING"}`);
      console.log(`  path: ${status.killSwitchPath}`);
      if (status.fileMtime) console.log(`  mtime: ${status.fileMtime}`);
      if (lastAudit) {
        console.log(`  last toggle: ${lastAudit.action} @ ${lastAudit.ts} by ${lastAudit.actor}`);
        console.log(`    reason: ${lastAudit.reason}`);
      }
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
