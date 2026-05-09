#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
const FIRST_BROADCAST_LOCK_TTL_MS = 30 * 60 * 1000;

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function parseArgs(argv = []) {
  const execute = hasFlag(argv, "--execute");
  return {
    execute,
    preview: hasFlag(argv, "--preview") || !execute,
    json: hasFlag(argv, "--json"),
  };
}

function stepDefinitions() {
  return [
    { id: "bootstrap_from_btc", command: "npm", args: ["run", "executor:bootstrap-from-btc", "--", "--preview", "--json"] },
    { id: "yield_position_sims", command: "npm", args: ["run", "run:yield-position-sims", "--", "--write-shadow-edge", "--json"] },
    { id: "prelive_simulations", command: "npm", args: ["run", "run:prelive-simulations", "--", "--write", "--write-shadow-edge", "--json"] },
    { id: "blocker_resolve", command: "npm", args: ["run", "blocker:resolve", "--", "--preview", "--json"] },
    { id: "merkl_orchestrator", command: "npm", args: ["run", "executor:merkl-portfolio-orchestrator", "--", "--preview", "--json"] },
    { id: "radar_ingest", command: "npm", args: ["run", "radar:sync-merkl", "--", "--json"] },
    { id: "radar_promote", command: "npm", args: ["run", "radar:promote", "--", "--preview", "--json"] },
    { id: "cold_start_canary", command: "npm", args: ["run", "cold-start:canary", "--", "--preview", "--json"] },
  ];
}

