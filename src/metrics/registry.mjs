const METRIC_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MAX_LABEL_VALUE_LENGTH = 32;
const FORBIDDEN_LABEL_KEY_RE = /(secret|token|api.?key|private|payload|signed|raw|path|hash|txid|transaction|intent)/i;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const LONG_HEX_RE = /^0x[a-fA-F0-9]{16,}$/;
const BTC_ADDRESS_RE = /^(bc1|tb1|[13mn2])[a-zA-HJ-NP-Z0-9]{20,}$/i;
const PRIVATE_PATH_RE = /(^|\/)(\.?ssh|\.?aws|\.?config|key|keys|keystore|secrets?)(\/|$)/i;

function assertMetricName(name) {
  if (typeof name !== "string" || !METRIC_NAME_RE.test(name)) {
    throw new Error(`invalid metric name: ${String(name)}`);
  }
}

function assertFiniteMetricValue(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`metric value must be finite: ${String(value)}`);
  }
}

function assertLabelKey(key) {
  if (typeof key !== "string" || !LABEL_KEY_RE.test(key)) {
    throw new Error(`invalid metric label key: ${String(key)}`);
  }
  if (FORBIDDEN_LABEL_KEY_RE.test(key)) {
    throw new Error(`forbidden metric label key: ${key}`);
  }
}

function assertLabelValue(key, value) {
  if (typeof value !== "string") {
    throw new Error(`metric label value must be a string: ${key}`);
  }
  if (
    EVM_ADDRESS_RE.test(value) ||
    LONG_HEX_RE.test(value) ||
    BTC_ADDRESS_RE.test(value) ||
    PRIVATE_PATH_RE.test(value)
  ) {
    throw new Error(`sensitive metric label value: ${key}`);
  }
  if (value.length > MAX_LABEL_VALUE_LENGTH) {
    throw new Error(`high-cardinality metric label value: ${key}`);
  }
}

function normalizeLabels(labels = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(labels || {})) {
    assertLabelKey(key);
    const stringValue = String(value);
    assertLabelValue(key, stringValue);
    normalized[key] = stringValue;
  }
  return normalized;
}

function seriesKey(labels) {
  return JSON.stringify(Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)));
}

function cloneLabels(labels) {
  return Object.freeze({ ...labels });
}

function ensureMetric(store, name, type, help) {
  assertMetricName(name);
  const existing = store.get(name);
  if (existing) {
    if (existing.type !== type) {
      throw new Error(`metric type mismatch: ${name}`);
    }
    return existing;
  }
  const metric = {
    name,
    type,
    help: help || `${name} ${type}`,
    series: new Map(),
  };
  store.set(name, metric);
  return metric;
}

function upsertValue(metric, labels, update) {
  const key = seriesKey(labels);
  const current = metric.series.get(key) || { labels: cloneLabels(labels), value: 0 };
  metric.series.set(key, update(current));
}

export function createMetricsRegistry({ now = () => new Date() } = {}) {
  const store = new Map();

  return Object.freeze({
    incrementCounter(name, value = 1, labels = {}, help) {
      assertFiniteMetricValue(value);
      if (value < 0) throw new Error(`counter increment must be non-negative: ${name}`);
      const normalizedLabels = normalizeLabels(labels);
      const metric = ensureMetric(store, name, "counter", help);
      upsertValue(metric, normalizedLabels, (current) => ({
        ...current,
        value: current.value + value,
        updatedAt: now().toISOString(),
      }));
    },

    setGauge(name, value, labels = {}, help) {
      assertFiniteMetricValue(value);
      const normalizedLabels = normalizeLabels(labels);
      const metric = ensureMetric(store, name, "gauge", help);
      upsertValue(metric, normalizedLabels, (current) => ({
        ...current,
        value,
        updatedAt: now().toISOString(),
      }));
    },

    observeSummary(name, value, labels = {}, help) {
      assertFiniteMetricValue(value);
      if (value < 0) throw new Error(`summary observation must be non-negative: ${name}`);
      const normalizedLabels = normalizeLabels(labels);
      const metric = ensureMetric(store, name, "summary", help);
      const key = seriesKey(normalizedLabels);
      const current = metric.series.get(key) || {
        labels: cloneLabels(normalizedLabels),
        count: 0,
        sum: 0,
        min: null,
        max: null,
      };
      metric.series.set(key, {
        ...current,
        count: current.count + 1,
        sum: current.sum + value,
        min: current.min == null ? value : Math.min(current.min, value),
        max: current.max == null ? value : Math.max(current.max, value),
        updatedAt: now().toISOString(),
      });
    },

    snapshot() {
      return Array.from(store.values()).map((metric) => ({
        name: metric.name,
        type: metric.type,
        help: metric.help,
        series: Array.from(metric.series.values()).map((item) => ({ ...item, labels: { ...item.labels } })),
      }));
    },
  });
}

export async function recordTimedOperation(registry, metricName, labels, operation, { nowMs = () => Date.now() } = {}) {
  const startedAt = nowMs();
  try {
    return await operation();
  } finally {
    registry.observeSummary(metricName, nowMs() - startedAt, labels);
  }
}

function escapeHelp(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

function escapeLabelValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function labelSuffix(labels) {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(",")}}`;
}

export function exportMetricsJson(registry, { generatedAt = new Date().toISOString() } = {}) {
  return Object.freeze({
    format: "bobclaw.metrics.v1",
    generatedAt,
    metrics: registry.snapshot(),
  });
}

export function exportOpenMetrics(registry) {
  const lines = [];
  for (const metric of registry.snapshot()) {
    lines.push(`# HELP ${metric.name} ${escapeHelp(metric.help)}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);
    for (const item of metric.series) {
      const labels = labelSuffix(item.labels);
      if (metric.type === "summary") {
        lines.push(`${metric.name}_count${labels} ${item.count}`);
        lines.push(`${metric.name}_sum${labels} ${item.sum}`);
        lines.push(`${metric.name}_min${labels} ${item.min ?? 0}`);
        lines.push(`${metric.name}_max${labels} ${item.max ?? 0}`);
      } else {
        lines.push(`${metric.name}${labels} ${item.value}`);
      }
    }
  }
  lines.push("# EOF");
  return `${lines.join("\n")}\n`;
}
