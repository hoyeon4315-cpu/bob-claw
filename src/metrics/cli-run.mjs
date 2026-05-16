import { normalize, sep } from "node:path";

import { writeTextIfChanged } from "../lib/file-write.mjs";
import { createMetricsRegistry, exportMetricsJson, exportOpenMetrics } from "./registry.mjs";

const RESTRICTED_OUTPUT_PATTERNS = [
  /(^|[/\\])logs[/\\][^/\\]*(audit|receipt)[^/\\]*\.jsonl$/iu,
  /(^|[/\\])data[/\\][^/\\]*(receipt|capital-audit)[^/\\]*\.jsonl$/iu,
];

function normalizedPath(path) {
  return normalize(String(path || ""))
    .split(sep)
    .join("/");
}

export function isRestrictedMetricsOutputPath(path) {
  return RESTRICTED_OUTPUT_PATTERNS.some((pattern) => pattern.test(normalizedPath(path)));
}

export function parseMetricsArgs(argv = [], { resolvePath } = {}) {
  const entries = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...rest] = arg.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );

  const metricsFormat = entries["metrics-format"] || "openmetrics";
  if (metricsFormat !== "openmetrics" && metricsFormat !== "json") {
    throw new Error(`unsupported metrics format: ${metricsFormat}`);
  }

  return {
    metricsOut: entries["metrics-out"] ? resolvePath(entries["metrics-out"]) : null,
    metricsFormat,
  };
}

export async function writeMetricsSnapshot({
  registry,
  outPath,
  format = "openmetrics",
  generatedAt = new Date().toISOString(),
  writeTextImpl = writeTextIfChanged,
} = {}) {
  if (!outPath) return null;
  if (isRestrictedMetricsOutputPath(outPath)) {
    throw new Error("metrics output path must not target audit or receipt artifacts");
  }

  const text =
    format === "json"
      ? `${JSON.stringify(exportMetricsJson(registry, { generatedAt }), null, 2)}\n`
      : exportOpenMetrics(registry);
  return writeTextImpl(outPath, text);
}

export function createCliMetricsSession({
  command,
  metricsOut = null,
  metricsFormat = "openmetrics",
  now = () => new Date(),
  nowMs = () => Date.now(),
  writeTextImpl = writeTextIfChanged,
} = {}) {
  const registry = createMetricsRegistry({
    now: () => {
      const current = now();
      return current instanceof Date ? current : new Date(current);
    },
  });
  const startedAtMs = nowMs();

  function scopedLabels(labels = {}) {
    return {
      command,
      ...labels,
    };
  }

  return Object.freeze({
    registry,

    setGauge(name, value, labels = {}, help) {
      registry.setGauge(name, value, scopedLabels(labels), help);
    },

    incrementCounter(name, value = 1, labels = {}, help) {
      registry.incrementCounter(name, value, scopedLabels(labels), help);
    },

    observeSummary(name, value, labels = {}, help) {
      registry.observeSummary(name, value, scopedLabels(labels), help);
    },

    async finalize({ result = "ok", gauges = [] } = {}) {
      const durationMs = Math.max(0, nowMs() - startedAtMs);
      const generatedAt = now();
      const generatedAtDate = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);

      registry.incrementCounter("bobclaw_cli_runs_total", 1, scopedLabels({ result }));
      registry.observeSummary("bobclaw_cli_duration_ms", durationMs, scopedLabels());
      registry.setGauge("bobclaw_cli_last_run_unixtime", Math.floor(generatedAtDate.getTime() / 1000), scopedLabels());

      for (const gauge of gauges) {
        if (!gauge || typeof gauge.name !== "string") continue;
        registry.setGauge(gauge.name, gauge.value, scopedLabels(gauge.labels || {}), gauge.help);
      }

      return writeMetricsSnapshot({
        registry,
        outPath: metricsOut,
        format: metricsFormat,
        generatedAt: generatedAtDate.toISOString(),
        writeTextImpl,
      });
    },
  });
}
