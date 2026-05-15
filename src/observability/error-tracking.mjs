import process from "node:process";
import * as SentryNode from "@sentry/node";

const REDACTED_KEY = "[REDACTED:sensitive_key]";
const REDACTED_VALUE = "[REDACTED:sensitive_value]";
const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 512;
const SENSITIVE_KEY_RE =
  /(secret|token|api.?key|private|payload|signed|raw|seed|mnemonic|wallet|address|key.?path|keystore|burner|operator|txid|transaction|intent.?hash)/i;
const SECRET_LIKE_VALUE_RE =
  /(sk-[a-z0-9_-]{8,}|seed phrase|mnemonic|private key|burner[_-]?(evm|btc)|telegram token|api key)/i;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const EVM_ADDRESS_IN_RE = /0x[a-fA-F0-9]{40}/;
const BTC_ADDRESS_RE = /^(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{20,}$/i;
const BTC_ADDRESS_IN_RE = /\b(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{20,}\b/i;
const LONG_HEX_RE = /^0x[a-fA-F0-9]{24,}$/;
const LONG_HEX_IN_RE = /0x[a-fA-F0-9]{24,}/;
const KEY_PATH_RE = /(^|\/)(\.?ssh|\.?aws|\.?config|key|keys|keystore|secrets?|wallets?)(\/|$)/i;

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isSensitiveValue(value) {
  if (typeof value !== "string") return false;
  return (
    EVM_ADDRESS_RE.test(value) ||
    EVM_ADDRESS_IN_RE.test(value) ||
    BTC_ADDRESS_RE.test(value) ||
    BTC_ADDRESS_IN_RE.test(value) ||
    LONG_HEX_RE.test(value) ||
    LONG_HEX_IN_RE.test(value) ||
    KEY_PATH_RE.test(value) ||
    SECRET_LIKE_VALUE_RE.test(value)
  );
}

function trimString(value) {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
}

export function sanitizeErrorTrackingValue(value, { depth = 0, key = "" } = {}) {
  if (SENSITIVE_KEY_RE.test(String(key))) return REDACTED_KEY;
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    if (isSensitiveValue(value)) return REDACTED_VALUE;
    return trimString(value);
  }
  if (value instanceof Error) {
    return Object.freeze({
      name: sanitizeErrorTrackingValue(value.name, { depth: depth + 1, key: "errorName" }),
      message: sanitizeErrorTrackingValue(value.message, { depth: depth + 1, key: "errorMessage" }),
      stack: sanitizeErrorTrackingValue(value.stack, { depth: depth + 1, key: "stack" }),
    });
  }
  if (depth >= MAX_DEPTH) return "[MaxDepth]";
  if (Array.isArray(value)) {
    return Object.freeze(
      value.slice(0, 25).map((item, index) =>
        sanitizeErrorTrackingValue(item, {
          depth: depth + 1,
          key: `${key}[${index}]`,
        }),
      ),
    );
  }
  if (!isPlainObject(value)) return trimString(String(value));

  const sanitized = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    sanitized[entryKey] = sanitizeErrorTrackingValue(entryValue, {
      depth: depth + 1,
      key: entryKey,
    });
  }
  return Object.freeze(sanitized);
}

export function sanitizeErrorTrackingEvent(event) {
  if (!event || typeof event !== "object") return event;
  return sanitizeErrorTrackingValue(event);
}

function sanitizeBreadcrumb(breadcrumb = {}) {
  return sanitizeErrorTrackingValue(breadcrumb);
}

function normalizeTags(tags = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(tags || {})) {
    normalized[key] = sanitizeErrorTrackingValue(String(value), { key });
  }
  return Object.freeze(normalized);
}

function normalizeContextName(name) {
  const safe = String(name || "context").replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return safe.slice(0, 64) || "context";
}

function errorPreview(error) {
  if (error instanceof Error) {
    return Object.freeze({
      name: sanitizeErrorTrackingValue(error.name),
      message: sanitizeErrorTrackingValue(error.message),
      stack: sanitizeErrorTrackingValue(error.stack),
    });
  }
  return sanitizeErrorTrackingValue(error);
}

function buildEvent(kind, payload, baseContext, captureOptions = {}) {
  const tags = Object.freeze({
    component: baseContext.component,
    environment: baseContext.environment,
    ...(captureOptions.tags ? normalizeTags(captureOptions.tags) : {}),
  });
  const context = Object.freeze({
    ...Object.fromEntries(baseContext.contexts),
    ...(captureOptions.context ? { capture: sanitizeErrorTrackingValue(captureOptions.context) } : {}),
  });
  return Object.freeze({
    kind,
    payload: sanitizeErrorTrackingValue(payload),
    tags,
    context,
    breadcrumbs: Object.freeze(baseContext.breadcrumbs.slice()),
    release: baseContext.release,
  });
}

