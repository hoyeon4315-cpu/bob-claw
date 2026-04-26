import { config } from "../../config/env.mjs";
import { sendTelegramMessage } from "../../notify/telegram.mjs";

const NOTIFY_BLOCKERS = new Set(["max_consecutive_failures_reached"]);

export function shouldNotifyPolicyRejection(policy = null) {
  return (policy?.blockers || []).some((blocker) => NOTIFY_BLOCKERS.has(blocker));
}

export function formatPolicyRejectionAlert({ intent = {}, policy = null } = {}) {
  const lines = [
    "BOB Claw signer policy rejection",
    `strategy: ${intent.strategyId || "unknown"}`,
    `chain: ${intent.chain || "unknown"}`,
    `intentType: ${intent.intentType || "unknown"}`,
    `blockers: ${(policy?.blockers || []).join(",") || "none"}`,
  ];
  const consecutiveFailures = policy?.results?.find((item) => item.policy === "consecutive_failures")?.metrics?.consecutiveFailures;
  if (Number.isFinite(consecutiveFailures)) {
    lines.push(`consecutiveFailures: ${consecutiveFailures}`);
  }
  lines.push("action: keep strategy halted until operator reviews and resumes by committed diff");
  return lines.join("\n");
}

export async function notifyPolicyRejection({
  intent = {},
  policy = null,
  botToken = config.telegramBotToken,
  chatId = config.telegramChatId,
  sendImpl = sendTelegramMessage,
} = {}) {
  if (!shouldNotifyPolicyRejection(policy)) {
    return { sent: false, skipped: true, reason: "not_notify_worthy" };
  }
  try {
    return await sendImpl({
      botToken,
      chatId,
      text: formatPolicyRejectionAlert({ intent, policy }),
      category: "strategy_halt",
    });
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      reason: "telegram_send_failed",
      error: {
        name: error.name,
        message: error.message,
      },
    };
  }
}
