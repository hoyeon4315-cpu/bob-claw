import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  main as diagnoseSignerHealthMain,
  parseArgs as parseDiagnoseSignerHealthArgs,
} from "../src/cli/diagnose-signer-health.mjs";
import {
  main as reportAutomationHealthMain,
  parseArgs as parseReportAutomationHealthArgs,
} from "../src/cli/report-automation-health.mjs";
import { createMetricsRegistry } from "../src/metrics/registry.mjs";
import { writeMetricsSnapshot } from "../src/metrics/cli-run.mjs";

function createBufferingStream() {
  const chunks = [];
  return {
    stream: {
      write(chunk) {
        chunks.push(String(chunk));
      },
    },
    text() {
      return chunks.join("");
    },
  };
}

test("diagnose-signer-health parses metrics export flags", () => {
  const parsed = parseDiagnoseSignerHealthArgs([
    "--json",
    "--metrics-out=./tmp/diagnose.prom",
    "--metrics-format=json",
  ]);

  assert.equal(parsed.json, true);
  assert.equal(parsed.metricsFormat, "json");
  assert.equal(parsed.metricsOut, resolve("./tmp/diagnose.prom"));
});

test("report-automation-health parses metrics export flags", () => {
  const parsed = parseReportAutomationHealthArgs([
    "--json",
    "--skip-runtime-probe",
    "--metrics-out=./tmp/automation.prom",
  ]);

  assert.equal(parsed.json, true);
  assert.equal(parsed.skipRuntimeProbe, true);
  assert.equal(parsed.metricsFormat, "openmetrics");
  assert.equal(parsed.metricsOut, resolve("./tmp/automation.prom"));
});

test("writeMetricsSnapshot rejects audit-like output targets", async () => {
  const registry = createMetricsRegistry();
  registry.incrementCounter("bobclaw_cli_runs_total", 1, {
    command: "diagnose_signer_health",
    result: "ok",
  });

  await assert.rejects(
    () =>
      writeMetricsSnapshot({
        registry,
        outPath: join(tmpdir(), "logs", "signer-audit.jsonl"),
      }),
    /metrics output path must not target audit or receipt artifacts/,
  );
});

test("diagnose-signer-health writes bounded CLI metrics without leaking signer details", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-cli-metrics-diagnose-"));
  const metricsPath = join(root, "diagnose-signer-health.prom");
  const stdout = createBufferingStream();
  const stderr = createBufferingStream();

  try {
    const report = await diagnoseSignerHealthMain(["--json", `--metrics-out=${metricsPath}`], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      diagnoseSignerHealthImpl: async () => ({
        cause: "clean",
        readiness: {
          readyForBroadcast: true,
          telemetryComplete: true,
          limitations: [],
        },
        process: {
          daemonRunning: true,
          watchdogRunning: true,
        },
        heartbeat: {
          status: "fresh",
          ageMs: 1200,
        },
        socket: { ok: true },
        btcRpc: { ok: true },
        rpc: {
          chains: [
            { chain: "base", ok: true },
            { chain: "ethereum", ok: false },
          ],
        },
        nonceManagers: { ok: true },
        signerAudit: {
          lastStage: "confirmed",
          lastTimestamp: "2026-05-13T00:00:00.000Z",
        },
      }),
    });

    assert.equal(report.cause, "clean");
    assert.match(stdout.text(), /"cause": "clean"/);
    assert.equal(stderr.text(), "");

    const metricsText = await readFile(metricsPath, "utf8");
    assert.match(metricsText, /bobclaw_cli_runs_total\{command="diagnose_signer_health",result="ok"\} 1/);
    assert.match(metricsText, /bobclaw_signer_health_ready_for_broadcast\{command="diagnose_signer_health"\} 1/);
    assert.match(metricsText, /bobclaw_signer_health_failed_rpc_count\{command="diagnose_signer_health"\} 1/);
    assert.doesNotMatch(metricsText, /0x[a-fA-F0-9]{40}/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("report-automation-health writes JSON metrics for queue and runtime gauges", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-cli-metrics-automation-"));
  const metricsPath = join(root, "automation-health.json");
  const stdout = createBufferingStream();
  const stderr = createBufferingStream();

  try {
    const report = await reportAutomationHealthMain(
      ["--json", "--skip-runtime-probe", `--metrics-out=${metricsPath}`, "--metrics-format=json"],
      {
        stdout: stdout.stream,
        stderr: stderr.stream,
        collectAutomationHealthReportImpl: async () => ({
          status: "attention_required",
          runtimeReadiness: { ready: false },
          launchd: { summary: { configuredCount: 1 } },
          allChain: { refillBlockedCount: 3 },
          queues: { totalCandidates: 7 },
          topBlockers: [{ reason: "inventory_missing", count: 2 }],
        }),
      },
    );

    assert.equal(report.status, "attention_required");
    assert.match(stdout.text(), /"status": "attention_required"/);
    assert.equal(stderr.text(), "");

    const metrics = JSON.parse(await readFile(metricsPath, "utf8"));
    assert.equal(metrics.format, "bobclaw.metrics.v1");

    const runCounter = metrics.metrics.find((entry) => entry.name === "bobclaw_cli_runs_total");
    const queueGauge = metrics.metrics.find((entry) => entry.name === "bobclaw_automation_health_queue_candidates");
    const runtimeGauge = metrics.metrics.find((entry) => entry.name === "bobclaw_automation_health_runtime_ready");
    const blockerGauge = metrics.metrics.find((entry) => entry.name === "bobclaw_automation_health_top_blocker_count");

    assert.deepEqual(runCounter.series[0].labels, {
      command: "report_automation_health",
      result: "blocked",
    });
    assert.equal(queueGauge.series[0].value, 7);
    assert.equal(runtimeGauge.series[0].value, 0);
    assert.equal(blockerGauge.series[0].value, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