function defaultRunStep(step, { cwd = process.cwd() } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(step.command, step.args, {
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

function parseJsonPayload(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function candidateScore(candidate = {}) {
  return finiteNumber(candidate.expectedRealizedNetUsd) ??
    finiteNumber(candidate.expectedNetUsd) ??
    finiteNumber(candidate.expectedNetEvUsd) ??
    finiteNumber(candidate.selectedEv?.expectedNetUsd) ??
    finiteNumber(candidate.ev?.expectedNetUsd) ??
    finiteNumber(candidate.decision?.expectedNetUsd) ??
    0;
}

function merklCandidates(payload = {}) {
  const executableNow = finiteNumber(payload.summary?.executableNow) ??
    finiteNumber(payload.summary?.executableNowCount) ??
    finiteNumber(payload.executableNow);
  const candidates = [
    ...(Array.isArray(payload.candidates) ? payload.candidates : []),
    ...(Array.isArray(payload.entryQueue) ? payload.entryQueue : []),
    ...(Array.isArray(payload.allocations) ? payload.allocations : []),
  ].filter((candidate) =>
    candidate.executableNow === true ||
    candidate.status === "ready" ||
    candidate.decision?.expectedNetSats > 0 ||
    candidateScore(candidate) > 0,
  );
  if (!candidates.length && executableNow > 0) {
    candidates.push({ id: "merkl-summary-executable", expectedRealizedNetUsd: 0, executableNow: true });
  }
  return candidates.map((candidate) => ({
    kind: "merkl",
    id: candidate.id || candidate.queueId || candidate.opportunityId || candidate.strategyId || "merkl",
    expectedRealizedNetUsd: candidateScore(candidate),
    executeCommand: "npm run executor:merkl-portfolio-orchestrator -- --execute",
    executeStep: null,
    blockedExecuteReason: "merkl_orchestrator_has_no_single_allocation_selector",
    raw: candidate,
  }));
}

function radarCandidates(payload = {}) {
  const rows = [
    ...(Array.isArray(payload.eligibleCandidates) ? payload.eligibleCandidates : []),
    ...(Array.isArray(payload.candidates) ? payload.candidates : []),
    ...(payload.selectedCandidate ? [payload.selectedCandidate] : []),
  ].filter((candidate) =>
    candidate.status === "ready" ||
    candidate.gateStatus === "executable" ||
    candidate.executable === true ||
    candidateScore(candidate) > 0,
  );
  return rows.map((candidate) => ({
    kind: "radar",
    id: candidate.candidateId || candidate.id || candidate.packetId || "radar",
    expectedRealizedNetUsd: candidateScore(candidate),
    executeCommand: `npm run radar:promote -- --execute --candidate-id=${candidate.candidateId || candidate.id || ""}`,
    executeStep: candidate.candidateId || candidate.id
      ? {
          id: "selected_execute",
          command: "npm",
          args: ["run", "radar:promote", "--", "--execute", `--candidate-id=${candidate.candidateId || candidate.id}`, "--json"],
        }
      : null,
    blockedExecuteReason: candidate.candidateId || candidate.id ? null : "radar_candidate_id_missing",
    raw: candidate,
  }));
}

function coldStartCandidates(payload = {}) {
  if (payload.status !== "ready" || !payload.selectedCandidate) return [];
  return [{
    kind: "radar_canary",
    id: payload.selectedCandidate.candidateId || "cold-start-canary",
    expectedRealizedNetUsd: candidateScore(payload.selectedEv || payload.selectedCandidate),
    executeCommand: `npm run cold-start:canary -- --execute --candidate-id=${payload.selectedCandidate.candidateId || ""}`,
    executeStep: payload.selectedCandidate.candidateId
      ? {
          id: "selected_execute",
          command: "npm",
          args: ["run", "cold-start:canary", "--", "--execute", `--candidate-id=${payload.selectedCandidate.candidateId}`, "--json"],
        }
      : null,
    blockedExecuteReason: payload.selectedCandidate.candidateId ? null : "cold_start_candidate_id_missing",
    raw: payload.selectedCandidate,
  }];
}

function transportCandidates(payload = {}) {
  const rows = [
    ...(Array.isArray(payload.routingPlan) ? payload.routingPlan : []),
    ...(Array.isArray(payload.actions) ? payload.actions : []),
  ].filter((candidate) =>
    (candidate.expectedNetUsd ?? candidate.expectedRealizedNetUsd ?? candidate.expectedDailyUsdOnResolve) > 0 &&
    (candidate.preDispatchChecks?.passed ?? true),
  );
  return rows.map((candidate) => ({
    kind: "transport",
    id: candidate.intentHash || candidate.strategyId || candidate.action || "transport",
    expectedRealizedNetUsd: candidateScore(candidate),
    executeCommand: "npm run blocker:resolve -- --execute",
    executeStep: null,
    blockedExecuteReason: "blocker_resolver_execute_is_not_single_candidate_scoped",
    raw: candidate,
  }));
}

function selectCandidate(stepPayloads = new Map()) {
  const candidates = [
    ...merklCandidates(stepPayloads.get("merkl_orchestrator") || {}),
    ...radarCandidates(stepPayloads.get("radar_promote") || {}),
    ...coldStartCandidates(stepPayloads.get("cold_start_canary") || {}),
    ...transportCandidates(stepPayloads.get("blocker_resolve") || {}),
  ].sort((left, right) =>
    right.expectedRealizedNetUsd - left.expectedRealizedNetUsd ||
    left.kind.localeCompare(right.kind) ||
    String(left.id).localeCompare(String(right.id)),
  );
  return { candidates, selectedCandidate: candidates[0] || null };
}

async function writeStepLog(dataDir, id, payload) {
  const path = join(dataDir, "first-broadcast-runs", `${id}.json`);
  await writeTextIfChanged(path, `${JSON.stringify(payload, null, 2)}\n`);
}

async function appendJsonl(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

async function acquireFirstBroadcastLock(dataDir, now = new Date().toISOString()) {
  const path = join(dataDir, "first-broadcast.lock");
  await mkdir(dataDir, { recursive: true });
  try {
    const handle = await open(path, "wx");
    await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, createdAt: now }, null, 2)}\n`);
    await handle.close();
    return { acquired: true, path, staleReplaced: false };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  const existing = await readFile(path, "utf8").catch(() => "");
  let createdAtMs = 0;
  try {
    createdAtMs = Date.parse(JSON.parse(existing).createdAt || 0);
  } catch {
    createdAtMs = 0;
  }
  const nowMs = Date.parse(now);
  if (Number.isFinite(createdAtMs) && Number.isFinite(nowMs) && nowMs - createdAtMs < FIRST_BROADCAST_LOCK_TTL_MS) {
    return { acquired: false, path, staleReplaced: false, existingCreatedAt: new Date(createdAtMs).toISOString() };
  }
  await writeTextIfChanged(path, `${JSON.stringify({ schemaVersion: 1, createdAt: now, replacedStaleLock: true }, null, 2)}\n`);
  return { acquired: true, path, staleReplaced: true };
}

function executeOutcomeFromParsed(parsed = {}, exitCode = 0) {
  return parsed?.run?.outcome ||
    parsed?.outcome ||
    (exitCode === 0 ? "execute_command_completed" : "execute_command_failed");
}

export async function runFirstBroadcastRunnerCli(
  argv = process.argv.slice(2),
  {
    cwd = process.cwd(),
    dataDir = resolve(cwd, config.dataDir),
    runStep = defaultRunStep,
    now = new Date().toISOString(),
  } = {},
) {
  const args = parseArgs(argv);
  const payloads = new Map();
  const stepResults = [];
  for (const step of stepDefinitions()) {
    const result = await runStep(step, { cwd });
    const parsed = parseJsonPayload(result.stdout);
    const logPayload = {
      schemaVersion: 1,
      generatedAt: now,
      stepId: step.id,
      command: [step.command, ...step.args].join(" "),
      exitCode: result.exitCode,
      parsed,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    await writeStepLog(dataDir, step.id, logPayload);
    payloads.set(step.id, parsed || {});
    stepResults.push({ stepId: step.id, exitCode: result.exitCode });
  }

  const { candidates, selectedCandidate } = selectCandidate(payloads);
  let finalPayload = {
    schemaVersion: 1,
    generatedAt: now,
    mode: args.execute ? "execute" : "preview",
    outcome: selectedCandidate ? "candidate_selected_preview" : "no_candidate_sets_non_empty",
    selectedCandidate,
    candidateCount: candidates.length,
    candidates,
    stepResults,
  };

  let exitCode = 0;
  if (args.execute && selectedCandidate) {
    if (!selectedCandidate.executeStep) {
      finalPayload = {
        ...finalPayload,
        outcome: "execute_blocked_no_single_broadcast_selector",
        blockedReason: selectedCandidate.blockedExecuteReason || "selected_candidate_not_single_scoped",
      };
      exitCode = 2;
    } else {
      const lock = await acquireFirstBroadcastLock(dataDir, now);
      if (!lock.acquired) {
        finalPayload = {
          ...finalPayload,
          outcome: "execute_blocked_lock_active",
          blockedReason: "first_broadcast_lock_active",
          lock,
        };
        exitCode = 2;
      } else {
        const executeResult = await runStep(selectedCandidate.executeStep, { cwd });
        const executeParsed = parseJsonPayload(executeResult.stdout);
        const executePayload = {
          schemaVersion: 1,
          generatedAt: now,
          stepId: "selected_execute",
          command: [selectedCandidate.executeStep.command, ...selectedCandidate.executeStep.args].join(" "),
          exitCode: executeResult.exitCode,
          parsed: executeParsed,
          stdout: executeResult.stdout,
          stderr: executeResult.stderr,
          selectedCandidate,
          lock,
        };
        await writeStepLog(dataDir, "selected_execute", executePayload);
        finalPayload = {
          ...finalPayload,
          outcome: executeOutcomeFromParsed(executeParsed, executeResult.exitCode),
          selectedExecute: executePayload,
          lock,
        };
        await appendJsonl(join(cwd, "logs", "first-broadcast-audit.jsonl"), {
          schemaVersion: 1,
          observedAt: now,
          outcome: finalPayload.outcome,
          selectedKind: selectedCandidate.kind,
          selectedId: selectedCandidate.id,
          command: executePayload.command,
          exitCode: executeResult.exitCode,
        });
        exitCode = executeResult.exitCode === 0 ? 0 : executeResult.exitCode;
      }
    }
  }
  await writeStepLog(dataDir, "final", finalPayload);

  const stdout = args.json
    ? `${JSON.stringify(finalPayload, null, 2)}\n`
    : [
        `mode=${finalPayload.mode}`,
        `outcome=${finalPayload.outcome}`,
        `selected=${selectedCandidate ? `${selectedCandidate.kind}:${selectedCandidate.id}` : "none"}`,
        `candidateCount=${candidates.length}`,
      ].join("\n") + "\n";
  return { exitCode, stdout, payload: finalPayload };
}

if (IS_MAIN) {
  runFirstBroadcastRunnerCli().then((result) => {
    process.stdout.write(result.stdout);
    process.exit(result.exitCode);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
