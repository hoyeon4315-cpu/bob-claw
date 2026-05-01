import { config } from "../../config/env.mjs";
import { sendTelegramMessage } from "../../notify/telegram.mjs";

const GENERIC_PROBE_STRATEGY_IDS = new Set([
  "token-dex-experiment",
  "native-dex-experiment",
]);
const IMMEDIATE_ALERT_MIN_USD = 25;

function shortHash(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 18) return text;
  return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

function formatUsd(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return `$${parsed.toFixed(parsed >= 10 ? 2 : 4)}`;
}

function satsFromIntent(intent = {}) {
  const value =
    intent.metadata?.amountSats ??
    intent.metadata?.plannedPaybackSats ??
    intent.metadata?.grossProfitSats ??
    intent.metadata?.amount_sats ??
    null;
  if (value === null || value === undefined || value === "") return "기록 없음";
  return `${value} sats`;
}

export function formatLiveTransactionAlert({
  intent = {},
  broadcast = {},
  stage = "broadcasted",
} = {}) {
  const txHash = broadcast?.txHash || intent.txHash || null;
  const statusLabel = ({
    confirmed: "확정",
    reverted: "리버트",
    failed: "실패",
    error: "오류",
  })[stage] || "브로드캐스트";
  const lines = [
    "BOB Claw 실제 트랜잭션",
    `상태: ${statusLabel}`,
    `전략: ${intent.strategyId || "unknown"}`,
    `체인: ${intent.chain || "unknown"}`,
    `유형: ${intent.intentType || "unknown"}`,
    `BTC 기준: ${satsFromIntent(intent)}`,
  ];
  const usd = formatUsd(intent.amountUsd);
  if (usd) lines.push(`USD 표시: ${usd}`);
  if (txHash) lines.push(`tx: ${shortHash(txHash)}`);
  return lines.join("\n");
}

function isGenericProbeIntent(intent = {}) {
  return GENERIC_PROBE_STRATEGY_IDS.has(String(intent.strategyId || ""));
}

function isPaybackIntent(intent = {}) {
  return String(intent.strategyId || "").startsWith("payback:") || String(intent.intentType || "") === "payback";
}

function isEmergencyIntent(intent = {}) {
  return ["emergency_unwind", "risk_unwind"].includes(String(intent.intentType || ""));
}

function isFailureStage(stage = "") {
  return ["reverted", "failed", "error"].includes(String(stage || ""));
}

function liveAlertAmountUsd(intent = {}) {
  const value = Number(intent.amountUsd ?? intent.metadata?.capCheckAmountUsd ?? NaN);
  return Number.isFinite(value) ? value : null;
}

export function shouldSendLiveTransactionAlert({ intent = {}, stage = "broadcasted" } = {}) {
  if (isFailureStage(stage)) return { send: true, reason: "failure_stage" };
  if (isPaybackIntent(intent)) return { send: true, reason: "payback" };
  if (isEmergencyIntent(intent)) return { send: true, reason: "emergency" };
  if (stage === "confirmed" || stage === "broadcasted") {
    const amountUsd = liveAlertAmountUsd(intent);
    if (amountUsd !== null && amountUsd >= IMMEDIATE_ALERT_MIN_USD) {
      return { send: true, reason: "notional_threshold" };
    }
  }
  return { send: false, reason: "routine_transaction_suppressed" };
}

export async function notifyLiveTransaction({
  intent = {},
  broadcast = {},
  stage = "broadcasted",
  botToken = config.telegramBotToken,
  chatId = config.telegramChatId,
  sendImpl = sendTelegramMessage,
} = {}) {
  if (!broadcast?.txHash) {
    return { sent: false, skipped: true, reason: "tx_hash_missing" };
  }
  const decision = shouldSendLiveTransactionAlert({ intent, stage });
  if (!decision.send) {
    return {
      sent: false,
      skipped: true,
      reason: isGenericProbeIntent(intent) && stage === "broadcasted"
        ? "generic_probe_broadcast_suppressed"
        : decision.reason,
      category: "live_execution_result",
    };
  }
  return sendImpl({
    botToken,
    chatId,
    text: formatLiveTransactionAlert({ intent, broadcast, stage }),
    category: "live_execution_result",
  });
}
