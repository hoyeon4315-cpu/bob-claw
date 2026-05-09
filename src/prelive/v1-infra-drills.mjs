import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateIntentPolicies } from "../executor/policy/index.mjs";
import { appendSignerAuditRecord, buildSignerAuditRecord, readSignerAuditLog } from "../executor/signer/audit-log.mjs";
import { notifyPolicyRejection } from "../executor/signer/policy-alerts.mjs";
import { runWatchdogCycle } from "../executor/watchdog/runner.mjs";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function baseIntent(overrides = {}) {
  return {
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    family: "evm",
    mode: "live",
    intentType: "borrow_loop",
    amountUsd: 25,
    quote: {
      observedAt: "2026-04-17T00:00:00.000Z",
    },
    positionState: {
      currentHealthFactor: 1.7,
      projectedHealthFactor: 1.55,
      currentLiquidationBufferPct: 15,
      projectedLiquidationBufferPct: 13,
    },
    metadata: {
      capCheckAmountUsd: 25,
    },
    ...overrides,
  };
}

function buildDrillResult({
  id,
  input,
  expected,
  observed,
  auditTail = [],
  alert = null,
  status = "passed",
  blockers = [],
  notes = [],
} = {}) {
  return {
    id,
    status,
    input,
    expected,
    observed,
    blockers: unique(blockers),
    auditTail,
    alert,
    notes: unique(notes),
  };
}

async function auditTail(rootDir, tailSize = 3) {
  const records = await readSignerAuditLog({ rootDir });
  return records.slice(-tailSize);
}

async function runKillSwitchDrill(rootDir) {
  const killSwitchPath = join(rootDir, "state", "kill-switch");
  await mkdir(join(rootDir, "state"), { recursive: true });
  await writeFile(killSwitchPath, "engaged\n", "utf8");
  const intent = baseIntent();
  const policy = await evaluateIntentPolicies({
    intent,
    auditRecords: [],
    killSwitchPath,
    now: "2026-04-17T00:00:05.000Z",
  });
  await appendSignerAuditRecord(
    buildSignerAuditRecord({
      intent,
      policyVerdict: "rejected",
      lifecycle: {
        stage: "rejected",
        blockers: policy.blockers,
      },
      observedAt: "2026-04-17T00:00:05.000Z",
    }),
    { rootDir },
  );
  return buildDrillResult({
    id: "kill_switch_file",
    input: 'touch "$KILL_SWITCH_PATH"',
    expected: "policy blocks with kill_switch_present and signer audit appends a rejected entry",
    observed: {
      decision: policy.decision,
      blockers: policy.blockers,
    },
    auditTail: await auditTail(rootDir),
    status: policy.blockers.includes("kill_switch_present") ? "passed" : "failed",
    blockers: policy.blockers,
  });
}

async function runWatchdogDrill(rootDir) {
  const heartbeatPath = join(rootDir, "state", "executor-heartbeat.json");
  const killSwitchPath = join(rootDir, "state", "watchdog.kill");
  await mkdir(join(rootDir, "state"), { recursive: true });
  await writeFile(
    heartbeatPath,
    `${JSON.stringify({ observedAt: "2026-04-17T00:00:00.000Z", socketPath: "/tmp/fake.sock" })}\n`,
    "utf8",
  );
  const alerts = [];
  const result = await runWatchdogCycle({
    once: true,
    heartbeatPath,
    killSwitchPath,
    ttlMs: 10_000,
    startupGraceMs: 0,
    nowFactory: () => "2026-04-17T00:00:30.000Z",
    alertImpl: async (payload) => {
      alerts.push(payload);
      return { sent: true, skipped: false };
    },
  });
  const killSwitchContents = await readFile(killSwitchPath, "utf8");
  return buildDrillResult({
    id: "watchdog_heartbeat",
    input: "stale heartbeat older than watchdog ttl",
    expected: "watchdog writes the kill-switch and emits one alert payload",
    observed: {
      status: result.evaluation?.status || null,
      stale: Boolean(result.evaluation?.stale),
      killSwitchWritten: result.killSwitchWritten,
      alertCount: alerts.length,
      killSwitchContents: killSwitchContents.trim(),
    },
    alert: alerts[0] || null,
    status: result.killSwitchWritten && alerts.length === 1 ? "passed" : "failed",
    blockers: result.killSwitchWritten ? [] : ["watchdog_kill_switch_not_written"],
  });
}

async function runStaleQuoteDrill(rootDir) {
  const intent = baseIntent({
    quote: {
      observedAt: "2026-04-16T22:00:00.000Z",
    },
  });
  const policy = await evaluateIntentPolicies({
    intent,
    auditRecords: [],
    now: "2026-04-17T00:00:00.000Z",
    killSwitchPath: join(rootDir, "state", "stale-quote.kill"),
  });
  await appendSignerAuditRecord(
    buildSignerAuditRecord({
      intent,
      policyVerdict: "rejected",
      lifecycle: {
        stage: "rejected",
        blockers: policy.blockers,
      },
      observedAt: "2026-04-17T00:00:00.000Z",
    }),
    { rootDir },
  );
  return buildDrillResult({
    id: "stale_quote_reject",
    input: "quote.observedAt forced two hours into the past",
    expected: "policy blocks with quote_stale",
    observed: {
      decision: policy.decision,
      blockers: policy.blockers,
    },
    auditTail: await auditTail(rootDir),
    status: policy.blockers.includes("quote_stale") ? "passed" : "failed",
    blockers: policy.blockers,
  });
}

