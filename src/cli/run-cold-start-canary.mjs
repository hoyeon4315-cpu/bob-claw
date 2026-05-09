#!/usr/bin/env node

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { RADAR_POLICY } from "../config/radar-policy.mjs";
import { listStrategyCaps } from "../config/strategy-caps.mjs";
import { resolveKillSwitchPath } from "../executor/policy/kill-switch.mjs";
import { resolveDevLockPath } from "../runtime/dev-lock.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { evaluateAutoKillTriggers } from "../risk/auto-kill-triggers.mjs";
import { readRadarJsonl } from "../strategy/radar/jsonl.mjs";
import { buildRadarCostLedger } from "../strategy/radar/cost-ledger.mjs";
import { buildRadarCanaryIntent } from "../strategy/radar/radar-candidate-router.mjs";
import { splitCandidateBlockers } from "../executor/policy/blocker-codes.mjs";
import {
  attachSharePriceUnwindProofsToCandidates,
  collectSharePriceUnwindProofRecords,
  readSharePriceUnwindProofRecords,
  writeSharePriceUnwindProofRecords,
} from "../executor/proof/share-price-unwind-proof.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
const EXECUTION_PATHS = new Set(["gateway_destination", "base_native_evm", "gateway_to_evm_bridged"]);

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function optionValue(argv, name) {
  const prefix = `${name}=`;
  const raw = argv.find((item) => item.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function parseArgs(argv = []) {
  const execute = hasFlag(argv, "--execute");
  const refreshRadar = !hasFlag(argv, "--no-refresh") && !hasFlag(argv, "--no-refresh-radar");
  return {
    execute,
    preview: hasFlag(argv, "--preview") || !execute,
    json: hasFlag(argv, "--json"),
    candidateId: optionValue(argv, "--candidate-id"),
    refreshProofs: hasFlag(argv, "--refresh-proofs"),
    refreshRadar,
    proofPath: optionValue(argv, "--proof-path"),
  };
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

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function appendJsonl(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

function defaultRunCommand(command, args, { cwd = process.cwd() } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolvePromise({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function refreshRadarInputs({ cwd = process.cwd(), runCommand = defaultRunCommand } = {}) {
  const steps = [
    { id: "radar_sync_merkl", command: "npm", args: ["run", "radar:sync-merkl", "--", "--json"] },
    { id: "radar_ingest", command: "npm", args: ["run", "radar:ingest", "--", "--json"] },
  ];
  const results = [];
  for (const step of steps) {
    const result = await runCommand(step.command, step.args, { cwd });
    results.push({
      stepId: step.id,
      command: [step.command, ...step.args].join(" "),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return {
    status: results.every((item) => item.exitCode === 0) ? "completed" : "failed",
    steps: results,
  };
}

function packetById(packets = []) {
  return new Map(packets.map((packet) => [packet.packetId, packet]));
}

function candidateTime(candidate = {}) {
  const parsed = Date.parse(candidate.observedAt || candidate.metadata?.syncedAt || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestCandidates(candidates = []) {
  const byId = new Map();
  for (const candidate of candidates || []) {
    if (!candidate?.candidateId) continue;
    const existing = byId.get(candidate.candidateId);
    if (!existing || candidateTime(candidate) >= candidateTime(existing)) byId.set(candidate.candidateId, candidate);
  }
  return [...byId.values()];
}

function hasRewardToken(candidate = {}) {
  return Boolean(candidate.rewardToken || candidate.rewardTokenSymbol || candidate.rewardTokenAddress || candidate.rewardAsset);
}

function hasShareUnwindProof(candidate = {}) {
  if (hasRewardToken(candidate)) return true;
  if (candidate.sharePriceUnwindProof?.ok === true) return true;
  if (candidate.unwindProof?.ok === true) return true;
  if (candidate.receiptBackedUnwindProof?.ok === true) return true;
  if (Array.isArray(candidate.exitPath) && candidate.exitPath.length > 0) return true;
  if (Array.isArray(candidate.unwindPlan?.steps) && candidate.unwindPlan.steps.length > 0) return true;
  return false;
}

function todayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function successfulRadarCanary(record = {}) {
  const intent = record.intent || {};
  return intent.intentType === "tiny_live_canary" &&
    intent.executionReason === "radar_tiny_live_canary" &&
    ["approved", "signed", "broadcasted", "confirmed"].includes(record.policyVerdict || record.lifecycle?.stage);
}

function radarLaneBudgetState(auditRecords = [], now = new Date().toISOString()) {
  const day = todayKey(now);
  const today = (auditRecords || []).filter((record) => {
    const recordDay = todayKey(record.timestamp || record.observedAt || now);
    return recordDay === day && successfulRadarCanary(record);
  });
  const spentUsd = today.reduce((sum, record) => sum + Number(record.amountUsd ?? record.intent?.amountUsd ?? 0), 0);
  const openCount = today.filter((record) => record.lifecycle?.stage !== "confirmed" && record.lifecycle?.stage !== "reverted").length;
  return { spentUsd, openCount };
}

async function defaultReadGuards({
  execute = false,
  strategyTickStatus = null,
  killSwitchPath = resolveKillSwitchPath(),
  devLockPath = resolveDevLockPath(),
} = {}) {
  const blockers = [];
  const killSwitchActive = await fileExists(killSwitchPath);
  const devLockActive = execute && await fileExists(devLockPath);
  if (killSwitchActive) blockers.push("kill_switch_active");
  if (devLockActive) blockers.push("dev_lock_active");
  const readyForLiveBroadcast = (strategyTickStatus?.strategies || []).some((row) =>
    row?.layerStatus?.runtimeExecutable === true || row?.policyReadiness?.policyOk === true,
  );
  if (execute && readyForLiveBroadcast === false) blockers.push("readiness_guard_blocked");
  return { ok: blockers.length === 0, blockers, readyForLiveBroadcast, killSwitchActive, devLockActive };
}

function candidateBaseBlockers(candidate = {}, policy = RADAR_POLICY) {
  const blockers = [];
  if (policy?.calibrationStatus !== "calibrated_aggressive_v1") blockers.push("radar_policy_not_calibrated_aggressive");
  if (!EXECUTION_PATHS.has(candidate.executionPath)) blockers.push("radar_execution_path_not_supported");
  if (!hasShareUnwindProof(candidate)) blockers.push("share_price_unwind_proof_missing");
  return blockers;
}

export async function buildColdStartCanaryPlan({
  packets = [],
  candidates = [],
  strategyCapsById = {},
  costLedger = {},
  auditRecords = [],
  guards = { ok: true, blockers: [], readyForLiveBroadcast: true },
  autoKill = { triggered: false, triggers: [] },
  policy = RADAR_POLICY,
  candidateId = null,
  now = new Date().toISOString(),
} = {}) {
  const hardBlockers = [...(guards.blockers || [])];
  if (autoKill.triggered) hardBlockers.push("auto_kill_triggered");
  if (hardBlockers.length) {
    return {
      schemaVersion: 1,
      generatedAt: now,
      status: "blocked",
      exitCode: 2,
      blockers: hardBlockers,
      eligibleCandidates: [],
      selectedCandidate: null,
      selectedIntent: null,
    };
  }

  const packetsById = packetById(packets);
  const budget = radarLaneBudgetState(auditRecords, now);
  const evaluated = latestCandidates(candidates)
    .filter((candidate) => !candidateId || candidate.candidateId === candidateId)
    .map((candidate) => {
      const baseBlockers = candidateBaseBlockers(candidate, policy);
      if (baseBlockers.length) return { status: "blocked", candidate, blockers: baseBlockers, filters: [] };
      const result = buildRadarCanaryIntent({
        packet: packetsById.get(candidate.packetId) ?? { packetId: candidate.packetId ?? null },
        candidate,
        policy,
        strategyCapsById,
        costLedger,
        now,
      });
      if (result.status !== "ready") {
        const split = splitCandidateBlockers(result.blockers || [], { candidateScopedInventory: true });
        return {
          ...result,
          status: result.status === "filtered" || (split.filters.length && !split.blockers.length) ? "filtered" : "blocked",
          candidate,
          blockers: split.blockers,
          filters: result.filters?.length ? result.filters : split.filters,
        };
      }
      const amountUsd = Number(result.intent.amountUsd || 0);
      const blockers = [];
      if (amountUsd > Number(strategyCapsById[result.intent.strategyId]?.caps?.tinyLivePerTxUsd ?? Number.POSITIVE_INFINITY)) {
        blockers.push("tiny_live_per_tx_cap_exceeded");
      }
      if (budget.spentUsd + amountUsd > 90) blockers.push("radar_daily_budget_exceeded");
      if (budget.openCount + 1 > 6) blockers.push("radar_concurrent_canary_limit_exceeded");
      if (blockers.length) return { status: "blocked", candidate, blockers, intent: result.intent, ev: result.ev };
      return {
        status: "ready",
        candidate,
        intent: result.intent,
        ev: result.ev,
        score: Number(result.ev?.expectedNetUsd || 0) / Math.max(1, amountUsd),
      };
    });
  const eligible = evaluated
    .filter((item) => item.status === "ready")
    .sort((left, right) =>
      right.score - left.score || String(left.candidate.candidateId).localeCompare(String(right.candidate.candidateId)),
    );
  const selected = eligible[0] || null;
  if (!selected) {
    const blockers = [...new Set(evaluated.flatMap((item) => item.blockers || []))];
    const filters = [...new Set(evaluated.flatMap((item) => item.filters || []))];
    return {
      schemaVersion: 1,
      generatedAt: now,
      status: blockers.length ? "blocked" : filters.length ? "filtered" : "blocked",
      exitCode: 0,
      blockers: blockers.length ? blockers : filters.length ? [] : ["no_eligible_candidate"],
      filters,
      eligibleCandidates: [],
      selectedCandidate: null,
      selectedIntent: null,
      evaluatedCandidates: evaluated.map((item) => ({
        candidateId: item.candidate?.candidateId || null,
        status: item.status,
        blockers: item.blockers || [],
        filters: item.filters || [],
      })),
    };
  }
  return {
    schemaVersion: 1,
    generatedAt: now,
    status: "ready",
    exitCode: 0,
    blockers: [],
    filters: [],
    eligibleCandidates: eligible.map((item) => ({
      candidateId: item.candidate.candidateId,
      strategyId: item.intent.strategyId,
      amountUsd: item.intent.amountUsd,
      expectedNetUsd: item.ev?.expectedNetUsd ?? null,
      score: item.score,
    })),
    selectedCandidate: selected.candidate,
    selectedIntent: selected.intent,
    selectedEv: selected.ev,
  };
}

function defaultRunRadarPromote({ candidateId, cwd }) {
  return new Promise((resolvePromise) => {
    const child = spawn("npm", ["run", "radar:promote", "--", "--execute", `--candidate-id=${candidateId}`], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolvePromise({ ok: code === 0, exitCode: code, stdout, stderr });
    });
  });
}

function recordIntentHash(record = {}) {
  return record.intentHash || record.intent?.intentHash || record.lifecycle?.intentHash || record.metadata?.intentHash || null;
}

async function defaultPollReceipt({ intentHash, logsDir, timeoutMs = 600_000, intervalMs = 10_000 }) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const records = await readJsonl(logsDir, "signer-audit").catch(() => []);
    const match = records.find((record) =>
      intentHash && recordIntentHash(record) === intentHash &&
      (record.lifecycle?.stage === "confirmed" || record.receipt?.status === 1 || record.broadcast?.txHash),
    );
    if (match) return match;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  return null;
}

export async function executeColdStartCanary({
  plan,
  cwd = process.cwd(),
  logsDir = join(cwd, "logs"),
  runRadarPromote = defaultRunRadarPromote,
  pollReceipt = defaultPollReceipt,
  now = new Date().toISOString(),
} = {}) {
  if (plan?.status !== "ready") {
    return {
      schemaVersion: 1,
      observedAt: now,
      outcome: "execute_blocked",
      reason: plan?.blockers?.[0] || "plan_not_ready",
      plan,
    };
  }
  const result = await runRadarPromote({
    candidateId: plan.selectedCandidate?.candidateId,
    cwd,
    intent: plan.selectedIntent,
  });
  if (!result?.ok) {
    return {
      schemaVersion: 1,
      observedAt: now,
      outcome: "radar_promote_failed",
      reason: "radar_promote_exit_nonzero",
      radarPromote: result,
      plan,
    };
  }
  if (String(result.stdout || "").includes("signed=false")) {
    return {
      schemaVersion: 1,
      observedAt: now,
      outcome: "not_broadcast",
      reason: "radar_promote_did_not_return_receipt",
      radarPromote: result,
      plan,
    };
  }
  const receipt = await pollReceipt({
    intentHash: plan.selectedIntent?.intentHash,
    logsDir,
  });
  if (!receipt) {
    return {
      schemaVersion: 1,
      observedAt: now,
      outcome: "not_broadcast",
      reason: "radar_promote_did_not_return_receipt",
      radarPromote: result,
      plan,
    };
  }
  return {
    schemaVersion: 1,
    observedAt: now,
    outcome: "broadcast_confirmed",
    reason: null,
    receipt,
    radarPromote: result,
    plan,
  };
}

async function runCli(argv = process.argv.slice(2), { cwd = process.cwd(), now = new Date().toISOString() } = {}) {
  const args = parseArgs(argv);
  const dataDir = resolve(cwd, config.dataDir);
  const dashboardDir = join(cwd, "dashboard", "public");
  const proofPath = args.proofPath ? resolve(cwd, args.proofPath) : join(dataDir, "share-price-unwind-proofs.jsonl");
  const radarRefresh = args.refreshRadar
    ? await refreshRadarInputs({ cwd })
    : { status: "skipped", reason: "no_refresh" };
  const [packets, rawCandidates, auditRecords, strategyTickStatus, proofRecords] = await Promise.all([
    readRadarJsonl(dataDir, "portable-packets").catch(() => []),
    readRadarJsonl(dataDir, "executable-candidates").catch(() => []),
    readJsonl(join(cwd, "logs"), "signer-audit").catch(() => []),
    readJsonIfExists(join(dashboardDir, "strategy-tick-status.json")),
    readSharePriceUnwindProofRecords(proofPath).catch(() => []),
  ]);
  const guards = await defaultReadGuards({ execute: args.execute, strategyTickStatus });
  const autoKill = evaluateAutoKillTriggers({ auditRecords, now: new Date(now) });
  const strategyCapsById = Object.fromEntries(listStrategyCaps().map((item) => [item.strategyId, item]));
  const costLedger = buildRadarCostLedger({ auditRecords });
  let candidates = attachSharePriceUnwindProofsToCandidates(rawCandidates, proofRecords, { now });
  let proofRefresh = null;
  let plan = await buildColdStartCanaryPlan({
    packets,
    candidates,
    strategyCapsById,
    costLedger,
    auditRecords,
    guards,
    autoKill,
    candidateId: args.candidateId,
    now,
  });
  if (args.refreshProofs && plan.blockers?.includes("share_price_unwind_proof_missing")) {
    const merklQueue = await readJsonIfExists(join(dataDir, "merkl-canary-queue.json"));
    const collection = collectSharePriceUnwindProofRecords({
      candidates,
      merklQueue,
      candidateId: args.candidateId,
      now,
    });
    const writeResult = await writeSharePriceUnwindProofRecords(proofPath, collection.records);
    const refreshedProofs = await readSharePriceUnwindProofRecords(proofPath);
    candidates = attachSharePriceUnwindProofsToCandidates(rawCandidates, refreshedProofs, { now });
    plan = await buildColdStartCanaryPlan({
      packets,
      candidates,
      strategyCapsById,
      costLedger,
      auditRecords,
      guards,
      autoKill,
      candidateId: args.candidateId,
      now,
    });
    proofRefresh = {
      proofPath,
      collectedCount: collection.collectedCount,
      skippedCount: collection.skippedCount,
      writeResult,
    };
  }
  await writeTextIfChanged(join(dataDir, "cold-start-canary-preview.json"), `${JSON.stringify(plan, null, 2)}\n`);
  let run = null;
  if (args.execute && plan.status === "ready") {
    run = await executeColdStartCanary({ plan, cwd, now });
    await appendJsonl(join(dataDir, "cold-start-canary-runs.jsonl"), run);
    await appendJsonl(join(cwd, "logs", "cold-start-canary-audit.jsonl"), {
      schemaVersion: 1,
      observedAt: now,
      outcome: run.outcome,
      reason: run.reason,
      candidateId: plan.selectedCandidate?.candidateId || null,
      strategyId: plan.selectedIntent?.strategyId || null,
    });
  } else if (args.execute && plan.status !== "ready") {
    run = {
      schemaVersion: 1,
      observedAt: now,
      outcome: "execute_blocked",
      reason: plan.blockers[0] || "plan_not_ready",
      plan,
    };
    await appendJsonl(join(dataDir, "cold-start-canary-runs.jsonl"), run);
  }
  const payload = { ...plan, mode: args.execute ? "execute" : "preview", radarRefresh, proofRefresh, run };
  const stdout = args.json
    ? `${JSON.stringify(payload, null, 2)}\n`
    : [
        `mode=${payload.mode}`,
        `status=${payload.status}`,
        `selected=${payload.selectedCandidate?.candidateId || "none"}`,
        `blockers=${payload.blockers?.join(",") || "none"}`,
        run ? `outcome=${run.outcome}` : null,
      ].filter(Boolean).join("\n") + "\n";
  return { exitCode: args.execute && plan.exitCode === 2 ? 2 : 0, stdout };
}

export { runCli };

if (IS_MAIN) {
  runCli().then((result) => {
    process.stdout.write(result.stdout);
    process.exit(result.exitCode);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
