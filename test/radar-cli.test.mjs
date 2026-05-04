import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readRadarJsonl as readJsonl } from "../src/strategy/radar/jsonl.mjs";

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
  assert.match(report.stdout, /candidates=0/);
  assert.match(report.stdout, /blocked=0/);

  const board = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(board.summary.observedCount, 1);
  assert.equal(JSON.stringify(board).includes("rawEventPayloadHash"), false);
});

test("radar board CLI supports json flag before inline write path", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-cli-"));
  const inputPath = join(dataDir, "observation.json");
  await writeFile(inputPath, JSON.stringify({ ...observation, obsId: "obs_cli_json_write" }));

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

  const reportPath = join(dataDir, "onchain-opportunity-radar-json.json");
  const report = spawnSync(process.execPath, [
    "src/cli/report-radar-board.mjs",
    "--data-dir",
    dataDir,
    "--json",
    `--write=${reportPath}`,
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(report.status, 0, report.stderr);
  const board = JSON.parse(await readFile(reportPath, "utf8"));
  const stdoutBoard = JSON.parse(report.stdout);
  assert.equal(board.summary.observedCount, 1);
  assert.equal(stdoutBoard.summary.observedCount, 1);
});

test("radar board CLI defaults bare write flag to the data-dir board path", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-cli-"));
  const inputPath = join(dataDir, "observation.json");
  await writeFile(inputPath, JSON.stringify({ ...observation, obsId: "obs_cli_bare_write" }));

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

  const report = spawnSync(process.execPath, [
    "src/cli/report-radar-board.mjs",
    "--data-dir",
    dataDir,
    "--write",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /wrote=/);

  const board = JSON.parse(await readFile(join(dataDir, "radar-board.json"), "utf8"));
  assert.equal(board.summary.observedCount, 1);
});

test("radar cap review CLI reports committed-diff cap raise candidates", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-cap-review-cli-"));
  const radarDir = join(dataDir, "radar");
  await mkdir(radarDir, { recursive: true });
  await writeFile(join(radarDir, "realization-records.jsonl"), [
    JSON.stringify({
      runId: "run_a",
      candidateId: "candidate_a",
      strategyId: "wrapped-btc-loop-base-moonwell",
      familyKey: "wrapped_btc_direct_lending",
      campaignWindowId: "window_a",
      exitReceipts: [{ txHash: "0xexitA" }],
      lifecycle: { strategyRealized: true, paybackDelivered: false },
      netRealizedPnlUsd: 2.5,
      netRealizedPnlSats: "-500",
      settledAt: "2026-05-01T00:00:00.000Z",
    }),
    JSON.stringify({
      runId: "run_b",
      candidateId: "candidate_b",
      strategyId: "wrapped-btc-loop-base-moonwell",
      familyKey: "wrapped_btc_direct_lending",
      campaignWindowId: "window_b",
      exitReceipts: [{ txHash: "0xexitB" }],
      lifecycle: { strategyRealized: true, paybackDelivered: false },
      netRealizedPnlUsd: 1.25,
      netRealizedPnlSats: "-250",
      settledAt: "2026-05-01T01:00:00.000Z",
    }),
  ].join("\n") + "\n");

  const reportPath = join(dataDir, "radar-cap-review.json");
  const report = spawnSync(process.execPath, [
    "src/cli/report-radar-cap-review.mjs",
    "--data-dir",
    dataDir,
    "--write",
    reportPath,
    "--now",
    "2026-05-01T12:00:00.000Z",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /capRaiseCandidates=1/);
  assert.match(report.stdout, /capRaiseCandidateIntents=1/);

  const review = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(review.candidates[0].eligible, true);
  assert.equal(review.candidates[0].suggestedNextTinyLivePerTxUsd, 50);
  assert.equal(review.candidates[0].requiresCommittedDiff, true);

  const candidateIntents = await readJsonl(dataDir, "cap-raise-candidates");
  assert.equal(candidateIntents.length, 1);
  assert.equal(candidateIntents[0].intentType, "capRaiseCandidate");
  assert.equal(candidateIntents[0].strategyId, "wrapped-btc-loop-base-moonwell");
});

test("radar promote CLI writes ready tiny live canary intents without signing", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-promote-cli-"));
  const radarDir = join(dataDir, "radar");
  await mkdir(radarDir, { recursive: true });
  await writeFile(join(radarDir, "portable-packets.jsonl"), `${JSON.stringify({ packetId: "packet_cli" })}\n`);
  await writeFile(join(radarDir, "executable-candidates.jsonl"), `${JSON.stringify({
    candidateId: "candidate_cli",
    packetId: "packet_cli",
    familyKey: "wrapped_btc_direct_lending",
    executionPath: "base_native_evm",
    chain: "base",
    protocol: "moonwell",
    opportunityId: "opp_cli",
    displayedAprPct: 2000,
    rewardTokenType: "stable",
    rewardToken: "USDC",
    proposedSizeBtc: "0.0001",
    committedCapBtc: "0.0002",
    protocolAuditStatus: "audited_by_known",
    sanctionsFlag: "clean",
    bridgeRouteSanctionsCheck: "clean",
    killSwitchState: "running",
    slippageSimAtSize: 20,
    mevExposureScore: 10,
    campaignEndsAt: "2026-05-04T00:00:00.000Z",
  })}\n`);

  const queuePath = join(dataDir, "radar-canary-queue.json");
  const promote = spawnSync(process.execPath, [
    "src/cli/radar-promote.mjs",
    "--data-dir",
    dataDir,
    "--execute",
    "--write",
    queuePath,
    "--now",
    "2026-05-01T00:00:00.000Z",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(promote.status, 0, promote.stderr);
  assert.match(promote.stdout, /ready=1/);
  assert.match(promote.stdout, /signed=false/);

  const queue = JSON.parse(await readFile(queuePath, "utf8"));
  assert.equal(queue.intents.length, 1);
  assert.equal(queue.intents[0].intentType, "tiny_live_canary");
  assert.equal(queue.intents[0].amountUsd, 25);
  assert.equal(queue.intents[0].metadata.radarCandidateId, "candidate_cli");
});

test("radar promote CLI evaluates only the latest candidate version", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-promote-cli-"));
  const radarDir = join(dataDir, "radar");
  await mkdir(radarDir, { recursive: true });
  await writeFile(join(radarDir, "portable-packets.jsonl"), `${JSON.stringify({ packetId: "packet_cli" })}\n`);
  const baseCandidate = {
    candidateId: "candidate_cli",
    packetId: "packet_cli",
    familyKey: "wrapped_btc_direct_lending",
    executionPath: "base_native_evm",
    chain: "base",
    protocol: "moonwell",
    opportunityId: "opp_cli",
    displayedAprPct: 2000,
    rewardTokenType: "stable",
    rewardToken: "USDC",
    proposedSizeBtc: "0.0001",
    committedCapBtc: "0.0002",
    protocolAuditStatus: "audited_by_known",
    sanctionsFlag: "clean",
    bridgeRouteSanctionsCheck: "clean",
    killSwitchState: "running",
    slippageSimAtSize: 20,
    mevExposureScore: 10,
    campaignEndsAt: "2026-05-04T00:00:00.000Z",
  };
  await writeFile(join(radarDir, "executable-candidates.jsonl"), [
    JSON.stringify({
      ...baseCandidate,
      observedAt: "2026-05-01T00:00:00.000Z",
      gateStatus: "executable",
      blockers: [],
    }),
    JSON.stringify({
      ...baseCandidate,
      observedAt: "2026-05-01T00:05:00.000Z",
      gateStatus: "blocked",
      blockers: ["same_chain_unprofitable:need_$64_on_base"],
    }),
  ].join("\n") + "\n");

  const queuePath = join(dataDir, "radar-canary-queue.json");
  const promote = spawnSync(process.execPath, [
    "src/cli/radar-promote.mjs",
    "--data-dir",
    dataDir,
    "--execute",
    "--write",
    queuePath,
    "--now",
    "2026-05-01T00:00:00.000Z",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(promote.status, 0, promote.stderr);
  assert.match(promote.stdout, /ready=0/);

  const queue = JSON.parse(await readFile(queuePath, "utf8"));
  assert.equal(queue.intents.length, 0);
  assert.equal(queue.blocked.length, 1);
  assert.ok(queue.blocked[0].blockers.includes("same_chain_unprofitable:need_$64_on_base"));
});

test("radar promote CLI preserves blocked candidate ids after ready candidates", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-promote-cli-"));
  const radarDir = join(dataDir, "radar");
  await mkdir(radarDir, { recursive: true });
  await writeFile(join(radarDir, "portable-packets.jsonl"), `${JSON.stringify({ packetId: "packet_cli" })}\n`);
  const baseCandidate = {
    packetId: "packet_cli",
    familyKey: "wrapped_btc_direct_lending",
    executionPath: "base_native_evm",
    chain: "base",
    protocol: "moonwell",
    displayedAprPct: 2000,
    rewardTokenType: "stable",
    rewardToken: "USDC",
    proposedSizeBtc: "0.0001",
    committedCapBtc: "0.0002",
    protocolAuditStatus: "audited_by_known",
    sanctionsFlag: "clean",
    bridgeRouteSanctionsCheck: "clean",
    killSwitchState: "running",
    slippageSimAtSize: 20,
    mevExposureScore: 10,
    campaignEndsAt: "2026-05-04T00:00:00.000Z",
  };
  await writeFile(join(radarDir, "executable-candidates.jsonl"), [
    JSON.stringify({
      ...baseCandidate,
      candidateId: "candidate_ready",
      opportunityId: "opp_ready",
      gateStatus: "executable",
      blockers: [],
    }),
    JSON.stringify({
      ...baseCandidate,
      candidateId: "candidate_blocked",
      opportunityId: "opp_blocked",
      gateStatus: "blocked",
      blockers: ["same_chain_unprofitable:need_$64_on_base"],
    }),
  ].join("\n") + "\n");

  const queuePath = join(dataDir, "radar-canary-queue.json");
  const promote = spawnSync(process.execPath, [
    "src/cli/radar-promote.mjs",
    "--data-dir",
    dataDir,
    "--write",
    queuePath,
    "--now",
    "2026-05-01T00:00:00.000Z",
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });

  assert.equal(promote.status, 0, promote.stderr);
  const queue = JSON.parse(await readFile(queuePath, "utf8"));
  assert.equal(queue.intents.length, 1);
  assert.equal(queue.blocked[0].candidateId, "candidate_blocked");
});
