#!/usr/bin/env node
import { performance } from "node:perf_hooks";

import {
  createMetricsRegistry,
  exportMetricsJson,
  exportOpenMetrics,
  recordTimedOperation,
} from "../metrics/registry.mjs";

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const registry = createMetricsRegistry();
  const commandLabel = "report_metrics_snapshot";
  const startedAt = Date.now();

  registry.incrementCounter("bobclaw_cli_runs_total", 1, { command: commandLabel, result: "started" });
  registry.setGauge("bobclaw_metrics_exporter_info", 1, {
    exporter: "local_openmetrics",
    authority: "observability_only",
  });

  await recordTimedOperation(
    registry,
    "bobclaw_cli_duration_ms",
    { command: commandLabel },
    async () => {
      registry.setGauge("bobclaw_process_uptime_seconds", Math.max(0, process.uptime()), {
        command: commandLabel,
      });
    },
    { nowMs: () => performance.now() },
  );

  registry.incrementCounter("bobclaw_cli_runs_total", 1, { command: commandLabel, result: "ok" });
  registry.setGauge("bobclaw_cli_last_success_unixtime", Math.floor(startedAt / 1000), {
    command: commandLabel,
  });

  if (hasFlag("--json")) {
    process.stdout.write(`${JSON.stringify(exportMetricsJson(registry), null, 2)}\n`);
    return;
  }
  process.stdout.write(exportOpenMetrics(registry));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
