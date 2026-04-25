import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTinyLiveCanaryIntent } from "../src/executor/policy/tiny-live-canary-intent.mjs";

test("buildTinyLiveCanaryIntent produces correct shape", () => {
  const now = "2026-04-22T12:00:00.000Z";
  const intent = buildTinyLiveCanaryIntent({
    strategyId: "wrapped-btc-loop-base-moonwell",
    chain: "base",
    amountUsd: 25,
    microCanaryStatus: "minimal_live_proof_exists",
    metadata: { slippagePct: 0.5 },
    now,
  });

  assert.equal(intent.schemaVersion, 1);
  assert.equal(intent.intentType, "tiny_live_canary");
  assert.equal(intent.mode, "tiny_live");
  assert.equal(intent.executionReason, "tiny_live_canary_execution");
  assert.equal(intent.strategyId, "wrapped-btc-loop-base-moonwell");
  assert.equal(intent.chain, "base");
  assert.equal(intent.amountUsd, 25);
  assert.equal(intent.family, "evm");
  assert.equal(intent.metadata.microCanaryStatus, "minimal_live_proof_exists");
  assert.equal(intent.metadata.slippagePct, 0.5);
  assert.ok(intent.intentId.includes("tiny-live-canary"));
});

test("buildTinyLiveCanaryIntent throws without strategyId", () => {
  assert.throws(() => buildTinyLiveCanaryIntent({ chain: "base" }), /strategyId is required/);
});

test("buildTinyLiveCanaryIntent throws without chain", () => {
  assert.throws(() => buildTinyLiveCanaryIntent({ strategyId: "s" }), /chain is required/);
});
