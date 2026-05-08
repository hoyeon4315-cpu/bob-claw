#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import {
  diagnosticsFromRefillExecutions,
  resolveRefillPrerequisites,
} from "../executor/dispatcher/refill-prerequisite-resolver.mjs";

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
    write: flags.has("--write"),
    input: options.input || join(config.dataDir, "all-chain-autopilot-latest.json"),
    output: options.output || join(config.dataDir, "refill-status.json"),
  };
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function buildRefillStatusReport({
  allChainReport = null,
  now = new Date().toISOString(),
} = {}) {
  const diagnostics = diagnosticsFromRefillExecutions(allChainReport?.refillExecutions || []);
  const resolved = resolveRefillPrerequisites({ diagnostics, now });
  return {
    schemaVersion: 1,
    observedAt: now,
    sourceObservedAt: allChainReport?.observedAt || null,
    source: "all_chain_autopilot_refill_executions",
    ...resolved,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allChainReport = await readJson(args.input, null);
  const now = allChainReport?.observedAt || new Date().toISOString();
  const report = buildRefillStatusReport({ allChainReport, now });

  if (args.write) {
    await writeTextIfChanged(args.output, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    await new Promise((resolve, reject) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    return;
  }

  console.log(`status=${report.status}`);
  console.log(`prerequisites=${report.summary.prerequisiteCount}`);
  console.log(`routing_exhausted=${report.summary.byBlocker.routing_exhausted || 0}`);
  console.log(`insufficient_funds=${report.summary.byBlocker.insufficient_funds || 0}`);
  console.log(`budget_exceeded=${report.summary.byBlocker.budget_exceeded || 0}`);
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
