import assert from "node:assert/strict";
import { test } from "node:test";

import { buildIdleInventoryConsolidationPlan } from "../src/executor/treasury/idle-inventory-trigger.mjs";
import { computeIdleDustThreshold } from "../src/config/idle-dust-threshold.mjs";

test("idle inventory trigger plans only idle BTC-family wallet dust", () => {
  const walletSnapshot = {
    items: [
      { sym: "yousd", name: "yoUSD", chain: "base", amount: 70, usd: 70, family: "protocol", protocolId: "yo" },
      { sym: "rlusd", name: "RLUSD", chain: "ethereum", amount: 25, usd: 25, family: "token" },
      { sym: "cbbtc", name: "cbBTC", chain: "base", amount: 0.0002, usd: 20, family: "token" },
      { sym: "eth", name: "ETH", chain: "ethereum", amount: 0.01, usd: 20, family: "native" },
      ...["bsc", "avalanche", "unichain", "sonic", "sei", "bera", "soneium", "bob"].map((chain) => ({
        sym: "wbtc",
        name: "wBTC.OFT",
        chain,
        amount: 0.0001,
        usd: 7,
        family: "token",
        firstSeenAt: "2026-05-01T00:00:00.000Z",
      })),
    ],
  };

  const plan = buildIdleInventoryConsolidationPlan({
    walletSnapshot,
    threshold: {
      dstChain: "base",
      minIdleUsd: 5,
      minIdleAgeMs: 72 * 60 * 60 * 1000,
      maxAggregateIdleUsd: 50,
    },
    now: "2026-05-08T00:00:00.000Z",
  });

  assert.equal(plan.status, "plan_ready");
  assert.equal(plan.candidates.length, 8);
  assert.equal(plan.aggregateUsd, 50);
  assert.equal(plan.candidates.some((item) => /yo|rlusd|cbbtc|eth/i.test(item.srcSym)), false);
  assert.deepEqual(plan.candidates.map((item) => item.srcChain).sort(), [
    "avalanche",
    "bera",
    "bob",
    "bsc",
    "sei",
    "soneium",
    "sonic",
    "unichain",
  ]);
});

test("idle inventory trigger emits no plan while kill-switch is active", () => {
  const walletSnapshot = {
    items: [
      {
        sym: "wbtc",
        name: "wBTC.OFT",
        chain: "bsc",
        amount: 0.0001,
        usd: 7,
        family: "token",
        firstSeenAt: "2026-05-01T00:00:00.000Z",
      },
    ],
  };

  const plan = buildIdleInventoryConsolidationPlan({
    walletSnapshot,
    killSwitchActive: true,
    threshold: {
      dstChain: "base",
      minIdleUsd: 5,
      minIdleAgeMs: 72 * 60 * 60 * 1000,
      maxAggregateIdleUsd: 50,
    },
    now: "2026-05-08T00:00:00.000Z",
  });

  assert.equal(plan.status, "skipped_kill_switch_active");
  assert.equal(plan.aggregateUsd, 0);
  assert.deepEqual(plan.candidates, []);
});

test("idle dust threshold uses conservative p90 round-trip cost when enough recent samples exist", () => {
  const threshold = computeIdleDustThreshold({
    chain: "sonic",
    auditRecords: [1, 2, 3, 4].map((cost, index) => ({
      timestamp: `2026-05-0${index + 1}T00:00:00.000Z`,
      chain: "sonic",
      lifecycle: { stage: "confirmed" },
      realized: { actualKnownCostUsd: cost },
    })),
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(threshold.minIdleUsd, 8);
  assert.equal(threshold.minIdleAgeMs, 72 * 60 * 60 * 1000);
  assert.equal(threshold.evidenceSource, "signer_audit_p90_roundtrip_30d");
});

test("idle dust threshold keeps default when recent sample count is too small", () => {
  const threshold = computeIdleDustThreshold({
    chain: "sonic",
    auditRecords: [
      {
        timestamp: "2026-05-01T00:00:00.000Z",
        chain: "sonic",
        lifecycle: { stage: "confirmed" },
        realized: { actualKnownCostUsd: 10 },
      },
    ],
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(threshold.minIdleUsd, 5);
  assert.equal(threshold.evidenceSource, "default_insufficient_recent_samples");
});
