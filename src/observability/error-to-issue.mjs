import { createHash } from "node:crypto";

export const DEFAULT_ERROR_ISSUE_LABELS = Object.freeze(["type/bug", "area/runtime", "readiness/blocker"]);

const REDACTION_PATTERNS = Object.freeze([
  [/\b(?:0x)?[a-fA-F0-9]{64}\b/gu, "[REDACTED_HASH]"],
  [/\b0x[a-fA-F0-9]{40}\b/gu, "[REDACTED_EVM_ADDRESS]"],
  [/\b(?:bc1|tb1|bcrt1)[ac-hj-np-z02-9]{20,90}\b/giu, "[REDACTED_BTC_ADDRESS]"],
  [/\b(?:xprv|xpub|tprv|tpub)[A-Za-z0-9]{80,120}\b/gu, "[REDACTED_EXTENDED_KEY]"],
  [/\b(?:sk|ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/gu, "[REDACTED_TOKEN]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu, "[REDACTED_TOKEN]"],
  [/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/gu, "[REDACTED_TELEGRAM_TOKEN]"],
  [/(\/Users\/)[^/\s]+(\/)/gu, "$1[REDACTED_USER]$2"],
  [
    /\b[A-Za-z0-9._/-]*(?:key|secret|seed|wallet|burner)[A-Za-z0-9._/-]*\.(?:key|pem|json|txt)\b/giu,
    "[REDACTED_KEY_PATH]",
  ],
]);

const SENSITIVE_KEY_PATTERN =
  /(?:private|secret|token|api[_-]?key|seed|mnemonic|wallet|address|tx[_-]?hash|txhash|intent[_-]?hash|intenthash|signed|signature|burner|key[_-]?path|operator|identity)/iu;

function safeText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || value.message || value.name;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(text, maxLength = 6000) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n[truncated ${text.length - maxLength} chars]`;
}

export function redactSensitiveText(value, { maxLength = 6000 } = {}) {
  let text = safeText(value);
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(
    /\b([A-Z0-9_]*(?:PRIVATE|SECRET|TOKEN|API_KEY|SEED|MNEMONIC|BURNER|KEY_PATH|WALLET|ADDRESS|TX_HASH|INTENT_HASH)[A-Z0-9_]*)\s*[:=]\s*([^\s,;]+)/giu,
    "$1=[REDACTED_FIELD]",
  );
  text = text.replace(
    /\b(privateKey|secret|token|apiKey|seedPhrase|mnemonic|walletAddress|txHash|intentHash|signedTx|signature|keyPath)\s*[:=]\s*([^\s,;]+)/giu,
    "$1=[REDACTED_FIELD]",
  );
  return truncate(text, maxLength);
}

export function sanitizeErrorValue(value, key = "") {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED_FIELD]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value))
    return value.slice(0, 20).map((item, index) => sanitizeErrorValue(item, `${key}[${index}]`));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 60)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeErrorValue(entryValue, entryKey)]),
    );
  }
  return redactSensitiveText(String(value));
}

function firstLine(text) {
  return (
    String(text || "")
      .split(/\r?\n/u)
      .find((line) => line.trim()) || ""
  );
}

function normalizeComponent(component) {
  const sanitized = redactSensitiveText(component || "unknown-component", { maxLength: 120 })
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return sanitized || "unknown-component";
}

function normalizeErrorClass(errorClass, message = "") {
  const fallback = firstLine(message).split(":")[0] || "Error";
  return redactSensitiveText(errorClass || fallback, { maxLength: 80 }).replace(/[^A-Za-z0-9_.:-]/gu, "");
}

function hashText(text, length = 16) {
  return createHash("sha256").update(text).digest("hex").slice(0, length);
}

function codeBlock(text, language = "") {
  const body = redactSensitiveText(text || "not provided");
  return `\`\`\`${language}\n${body}\n\`\`\``;
}

function bulletList(items, fallback) {
  const list = Array.isArray(items) ? items : [items].filter(Boolean);
  if (list.length === 0) return `- ${fallback}`;
  return list
    .slice(0, 10)
    .map((item) => `- ${redactSensitiveText(item, { maxLength: 600 })}`)
    .join("\n");
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== "");
}

