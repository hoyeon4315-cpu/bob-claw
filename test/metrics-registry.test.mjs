import assert from "node:assert/strict";
import test from "node:test";

import {
  createMetricsRegistry,
  exportMetricsJson,
  exportOpenMetrics,
  recordTimedOperation,
} from "../src/metrics/registry.mjs";

test("records counters, gauges, and timing summaries with bounded labels", async () => {
  const registry = createMetricsRegistry({
    now: () => new Date("2026-05-12T00:00:00.000Z"),
  });

  registry.incrementCounter("bobclaw_report_runs_total", 1, {
    command: "report_metrics_snapshot",
    result: "ok",
  });
  registry.setGauge("bobclaw_report_last_success_unixtime", 1778544000, {
    command: "report_metrics_snapshot",
  });
  await recordTimedOperation(
    registry,
    "bobclaw_report_duration_ms",
    { command: "report_metrics_snapshot" },
    async () => "done",
    {
      nowMs: (() => {
        let current = 1000;
        return () => {
          current += 25;
          return current;
        };
      })(),
    },
  );

  const snapshot = exportMetricsJson(registry);
  assert.equal(snapshot.metrics.length, 3);
  assert.equal(snapshot.metrics[0].name, "bobclaw_report_runs_total");
  assert.deepEqual(snapshot.metrics[0].series[0].labels, {
    command: "report_metrics_snapshot",
    result: "ok",
  });
  assert.equal(snapshot.metrics[2].series[0].count, 1);
  assert.equal(snapshot.metrics[2].series[0].sum, 25);

  const openMetrics = exportOpenMetrics(registry);
  assert.match(openMetrics, /# TYPE bobclaw_report_runs_total counter/);
  assert.match(openMetrics, /bobclaw_report_runs_total\{command="report_metrics_snapshot",result="ok"\} 1/);
  assert.match(openMetrics, /bobclaw_report_duration_ms_count\{command="report_metrics_snapshot"\} 1/);
  assert.match(openMetrics, /# EOF\n$/);
});

test("rejects secret-like and high-cardinality metric labels", () => {
  const registry = createMetricsRegistry();

  assert.throws(
    () => registry.incrementCounter("bobclaw_rejected_labels_total", 1, { intentHash: "0xabc" }),
    /forbidden metric label key: intentHash/,
  );
  assert.throws(
    () =>
      registry.incrementCounter("bobclaw_rejected_labels_total", 1, {
        route: "base-to-bob-full-route-id-with-many-segments",
      }),
    /high-cardinality metric label value/,
  );
  assert.throws(
    () =>
      registry.incrementCounter("bobclaw_rejected_labels_total", 1, {
        wallet: "0x000000000000000000000000000000000000dEaD",
      }),
    /sensitive metric label value/,
  );
});
