#!/usr/bin/env node

import { join } from "node:path";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { buildShadowRefreshQueue } from "../session/shadow-refresh-queue.mjs";
import { buildShadowRefreshBatchSummary, executeShadowRefreshBatch } from "../session/shadow-refresh-batch.mjs";
import { parseWhitelistedRefreshCommand, runParsedRefreshSteps } from "../session/shadow-refresh-runner.mjs";

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
    execute: flags.has("--execute"),
    continueOnFailure: flags.has("--continue-on-failure"),
    rank: options.rank ? Number(options.rank) : null,
    limit: options.limit ? Number(options.limit) : 1,
    scope: options.scope ? options.scope.split(",").map((item) => item.trim()).filter(Boolean) : [],
  };
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { generatedAt, latestObservedAt, ...stable } = value;
  return stable;
}

const POST_APPEND_SYNC_COMMANDS = [
  "npm run status:dashboard",
  "npm run write:session-handoff",
];

const POST_APPEND_ALLOWED_SCRIPTS = new Set(["status:dashboard", "write:session-handoff"]);

async function loadRefreshPlan() {
  const existing = await readJsonIfExists(join(config.dataDir, "shadow-refresh-plan.json"));
  if (existing?.items?.length) return existing;
  const [shadowCycle, readinessRecords, readinessFailures] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "shadow-cycle-latest.json")),
    readJsonl(config.dataDir, "estimator-wallet-readiness"),
    readJsonl(config.dataDir, "estimator-wallet-readiness-failures"),
  ]);
  if (!shadowCycle) {
    throw new Error("Missing shadow cycle snapshot. Run npm run run:shadow-cycle -- --write first.");
  }
  const items = buildShadowRefreshQueue({ shadowCycle, readinessRecords, readinessFailures, limit: 8 });
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    shadowCycleObservedAt: shadowCycle.observedAt || null,
    itemCount: items.length,
    items,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = await loadRefreshPlan();
  let items = plan.items || [];
  if (Number.isFinite(args.rank)) {
    items = items.filter((item) => item.rank === args.rank);
  }
  if (args.scope.length) {
    items = items.filter((item) => args.scope.includes(item.scope));
  }
  const safeLimit = Number.isFinite(args.limit) && args.limit > 0 ? Math.round(args.limit) : 1;
  items = items.slice(0, safeLimit);

  const record = await executeShadowRefreshBatch({
    queueItems: items,
    execute: args.execute,
    stopOnFailure: !args.continueOnFailure,
  });

  if (args.execute) {
    const store = new JsonlStore(config.dataDir);
    await store.append("shadow-refresh-batches", record);
  }

  const allRecords = args.execute || args.write ? await readJsonl(config.dataDir, "shadow-refresh-batches") : [];
  const persistedSummary = buildShadowRefreshBatchSummary(allRecords);

  if (args.write || args.execute) {
    const outputPath = join(config.dataDir, "shadow-refresh-batch-summary.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(persistedSummary, null, 2)}\n`, {
      normalize: (contents) => {
        if (!contents) return contents;
        return JSON.stringify(stripVolatile(JSON.parse(contents)));
      },
    });
  }

  if (args.execute) {
    for (const command of POST_APPEND_SYNC_COMMANDS) {
      const steps = parseWhitelistedRefreshCommand(command, { allowedScripts: POST_APPEND_ALLOWED_SCRIPTS });
      const result = await runParsedRefreshSteps(steps);
      if (result.executionStatus !== "succeeded") {
        throw new Error(`Post-append sync failed for command: ${command}`);
      }
    }
  }

  const summary = args.execute ? persistedSummary : buildShadowRefreshBatchSummary([record]);
  const output = {
    record,
    summary,
    persistedSummary,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`mode=${record.mode}`);
  console.log(`selectedCount=${record.selectedCount}`);
  console.log(`batchStatus=${record.batchStatus}`);
  console.log(`stopReason=${record.stopReason || "none"}`);
  console.log(`circuitBreaker=${record.circuitBreaker.blocked ? record.circuitBreaker.reasons.join(",") : "clear"}`);
  for (const result of record.queueResults || []) {
    console.log(
      [
        "queueItem",
        `rank=${result.rank ?? "n/a"}`,
        `scope=${result.scope || "unknown"}`,
        `code=${result.code || "unknown"}`,
        `status=${result.executionStatus || "unknown"}`,
        result.routeLabel ? `route=${result.routeLabel}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  for (const result of record.followUps || []) {
    console.log(
      [
        "followUp",
        `status=${result.executionStatus || "unknown"}`,
        result.scripts?.length ? `scripts=${result.scripts.join(",")}` : null,
        result.invalidReason ? `reason=${result.invalidReason}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  console.log(`batchSummary runs=${summary.runCount} success=${summary.successCount} failed=${summary.failureCount} blocked=${summary.blockedCount} invalid=${summary.invalidCount}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