export function createErrorTracker({
  enabled = false,
  reason = enabled ? "enabled" : "disabled",
  environment = "local",
  component = "app",
  release = "local",
  transport = null,
  org = "",
  project = "",
} = {}) {
  const breadcrumbs = [];
  const contexts = new Map();
  const baseContext = Object.freeze({
    get breadcrumbs() {
      return breadcrumbs;
    },
    get contexts() {
      return contexts;
    },
    environment: sanitizeErrorTrackingValue(environment),
    component: sanitizeErrorTrackingValue(component),
    release: sanitizeErrorTrackingValue(release),
    org: sanitizeErrorTrackingValue(org),
    project: sanitizeErrorTrackingValue(project),
  });

  function preview(kind, payload, options) {
    const event = buildEvent(kind, payload, baseContext, options);
    if (!enabled || !transport) {
      return Object.freeze({ sent: false, reason, event });
    }
    const result = transport(event);
    return Object.freeze({ sent: true, eventId: result ?? null, event });
  }

  return Object.freeze({
    status: Object.freeze({
      enabled: Boolean(enabled),
      reason,
      environment: baseContext.environment,
      component: baseContext.component,
      release: baseContext.release,
    }),

    setContext(name, context) {
      contexts.set(normalizeContextName(name), sanitizeErrorTrackingValue(context));
    },

    addBreadcrumb(breadcrumb) {
      breadcrumbs.push(sanitizeBreadcrumb(breadcrumb));
      if (breadcrumbs.length > 50) breadcrumbs.shift();
    },

    captureException(error, options = {}) {
      return preview("exception", errorPreview(error), options);
    },

    captureMessage(message, options = {}) {
      return preview("message", sanitizeErrorTrackingValue(message), options);
    },

    async flush() {
      return true;
    },
  });
}

function envEnabled(env) {
  return env.BOB_CLAW_ERROR_TRACKING_ENABLED === "1" || env.BOB_CLAW_ERROR_TRACKING_ENABLED === "true";
}

function envDsn(env) {
  return env.BOB_CLAW_SENTRY_DSN || env.SENTRY_DSN || "";
}

function envOrg(env) {
  return env.BOB_CLAW_SENTRY_ORG || env.SENTRY_ORG || "";
}

function envProject(env) {
  return env.BOB_CLAW_SENTRY_PROJECT || env.SENTRY_PROJECT || "";
}

function sentryScopeOptions(options = {}) {
  return {
    tags: options.tags ? normalizeTags(options.tags) : undefined,
    context: options.context ? { capture: sanitizeErrorTrackingValue(options.context) } : undefined,
  };
}

export async function createSentryErrorTracker({
  env = process.env,
  importSentry = async () => SentryNode,
  component = "app",
} = {}) {
  const enabled = envEnabled(env);
  const dsn = envDsn(env);
  const environment = env.BOB_CLAW_ERROR_TRACKING_ENVIRONMENT || env.NODE_ENV || "local";
  const release = env.SENTRY_RELEASE || "local";
  const org = envOrg(env);
  const project = envProject(env);

  if (!enabled) {
    return createErrorTracker({
      enabled: false,
      reason: "disabled",
      environment,
      component,
      release,
      org,
      project,
    });
  }
  if (!dsn) {
    return createErrorTracker({
      enabled: false,
      reason: "missing_dsn",
      environment,
      component,
      release,
      org,
      project,
    });
  }

  const Sentry = await importSentry();
  Sentry.init({
    dsn,
    enabled: true,
    environment,
    release,
    attachStacktrace: true,
    sendDefaultPii: false,
    beforeSend(event) {
      return sanitizeErrorTrackingEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      return sanitizeBreadcrumb(breadcrumb);
    },
  });

  return Object.freeze({
    status: Object.freeze({
      enabled: true,
      reason: "enabled",
      environment: sanitizeErrorTrackingValue(environment),
      component: sanitizeErrorTrackingValue(component),
      release: sanitizeErrorTrackingValue(release),
    }),

    setContext(name, context) {
      Sentry.setContext(normalizeContextName(name), sanitizeErrorTrackingValue(context));
    },

    addBreadcrumb(breadcrumb) {
      Sentry.addBreadcrumb(sanitizeBreadcrumb(breadcrumb));
    },

    captureException(error, options = {}) {
      const scope = sentryScopeOptions(options);
      const eventId = Sentry.captureException(error, scope);
      return Object.freeze({ sent: true, eventId });
    },

    captureMessage(message, options = {}) {
      const scope = sentryScopeOptions(options);
      const level = options.level || "error";
      const eventId = Sentry.captureMessage(sanitizeErrorTrackingValue(message), level, scope);
      return Object.freeze({ sent: true, eventId });
    },

    async flush(timeoutMs = 2000) {
      if (typeof Sentry.flush === "function") return Sentry.flush(timeoutMs);
      return true;
    },
  });
}

export const ERROR_TRACKING_ENV_VARS = Object.freeze({
  enabled: "BOB_CLAW_ERROR_TRACKING_ENABLED",
  sentryDsn: "BOB_CLAW_SENTRY_DSN",
  environment: "BOB_CLAW_ERROR_TRACKING_ENVIRONMENT",
  release: "SENTRY_RELEASE",
});
