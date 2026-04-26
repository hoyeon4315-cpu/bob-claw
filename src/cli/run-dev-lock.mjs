#!/usr/bin/env node

/**
 * Dev-lock toggle CLI.
 *
 *   npm run dev:lock   -- --reason="hand-coding strategy X"
 *   npm run dev:unlock -- --reason="done"
 *   npm run dev:lock-status [-- --json]
 *
 * Existence of $DEV_LOCK_PATH (default ~/.bob-claw/DEV_LOCK) pauses the
 * dev-automation CLIs (auto-validation, route discovery, auto-promotion
 * runner). Live execution is NOT affected — kill-switch is a separate file.
 */

import process from "node:process";
import { existsSync, statSync } from "node:fs";
import { mkdir, appendFile, writeFile, rm, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveDevLockPath } from "../runtime/dev-lock.mjs";

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
    lock: flags.has("--lock"),
    unlock: flags.has("--unlock"),
    status: flags.has("--status"),
    json: flags.has("--json"),
    reason: options.reason || null,
    actor: options.actor || "operator",
    devLockPath: options["dev-lock-path"] || resolveDevLockPath(process.env),
    auditPath:
      options["audit-path"] ||
      process.env.DEV_LOCK_AUDIT_PATH ||
      "logs/dev-lock-audit.jsonl",
  };
}

async function appendAudit(auditPath, record) {
  await mkdir(dirname(resolve(auditPath)), { recursive: true });
  await appendFile(resolve(auditPath), JSON.stringify(record) + "\n", "utf8");
}

async function readLastAudit(auditPath) {
  try {
    const raw = await readFile(resolve(auditPath), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;
    return JSON.parse(lines[lines.length - 1]);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const actionCount = [args.lock, args.unlock, args.status].filter(Boolean).length;
  if (actionCount !== 1) {
    console.error("Specify exactly one of --lock, --unlock, --status.");
    process.exit(2);
  }

  if ((args.lock || args.unlock) && (!args.reason || args.reason.trim().length < 3)) {
    console.error("--reason=\"...\" required for --lock / --unlock (min 3 chars).");
    process.exit(2);
  }

  const lastAudit = await readLastAudit(args.auditPath);

  if (args.status) {
    const exists = existsSync(args.devLockPath);
    let mtime = null;
    if (exists) {
      try {
        mtime = statSync(args.devLockPath).mtime.toISOString();
      } catch {
        mtime = null;
      }
    }
    const status = {
      devLockPath: args.devLockPath,
      locked: exists,
      fileMtime: mtime,
      lastAudit,
    };
    if (args.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(`dev-lock: ${status.locked ? "LOCKED (automation paused)" : "OPEN (automation runs)"}`);
      console.log(`  path: ${status.devLockPath}`);
      if (mtime) console.log(`  mtime: ${mtime}`);
      if (lastAudit) {
        console.log(`  last toggle: ${lastAudit.action} @ ${lastAudit.ts} by ${lastAudit.actor}`);
        console.log(`    reason: ${lastAudit.reason}`);
      }
    }
    return;
  }

  const ts = new Date().toISOString();
  const action = args.lock ? "lock" : "unlock";
  const previousLocked = existsSync(args.devLockPath);

  if (args.lock) {
    await mkdir(dirname(resolve(args.devLockPath)), { recursive: true });
    await writeFile(
      resolve(args.devLockPath),
      `locked_at=${ts}\nreason=${args.reason}\nactor=${args.actor}\n`,
      "utf8",
    );
  } else if (existsSync(args.devLockPath)) {
    await rm(resolve(args.devLockPath));
  }

  const record = {
    ts,
    action,
    reason: args.reason,
    actor: args.actor,
    devLockPath: args.devLockPath,
    previousState: previousLocked ? "locked" : "open",
  };
  await appendAudit(args.auditPath, record);

  if (args.json) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    console.log(`dev-lock ${action} OK (was ${record.previousState}).`);
    console.log(`  reason: ${args.reason}`);
    console.log(`  audit: ${args.auditPath}`);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
