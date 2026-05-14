#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRunCommand } from "../session/shadow-refresh-runner.mjs";

const IS_MAIN = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

export function parseArgs(argv = []) {
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
    target: options.target || null,
    commandTimeoutMs: options["command-timeout-ms"] ? Number(options["command-timeout-ms"]) : null,
  };
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractJsonObject(text) {
  const value = String(text || "");
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first < 0 || last < first) {
    throw new Error("stdout_json_missing");
  }
  return JSON.parse(value.slice(first, last + 1));
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function buildSteps(target) {
  return [
    {
      id: "kill_status",
      label: "kill-switch status",
      command: "npm",
      args: ["run", "kill:status", "--", "--json"],
    },
    {
      id: "signer_health",
      label: "signer health",
      command: "npm",
      args: ["run", "diagnose:signer-health", "--", "--json"],
    },
    {
      id: "wallet_holdings",
      label: "wallet holdings",
      command: "npm",
      args: ["run", "report:wallet-holdings", "--", "--json"],
    },
    {
      id: "payback_status",
      label: "payback status",
      command: "npm",
      args: ["run", "report:payback-status", "--", "--json"],
    },
    {
      id: "dispatch_dry_run",
      label: "dispatch dry-run readiness",
      command: "npm",
      args: ["run", "executor:dispatch-target", "--", `--target=${target}`, "--dry-run", "--json"],
    },
  ];
}

function blocker(stage, reason, detail = {}) {
  return {
    stage,
    reason,
    ...detail,
  };
}

function evaluateKillStatus(payload) {
  const halted = payload?.halted === true;
  return {
    ok: !halted,
    summary: {
      halted,
      state: halted ? "HALTED" : "RUNNING",
      activeReason: payload?.activeReason || null,
    },
    blocker: halted
      ? blocker("kill_status", "kill_switch_halted", { activeReason: payload?.activeReason || null })
      : null,
  };
}

function evaluateSignerHealth(payload) {
  const readyForBroadcast = payload?.readiness?.readyForBroadcast === true;
  return {
    ok: readyForBroadcast,
    summary: {
      readyForBroadcast,
      telemetryComplete: payload?.readiness?.telemetryComplete === true,
      limitations: payload?.readiness?.limitations || [],
      cause: payload?.cause || null,
    },
    blocker: readyForBroadcast
      ? null
      : blocker("signer_health", "signer_not_ready_for_broadcast", {
          cause: payload?.cause || null,
          limitations: payload?.readiness?.limitations || [],
        }),
  };
}

async function evaluateWalletHoldings(
  payload,
  { commandResult = null, walletPayloadPath = join(process.cwd(), "dashboard", "public", "wallet-holdings.json") } = {},
) {
  const commandWalletPath = commandResult?.out ? resolve(process.cwd(), commandResult.out) : null;
  const wallet =
    commandResult?.walletPayload ||
    (commandWalletPath ? await readJsonIfExists(commandWalletPath) : null) ||
    (await readJsonIfExists(walletPayloadPath)) ||
    payload ||
    {};
  const totalUsd = finiteNumber(wallet.totalUsd ?? payload?.totalUsd);
  const freshnessCoveragePct = finiteNumber(
    wallet.assetMetadataCoverage?.freshnessCoveragePct ?? payload?.freshnessCoveragePct,
  );
  const staleItemCount = Number(wallet.staleItemCount ?? payload?.staleItemCount ?? 0);
  const stalePriceItemCount = Number(wallet.stalePriceItemCount ?? payload?.stalePriceItemCount ?? 0);
  const divergenceWarnCount = Number(
    wallet.assetMetadataCoverage?.divergenceWarnCount ?? payload?.divergenceWarnCount ?? 0,
  );
  const divergenceBlockCount = Number(
    wallet.assetMetadataCoverage?.divergenceBlockCount ?? payload?.divergenceBlockCount ?? 0,
  );
  const pending = wallet.pending === true || payload?.pending === true;
  const ok =
    pending === false &&
    totalUsd !== null &&
    freshnessCoveragePct === 1 &&
    staleItemCount === 0 &&
    divergenceWarnCount === 0 &&
    divergenceBlockCount === 0;
  return {
    ok,
    summary: {
      totalUsd,
      pending,
      freshnessPct: freshnessCoveragePct,
      staleItemCount,
      stalePriceItemCount,
      divergenceWarnCount,
      divergenceBlockCount,
    },
    blocker: ok
      ? null
      : blocker("wallet_holdings", "wallet_holdings_not_fresh_or_divergent", {
          totalUsd,
          pending,
          freshnessPct: freshnessCoveragePct,
          staleItemCount,
          stalePriceItemCount,
          divergenceWarnCount,
          divergenceBlockCount,
        }),
  };
}

