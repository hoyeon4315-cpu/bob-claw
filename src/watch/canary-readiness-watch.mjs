import { sendTelegramMessage } from "../notify/telegram.mjs";

export function formatCanaryWatchSummary(nextStep) {
  const lines = [
    `decision=${nextStep.decision}`,
    `headline=${nextStep.headline}`,
  ];
  if (nextStep.route) {
    lines.push(`route=${nextStep.route.label} amount=${nextStep.route.amount}`);
  }
  if (nextStep.reasons?.length) {
    lines.push(`reasons=${nextStep.reasons.join(",")}`);
  }
  return lines.join("\n");
}

export function formatCanaryTelegramAlert(nextStep) {
  const lines = [
    "BOB Claw canary update",
    `decision: ${nextStep.decision}`,
    `headline: ${nextStep.headline}`,
  ];
  if (nextStep.route) {
    lines.push(`route: ${nextStep.route.label}`);
    lines.push(`amount: ${nextStep.route.amount}`);
  }
  if (nextStep.reasons?.length) {
    lines.push(`reasons: ${nextStep.reasons.join(",")}`);
  }
  return lines.join("\n");
}

export function decisionFingerprint(nextStep) {
  return JSON.stringify({
    decision: nextStep.decision,
    routeKey: nextStep.route?.routeKey || null,
    amount: nextStep.route?.amount || null,
    reasons: nextStep.reasons || [],
  });
}

export async function notifyCanaryDecision({ botToken, chatId, nextStep, fetchImpl = fetch }) {
  return sendTelegramMessage({
    botToken,
    chatId,
    text: formatCanaryTelegramAlert(nextStep),
    fetchImpl,
  });
}
