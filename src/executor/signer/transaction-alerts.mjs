import { config } from "../../config/env.mjs";
import { sendTelegramMessage } from "../../notify/telegram.mjs";

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
  const statusLabel = stage === "confirmed" ? "확정" : "브로드캐스트";
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
  return sendImpl({
    botToken,
    chatId,
    text: formatLiveTransactionAlert({ intent, broadcast, stage }),
    category: "live_execution_result",
  });
}
