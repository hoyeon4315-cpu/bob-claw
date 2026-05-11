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

test("unified NAV sums EVM aggregate + BTC L1 when sources agree", async () => {
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
  const unified = await loadUnifiedOperatingCapital({ dataDir: dir });
  assert.equal(unified.halt, false);
  assert.equal(unified.btcL1Usd, 500.83);
  assert.equal(unified.evmAggregateUsd, 468.95);
  assert.equal(unified.unifiedNavUsd, 969.78);
  assert.equal(unified.breakdown.bobL2WbtcUsd.valueUsd, 34.65);
  assert.equal(operatingCapitalUsdFromUnified(unified), 969.78);
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
  const unified = await loadUnifiedOperatingCapital({ dataDir: dir, discrepancyThresholdPct: 10 });
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
  const unified = await loadUnifiedOperatingCapital({ dataDir: dir });
  assert.equal(unified.halt, true);
  assert.ok(unified.flags.includes("source_missing"));
  assert.ok(unified.missingSources.includes("btcL1Usd"));
});

test("unified NAV restricts closed-protocol-marks to closed audit-pair strategies", async () => {
  const dir = await makeFixture({
    treasuryRow: { summary: { estimatedWalletUsd: 500 }, tokens: [] },
    autopilotSnapshot: { summary: { capitalManager: { estimatedAssetValueUsd: 500 } } },
    btcRow: { totalUsd: 500 },
    auditPairs: [
      { strategyId: "closed-strat", status: "closed" },
      { strategyId: "open-strat", status: "open" },
    ],
    positionMarks: [
      { positionId: "p1", event: "mark", strategyId: "closed-strat", valueUsd: 25 },
      { positionId: "p2", event: "mark", strategyId: "open-strat", valueUsd: 75 },
    ],
  });
  const unified = await loadUnifiedOperatingCapital({ dataDir: dir });
  assert.equal(unified.breakdown.closedProtocolMarksUsd.positionCount, 1);
  assert.equal(unified.breakdown.closedProtocolMarksUsd.valueUsd, 25);
});
