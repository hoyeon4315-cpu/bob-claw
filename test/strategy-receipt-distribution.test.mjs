import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStrategyReceiptDistribution,
  defaultRegimeForTimestamp,
} from "../src/strategy/strategy-receipt-distribution.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function writeJsonl(path, records) {
  await mkdir(dirname(path), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

test("strategy receipt distribution counts final signer-backed receipts by window and regime", () => {
  const now = "2026-05-08T00:00:00.000Z";
  const records = [
    {
      source: "signer",
      strategyId: "base-lane",
      chain: "base",
      observedAt: "2026-05-07T00:00:00.000Z",
      broadcast: { txHash: "0xbase1" },
      lifecycle: { stage: "confirmed" },
      reconciliation: { status: "reconciled" },
      realized: { realizedNetPnlSats: -50 },
    },
    {
      source: "signer",
      strategyId: "base-lane",
      chain: "base",
      observedAt: "2026-04-20T00:00:00.000Z",
      txHash: "0xbase2",
      receipt: { status: "delivered" },
      reconciliationStatus: "reconciled",
      realizedNetPnlSats: 200,
    },
    {
      source: "signer",
      strategyId: "bsc-lane",
      chain: "bsc",
      observedAt: "2026-03-01T00:00:00.000Z",
      broadcast: { txHash: "0xbsc1" },
      lifecycle: { stage: "confirmed" },
      reconciliationStatus: "reconciled",
      realized: { realizedNetPnlSats: 800 },
    },
    {
      source: "signer",
      strategyId: "ignored-preview",
      chain: "base",
      observedAt: "2026-05-07T00:00:00.000Z",
      broadcast: { txHash: "0xpreview" },
      lifecycle: { stage: "confirmed" },
      mode: "preview",
      realized: { realizedNetPnlSats: 999 },
    },
    {
      source: "signer",
      strategyId: "ignored-marker",
      chain: "base",
      observedAt: "2026-05-07T00:00:00.000Z",
      lifecycle: { stage: "confirmed" },
      normalizationError: "strategy_executor_missing",
      realized: { realizedNetPnlSats: 999 },
    },
  ];

  const report = buildStrategyReceiptDistribution({
    records,
    now,
    regimeForTimestamp: (ts) => (ts < Date.parse("2026-04-01T00:00:00.000Z") ? "bear" : "neutral"),
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.summary.receiptCount90d, 3);
  assert.equal(report.summary.topConcentratedStrategyId, "base-lane");
  assert.equal(report.summary.concentrationWarningCount, 1);
  assert.equal(report.summary.receiptPoorStrategyCount, 0);
  assert.deepEqual(report.receiptDistribution.byRegime, {
    bear: { receiptCount90d: 1, realizedNetPnlSats90d: 800 },
    neutral: { receiptCount90d: 2, realizedNetPnlSats90d: 150 },
  });

  const base = report.items.find((item) => item.strategyId === "base-lane" && item.chain === "base");
  assert.equal(base.receiptCount7d, 1);
  assert.equal(base.receiptCount30d, 2);
  assert.equal(base.receiptCount90d, 2);
  assert.equal(base.realizedNetPnlSats7d, -50);
  assert.equal(base.realizedNetPnlSats30d, 150);
  assert.equal(base.realizedNetPnlSats90d, 150);
  assert.equal(base.sampleShare90d, 2 / 3);
  assert.equal(base.concentrationWarning, true);
});

test("strategy receipt distribution infers signer audit shape and canonicalizes chain aliases", () => {
  const report = buildStrategyReceiptDistribution({
    now: "2026-05-08T00:00:00.000Z",
    records: [
      {
        schemaVersion: 1,
        intentHash: "0xintent1",
        policyVerdict: "broadcasted",
        strategyId: "alias-lane",
        chain: "BNB Chain",
        timestamp: "2026-05-07T00:00:00.000Z",
        broadcast: { txHash: "0xaaa" },
        lifecycle: { stage: "confirmed" },
        reconciliationStatus: "reconciled",
        realized: { realizedNetPnlSats: 10 },
      },
      {
        schemaVersion: 1,
        intentHash: "0xintent2",
        policyVerdict: "broadcasted",
        strategyId: "alias-lane",
        chain: "bsc",
        timestamp: "2026-05-07T01:00:00.000Z",
        broadcast: { txHash: "0xbbb" },
        lifecycle: { stage: "confirmed" },
        reconciliationStatus: "reconciled",
        realized: { realizedNetPnlSats: 15 },
      },
    ],
    expectedStrategies: ["alias-lane", "quiet-lane"],
  });

  assert.equal(report.summary.receiptCount90d, 2);
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].chain, "bsc");
  assert.equal(report.items[0].receiptCount90d, 2);
  assert.equal(report.items[0].realizedNetPnlSats90d, 25);
  assert.equal(report.summary.receiptPoorStrategyCount, 1);
});

test("strategy receipt distribution rejects tx hashes without reconciliation proof", () => {
  const report = buildStrategyReceiptDistribution({
    now: "2026-05-08T00:00:00.000Z",
    records: [
      {
        schemaVersion: 1,
        intentHash: "0xintent1",
        policyVerdict: "broadcasted",
        strategyId: "unreconciled-lane",
        chain: "base",
        timestamp: "2026-05-07T00:00:00.000Z",
        broadcast: { txHash: "0xaaa" },
        lifecycle: { stage: "confirmed", confirmations: 64 },
        realized: { realizedNetPnlSats: 10 },
      },
    ],
    expectedStrategies: ["unreconciled-lane"],
  });

  assert.equal(report.summary.receiptCount90d, 0);
  assert.equal(report.items.length, 0);
  assert.equal(report.summary.receiptPoorStrategyCount, 1);
});

test("strategy receipt distribution CLI emits json from signer audit fixtures", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-receipt-distribution-"));
  const auditLog = join(cwd, "logs", "signer-audit.jsonl");
  await writeJsonl(auditLog, [
    {
      source: "signer",
      strategyId: "gateway_native_asset_conversion_sleeve",
      chain: "base",
      observedAt: "2026-05-07T00:00:00.000Z",
      broadcast: { txHash: "0xabc" },
      lifecycle: { stage: "confirmed" },
      reconciliationStatus: "reconciled",
      realized: { realizedNetPnlSats: 25 },
    },
  ]);

  const result = spawnSync(
    process.execPath,
    [
      join(ROOT, "src/cli/report-strategy-receipt-distribution.mjs"),
      `--audit=${auditLog}`,
      "--now=2026-05-08T00:00:00.000Z",
      "--json",
    ],
    { cwd, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.receiptCount90d, 1);
  assert.equal(report.items[0].strategyId, "gateway_native_asset_conversion_sleeve");
});

test("default receipt regime is unknown without injected detector", () => {
  assert.equal(defaultRegimeForTimestamp(Date.now()), "unknown");
});
