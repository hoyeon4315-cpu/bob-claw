import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadStrategyExecutionSurfaceInputs } from "../src/cli/report-strategy-execution-surfaces.mjs";

test("strategy execution surface CLI loads lightweight snapshots without full dashboard rebuild", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-surfaces-cli-"));
  const latestTreasury = {
    observedAt: "2026-05-07T00:01:00.000Z",
    tokens: [
      {
        chain: "base",
        token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        actual: "33053",
        actualDecimal: 0.00033053,
        estimatedUsd: 25.69,
        priceUsd: 77725,
        status: "below_target",
      },
    ],
  };
  await writeFile(
    join(dataDir, "dashboard-status.json"),
    `${JSON.stringify({
      generatedAt: "2026-05-07T00:00:00.000Z",
      overall: { liveTrading: "ALLOWED" },
      strategy: { strategyTracks: { tracks: [] } },
    })}\n`,
    "utf8",
  );
  await writeFile(join(dataDir, "gateway-scores.json"), `${JSON.stringify({ scores: [] })}\n`, "utf8");
  await writeFile(
    join(dataDir, "treasury-inventory.jsonl"),
    `${JSON.stringify({ observedAt: "old", tokens: [] })}\n${JSON.stringify(latestTreasury)}\n`,
    "utf8",
  );
  await writeFile(join(dataDir, "phase3-strategy-validation.json"), `${JSON.stringify({ validations: [] })}\n`, "utf8");
  await writeFile(
    join(dataDir, "wrapped-btc-lending-loop-slice.json"),
    `${JSON.stringify({ strategy: { id: "wrapped-btc-loop-base-moonwell" } })}\n`,
    "utf8",
  );
  await writeFile(
    join(dataDir, "merkl-canary-queue.json"),
    `${JSON.stringify({ summary: { queueCount: 0 }, queue: [] })}\n`,
    "utf8",
  );

  const inputs = await loadStrategyExecutionSurfaceInputs({
    dataDir,
    readSignerAuditLogImpl: async () => [],
    readTriangleArtifactsImpl: async () => ({}),
    loadLiveInventory: false,
  });

  assert.equal(inputs.dashboardStatus.overall.liveTrading, "ALLOWED");
  assert.deepEqual(inputs.state.scoreSnapshot, { scores: [] });
  assert.deepEqual(inputs.artifacts.treasuryInventoryRecords, [latestTreasury]);
  assert.equal(inputs.artifacts.signerAuditRecords.length, 0);
});