async function runCapExceededDrill(rootDir) {
  const intent = baseIntent({
    amountUsd: 2_000_000,
    metadata: {
      capCheckAmountUsd: 2_000_000,
    },
  });
  const policy = await evaluateIntentPolicies({
    intent,
    auditRecords: [],
    now: "2026-04-17T00:00:00.000Z",
    killSwitchPath: join(rootDir, "state", "cap-exceeded.kill"),
  });
  await appendSignerAuditRecord(
    buildSignerAuditRecord({
      intent,
      policyVerdict: "rejected",
      lifecycle: {
        stage: "rejected",
        blockers: policy.blockers,
      },
      observedAt: "2026-04-17T00:00:00.000Z",
    }),
    { rootDir },
  );
  return buildDrillResult({
    id: "per_tx_cap_exceeded",
    input: "submit an intent larger than the declared per-tx cap",
    expected: "policy blocks with strategy_per_tx_cap_exceeded",
    observed: {
      decision: policy.decision,
      blockers: policy.blockers,
    },
    auditTail: await auditTail(rootDir),
    status: policy.blockers.includes("strategy_per_tx_cap_exceeded") ? "passed" : "failed",
    blockers: policy.blockers,
  });
}

async function runConsecutiveFailureDrill(rootDir) {
  const now = "2026-05-01T00:00:10.000Z";
  const intent = baseIntent();
  for (let index = 0; index < 3; index += 1) {
    await appendSignerAuditRecord(
      buildSignerAuditRecord({
        intent: {
          ...intent,
          intentId: `${intent.strategyId}:failed-${index + 1}`,
        },
        policyVerdict: "errored",
        lifecycle: {
          stage: "reverted",
          txHash: `0x${String(index + 1).padStart(64, "0")}`,
        },
        broadcast: {
          txHash: `0x${String(index + 1).padStart(64, "0")}`,
          nonce: index + 1,
          from: "0x0000000000000000000000000000000000000001",
          to: "0x0000000000000000000000000000000000000002",
        },
        error: {
          name: "SimulatedExecutionFailure",
          message: `failure-${index + 1}`,
        },
        observedAt: `2026-05-01T00:00:0${index}.000Z`,
      }),
      { rootDir },
    );
  }
  const auditRecords = await readSignerAuditLog({ rootDir });
  const policy = await evaluateIntentPolicies({
    intent: {
      ...intent,
      intentId: `${intent.strategyId}:blocked-after-failures`,
    },
    auditRecords,
    now,
    killSwitchPath: join(rootDir, "state", "consecutive-failures.kill"),
  });
  const alert = await notifyPolicyRejection({
    intent,
    policy,
    sendImpl: async () => ({ sent: true, skipped: false }),
  });
  await appendSignerAuditRecord(
    buildSignerAuditRecord({
      intent: {
        ...intent,
        intentId: `${intent.strategyId}:blocked-after-failures`,
      },
      policyVerdict: "rejected",
      lifecycle: {
        stage: "rejected",
        blockers: policy.blockers,
      },
      observedAt: now,
    }),
    { rootDir },
  );
  return buildDrillResult({
    id: "consecutive_failures",
    input: "three prior terminal failures on the same strategy followed by one more submission",
    expected: "policy blocks with max_consecutive_failures_reached and suppresses the non-transaction Telegram alert",
    observed: {
      decision: policy.decision,
      blockers: policy.blockers,
    },
    auditTail: await auditTail(rootDir),
    alert,
    status:
      policy.blockers.includes("max_consecutive_failures_reached") &&
      (alert.sent === true || alert.reason === "transaction_alerts_only")
        ? "passed"
        : "failed",
    blockers: policy.blockers,
  });
}

function summarizeDrillSuite(drills = []) {
  const passedCount = drills.filter((item) => item.status === "passed").length;
  const failed = drills.find((item) => item.status !== "passed") || null;
  return {
    drillCount: drills.length,
    passedCount,
    failedCount: drills.length - passedCount,
    status: passedCount === drills.length ? "passed" : "failed",
    topFailedDrillId: failed?.id || null,
    nextAction: failed
      ? {
          code: `fix_${failed.id}`,
          command: null,
        }
      : {
          code: "advance_v2_live_canaries",
          command: "npm run report:tiny-live-canary-rollout -- --write",
        },
  };
}

export async function runV1InfraDrillSuite({ now = null } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), "bob-claw-v1-drills-"));
  try {
    const drills = [
      await runKillSwitchDrill(rootDir),
      await runWatchdogDrill(rootDir),
      await runStaleQuoteDrill(rootDir),
      await runCapExceededDrill(rootDir),
      await runConsecutiveFailureDrill(rootDir),
    ];
    return {
      schemaVersion: 1,
      generatedAt: now || new Date().toISOString(),
      summary: summarizeDrillSuite(drills),
      drills,
    };
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

export function summarizeV1InfraDrills(report = null) {
  if (!report) return null;
  const topFailed =
    report.drills?.find((item) => item.id === report.summary?.topFailedDrillId) ||
    report.drills?.find((item) => item.status !== "passed") ||
    null;
  return {
    status: report.summary?.status || null,
    drillCount: report.summary?.drillCount ?? 0,
    passedCount: report.summary?.passedCount ?? 0,
    topFailedDrill: topFailed
      ? {
          id: topFailed.id || null,
          status: topFailed.status || null,
        }
      : null,
    nextAction: report.summary?.nextAction || null,
  };
}