function evaluatePaybackStatus(payload) {
  const progress =
    finiteNumber(payload?.payback?.scheduler?.minimumPaybackProgress?.progressToMinimumRatio) ??
    finiteNumber(payload?.payback?.scheduler?.previewAfterDestination?.progressToMinimumRatio) ??
    null;
  const effectiveMinSats =
    finiteNumber(payload?.payback?.scheduler?.minimumPaybackProgress?.minPaybackSats) ??
    finiteNumber(payload?.policy?.minPaybackSats) ??
    null;
  return {
    ok: true,
    summary: {
      pendingSats: finiteNumber(payload?.payback?.accumulatorPendingSats) ?? 0,
      effectiveMinSats,
      progress,
      decisionStatus: payload?.decision?.status || null,
      decisionReason: payload?.decision?.reason || null,
    },
    blocker: null,
  };
}

function evaluateDispatchDryRun(payload, target) {
  const results = payload?.record?.strategyResults || [];
  const result = results.find((item) => item.strategyId === target) || results[0] || null;
  if (!result) {
    return {
      ok: false,
      summary: {
        readyForPolicyDispatch: false,
        readyForLiveBroadcast: false,
        strategyId: target,
      },
      blocker: blocker("dispatch_dry_run", "dispatch_target_missing", { strategyId: target }),
    };
  }
  const readiness = result.broadcastReadiness || {};
  const readyForPolicyDispatch = readiness.readyForPolicyDispatch === true;
  const readyForLiveBroadcast = readiness.readyForLiveBroadcast === true;
  const ok = readyForPolicyDispatch && readyForLiveBroadcast;
  return {
    ok,
    summary: {
      strategyId: result.strategyId || target,
      executionStatus: result.executionStatus || null,
      blockedReason: result.blockedReason || null,
      readyForPolicyDispatch,
      readyForLiveBroadcast,
      policyBlockers: readiness.policyDispatchBlockers || [],
      selectedMode: readiness.selectedMode || result.selectedMode || null,
      adviceCode: readiness.advisoryEvidence?.adviceCode || null,
    },
    blocker: ok
      ? null
      : blocker(
          "dispatch_dry_run",
          readyForPolicyDispatch ? "dispatch_not_ready_for_live_broadcast" : "dispatch_not_ready_for_policy_dispatch",
          {
            strategyId: result.strategyId || target,
            policyBlockers: readiness.policyDispatchBlockers || [],
            selectedMode: readiness.selectedMode || result.selectedMode || null,
            adviceCode: readiness.advisoryEvidence?.adviceCode || null,
          },
        ),
  };
}

async function evaluateStep(step, payload, options) {
  if (step.id === "kill_status") return evaluateKillStatus(payload);
  if (step.id === "signer_health") return evaluateSignerHealth(payload);
  if (step.id === "wallet_holdings") return evaluateWalletHoldings(payload, options);
  if (step.id === "payback_status") return evaluatePaybackStatus(payload);
  if (step.id === "dispatch_dry_run") return evaluateDispatchDryRun(payload, options.target);
  return {
    ok: false,
    summary: {},
    blocker: blocker(step.id, "unknown_preflight_step"),
  };
}

