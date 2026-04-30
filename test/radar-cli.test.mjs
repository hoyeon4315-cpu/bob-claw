import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const observation = Object.freeze({
  obsId: "obs_cli_001",
  observedAt: "2026-04-30T14:00:00.000Z",
  sourceList: ["raw_evm_rpc"],
  sourceFreshness: Object.freeze({ raw_evm_rpc: Object.freeze({ observedHead: "1", providerHead: "1" }) }),
  walletClusterId: "cluster_cli",
  clusterMethod: "custom_indexer",
  clusterConfidence: 0.8,
  chain: "base",
  protocolId: "moonwell",
  poolOrMarket: "base:0xmarket",
  sourceTxs: ["0xentry"],
  rawEventPayloadHash: "sha256:not-public",
  executionPath: "gateway_destination",
  discoveryClaimType: "behavior_observed",
});

test("radar CLI ingests observations and reports sanitized board", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-cli-"));
  const inputPath = join(dataDir, "observation.json");
  await writeFile(inputPath, JSON.stringify(observation));

  const ingest = spawnSync(process.execPath, [
    "src/cli/radar-ingest.mjs",
    "--data-dir",
    dataDir,
    "--input",
    inputPath,
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(ingest.status, 0, ingest.stderr);
  assert.match(ingest.stdout, /wrote=true/);

  const reportPath = join(dataDir, "onchain-opportunity-radar.json");
  const report = spawnSync(process.execPath, [
    "src/cli/report-radar-board.mjs",
    "--data-dir",
    dataDir,
    "--write",
    reportPath,
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /observed=1/);

  const board = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(board.summary.observedCount, 1);
  assert.equal(JSON.stringify(board).includes("rawEventPayloadHash"), false);
});
