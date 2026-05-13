// Generated from analytics.jsx by src/cli/build-dashboard-public.mjs.

(() => {
const allowedProductAnalyticsEvents = /* @__PURE__ */ new Set(["dashboard_view", "dashboard_tab_changed", "dashboard_interaction"]);
const allowedProductAnalyticsProperties = /* @__PURE__ */ new Set([
  "surface",
  "view",
  "interaction",
  "component",
  "entryPoint",
  "releaseChannel",
  "statusCategory"
]);
const blockedSensitivePropertyNames = [
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
  "walletAddress"
];
function productAnalyticsConfig() {
  const config = window.BOB_CLAW_ANALYTICS_CONFIG || {};
  const enabled = config.enabled === true;
  const projectKey = String(config.posthogProjectKey || "").trim();
  const apiHost = String(config.posthogApiHost || "https://app.posthog.com").replace(/\/+$/, "");
  return {
    enabled,
    vendor: "posthog",
    posthogProjectKey: projectKey,
    posthogApiHost: apiHost || "https://app.posthog.com",
    mode: enabled && projectKey ? "send" : "dry_run"
  };
}
function propertyNameBlocked(name) {
  const normalized = String(name || "").toLowerCase();
  return blockedSensitivePropertyNames.some((blocked) => normalized.includes(blocked.toLowerCase()));
}
function propertyValueBlocked(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length > 80) return true;
  if (/^0x[a-fA-F0-9]{32,}$/.test(trimmed)) return true;
  if (/^(bc1|[13])[a-zA-Z0-9]{20,}$/.test(trimmed)) return true;
  if (/\/Users\/|\.env|key|secret|token/i.test(trimmed)) return true;
  return trimmed.includes("\n");
}
function validateDashboardProductAnalyticsEvent(eventName, properties) {
  const errors = [];
  if (!allowedProductAnalyticsEvents.has(eventName)) errors.push(`blocked_event_name:${eventName || "missing"}`);
  const keys = Object.keys(properties || {});
  if (keys.length > 8) errors.push("too_many_properties");
  keys.sort().forEach((key) => {
    if (propertyNameBlocked(key)) {
      errors.push(`blocked_sensitive_property:${key}`);
    } else if (!allowedProductAnalyticsProperties.has(key)) {
      errors.push(`blocked_unapproved_property:${key}`);
    } else if (propertyValueBlocked(properties[key])) {
      errors.push(`blocked_sensitive_value:${key}`);
    }
  });
  return { ok: errors.length === 0, errors };
}
function safeDashboardProductAnalyticsProperties(properties) {
  const out = {};
  Object.entries(properties || {}).forEach(([key, value]) => {
    if (!allowedProductAnalyticsProperties.has(key)) return;
    if (typeof value === "string") out[key] = value.trim().slice(0, 80);
    else if (typeof value === "boolean" || typeof value === "number") out[key] = value;
  });
  return out;
}
function posthogCapture(config, event) {
  if (typeof fetch !== "function") return Promise.resolve({ status: "skipped", reason: "fetch_unavailable" });
  return fetch(`${config.posthogApiHost}/capture/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: config.posthogProjectKey,
      event: event.eventName,
      distinct_id: "bob-claw-dashboard-anonymous",
      properties: event.properties,
      timestamp: event.observedAt
    })
  }).then((response) => ({ status: response.ok ? "sent" : "error", statusCode: response.status }));
}
window.BOB_CLAW_ANALYTICS_EVENTS = window.BOB_CLAW_ANALYTICS_EVENTS || [];
window.trackProductAnalytics = function trackProductAnalytics(eventName, properties = {}) {
  const config = productAnalyticsConfig();
  const validation = validateDashboardProductAnalyticsEvent(eventName, properties);
  if (!validation.ok) {
    return { status: "blocked", vendor: config.vendor, errors: validation.errors };
  }
  const event = {
    eventName,
    vendor: config.vendor,
    mode: config.mode,
    observedAt: (/* @__PURE__ */ new Date()).toISOString(),
    properties: safeDashboardProductAnalyticsProperties(properties)
  };
  window.BOB_CLAW_ANALYTICS_EVENTS.push(event);
  if (config.mode !== "send") {
    return { status: "dry_run", vendor: config.vendor, event };
  }
  posthogCapture(config, event).catch(() => null);
  return { status: "queued", vendor: config.vendor, event };
};
})();