async function runStep(
  step,
  { runCommandImpl, commandTimeoutMs, cwd = process.cwd(), env = process.env, target, walletPayloadPath } = {},
) {
  const result = await runCommandImpl({
    command: step.command,
    args: step.args,
    cwd,
    env,
    timeoutMs: commandTimeoutMs,
    step,
  });
  const base = {
    id: step.id,
    label: step.label,
    command: [step.command, ...step.args].join(" "),
    ok: Boolean(result.ok),
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    durationMs: result.durationMs ?? null,
  };
  if (!result.ok) {
    return {
      ...base,
      status: "blocked",
      summary: {},
      blocker: blocker(step.id, "command_failed", {
        exitCode: result.exitCode ?? null,
        signal: result.signal ?? null,
      }),
    };
  }
  let payload;
  try {
    payload = extractJsonObject(result.stdout);
  } catch (error) {
    return {
      ...base,
      status: "blocked",
      summary: {},
      blocker: blocker(step.id, error.message || "stdout_json_parse_failed"),
    };
  }
  const evaluated = await evaluateStep(step, payload, {
    commandResult: payload && typeof payload === "object" ? { ...result, ...payload } : result,
    target,
    walletPayloadPath,
  });
  return {
    ...base,
    status: evaluated.ok ? "passed" : "blocked",
    summary: evaluated.summary,
    blocker: evaluated.blocker,
  };
}

function skippedStep(step) {
  return {
    id: step.id,
    label: step.label,
    command: [step.command, ...step.args].join(" "),
    ok: null,
    exitCode: null,
    signal: null,
    durationMs: null,
    status: "skipped",
    summary: {},
    blocker: null,
  };
}

function summarizeStages(stages = []) {
  const byId = Object.fromEntries(stages.map((stage) => [stage.id, stage.summary || {}]));
  return {
    killSwitch: byId.kill_status || {},
    signer: byId.signer_health || {},
    wallet: byId.wallet_holdings || {},
    payback: byId.payback_status || {},
    dispatch: byId.dispatch_dry_run || {},
  };
}

function nextActionGuide({ target, clean }) {
  if (clean) {
    return {
      command: `npm run executor:dispatch-target -- --target=${target} --execute`,
      note: "Allowed only because this preflight returned preflight_clean.",
    };
  }
  return {
    command: `npm run preflight:broadcast -- --target=${target} --json`,
    note: "Resolve the blocker and rerun preflight before any execute attempt.",
  };
}

function renderJson(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function renderText(payload) {
  const lines = [
    `status=${payload.status}`,
    `target=${payload.target}`,
    `executeAllowed=${payload.executeAllowed}`,
    `blockers=${payload.blockers.length ? payload.blockers.map((item) => `${item.stage}:${item.reason}`).join(",") : "none"}`,
    `next=${payload.nextActionGuide.command}`,
  ];
  return `${lines.join("\n")}\n`;
}

export async function runPreflightBroadcastCli(
  argv = process.argv.slice(2),
  {
    runCommandImpl = defaultRunCommand,
    cwd = process.cwd(),
    env = process.env,
    walletPayloadPath = join(process.cwd(), "dashboard", "public", "wallet-holdings.json"),
    now = new Date().toISOString(),
  } = {},
) {
  const args = parseArgs(argv);
  if (!args.target) {
    const payload = {
      status: "preflight_blocked",
      observedAt: now,
      target: null,
      executeAllowed: false,
      stages: [],
      blockers: [blocker("args", "missing_target")],
      summary: summarizeStages([]),
      nextActionGuide: {
        command: "npm run preflight:broadcast -- --target=<strategy-id> --json",
        note: "Pass an explicit strategy target.",
      },
    };
    return {
      exitCode: 2,
      stdout: args.json ? renderJson(payload) : renderText(payload),
      stderr: "",
      payload,
    };
  }

  const steps = buildSteps(args.target);
  const stages = [];
  let blocked = null;
  for (const step of steps) {
    if (blocked) {
      stages.push(skippedStep(step));
      continue;
    }
    const stage = await runStep(step, {
      runCommandImpl,
      commandTimeoutMs: args.commandTimeoutMs,
      cwd,
      env,
      target: args.target,
      walletPayloadPath,
    });
    stages.push(stage);
    if (stage.blocker) blocked = stage.blocker;
  }
  const blockers = stages.map((stage) => stage.blocker).filter(Boolean);
  const clean = blockers.length === 0;
  const payload = {
    schemaVersion: 1,
    observedAt: now,
    target: args.target,
    status: clean ? "preflight_clean" : "preflight_blocked",
    executeAllowed: clean,
    stages,
    blockers,
    summary: summarizeStages(stages),
    nextActionGuide: nextActionGuide({ target: args.target, clean }),
  };
  return {
    exitCode: clean ? 0 : 2,
    stdout: args.json ? renderJson(payload) : renderText(payload),
    stderr: "",
    payload,
  };
}

async function main() {
  const result = await runPreflightBroadcastCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
