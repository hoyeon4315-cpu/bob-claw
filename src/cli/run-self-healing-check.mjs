#!/usr/bin/env node

import process from "node:process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateOperatorAbsence } from "../executor/health/operator-absence-engine.mjs";
import { runSelfHealing } from "../executor/health/self-healing-rebuild.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const i = arg.indexOf("=");
        return [arg.slice(2, i), arg.slice(i + 1)];
      }),
  );
  return {
    once: flags.has("--once"),
    dryRun: flags.has("--dry-run"),
    json: flags.has("--json"),
    metricsPath: options["metrics-path"] || null,
    policyPath: options["policy-path"] || null,
    auditPath: options["audit-path"] || null,
  };
}

async function readJsonIfExists(path) {
  if (!path) return null;
  try {
    const contents = await readFile(path, "utf8");
    return JSON.parse(contents);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const metrics = (await readJsonIfExists(args.metricsPath)) || {
    heartbeatAt: null,
    lastHarvestAt: null,
    lastPaybackAt: null,
    lastSignerAuditAt: null,
  };

  const policy = (await readJsonIfExists(args.policyPath)) || {};

  const absenceResult = evaluateOperatorAbsence({ metrics, policy, now: Date.now() });

  let healingResult = null;
  if (absenceResult.state === "absent") {
    const components = {
      heartbeatStale: absenceResult.stale.heartbeat,
      receiptIngestorLagMs: metrics.receiptIngestorLagMs || 0,
      dashboardStaleMs: metrics.dashboardStaleMs || 0,
    };
    healingResult = await runSelfHealing({
      absenceState: absenceResult.state,
      components,
      now: Date.now(),
      dryRun: args.dryRun,
      auditPath: args.auditPath || undefined,
    });
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    absence: absenceResult,
    healing: healingResult,
    dryRun: args.dryRun,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`absence_state=${absenceResult.state}`);
    if (healingResult) {
      console.log(`rebuilt=${healingResult.rebuilt}`);
      console.log(`dry_run=${healingResult.dryRun}`);
      for (const step of healingResult.steps) {
        console.log(`  step=${step.step} executed=${step.executed}`);
      }
    } else {
      console.log("healing=not_needed");
    }
  }

  if (healingResult && !healingResult.rebuilt && !args.dryRun && absenceResult.state === "absent") {
    process.exitCode = 1;
  }
}

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
