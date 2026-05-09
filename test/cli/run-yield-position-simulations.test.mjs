import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildYieldPositionSimulationRecords,
  runYieldPositionSimulationsCli,
} from "../../src/cli/run-yield-position-simulations.mjs";

test("yield position sims compound APR over the holding period before gas", () => {
  const records = buildYieldPositionSimulationRecords({
    opportunities: [
      {
        queueId: "q1",
        opportunityId: "o1",
        mappedStrategyId: "aerodrome-cl-base",
        chain: "base",
        family: "yield_position",
        aprPct: 10,
        notionalUsd: 1000,
        expectedHoldDays: 30,
        estimatedGasCostUsd: 5,
      },
    ],
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].status, "simulated_ok");
  assert.equal(records[0].evidenceClass, "yield_shadow");
  assert.equal(records[0].netEdgeUsd > 0, true);
  assert.equal(records[0].oneDayGrossYieldUsd < records[0].totalCostsUsd, true);
  assert.equal(records[0].holdingPeriodDays, 30);
  assert.equal(records[0].edgeBpsPerDay > 0, true);
});

test("yield position sims apply reward haircuts before reporting edge", () => {
  const records = buildYieldPositionSimulationRecords({
    opportunities: [
      {
        queueId: "q2",
        opportunityId: "o2",
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        chain: "base",
        family: "yield_position",
        aprPct: 100,
        rewardToken: "RWD",
        rewardTokenType: "defaultRewardToken",
        notionalUsd: 100,
        expectedHoldDays: 365,
        estimatedGasCostUsd: 0.1,
      },
    ],
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(records[0].status, "simulated_ok");
  assert.equal(records[0].rewardHaircutPct, 0.5);
  assert.equal(records[0].haircutYieldUsd, 50);
  assert.equal(records[0].netEdgeUsd, 49.9);
});

test("yield position sims recognizes array reward token metadata", () => {
  const records = buildYieldPositionSimulationRecords({
    opportunities: [
      {
        queueId: "q2a",
        opportunityId: "o2a",
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        chain: "base",
        family: "yield_position",
        aprPct: 20,
        rewardTokenSymbols: ["RWD"],
        rewardTokenTypes: ["TOKEN"],
        notionalUsd: 100,
        expectedHoldDays: 365,
        estimatedGasCostUsd: 0,
      },
    ],
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(records[0].rewardHaircutPct, 0.5);
  assert.equal(records[0].haircutYieldUsd, 10);
});


test("yield position sims haircuts non-native APR even when reward token metadata is missing", () => {
  const records = buildYieldPositionSimulationRecords({
    opportunities: [
      {
        queueId: "q2b",
        opportunityId: "o2b",
        mappedStrategyId: "gateway_native_asset_conversion_sleeve",
        chain: "base",
        family: "yield_position",
        aprPct: 10,
        nativeAprPct: 4,
        notionalUsd: 1000,
        expectedHoldDays: 365,
        estimatedGasCostUsd: 0,
      },
    ],
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(records[0].rewardHaircutPct, 0.5);
  assert.equal(records[0].haircutYieldUsd, 70);
});


test("yield position sims fail deterministically when APR is missing", () => {
  const records = buildYieldPositionSimulationRecords({
    opportunities: [
      {
        queueId: "q3",
        opportunityId: "o3",
        mappedStrategyId: "recursive_wrapped_btc_lending_loop",
        chain: "base",
        family: "yield_position",
        notionalUsd: 100,
        expectedHoldDays: 7,
        estimatedGasCostUsd: 0.1,
      },
    ],
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(records[0].status, "simulation_failed");
  assert.equal(records[0].skipReason, "apr_missing");
});

test("yield position sims CLI writes jsonl output and shadow edge records", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-yield-sims-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "merkl-canary-queue.json"), JSON.stringify({
    schemaVersion: 1,
    queue: [
      {
        queueId: "q4",
        opportunityId: "o4",
        mappedStrategyId: "aerodrome-cl-base",
        chain: "base",
        family: "yield_position",
        aprPct: 20,
        notionalUsd: 1000,
        expectedHoldDays: 30,
        estimatedGasCostUsd: 1,
      },
    ],
  }));
  await writeFile(join(dataDir, "merkl-opportunities-report.json"), JSON.stringify({
    schemaVersion: 1,
    opportunities: [
      {
        opportunityId: "o4",
        mappedStrategyId: "aerodrome-cl-base",
        chain: "base",
        aprPct: 999,
        notionalUsd: 1000,
        expectedHoldDays: 30,
        estimatedGasCostUsd: 1,
      },
      {
        opportunityId: "o5",
        mappedStrategyId: "recursive_stablecoin_lending_loop",
        chain: "base",
        family: "yield_position",
        aprPct: 12,
        nativeAprPct: 6,
        notionalUsd: 1000,
        expectedHoldDays: 30,
        estimatedGasCostUsd: 1,
      },
    ],
  }));

  const result = await runYieldPositionSimulationsCli(["--write-shadow-edge", "--json"], {
    cwd: root,
    dataDir,
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.summary.successCount, 2);
  assert.equal(payload.summary.sourceCounts.merklCanaryQueue, 1);
  assert.equal(payload.summary.sourceCounts.merklOpportunitiesReport, 2);
  const jsonl = await readFile(join(dataDir, "yield-position-simulation-runs.jsonl"), "utf8");
  assert.match(jsonl, /"evidenceClass":"yield_shadow"/);
  const shadow = JSON.parse(await readFile(join(dataDir, "destination-economics-shadow-edge.json"), "utf8"));
  assert.equal(shadow.records.every((record) => record.evidenceClass === "yield_shadow"), true);
  assert.equal(shadow.records.length, 2);
  assert.equal(shadow.records.find((record) => record.strategyId === "recursive_stablecoin_lending_loop").sampleCount, 1);

  await runYieldPositionSimulationsCli(["--write-shadow-edge", "--json"], {
    cwd: root,
    dataDir,
    now: "2026-05-09T00:01:00.000Z",
  });
  const rerunShadow = JSON.parse(await readFile(join(dataDir, "destination-economics-shadow-edge.json"), "utf8"));
  assert.equal(rerunShadow.records.find((record) => record.strategyId === "recursive_stablecoin_lending_loop").sampleCount, 1);
});
