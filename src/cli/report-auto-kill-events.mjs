#!/usr/bin/env node

// Summarize the last 24h of auto-kill trigger evaluations
// from data/risk/auto-kill-events.jsonl into a dashboard slice.
// The dashboard reads dashboard/public/auto-kill-events.json
// directly; this CLI is the only writer.

import process from "node:process";
import { constants } from "node:fs";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AUTO_KILL_EVENTS_PATH } from "../risk/auto-kill-events.mjs";

const DEFAULT_OUT = join("dashboard", "public", "auto-kill-events.json");
const WINDOW_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    eventsPath: options["events-path"] || AUTO_KILL_EVENTS_PATH,
    out: options.out || DEFAULT_OUT,
  };
}

async function readEvents(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function fileExists(path) {
  if (!path) return false;
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function summarize(events, now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  const recent = events.filter((event) => {
    const ts = Date.parse(event.evaluatedAt || event.observedAt || "");
    return Number.isFinite(ts) && ts >= cutoff;
  });
  const triggerCounts = {};
  for (const event of recent) {
    for (const trigger of event.triggers || []) {
      const key = trigger.trigger || "unknown";
      triggerCounts[key] = (triggerCounts[key] || 0) + 1;
    }
  }
  return {
    schemaVersion: 1,
    observedAt: new Date(now).toISOString(),
    summaryKind: "event_window_with_current_kill_switch_state",
    windowMs: WINDOW_MS,
    totalEvaluations24h: recent.length,
    triggerCounts,
    lastEvent: recent[recent.length - 1] || null,
    armedAt: recent.find((event) => event.alreadyArmed === false && event.triggers?.length)?.evaluatedAt || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const events = await readEvents(args.eventsPath);
  const summary = summarize(events);
  summary.killSwitchActive = await fileExists(summary.lastEvent?.killSwitchPath);
  summary.currentState = summary.killSwitchActive ? "halted" : "running";
  if (!summary.killSwitchActive) summary.armedAt = null;
  if (args.write) {
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`evaluations24h=${summary.totalEvaluations24h} triggers=${Object.keys(summary.triggerCounts).length} out=${args.write ? args.out : "(not written)"}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
