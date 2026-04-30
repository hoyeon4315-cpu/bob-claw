export const TELEGRAM_ALERT_MODE = "transaction_only";

export const TELEGRAM_IMMEDIATE_ALERT_CATEGORIES = Object.freeze([
  "live_execution_result",
  "payback_settlement",
]);

const TELEGRAM_IMMEDIATE_ALERT_CATEGORY_SET = new Set(TELEGRAM_IMMEDIATE_ALERT_CATEGORIES);

export function normalizeTelegramAlertCategory(category = null) {
  const normalized = String(category || "unspecified")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "unspecified";
}

export function isImmediateTelegramAlertCategory(category = null) {
  return TELEGRAM_IMMEDIATE_ALERT_CATEGORY_SET.has(normalizeTelegramAlertCategory(category));
}
