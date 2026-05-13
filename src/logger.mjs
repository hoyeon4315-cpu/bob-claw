import { appendFile, mkdir } from "node:fs/promises";
import { dirname, normalize, sep } from "node:path";

import { safeJsonStringify } from "./lib/json-safe.mjs";

const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

const REDACTED = "[redacted]";

const SENSITIVE_KEY_PATTERNS = [
  /authorization/u,
  /password/u,
  /passphrase/u,
  /mnemonic/u,
  /seedphrase/u,
  /secret/u,
  /token/u,
  /apikey/u,
  /privatekey/u,
  /burner.*key.*path/u,
  /keypath/u,
  /raw.*signed.*tx/u,
  /raw.*signed.*transaction/u,
  /signed.*tx/u,
  /signed.*transaction/u,
  /signature/u,
  /calldata/u,
];

const SENSITIVE_TEXT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gu,
];

const RESTRICTED_LOG_PATH_PATTERNS = [
  /(^|[/\\])logs[/\\][^/\\]*(audit|receipt)[^/\\]*\.jsonl$/iu,
  /(^|[/\\])data[/\\][^/\\]*(receipt|capital-audit)[^/\\]*\.jsonl$/iu,
];

function normalizedKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
}

export function isSensitiveLogKey(key) {
  const normalized = normalizedKey(key);
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function envSecrets(env) {
  const secrets = [];
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value !== "string" || value.length < 4) continue;
    if (isSensitiveLogKey(key)) secrets.push(value);
  }
  return secrets;
}

function sanitizeString(value, secrets) {
  let output = value;
  for (const pattern of SENSITIVE_TEXT_PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }
  for (const secret of secrets) {
    if (secret && output.includes(secret)) {
      output = output.split(secret).join(REDACTED);
    }
  }
  return output;
}

function errorToLogFields(error, secrets, seen) {
  return {
    name: sanitizeLogValue(error.name || "Error", secrets, seen),
    message: sanitizeLogValue(error.message || String(error), secrets, seen),
    stack: error.stack ? sanitizeLogValue(error.stack, secrets, seen) : undefined,
  };
}

function sanitizeLogValue(value, secrets, seen) {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return sanitizeString(value, secrets);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return errorToLogFields(value, secrets, seen);
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item, secrets, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      out[key] = isSensitiveLogKey(key) ? REDACTED : sanitizeLogValue(nestedValue, secrets, seen);
    }
    seen.delete(value);
    return out;
  }
  return String(value);
}

export function sanitizeLogFields(fields = {}, { env = process.env, extraSecrets = [] } = {}) {
  const secrets = [
    ...envSecrets(env),
    ...extraSecrets.filter((value) => typeof value === "string" && value.length >= 4),
  ];
  return sanitizeLogValue(fields, secrets, new WeakSet()) || {};
}

export function isRestrictedStructuredLogPath(path) {
  const normalized = normalize(String(path || ""))
    .split(sep)
    .join("/");
  return RESTRICTED_LOG_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function assertLevel(level) {
  if (!Object.hasOwn(LEVELS, level)) {
    throw new Error(`Unknown structured log level: ${level}`);
  }
}

function assertEvent(event) {
  if (!event || typeof event !== "string") {
    throw new Error("Structured log event must be a non-empty string.");
  }
}

function assertComponent(component) {
  if (!component || typeof component !== "string") {
    throw new Error("Structured logger component must be a non-empty string.");
  }
}

function assertFilePath(filePath) {
  if (!filePath) return;
  if (isRestrictedStructuredLogPath(filePath)) {
    throw new Error("Structured logger filePath must not target an audit or receipt log.");
  }
}

function writeStreamLine(stream, line) {
  if (!stream || typeof stream.write !== "function") return;
  stream.write(`${line}\n`);
}

export function createLogger({
  component,
  level = process.env.BOB_CLAW_LOG_LEVEL || "info",
  stdout = process.stdout,
  stderr = process.stderr,
  filePath = null,
  now = () => new Date().toISOString(),
  env = process.env,
  extraSecrets = [],
} = {}) {
  assertComponent(component);
  assertLevel(level);
  assertFilePath(filePath);

  const pendingWrites = new Set();

  function shouldLog(recordLevel) {
    return LEVELS[recordLevel] >= LEVELS[level];
  }

  function appendStructuredFileLine(line) {
    if (!filePath) return;
    const write = mkdir(dirname(filePath), { recursive: true }).then(() => appendFile(filePath, `${line}\n`, "utf8"));
    pendingWrites.add(write);
    write.then(
      () => pendingWrites.delete(write),
      () => pendingWrites.delete(write),
    );
  }

  function log(recordLevel, event, fields = {}) {
    assertLevel(recordLevel);
    assertEvent(event);
    if (!shouldLog(recordLevel)) return null;

    const sanitizedFields = sanitizeLogFields(fields, { env, extraSecrets });
    const record = {
      schemaVersion: 1,
      ...sanitizedFields,
      timestamp: now(),
      level: recordLevel,
      component,
      event,
    };
    const line = safeJsonStringify(record);
    writeStreamLine(recordLevel === "error" || recordLevel === "warn" ? stderr : stdout, line);
    appendStructuredFileLine(line);
    return record;
  }

  return {
    debug: (event, fields) => log("debug", event, fields),
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
    child(childComponent) {
      return createLogger({
        component: `${component}:${childComponent}`,
        level,
        stdout,
        stderr,
        filePath,
        now,
        env,
        extraSecrets,
      });
    },
    async flush() {
      await Promise.all([...pendingWrites]);
    },
  };
}
