#!/usr/bin/env node

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { runLiveReadinessRefreshPlan } from "../session/live-readiness-refresh.mjs";
import { buildWrappedBtcLendingLoopScaffold } from "../strategy/wrapped-btc-lending-loop-slice.mjs";
import {
  buildWrappedBtcLoopObservedReceipt,
  buildWrappedBtcLoopReceiptGuide,
  summarizeWrappedBtcLendingLoopDryRunRuns,
} from "../strategy/wrapped-btc-lending-loop-dry-run.mjs";
import {
  stabilizeWrappedBtcLoopLiveProof,
  hydrateWrappedBtcLoopLiveProof,
  WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE,
} from "../strategy/wrapped-btc-loop-live-proof.mjs";
import { buildWrappedBtcLoopOosEvidence } from "../strategy/wrapped-btc-loop-oos-evidence.mjs";
import {
  filterRecursiveLendingLoopDryRunRecords,
  summarizeRecursiveLendingLoopDryRunRuns,
} from "../strategy/recursive-lending-loop-dry-run.mjs";

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
  const parseNumericList = (value) =>
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => Number(item))
      .filter(Number.isFinite);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    scenario: options.scenario || "healthy_baseline",
    executionMode: options["execution-mode"] || "signer_backed_receipt",
    result: options.result || "passed",
    entryTxHashes: (options["entry-tx-hashes"] || "").split(",").map((item) => item.trim()).filter(Boolean),
    unwindTxHashes: (options["unwind-tx-hashes"] || "").split(",").map((item) => item.trim()).filter(Boolean),
    observedHealthFactorPath: parseNumericList(options["health-factor-path"]),
    observedLiquidationBufferPath: parseNumericList(options["liquidation-buffer-path"]),
    actualLoopFeesUsd: options["actual-loop-fees-usd"] ? Number(options["actual-loop-fees-usd"]) : null,
    actualUnwindCostUsd: options["actual-unwind-cost-usd"] ? Number(options["actual-unwind-cost-usd"]) : null,
    realizedNetCarryUsd: options["realized-net-carry-usd"] ? Number(options["realized-net-carry-usd"]) : null,
    notes: (options.notes || "").split("|").map((item) => item.trim()).filter(Boolean),
    observedAt: options["observed-at"] || null,
    refreshLivePacket: !flags.has("--no-refresh-live-packet"),
  };
}

function isMissingReceiptFieldError(error) {
  return /Missing required wrapped BTC loop receipt field:/.test(String(error?.message || ""));
}

function stripVolatile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { observedAt, generatedAt, runId, ...stable } = value;
  return stable;
}

function mergeReceiptArgs(args = {}, liveProof = null) {
  return {
    ...args,
    scenario: args.scenario || liveProof?.scenarioId || "healthy_baseline",
    executionMode: args.executionMode || liveProof?.executionMode || "signer_backed_receipt",
    result: args.result || liveProof?.result || "passed",
    entryTxHashes: args.entryTxHashes?.length ? args.entryTxHashes : liveProof?.entryTxHashes || [],
    unwindTxHashes: args.unwindTxHashes?.length ? args.unwindTxHashes : liveProof?.unwindTxHashes || [],
    observedHealthFactorPath:
      args.observedHealthFactorPath?.length ? args.observedHealthFactorPath : liveProof?.observedHealthFactorPath || [],
    observedLiquidationBufferPath:
      args.observedLiquidationBufferPath?.length
        ? args.observedLiquidationBufferPath
        : liveProof?.observedLiquidationBufferPath || [],
    actualLoopFeesUsd: Number.isFinite(args.actualLoopFeesUsd) ? args.actualLoopFeesUsd : liveProof?.actualLoopFeesUsd ?? null,
    actualUnwindCostUsd: Number.isFinite(args.actualUnwindCostUsd)
      ? args.actualUnwindCostUsd
      : liveProof?.actualUnwindCostUsd ?? null,
    realizedNetCarryUsd: Number.isFinite(args.realizedNetCarryUsd)
      ? args.realizedNetCarryUsd
      : liveProof?.realizedNetCarryUsd ?? null,
    notes: [...new Set([...(liveProof?.notes || []), ...(args.notes || [])].filter(Boolean))],
    observedAt: args.observedAt || liveProof?.observedAt || null,
  };
}

