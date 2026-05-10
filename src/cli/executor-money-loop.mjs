#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import { createStrategyRegistry } from "../strategy/strategy-registry.mjs";
import { defaultStrategySourcePlugins } from "../strategy/registry/plugins/json-file-source.mjs";
import { rotateTopK } from "../executor/portfolio-allocator/top-k-rotator.mjs";
import { classifyBlocker } from "../executor/blocker-classifier.mjs";
import { buildUniversalPositionSnapshot } from "../treasury/universal-position-aggregator.mjs";
import { buildBtcNavHistoryRecord } from "../status/btc-nav-history-slice.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { buildPreDepositReadiness } from "./check-pre-deposit-readiness.mjs";
import { runAutopilotCommand } from "./run-all-chain-autopilot.mjs";

function parseArgs(argv = []) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(2, index), item.slice(index + 1)];
      }),
  );
  return {
    tick: flags.has("--tick"),
    json: flags.has("--json"),
    execute: !flags.has("--preview") && !flags.has("--no-execute"),
    write: !flags.has("--no-write"),
    capitalUsd: entries["capital-usd"] ? Number(entries["capital-usd"]) : null,
  };
}

function finitePositive(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function extractAutopilotFinal(outcome = {}) {
  const safeOutcome = outcome || {};
  return safeOutcome.final || safeOutcome.execution || safeOutcome.preview || safeOutcome;
}

function autopilotBroadcastEvidence(outcome = {}) {
  const final = extractAutopilotFinal(outcome);
  const canary = final?.summary?.canarySweep || {};
  const strategy = final?.summary?.strategyDispatch || {};
  const txBroadcastCount =
    Number(canary.broadcastStepCount || 0) +
    Number(strategy.txBroadcastCount || 0) +
    Number(final?.summary?.destinationRepresentative?.txHashes?.length || 0);
  return {
    broadcast: txBroadcastCount > 0 || Number(canary.executedCount || 0) > 0,
    txBroadcastCount,
    canaryExecutedCount: Number(canary.executedCount || 0),
  };
}

function noTxReasonFromAutopilot(outcome = {}) {
  const final = extractAutopilotFinal(outcome);
  const executionGateReason = final?.summary?.executionGate?.blockedReason || null;
  return final?.blockedReason ||
    final?.summary?.canarySweep?.blockedReason ||
    final?.summary?.merklCanary?.blockedReason ||
    final?.summary?.portfolio?.blockedReason ||
    (executionGateReason !== "preview_only" ? executionGateReason : null) ||
    executionGateReason ||
    final?.summary?.payback?.reason ||
    null;
}

async function writeMoneyLoopArtifacts({ dataDir, result }) {
  const store = new JsonlStore(dataDir);
  await writeTextIfChanged(join(dataDir, "money-loop-latest.json"), `${safeJsonStringify(result, 2)}\n`);
  await writeTextIfChanged(join(dataDir, "..", "dashboard", "public", "money-loop-status.json"), `${safeJsonStringify(result, 2)}\n`);
  if (result.btcNavHistory?.latest) {
    await store.append("btc-nav-history", result.btcNavHistory.latest);
  }
  for (const item of result.perSlotAttribution || []) {
    await store.append("per-slot-attribution", item);
  }
}

export async function buildMoneyLoopTick({
  now = new Date().toISOString(),
  dataDir = config.dataDir,
  execute = true,
  writeArtifacts = true,
  registry = createStrategyRegistry({ sourcePlugins: defaultStrategySourcePlugins({ dataDir }) }),
  deposit = null,
  checkDeposit = false,
  runAutopilotImpl = runAutopilotCommand,
  positionSnapshot = null,
  capitalUsd = null,
} = {}) {
  const registryEnvelope = await registry.refresh({ observedAt: now, dataDir });
  if (registryEnvelope.empty) {
    const result = {
      schemaVersion: 1,
      observedAt: now,
      status: "blocked",
      stage: "registry_refresh",
      registry: registryEnvelope,
      scoring: [],
      rotator: null,
      policyValidation: { status: "blocked", reason: "empty_strategy_registry" },
      signerDispatch: { attempted: false, broadcast: false, reason: "empty_strategy_registry" },
      positionSnapshot: positionSnapshot || buildUniversalPositionSnapshot({ now }),
      payback: { status: "not_run", reason: "empty_strategy_registry" },
      btcNavHistory: { latest: null },
      perSlotAttribution: [],
      noTxReason: "empty_strategy_registry",
      blockerClass: "source",
      blocker: classifyBlocker("empty_strategy_registry", { source: "strategy_registry" }),
    };
    if (writeArtifacts) await writeMoneyLoopArtifacts({ dataDir, result });
    return result;
  }

  const readiness = deposit || (checkDeposit ? await buildPreDepositReadiness({ dataDir }) : null);
  const resolvedCapitalUsd =
    finitePositive(capitalUsd) ??
    finitePositive(readiness?.operatingCapital?.estimatedUsd) ??
    500;
  const rotator = rotateTopK(registryEnvelope.records, {
    capitalUsd: resolvedCapitalUsd,
    profile: "aggressive_calibrated",
  });

  if (rotator.actions.length === 0) {
    const reason = rotator.noTxReason || "no_strategy_candidates_eligible";
    const result = {
      schemaVersion: 1,
      observedAt: now,
      status: "blocked",
      stage: "top_k_rotator",
      deposit: readiness,
      registry: registryEnvelope,
      scoring: rotator.selected.map((item) => item.breakdown),
      rotator,
      policyValidation: { status: "blocked", reason },
      signerDispatch: { attempted: false, broadcast: false, reason },
      positionSnapshot: positionSnapshot || buildUniversalPositionSnapshot({ now }),
      payback: { status: "not_run", reason },
      btcNavHistory: { latest: null },
      perSlotAttribution: [],
      noTxReason: reason,
      blockerClass: rotator.blockerClass || "policy",
      blocker: classifyBlocker(reason),
    };
    if (writeArtifacts) await writeMoneyLoopArtifacts({ dataDir, result });
    return result;
  }

  if (readiness && readiness.status !== "DEPOSIT_CONFIRMED") {
    const reason = readiness.status === "BLOCKED_EXTERNAL" ? "bitcoin_deposit_provider_unavailable" : "operator_deposit_not_confirmed";
    const blocker = classifyBlocker(reason);
    const result = {
      schemaVersion: 1,
      observedAt: now,
      status: "blocked",
      stage: "deposit_gate",
      deposit: readiness,
      registry: registryEnvelope,
      rotator,
      policyValidation: { status: "blocked", reason },
      signerDispatch: { attempted: false, broadcast: false, reason },
      positionSnapshot: positionSnapshot || buildUniversalPositionSnapshot({ now }),
      payback: { status: "not_run", reason },
      btcNavHistory: { latest: null },
      perSlotAttribution: [],
      noTxReason: reason,
      blockerClass: blocker.category,
      blocker,
    };
    if (writeArtifacts) await writeMoneyLoopArtifacts({ dataDir, result });
    return result;
  }

  let autopilotOutcome = null;
  let autopilotError = null;
  if (execute) {
    try {
      autopilotOutcome = await runAutopilotImpl({
        execute: true,
        dryRunFirst: true,
        json: true,
        write: true,
        enableDexProbeExecution: true,
        bootstrapBtcSats: readiness?.deposit?.confirmedBalanceSats ?? null,
        bootstrapBtcPriceUsd: readiness?.operatingCapital?.btcUsd ?? null,
        bootstrapTotalCapitalUsd: resolvedCapitalUsd,
      });
    } catch (error) {
      autopilotError = error;
    }
  }

  const evidence = autopilotBroadcastEvidence(autopilotOutcome || {});
  const noTxReason = autopilotError?.message || (!evidence.broadcast ? noTxReasonFromAutopilot(autopilotOutcome) : null);
  const blocker = noTxReason ? classifyBlocker(noTxReason) : null;
  const final = extractAutopilotFinal(autopilotOutcome || {});
  const navRecord = buildBtcNavHistoryRecord({
    observedAt: now,
    totalUsd: resolvedCapitalUsd,
    btcUsd: readiness?.operatingCapital?.btcUsd ?? null,
    totalBtc: readiness?.deposit?.confirmedBalanceSats ? readiness.deposit.confirmedBalanceSats / 100_000_000 : null,
    attribution: rotator.actions.map((action) => ({
      slot: action.slot,
      strategyId: action.strategyId,
      capitalUsd: action.capitalUsd,
    })),
  });
  const perSlotAttribution = rotator.actions.map((action) => ({
    schemaVersion: 1,
    observedAt: now,
    slot: action.slot,
    strategyId: action.strategyId,
    chain: action.chain,
    protocol: action.protocol,
    plannedCapitalUsd: action.capitalUsd,
    score: action.score,
    liveBroadcast: evidence.broadcast,
    noTxReason,
  }));

  const result = {
    schemaVersion: 1,
    observedAt: now,
    status: evidence.broadcast ? "live_canary_broadcast" : noTxReason ? "blocked" : "completed_no_broadcast",
    stage: "money_loop_tick",
    deposit: readiness,
    registry: registryEnvelope,
    rotator,
    policyValidation: {
      status: noTxReason ? "blocked_or_carried" : "policy_path_invoked",
      reason: noTxReason,
      authority: "policy_engine_only",
    },
    signerDispatch: {
      attempted: execute,
      broadcast: evidence.broadcast,
      txBroadcastCount: evidence.txBroadcastCount,
      canaryExecutedCount: evidence.canaryExecutedCount,
      reason: noTxReason,
    },
    positionSnapshot: positionSnapshot || buildUniversalPositionSnapshot({ now }),
    harvest: { status: "checked", source: "autopilot" },
    payback: final?.summary?.payback || { status: "unknown", reason: null },
    compound: { status: "rotator_ready", actionCount: rotator.actions.length },
    btcNavHistory: { latest: navRecord },
    perSlotAttribution,
    dashboardStatus: {
      slice: "dashboard/public/money-loop-status.json",
      noTxReason,
      livePositionStatus: evidence.broadcast ? "pending_reader_confirmation" : "not_broadcast",
    },
    autopilot: autopilotOutcome,
    noTxReason,
    blockerClass: blocker?.category || null,
    blocker,
  };

  if (writeArtifacts) await writeMoneyLoopArtifacts({ dataDir, result });
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.tick) throw new Error("executor-money-loop requires --tick");
  const result = await buildMoneyLoopTick({
    execute: args.execute,
    writeArtifacts: args.write,
    checkDeposit: true,
    capitalUsd: args.capitalUsd,
  });
  if (args.json) {
    console.log(safeJsonStringify(result, 2));
    return;
  }
  console.log(`status=${result.status}`);
  console.log(`noTxReason=${result.noTxReason || "none"}`);
  console.log(`liveCanaryBroadcast=${result.signerDispatch.broadcast}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
