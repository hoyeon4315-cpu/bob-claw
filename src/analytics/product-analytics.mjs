const DEFAULT_VENDOR = "posthog";
const DEFAULT_POSTHOG_API_HOST = "https://app.posthog.com";
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const PROPERTY_NAME_PATTERN = /^[a-z][a-zA-Z0-9]{1,39}$/;
const MAX_PROPERTY_COUNT = 8;
const MAX_STRING_LENGTH = 80;

export const allowedProductAnalyticsEvents = Object.freeze([
  "dashboard_view",
  "dashboard_tab_changed",
  "dashboard_interaction",
  "dev_report_viewed",
]);

export const allowedProductAnalyticsProperties = Object.freeze([
  "surface",
  "view",
  "interaction",
  "component",
  "entryPoint",
  "releaseChannel",
  "statusCategory",
]);

export const blockedSensitivePropertyNames = Object.freeze([
  "address",
  "apiKey",
  "commandOutput",
  "envValue",
  "error",
  "filePath",
  "intentHash",
  "keyPath",
  "operator",
  "privateKey",
  "rawCommandOutput",
  "rawError",
  "rawFilePath",
  "seedPhrase",
  "signedTx",
  "telegramToken",
  "token",
  "txHash",
  "wallet",
  "walletAddress",
]);

const allowedEventSet = new Set(allowedProductAnalyticsEvents);
const allowedPropertySet = new Set(allowedProductAnalyticsProperties);
const blockedNameSet = new Set(blockedSensitivePropertyNames.map((name) => name.toLowerCase()));

function envValue(env, key) {
  if (!env || typeof env !== "object") return undefined;
  return env[key];
}

function normalizeBoolean(value) {
  return (
    String(value || "")
      .trim()
      .toLowerCase() === "true"
  );
}

function normalizeApiHost(value) {
  const host = String(value || DEFAULT_POSTHOG_API_HOST)
    .trim()
    .replace(/\/+$/, "");
  return host || DEFAULT_POSTHOG_API_HOST;
}

function isBlockedName(name) {
  const normalized = String(name || "").toLowerCase();
  if (blockedNameSet.has(normalized)) return true;
  return blockedSensitivePropertyNames.some((blocked) => normalized.includes(blocked.toLowerCase()));
}

function looksSensitiveValue(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length > MAX_STRING_LENGTH) return true;
  if (/^0x[a-fA-F0-9]{32,}$/.test(trimmed)) return true;
  if (/^(bc1|[13])[a-zA-Z0-9]{20,}$/.test(trimmed)) return true;
  if (/\/Users\/|\.env|key|secret|token/i.test(trimmed)) return true;
  if (trimmed.includes("\n")) return true;
  return false;
}

function sanitizeProperties(properties) {
  const sanitized = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (!allowedPropertySet.has(key)) continue;
    if (typeof value === "string") {
      sanitized[key] = value.trim().slice(0, MAX_STRING_LENGTH);
    } else if (typeof value === "boolean" || typeof value === "number") {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function normalizeProductAnalyticsConfig(env = {}) {
  const enabled = normalizeBoolean(envValue(env, "BOB_CLAW_ANALYTICS_ENABLED"));
  const projectKey = String(envValue(env, "BOB_CLAW_POSTHOG_PROJECT_KEY") || "").trim();
  return Object.freeze({
    enabled,
    vendor: DEFAULT_VENDOR,
    apiHost: normalizeApiHost(envValue(env, "BOB_CLAW_POSTHOG_API_HOST")),
    projectKey,
    mode: enabled && projectKey ? "send" : "dry_run",
  });
}

export function validateProductAnalyticsEvent(eventName, properties = {}) {
  const errors = [];
  if (!EVENT_NAME_PATTERN.test(String(eventName || "")) || !allowedEventSet.has(eventName)) {
    errors.push(`blocked_event_name:${eventName || "missing"}`);
  }
  const keys = Object.keys(properties || {});
  if (keys.length > MAX_PROPERTY_COUNT) errors.push("too_many_properties");
  for (const key of keys.sort()) {
    if (isBlockedName(key)) {
      errors.push(`blocked_sensitive_property:${key}`);
      continue;
    }
    if (!PROPERTY_NAME_PATTERN.test(key) || !allowedPropertySet.has(key)) {
      errors.push(`blocked_unapproved_property:${key}`);
      continue;
    }
    if (looksSensitiveValue(properties[key])) {
      errors.push(`blocked_sensitive_value:${key}`);
    }
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    properties: Object.freeze(sanitizeProperties(properties)),
  });
}

function defaultObservedAt() {
  return new Date().toISOString();
}

async function posthogTransport({ apiHost, projectKey, event }) {
  if (typeof fetch !== "function") {
    return Object.freeze({ status: "skipped", reason: "fetch_unavailable" });
  }
  const response = await fetch(`${apiHost}/capture/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: projectKey,
      event: event.eventName,
      distinct_id: "bob-claw-dashboard-anonymous",
      properties: event.properties,
      timestamp: event.observedAt,
    }),
  });
  return Object.freeze({ status: response.ok ? "sent" : "error", statusCode: response.status });
}

export function createProductAnalyticsTracker({
  config = normalizeProductAnalyticsConfig({}),
  now = defaultObservedAt,
  transport = posthogTransport,
} = {}) {
  const recorded = [];
  return Object.freeze({
    async track(eventName, properties = {}) {
      const validation = validateProductAnalyticsEvent(eventName, properties);
      if (!validation.ok) {
        return Object.freeze({
          status: "blocked",
          vendor: config.vendor,
          errors: validation.errors,
        });
      }
      const event = Object.freeze({
        eventName,
        vendor: config.vendor,
        mode: config.mode,
        observedAt: now(),
        properties: validation.properties,
      });
      recorded.push(event);
      if (config.mode !== "send") {
        return Object.freeze({ status: "dry_run", vendor: config.vendor, event });
      }
      await transport({
        apiHost: config.apiHost,
        projectKey: config.projectKey,
        event,
      });
      return Object.freeze({ status: "sent", vendor: config.vendor, event });
    },
    events() {
      return recorded.map((event) => ({ ...event, properties: { ...event.properties } }));
    },
  });
}