export function buildReceiptSeedProof({
  args = {},
  liveProof = null,
} = {}) {
  const merged = mergeReceiptArgs(args, liveProof);
  const entryHashesOverridden =
    Array.isArray(args.entryTxHashes) &&
    args.entryTxHashes.length > 0 &&
    JSON.stringify(args.entryTxHashes) !== JSON.stringify(liveProof?.entryTxHashes || []);
  const unwindHashesOverridden =
    Array.isArray(args.unwindTxHashes) &&
    args.unwindTxHashes.length > 0 &&
    JSON.stringify(args.unwindTxHashes) !== JSON.stringify(liveProof?.unwindTxHashes || []);
  return {
    ...liveProof,
    observedAt: merged.observedAt || liveProof?.observedAt || null,
    strategyId: liveProof?.strategyId || "wrapped-btc-loop-base-moonwell",
    scenarioId: merged.scenario,
    success: merged.result === "passed",
    proofKind: liveProof?.proofKind || "signer_backed_roundtrip",
    proofStatus: liveProof?.proofStatus || "signer_backed_roundtrip_recorded",
    entryCount: merged.entryTxHashes.length,
    unwindCount: merged.unwindTxHashes.length,
    entryReceiptMode: entryHashesOverridden ? null : liveProof?.entryReceiptMode || null,
    mintEventCount: entryHashesOverridden ? null : liveProof?.mintEventCount ?? null,
    borrowEventCount: entryHashesOverridden ? null : liveProof?.borrowEventCount ?? null,
    entryTxHashes: merged.entryTxHashes,
    unwindTxHashes: merged.unwindTxHashes,
    observedHealthFactorPath: merged.observedHealthFactorPath,
    observedLiquidationBufferPath: merged.observedLiquidationBufferPath,
    actualLoopFeesUsd: merged.actualLoopFeesUsd,
    actualUnwindCostUsd: merged.actualUnwindCostUsd,
    realizedNetCarryUsd: merged.realizedNetCarryUsd,
    receiptAutoIngest:
      entryHashesOverridden || unwindHashesOverridden ? { ran: false, reason: "historical_receipt_reconstruction" } : liveProof?.receiptAutoIngest || { ran: false, reason: null },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scaffold =
    (await readJsonIfExists(join(config.dataDir, "wrapped-btc-lending-loop-slice.json"))) || buildWrappedBtcLendingLoopScaffold();
  const [latestLiveProof, capitalAuditReport] = await Promise.all([
    readJsonIfExists(join(config.dataDir, WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE)),
    readJsonIfExists(join(config.dataDir, "capital-audit.json")),
  ]);
  const hydratedLiveProof = await stabilizeWrappedBtcLoopLiveProof({
    proof: latestLiveProof,
    capitalAuditReport,
  });
  const enrichedReceiptProof = await stabilizeWrappedBtcLoopLiveProof({
    proof: buildReceiptSeedProof({
      args,
      liveProof: hydratedLiveProof || latestLiveProof,
    }),
    capitalAuditReport,
    attempts: 5,
  });
  const resolvedLiveProof = enrichedReceiptProof || hydratedLiveProof;
  const resolvedArgs = mergeReceiptArgs(args, resolvedLiveProof);
  const store = new JsonlStore(config.dataDir);
  if (args.write) {
    if (resolvedLiveProof) {
      await writeTextIfChanged(
        join(config.dataDir, WRAPPED_BTC_LOOP_LIVE_PROOF_LATEST_FILE),
        `${JSON.stringify(resolvedLiveProof, null, 2)}\n`,
        {
          normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
        },
      );
    }
  }
  let receipt;
  try {
    receipt = buildWrappedBtcLoopObservedReceipt({
      scaffold,
      scenarioId: resolvedArgs.scenario,
      executionMode: resolvedArgs.executionMode,
      result: resolvedArgs.result,
      entryTxHashes: resolvedArgs.entryTxHashes,
      unwindTxHashes: resolvedArgs.unwindTxHashes,
      observedHealthFactorPath: resolvedArgs.observedHealthFactorPath,
      observedLiquidationBufferPath: resolvedArgs.observedLiquidationBufferPath,
      actualLoopFeesUsd: resolvedArgs.actualLoopFeesUsd,
      actualUnwindCostUsd: resolvedArgs.actualUnwindCostUsd,
      realizedNetCarryUsd: resolvedArgs.realizedNetCarryUsd,
      notes: resolvedArgs.notes,
      now: resolvedArgs.observedAt || undefined,
    });
  } catch (error) {
    if (isMissingReceiptFieldError(error)) {
      const guide = buildWrappedBtcLoopReceiptGuide({
        scaffold,
        liveProof: hydratedLiveProof,
      });
      const guideArtifact = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        strategyId: scaffold.strategy?.id || null,
        status: "receipt_template_required",
        reason: error.message,
        ...guide,
        missingExtendedReceiptFields: hydratedLiveProof?.missingExtendedReceiptFields || [],
      };
      const guidePath = join(config.dataDir, "wrapped-btc-loop-receipt-guide.json");
      if (args.write) {
        await writeTextIfChanged(guidePath, `${JSON.stringify(guideArtifact, null, 2)}\n`, {
          normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
        });
      }
      if (args.json) {
        console.log(JSON.stringify({ receipt: null, summary: null, oosEvidence: null, livePacketRefresh: null, hydratedLiveProof, guide: guideArtifact }, null, 2));
        return;
      }
      console.log(`scenario=${resolvedArgs.scenario}`);
      console.log(`executionMode=${resolvedArgs.executionMode}`);
      console.log("receiptRecorded=false");
      console.log(`missingFields=${guide.requiredFields.join(",")}`);
      console.log(`sampleCommand=${guide.sampleCommand}`);
      console.log(`liveProofMissingFields=${(hydratedLiveProof?.missingExtendedReceiptFields || []).join(",") || "none"}`);
      if (args.write) {
        console.log(`guideWrote=${guidePath}`);
      }
      return;
    }
  if (resolvedLiveProof?.missingExtendedReceiptFields?.length) {
      error.message = `${error.message} (hydrated live proof still missing: ${resolvedLiveProof.missingExtendedReceiptFields.join(", ")})`;
    }
    throw error;
  }
  if (args.write) {
    await store.append("wrapped-btc-loop-dry-runs", receipt);
  }
  const allRecords = args.write ? await readJsonl(config.dataDir, "wrapped-btc-loop-dry-runs") : [receipt];
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strategyId: scaffold.strategy?.id || null,
    ...summarizeWrappedBtcLendingLoopDryRunRuns(allRecords),
  };
  const oosEvidence = buildWrappedBtcLoopOosEvidence({
    records: allRecords,
    now: new Date().toISOString(),
  });
  let livePacketRefresh = null;

  if (args.write) {
    await writeTextIfChanged(join(config.dataDir, "wrapped-btc-lending-loop-dry-run-latest.json"), `${JSON.stringify(summary, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
    const recursiveWrappedSummary = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      strategyId: "recursive_wrapped_btc_lending_loop",
      ...summarizeRecursiveLendingLoopDryRunRuns(
        filterRecursiveLendingLoopDryRunRecords(allRecords, "recursive_wrapped_btc_lending_loop"),
      ),
    };
    await writeTextIfChanged(
      join(config.dataDir, "recursive_wrapped_btc_lending_loop-dry-run-latest.json"),
      `${JSON.stringify(recursiveWrappedSummary, null, 2)}\n`,
      {
        normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
      },
    );
    await writeTextIfChanged(join(config.dataDir, "wrapped-btc-loop-oos-evidence.json"), `${JSON.stringify(oosEvidence, null, 2)}\n`, {
      normalize: (contents) => (contents ? JSON.stringify(stripVolatile(JSON.parse(contents))) : contents),
    });
    if (args.refreshLivePacket) {
      const results = runLiveReadinessRefreshPlan();
      livePacketRefresh = {
        refreshed: true,
        stepCount: results.length,
        firstStep: results[0]?.script || null,
        lastStep: results.at(-1)?.script || null,
      };
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ receipt, summary, oosEvidence, livePacketRefresh, hydratedLiveProof: resolvedLiveProof }, null, 2));
    return;
  }

  console.log(`scenario=${receipt.scenarioId}`);
  console.log(`executionMode=${receipt.executionMode}`);
  console.log(`result=${receipt.result}`);
  console.log(`signerBackedRunCount=${oosEvidence.summary.signerBackedRunCount}`);
  console.log(`oosStatus=${oosEvidence.summary.status}`);
  if (resolvedLiveProof) {
    console.log(`liveProofMissingFields=${(resolvedLiveProof.missingExtendedReceiptFields || []).join(",") || "none"}`);
  }
  console.log(`livePacketRefresh=${livePacketRefresh?.refreshed ? `ran:${livePacketRefresh.stepCount}` : args.refreshLivePacket ? "skipped" : "disabled"}`);
}

if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
