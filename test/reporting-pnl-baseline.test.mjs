import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildReceiptReconciliation } from "../src/ledger/receipt-reconciliation.mjs";
import { buildDashboardStatus } from "../src/status/dashboard-status.mjs";
import {
  clearReportingPnlBaseline,
  readReportingPnlBaseline,
  setReportingPnlBaseline,
} from "../src/status/reporting-pnl-baseline.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function pricesFixture() {
  return {
    btc: 73_000,
    nativeByChain: {
      base: 2_200,
    },
    tokenByKey: {
      btc: 73_000,
      usd_stable: 1,
    },
  };
}

function routeContextFixture(overrides = {}) {
  return {
    routeKey: "base:0x0555->base:0x0556",
    amount: "10000",
    srcChain: "base",
    dstChain: "base",
    inputUsd: 7.3,
    outputUsd: 7.4,
    executableOutputUsd: null,
    netEdgeUsd: 0.05,
    executableNetEdgeUsd: null,
    executionGasUsd: 0.001,
    nativeCostUsd: 0.001,
    tradeReadiness: "policy_ready",
    srcAsset: {
      chain: "base",
      token: "0x0555",
      ticker: "wBTC.OFT",
      decimals: 8,
      priceKey: "btc",
      isNative: false,
    },
    dstAsset: {
      chain: "base",
      token: "0x0556",
      ticker: "USDC",
      decimals: 6,
      priceKey: "usd_stable",
      isNative: false,
    },
    price: {
      dstRawUsd: 1,
    },
    ...overrides,
  };
}

function receiptFixture(overrides = {}) {
  return {
    status: 1,
    blockNumber: 123,
    gasUsed: 300000n,
    effectiveGasPrice: 1_000_000n,
    from: "0xfrom",
    to: "0xto",
    ...overrides,
  };
}

function transactionFixture(overrides = {}) {
  return {
    from: "0xfrom",
    to: "0xto",
    nonce: 1,
    value: 0n,
    ...overrides,
  };
}

function receiptRecord(observedAt, { txHash, status = 1, outputUnits = "7400000" } = {}) {
  return buildReceiptReconciliation({
    observedAt,
    chain: "base",
    txHash,
    routeContext: routeContextFixture(),
    receipt: receiptFixture({ status }),
    transaction: transactionFixture(),
    prices: pricesFixture(),
    output: status === 0 ? {} : { actualOutputUnits: outputUnits },
  });
}

test("reporting pnl baseline persists and clears", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-reporting-pnl-"));
  const anchoredAt = "2026-04-20T00:00:00.000Z";

  const saved = await setReportingPnlBaseline({
    dataDir,
    anchoredAt,
    reason: "operator_reset_now",
  });
  assert.equal(saved.baseline.anchoredAt, anchoredAt);
  assert.equal(saved.baseline.reason, "operator_reset_now");

  const loaded = await readReportingPnlBaseline({ dataDir });
  assert.equal(loaded.anchoredAt, anchoredAt);

  const cleared = await clearReportingPnlBaseline({ dataDir });
  assert.equal(cleared.cleared, true);
  assert.equal(await readReportingPnlBaseline({ dataDir }), null);
});

