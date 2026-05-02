import { setTimeout as delay } from "node:timers/promises";
import { config } from "../../config/env.mjs";
import { enforceWatchdog } from "./watchdog-loop.mjs";
import { readHeartbeat } from "./heartbeat.mjs";
import { sendTelegramMessage } from "../../notify/telegram.mjs";
import { buildTelegramDeliveryDecision } from "../../notify/telegram.mjs";
import { resolveKillSwitchPath } from "../policy/kill-switch.mjs";

export function formatWatchdogAlert({ evaluation, heartbeatPath, killSwitchPath } = {}) {
  const lines = [
    "BOB Claw watchdog halt",
    `status: ${evaluation?.status || "unknown"}`,
    `stale: ${Boolean(evaluation?.stale)}`,
    `heartbeat: ${heartbeatPath || "unknown"}`,
  ];
  if (Number.isFinite(evaluation?.ageMs)) lines.push(`ageMs: ${evaluation.ageMs}`);
  if (Number.isFinite(evaluation?.ttlMs)) lines.push(`ttlMs: ${evaluation.ttlMs}`);
  if (killSwitchPath) lines.push(`killSwitch: ${killSwitchPath}`);
  return lines.join("\n");
}

export function createWatchdogAlerter({
  botToken = config.telegramBotToken,
  chatId = config.telegramChatId,
  sendImpl = sendTelegramMessage,
} = {}) {
  return async (payload) => {
    const delivery = buildTelegramDeliveryDecision({ category: "watchdog_halt" });
    if (!delivery.allowed) {
      return {
        sent: false,
        skipped: true,
        reason: "transaction_alerts_only",
        category: delivery.category,
        mode: delivery.mode,
      };
    }
    return sendImpl({
      botToken,
      chatId,
      text: formatWatchdogAlert(payload),
      category: "watchdog_halt",
    });
  };
}

export async function runWatchdogCycle({
  heartbeatPath = "./state/executor-heartbeat.json",
  killSwitchPath = resolveKillSwitchPath(),
  ttlMs = 60_000,
  startupGraceMs = ttlMs,
  startedAt = new Date().toISOString(),
  now = new Date().toISOString(),
  readHeartbeatImpl = readHeartbeat,
  enforceImpl = enforceWatchdog,
  alertImpl,
} = {}) {
  const heartbeat = await readHeartbeatImpl(heartbeatPath);
  const startedAtMs = new Date(startedAt).getTime();
  const nowMs = new Date(now).getTime();
  const startupGraceActive =
    !heartbeat &&
    Number.isFinite(startedAtMs) &&
    Number.isFinite(nowMs) &&
    nowMs - startedAtMs < startupGraceMs;

  if (startupGraceActive) {
    return {
      heartbeat: null,
      evaluation: {
        status: "startup_grace",
        stale: false,
        ageMs: null,
        ttlMs,
        startupGraceMs,
      },
      halted: false,
      killSwitchPresent: false,
      killSwitchWritten: false,
      startupGraceActive: true,
    };
  }

  const result = await enforceImpl({
    heartbeatPath,
    killSwitchPath,
    ttlMs,
    now,
    ...(alertImpl ? { alertImpl } : {}),
  });
  return {
    ...result,
    startupGraceActive: false,
  };
}

export async function runWatchdogLoop({
  once = false,
  intervalMs = 15_000,
  heartbeatPath = "./state/executor-heartbeat.json",
  killSwitchPath = resolveKillSwitchPath(),
  ttlMs = 60_000,
  startupGraceMs = ttlMs,
  alertImpl = createWatchdogAlerter(),
  onIteration = async () => {},
  nowFactory = () => new Date().toISOString(),
} = {}) {
  let lastAlertStatus = null;
  const startedAt = nowFactory();

  while (true) {
    const result = await runWatchdogCycle({
      heartbeatPath,
      killSwitchPath,
      ttlMs,
      startupGraceMs,
      startedAt,
      now: nowFactory(),
      readHeartbeatImpl: readHeartbeat,
      enforceImpl: enforceWatchdog,
      alertImpl: async (payload) => {
        const status = payload?.evaluation?.status || "unknown";
        if (status === lastAlertStatus) {
          return { sent: false, skipped: true, reason: "duplicate_watchdog_state" };
        }
        lastAlertStatus = status;
        return alertImpl(payload);
      },
    });

    if (!result.evaluation?.stale) {
      lastAlertStatus = null;
    }

    await onIteration({
      ...result,
      nextCheckInMs: once ? 0 : intervalMs,
    });

    if (once) {
      return result;
    }
    await delay(intervalMs);
  }
}
