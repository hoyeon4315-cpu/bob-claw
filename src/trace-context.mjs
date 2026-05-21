import { randomBytes } from "node:crypto";

const TRACE_ID_RE = /^[a-f0-9]{32}$/u;
const SPAN_ID_RE = /^[a-f0-9]{16}$/u;
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/u;
const TRACEPARENT_RE = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/u;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);
const SENSITIVE_ATTRIBUTE_RE =
  /(?:secret|token|api[-_]?key|private[-_]?key|mnemonic|seed|password|passphrase|authorization|cookie|signed[-_]?tx|raw[-_]?tx|key[-_]?path)/iu;

function randomHex(bytes) {
  return randomBytes(bytes).toString("hex");
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeLabel(value, fallback) {
  const candidate = asString(value);
  if (!candidate) return fallback;
  return candidate.replace(/[^A-Za-z0-9._:-]/gu, "_").slice(0, 96) || fallback;
}

export function isValidTraceId(value) {
  const candidate = asString(value).toLowerCase();
  return TRACE_ID_RE.test(candidate) && candidate !== ZERO_TRACE_ID;
}

export function isValidSpanId(value) {
  const candidate = asString(value).toLowerCase();
  return SPAN_ID_RE.test(candidate) && candidate !== ZERO_SPAN_ID;
}

export function isSafeRequestId(value) {
  return REQUEST_ID_RE.test(asString(value));
}

export function createTraceContext({
  traceId = null,
  parentTraceId = null,
  requestId = null,
  spanId = null,
  parentSpanId = null,
  boundary = "job",
  name = "unnamed",
  component = "unknown",
  operation = "unnamed",
  startedAt = null,
  sampled = true,
} = {}) {
  const resolvedTraceId = isValidTraceId(traceId) ? asString(traceId).toLowerCase() : randomHex(16);
  const resolvedSpanId = isValidSpanId(spanId) ? asString(spanId).toLowerCase() : randomHex(8);
  return Object.freeze({
    traceId: resolvedTraceId,
    parentTraceId: isValidTraceId(parentTraceId) ? asString(parentTraceId).toLowerCase() : null,
    requestId: isSafeRequestId(requestId) ? asString(requestId) : `req-${resolvedTraceId.slice(0, 16)}`,
    spanId: resolvedSpanId,
    parentSpanId: isValidSpanId(parentSpanId) ? asString(parentSpanId).toLowerCase() : null,
    boundary: safeLabel(boundary, "job"),
    name: safeLabel(name, "unnamed"),
    component: safeLabel(component, "unknown"),
    operation: safeLabel(operation, "unnamed"),
    startedAt: asString(startedAt) || null,
    sampled: sampled !== false,
  });
}

export function childTraceContext(
  parent,
  {
    spanId = null,
    boundary = "helper",
    name = "child",
    component = null,
    operation = null,
    startedAt = null,
    sampled,
  } = {},
) {
  const root = parent && typeof parent === "object" ? parent : createTraceContext();
  return createTraceContext({
    traceId: root.traceId,
    parentTraceId: root.traceId,
    requestId: root.requestId,
    spanId,
    parentSpanId: root.spanId,
    boundary,
    name,
    component: component || root.component,
    operation: operation || name,
    startedAt: startedAt || root.startedAt,
    sampled: sampled ?? root.sampled,
  });
}

function parseTraceparentHeader(value) {
  const candidate = asString(value).toLowerCase();
  const match = TRACEPARENT_RE.exec(candidate);
  if (!match) return null;
  const [, traceId, parentSpanId, traceFlags] = match;
  if (!isValidTraceId(traceId) || !isValidSpanId(parentSpanId)) return null;
  return {
    traceId,
    parentSpanId,
    sampled: traceFlags.endsWith("1"),
  };
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase());
  const lowerName = name.toLowerCase();
  const match = Object.entries(headers).find(([key]) => String(key).toLowerCase() === lowerName);
  return Array.isArray(match?.[1]) ? match[1][0] : match?.[1] || null;
}

export function traceContextFromHeaders(headers, options = {}) {
  const traceparent = parseTraceparentHeader(headerValue(headers, "traceparent"));
  return createTraceContext({
    ...options,
    requestId: headerValue(headers, "X-Request-ID") || options.requestId,
    traceId: headerValue(headers, "X-Trace-ID") || traceparent?.traceId || options.traceId,
    spanId: headerValue(headers, "X-Span-ID") || options.spanId,
    parentSpanId: headerValue(headers, "X-Parent-Span-ID") || traceparent?.parentSpanId || options.parentSpanId,
    sampled: traceparent?.sampled ?? options.sampled,
  });
}

export function traceHeaders(context) {
  const safe = createTraceContext(context);
  const headers = {
    "X-Request-ID": safe.requestId,
    "X-Trace-ID": safe.traceId,
    "X-Span-ID": safe.spanId,
    traceparent: `00-${safe.traceId}-${safe.spanId}-${safe.sampled ? "01" : "00"}`,
  };
  if (safe.parentSpanId) headers["X-Parent-Span-ID"] = safe.parentSpanId;
  return Object.freeze(headers);
}

function safeAttributeValue(value) {
  if (value == null) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.slice(0, 256);
  if (typeof value === "boolean") return value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function traceMetadata(context, attributes = {}) {
  const safe = createTraceContext(context);
  const metadata = {
    traceId: safe.traceId,
    parentTraceId: safe.parentTraceId,
    requestId: safe.requestId,
    spanId: safe.spanId,
    parentSpanId: safe.parentSpanId,
    boundary: safe.boundary,
    name: safe.name,
    component: safe.component,
    operation: safe.operation,
    startedAt: safe.startedAt,
    sampled: safe.sampled,
  };
  for (const [key, value] of Object.entries(attributes || {})) {
    if (SENSITIVE_ATTRIBUTE_RE.test(String(key))) continue;
    const safeValue = safeAttributeValue(value);
    if (safeValue !== null) metadata[key] = safeValue;
  }
  return Object.freeze(metadata);
}