test("dashboard status applies reporting pnl baseline only to reporting realized pnl and trade history", () => {
  const before = receiptRecord("2026-04-19T23:59:00.000Z", { txHash: "0xbefore" });
  const after = receiptRecord("2026-04-20T00:01:00.000Z", { txHash: "0xafter" });

  const status = buildDashboardStatus(
    {
      routesRecords: [],
      quotes: [],
      failures: [],
      gasSnapshots: [],
      gasFailures: [],
      priceSnapshots: [],
      updateSnapshots: [],
      updateAlerts: [],
      scoreSnapshot: null,
      dexQuotes: [],
      dexFailures: [],
      bitcoinFeeSnapshots: [],
      gatewayGasEstimates: [],
      gatewayGasEstimateFailures: [],
      estimatorWalletReadiness: [],
      estimatorWalletReadinessFailures: [],
      shadowObservations: [],
      receiptReconciliations: [before, after],
      executionEvents: [
        {
          observedAt: "2026-04-19T23:59:30.000Z",
          status: "confirmed",
          eventType: "execution",
          chain: "base",
          txHash: "0xbefore",
        },
        {
          observedAt: "2026-04-20T00:01:30.000Z",
          status: "confirmed",
          eventType: "execution",
          chain: "base",
          txHash: "0xafter",
        },
      ],
      reportingPnlBaseline: {
        anchoredAt: "2026-04-20T00:00:00.000Z",
        anchoredAtMs: new Date("2026-04-20T00:00:00.000Z").getTime(),
        reason: "operator_reset_now",
      },
    },
    { now: "2026-04-20T00:05:00.000Z" },
  );

  assert.equal(status.pnl.reportingBaseline.active, true);
  assert.equal(status.pnl.reportingBaseline.anchoredAt, "2026-04-20T00:00:00.000Z");
  assert.equal(status.pnl.realized.tradeCount, 1);
  assert.equal(status.tradeHistory.count, 1);
  assert.equal(status.tradeHistory.items[0].txHash, "0xafter");
});

test("report receipt ledger honors reporting pnl baseline unless all-time is requested", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-reporting-ledger-"));
  await mkdir(dataDir, { recursive: true });
  const records = [
    receiptRecord("2026-04-19T23:59:00.000Z", { txHash: "0xbefore" }),
    receiptRecord("2026-04-20T00:01:00.000Z", { txHash: "0xafter" }),
  ];
  await writeFile(
    join(dataDir, "receipt-reconciliations.jsonl"),
    `${records.map((item) => JSON.stringify(item)).join("\n")}\n`,
    "utf8",
  );
  await setReportingPnlBaseline({
    dataDir,
    anchoredAt: "2026-04-20T00:00:00.000Z",
    reason: "operator_reset_now",
  });

  const scoped = spawnSync(process.execPath, [join(ROOT, "src/cli/report-receipt-ledger.mjs"), "--json"], {
    cwd: ROOT,
    env: { ...process.env, BOB_CLAW_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  assert.equal(scoped.status, 0, scoped.stderr);
  const scopedJson = JSON.parse(scoped.stdout);
  assert.equal(scopedJson.summary.recordCount, 1);
  assert.equal(scopedJson.reportingPnlBaseline.active, true);
  assert.equal(scopedJson.reportingPnlBaseline.applied, true);

  const allTime = spawnSync(
    process.execPath,
    [join(ROOT, "src/cli/report-receipt-ledger.mjs"), "--json", "--all-time"],
    {
      cwd: ROOT,
      env: { ...process.env, BOB_CLAW_DATA_DIR: dataDir },
      encoding: "utf8",
    },
  );
  assert.equal(allTime.status, 0, allTime.stderr);
  const allTimeJson = JSON.parse(allTime.stdout);
  assert.equal(allTimeJson.summary.recordCount, 2);
  assert.equal(allTimeJson.reportingPnlBaseline.active, true);
  assert.equal(allTimeJson.reportingPnlBaseline.applied, false);
});

test("reporting pnl baseline cli can set and clear baseline", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-reporting-cli-"));

  const setResult = spawnSync(
    process.execPath,
    [
      join(ROOT, "src/cli/reporting-pnl-baseline.mjs"),
      "--set",
      "--at=2026-04-20T00:00:00.000Z",
      "--reason=operator_reset_now",
      "--json",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, BOB_CLAW_DATA_DIR: dataDir },
      encoding: "utf8",
    },
  );
  assert.equal(setResult.status, 0, setResult.stderr);
  assert.equal(JSON.parse(setResult.stdout).anchoredAt, "2026-04-20T00:00:00.000Z");

  const clearResult = spawnSync(
    process.execPath,
    [join(ROOT, "src/cli/reporting-pnl-baseline.mjs"), "--clear", "--json"],
    {
      cwd: ROOT,
      env: { ...process.env, BOB_CLAW_DATA_DIR: dataDir },
      encoding: "utf8",
    },
  );
  assert.equal(clearResult.status, 0, clearResult.stderr);
  assert.equal(JSON.parse(clearResult.stdout).cleared, true);
});