function issueLabels(options) {
  if (Array.isArray(options.labels) && options.labels.length > 0) return options.labels;
  return DEFAULT_ERROR_ISSUE_LABELS;
}

export function buildErrorFingerprint(report) {
  const sanitized = sanitizeErrorValue(report);
  const stackTop = firstLine(firstPresent(sanitized.stack, sanitized.error?.stack, ""));
  const message = firstPresent(sanitized.message, sanitized.error?.message, stackTop);
  const signature = [
    normalizeComponent(sanitized.component),
    normalizeErrorClass(sanitized.errorClass, message),
    redactSensitiveText(message, { maxLength: 240 }),
    redactSensitiveText(stackTop, { maxLength: 240 }),
  ].join("|");
  return hashText(signature);
}

export function buildErrorIssuePayload(report, options = {}) {
  const sanitized = sanitizeErrorValue(report);
  const rawMessage = firstPresent(sanitized.message, sanitized.error?.message, "No error message provided");
  const component = normalizeComponent(firstPresent(sanitized.component, sanitized.service, sanitized.source));
  const errorClass = normalizeErrorClass(firstPresent(sanitized.errorClass, sanitized.name), rawMessage);
  const message = redactSensitiveText(rawMessage, {
    maxLength: 300,
  });
  const severity = redactSensitiveText(firstPresent(sanitized.severity, sanitized.level, "error"), { maxLength: 80 });
  const observedAt = redactSensitiveText(firstPresent(sanitized.observedAt, sanitized.timestamp, "unknown"), {
    maxLength: 80,
  });
  const stack = firstPresent(sanitized.stack, sanitized.error?.stack, "not provided");
  const context = firstPresent(sanitized.context, sanitized.metadata, {});
  const evidence = firstPresent(sanitized.evidence, sanitized.reproduction, []);
  const fingerprint = buildErrorFingerprint(sanitized);
  const shortFingerprint = fingerprint.slice(0, 12);
  const labels = issueLabels(options);
  const duplicateQuery = `repo:${firstPresent(options.repo, "OWNER/REPO")} is:issue is:open ${fingerprint} in:body`;
  const title = `[error-to-insight] ${component} ${errorClass} (${shortFingerprint})`;

  const body = [
    "## Summary",
    `Sanitized ${severity} report for \`${component}\`: ${message}`,
    "",
    "## Affected component",
    `- Component: \`${component}\``,
    `- Error class: \`${errorClass}\``,
    `- Observed at: \`${observedAt}\``,
    `- Fingerprint: \`${fingerprint}\``,
    "",
    "## Sanitized stack/context",
    codeBlock(stack, "text"),
    codeBlock(context, "json"),
    "",
    "## Reproduction/evidence",
    bulletList(evidence, "No reproduction evidence was included in the sanitized report."),
    "",
    "## Safety impact",
    "- This issue was generated from sanitized observability input only.",
    "- It must not change signer, policy, caps, kill-switch, payback, capital mover, or live execution behavior without a separate operator-approved PR.",
    "",
    "## Next checks",
    "- Confirm whether the affected component has a recent regression or stale input.",
    "- Reproduce with a non-live dry-run or test fixture before touching runtime authority paths.",
    "- Attach only sanitized logs or command output.",
    "",
    "## Secret-safety warning",
    "- Do not paste private keys, env secret values, wallet secrets, Telegram tokens, API keys, seed phrases, signer key material, raw signed tx payloads, raw key paths, wallet addresses, operator identity, raw tx hashes, or raw intent hashes.",
    "",
    `error-fingerprint: ${fingerprint}`,
  ].join("\n");

  return {
    schemaVersion: 1,
    dryRunDefault: true,
    title,
    body,
    labels,
    fingerprint,
    duplicateQuery,
    sanitizedReport: sanitized,
  };
}
