import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  buildObservationRecord,
  ingestOpportunityObservation,
  readRadarJsonl,
} from "../src/strategy/radar/observation-ingest.mjs";

const validObservationInput = Object.freeze({
  obsId: "obs_ingest_001",
  observedAt: "2026-04-30T12:30:00.000Z",
  sourceList: ["raw_evm_rpc"],
  sourceFreshness: Object.freeze({
    raw_evm_rpc: Object.freeze({ observedHead: "10", providerHead: "10", blockHash: "0xblock" }),
  }),
  walletClusterId: "cluster_ingest",
  clusterMethod: "custom_indexer",
  clusterConfidence: 0.9,
  chain: "base",
  protocolId: "moonwell",
  poolOrMarket: "base:0xmarket",
  sourceTxs: ["0xentry"],
  rawEventPayloadHash: "sha256:ingest",
  executionPath: "gateway_destination",
  discoveryClaimType: "behavior_observed",
});

test("buildObservationRecord validates and freezes an observation", () => {
  const result = buildObservationRecord(validObservationInput);

  assert.equal(result.ok, true);
  assert.equal(result.record.obsId, "obs_ingest_001");
  assert.equal(Object.isFrozen(result.record), true);
});

test("ingestOpportunityObservation appends valid observations only", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-radar-ingest-"));

  const first = await ingestOpportunityObservation({ dataDir, observation: validObservationInput });
  const second = await ingestOpportunityObservation({
    dataDir,
    observation: { ...validObservationInput, obsId: "obs_ingest_002" },
  });
  const invalid = await ingestOpportunityObservation({
    dataDir,
    observation: { ...validObservationInput, obsId: undefined },
  });

  assert.equal(first.wrote, true);
  assert.equal(second.wrote, true);
  assert.equal(invalid.wrote, false);
  assert.deepEqual(invalid.blockers, ["missing_obsId"]);

  const records = await readRadarJsonl(dataDir, "opportunity-observations");
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.obsId), ["obs_ingest_001", "obs_ingest_002"]);

  const raw = await readFile(join(dataDir, "radar", "opportunity-observations.jsonl"), "utf8");
  assert.equal(raw.trim().split("\n").length, 2);
});
