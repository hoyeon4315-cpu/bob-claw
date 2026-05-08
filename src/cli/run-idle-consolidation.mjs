#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { readSignerAuditLog } from "../executor/signer/audit-log.mjs";
import {
  diagnosticsFromRefillExecutions,
  resolveRefillPrerequisites,
} from "../executor/dispatcher/refill-prerequisite-resolver.mjs";
import { buildIdleConsolidationSlice } from "../status/idle-consolidation-slice.mjs";

const IS_MAIN = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

function parseArgs(argv = []) {
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
    dryRun: flags.has("--dry-run") || !flags.has("--write"),
    write: flags.has("--write"),
    input: options.input || join(config.dataDir, "all-chain-autopilot-latest.json"),
  };
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function buildIdleConsolidationDryRun({
  allChainReport = null,
  auditRecords = [],
  now = new Date().toISOString(),
  write = false,
} = {}) {
  const diagnostics = diagnosticsFromRefillExecutions(allChainReport?.refillExecutions || []);
  const prerequisites = resolveRefillPrerequisites({ diagnostics, now });
  const jobs = prerequisites.prerequisites
    .flatMap((item) => item.jobs || [])
    .filter((job) => job.kind === "idle_inventory_consolidation");
  const idleConsolidation = buildIdleConsolidationSlice({ auditRecords, now });
  return {
    schemaVersion: 1,
    observedAt: now,
    mode: "dry_run",
    dryRun: true,
    write: Boolean(write),
    status: jobs.length > 0 ? "planned" : "no_action",
    prerequisiteSummary: prerequisites.summary,
    jobs,
    idleConsolidation,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allChainReport = await readJson(args.input, null);
  const auditRecords = await readSignerAuditLog({ rootDir: process.cwd() }).catch(() => []);
  const now = allChainReport?.observedAt || new Date().toISOString();
  const report = buildIdleConsolidationDryRun({
    allChainReport,
    auditRecords,
    now,
    write: args.write,
  });

  if (args.json) {
    await new Promise((resolve, reject) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    return;
  }

  console.log(`mode=${report.mode}`);
  console.log(`status=${report.status}`);
  console.log(`jobs=${report.jobs.length}`);
  console.log(`write=${report.write}`);
}

if (IS_MAIN) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
