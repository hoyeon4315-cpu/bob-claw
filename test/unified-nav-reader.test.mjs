import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadUnifiedOperatingCapital, operatingCapitalUsdFromUnified } from "../src/lib/unified-nav-reader.mjs";

async function makeFixture({
  treasuryRow,
  autopilotSnapshot,
  btcRow,
  auditPairs = [],
  positionMarks = [],
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "unified-nav-"));
  if (treasuryRow) {
    await writeFile(join(dir, "treasury-inventory.jsonl"), `${JSON.stringify(treasuryRow)}\n`);
  }
  if (autopilotSnapshot) {
    await writeFile(join(dir, "all-chain-autopilot-latest.json"), `${JSON.stringify(autopilotSnapshot)}\n`);
  }
  if (btcRow) {
    await writeFile(join(dir, "btc-nav-history.jsonl"), `${JSON.stringify(btcRow, null, 2)}\n`);
  }
  if (auditPairs.length > 0) {
    await writeFile(
      join(dir, "capital-audit-pairs.jsonl"),
      auditPairs.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }
  if (positionMarks.length > 0) {
    await writeFile(
      join(dir, "protocol-position-marks.jsonl"),
      positionMarks.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }
  return dir;
}

test("unified NAV breakdown values resolve from fixture when stale BTC fallback explicitly allowed (still halts policy)", async () => {
  const dir = await makeFixture({
    treasuryRow: {
      observedAt: "2026-05-11T00:00:00Z",
      summary: { estimatedWalletUsd: 468.95 },
      tokens: [{ chain: "bob", estimatedUsd: 34.65 }],
    },
    autopilotSnapshot: {
      observedAt: "2026-05-11T00:00:00Z",
      summary: { capitalManager: { estimatedAssetValueUsd: 449.75 } },
    },
    btcRow: { observedAt: "2026-05-10T07:00:00Z", totalUsd: 500.83 },
  });
  const unified = await loadUnifiedOperatingCapital({
    dataDir: dir,
    liveBtc: false, liveEvm: false, allowStaleEvmFallback: true,
    allowStaleBtcFallback: true,
  });
  assert.equal(unified.btcL1Usd, 500.83);
  assert.equal(unified.evmAggregateUsd, 468.95);
  assert.equal(unified.unifiedNavUsd, 969.78);
  assert.equal(unified.breakdown.bobL2WbtcUsd.valueUsd, 34.65);
  assert.equal(unified.halt, true, "stale BTC fallback must halt policy even when sum resolves");
  assert.ok(unified.flags.includes("btc_l1_stale_fallback"));
  assert.equal(operatingCapitalUsdFromUnified(unified), null);
});

test("unified NAV halts when EVM sources disagree by more than threshold", async () => {
  const dir = await makeFixture({
    treasuryRow: {
      observedAt: "2026-05-11T00:00:00Z",
      summary: { estimatedWalletUsd: 800 },
      tokens: [],
    },
    autopilotSnapshot: {
      summary: { capitalManager: { estimatedAssetValueUsd: 400 } },
    },
    btcRow: { totalUsd: 500 },
  });
  const unified = await loadUnifiedOperatingCapital({
    dataDir: dir,
    discrepancyThresholdPct: 10,
    liveBtc: false, liveEvm: false, allowStaleEvmFallback: true,
    allowStaleBtcFallback: true,
  });
  assert.equal(unified.halt, true);
  assert.ok(unified.flags.includes("evm_source_disagreement"));
  assert.equal(operatingCapitalUsdFromUnified(unified), null);
});

test("unified NAV halts when a required source is missing", async () => {
  const dir = await makeFixture({
    treasuryRow: {
      observedAt: "2026-05-11T00:00:00Z",
      summary: { estimatedWalletUsd: 500 },
      tokens: [],
    },
    autopilotSnapshot: {
      summary: { capitalManager: { estimatedAssetValueUsd: 500 } },
    },
    // no BTC L1 row
  });
  const unified = await loadUnifiedOperatingCapital({ dataDir: dir, liveBtc: false, liveEvm: false, allowStaleEvmFallback: true });
  assert.equal(unified.halt, true);
  assert.ok(unified.flags.includes("source_missing"));
  assert.ok(unified.missingSources.includes("btcL1Usd"));
});

test("protocol-position-marks adds all open marks to NAV; closed-pair subset reported for audit", async () => {
  const dir = await makeFixture({
    treasuryRow: { summary: { estimatedWalletUsd: 500 }, tokens: [] },
    autopilotSnapshot: { summary: { capitalManager: { estimatedAssetValueUsd: 500 } } },
    btcRow: { totalUsd: 500 },
    auditPairs: [
      { strategyId: "closed-strat", status: "closed" },
      { strategyId: "open-strat", status: "open" },
    ],
    positionMarks: [
      { positionId: "p1", event: "position_marked", strategyId: "closed-strat", valueUsd: 25 },
      { positionId: "p2", event: "position_marked", strategyId: "open-strat", valueUsd: 75 },
      { positionId: "p3", event: "position_mark_failed", strategyId: "open-strat", valueUsd: null },
    ],
  });
  const unified = await loadUnifiedOperatingCapital({
    dataDir: dir,
    liveBtc: false, liveEvm: false, allowStaleEvmFallback: true,
    allowStaleBtcFallback: true,
  });
  const slice = unified.breakdown.protocolPositionMarksUsd;
  assert.equal(slice.positionCount, 2);
  assert.equal(slice.valueUsd, 100);
  assert.equal(slice.closedAuditPairSubsetUsd, 25);
  assert.equal(slice.closedAuditPairSubsetCount, 1);
  assert.equal(slice.staleFailedAdapterCount, 1);
  assert.equal(unified.protocolMarksUsd, 100);
});

test("protocol marks add into unifiedNavUsd alongside EVM and BTC", async () => {
  const dir = await makeFixture({
    treasuryRow: { summary: { estimatedWalletUsd: 400 }, tokens: [] },
    autopilotSnapshot: { summary: { capitalManager: { estimatedAssetValueUsd: 400 } } },
    btcRow: { totalUsd: 200 },
    positionMarks: [
      { positionId: "p1", event: "position_marked", strategyId: "s1", valueUsd: 65.24 },
      { positionId: "p2", event: "position_marked", strategyId: "s1", valueUsd: 45.78 },
    ],
  });
  const unified = await loadUnifiedOperatingCapital({
    dataDir: dir,
    liveBtc: false, liveEvm: false, allowStaleEvmFallback: true,
    allowStaleBtcFallback: true,
  });
  assert.equal(unified.evmAggregateUsd, 400);
  assert.equal(unified.btcL1Usd, 200);
  assert.equal(unified.protocolMarksUsd, 111.02);
  assert.equal(Math.round(unified.unifiedNavUsd * 100) / 100, 711.02);
});

test("stale jsonl fallback is refused by default and forces halt", async () => {
  const dir = await makeFixture({
    treasuryRow: {
      observedAt: "2026-05-11T00:00:00Z",
      summary: { estimatedWalletUsd: 500 },
      tokens: [],
    },
    autopilotSnapshot: { summary: { capitalManager: { estimatedAssetValueUsd: 500 } } },
    btcRow: { observedAt: "2026-05-10T00:00:00Z", totalUsd: 999.99 },
  });
  const unified = await loadUnifiedOperatingCapital({ dataDir: dir, liveBtc: false, liveEvm: false, allowStaleEvmFallback: true });
  assert.equal(unified.btcL1Usd, null);
  assert.ok(unified.flags.includes("source_missing"));
  assert.equal(unified.halt, true);
});

test("stale jsonl fallback flagged as halt-eligible even when value present", async () => {
  const dir = await makeFixture({
    treasuryRow: {
      observedAt: "2026-05-11T00:00:00Z",
      summary: { estimatedWalletUsd: 500 },
      tokens: [],
    },
    autopilotSnapshot: { summary: { capitalManager: { estimatedAssetValueUsd: 500 } } },
    btcRow: { observedAt: "2026-05-10T00:00:00Z", totalUsd: 999.99 },
  });
  const unified = await loadUnifiedOperatingCapital({
    dataDir: dir,
    liveBtc: false, liveEvm: false, allowStaleEvmFallback: true,
    allowStaleBtcFallback: true,
  });
  assert.equal(unified.breakdown.btcL1Usd.source, "btc-nav-history.jsonl");
  assert.equal(unified.breakdown.btcL1Usd.valueUsd, 999.99);
  assert.equal(unified.breakdown.btcL1Usd.fallback, true);
  assert.ok(unified.flags.includes("btc_l1_stale_fallback"));
  assert.equal(unified.halt, true);
});
