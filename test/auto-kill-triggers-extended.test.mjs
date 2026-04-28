import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { buildAutoKillConfig } from "../src/config/auto-kill.mjs";
import {
  evaluateAutoKillTriggers,
  evaluateRelativePriceMove,
  evaluateClRangeHealth,
  evaluateProtocolIncident,
  evaluateCampaignDecay,
} from "../src/risk/auto-kill-triggers.mjs";

const NOW = new Date("2026-04-25T12:00:00.000Z");
const NOW_MS = NOW.getTime();

// --- evaluateRelativePriceMove ---

test("relativePriceMove returns null when move is within threshold", () => {
  const config = buildAutoKillConfig({
    relativePriceMove: { maxMovePct: 0.15, windowMs: 60_000 },
  });
  const priceSamples = [
    { timestamp: NOW_MS - 30_000, priceUsd: 100 },
    { timestamp: NOW_MS - 10_000, priceUsd: 105 },
  ];
  const result = evaluateRelativePriceMove({ priceSamples, config: config.relativePriceMove, nowMs: NOW_MS });
  assert.equal(result, null);
});

test("relativePriceMove trips when move exceeds threshold", () => {
  const config = buildAutoKillConfig({
    relativePriceMove: { maxMovePct: 0.15, windowMs: 60_000 },
  });
  const priceSamples = [
    { timestamp: NOW_MS - 40_000, priceUsd: 100 },
    { timestamp: NOW_MS - 20_000, priceUsd: 120 },
  ];
  const result = evaluateRelativePriceMove({ priceSamples, config: config.relativePriceMove, nowMs: NOW_MS });
  assert.ok(result);
  assert.equal(result.trigger, "relative_price_move");
  assert.equal(result.move, 0.20);
});

test("relativePriceMove returns null with insufficient samples", () => {
  const config = buildAutoKillConfig({
    relativePriceMove: { maxMovePct: 0.15, windowMs: 60_000 },
  });
  const result = evaluateRelativePriceMove({ priceSamples: [], config: config.relativePriceMove });
  assert.equal(result, null);
});

// --- evaluateClRangeHealth ---

test("clRangeHealth trips when timeInRange is below threshold", () => {
  const config = buildAutoKillConfig({
    clRangeHealth: { minTimeInRangePct24h: 0.80, maxIlExceedsFeesHours: 24 },
  });
  const result = evaluateClRangeHealth({
    clStatus: { timeInRangePct24h: 0.70, ilExceedsFeesHours: 0 },
    config: config.clRangeHealth,
  });
  assert.ok(result);
  assert.equal(result.trigger, "cl_range_health");
  assert.equal(result.reason, "time_in_range_low");
});

test("clRangeHealth trips when IL exceeds fees for too long", () => {
  const config = buildAutoKillConfig({
    clRangeHealth: { minTimeInRangePct24h: 0.80, maxIlExceedsFeesHours: 24 },
  });
  const result = evaluateClRangeHealth({
    clStatus: { timeInRangePct24h: 0.90, ilExceedsFeesHours: 30 },
    config: config.clRangeHealth,
  });
  assert.ok(result);
  assert.equal(result.trigger, "cl_range_health");
  assert.equal(result.reason, "il_exceeds_fees");
});

test("clRangeHealth returns null when both metrics are healthy", () => {
  const config = buildAutoKillConfig({
    clRangeHealth: { minTimeInRangePct24h: 0.80, maxIlExceedsFeesHours: 24 },
  });
  const result = evaluateClRangeHealth({
    clStatus: { timeInRangePct24h: 0.85, ilExceedsFeesHours: 10 },
    config: config.clRangeHealth,
  });
  assert.equal(result, null);
});

test("clRangeHealth returns null when inputs are missing", () => {
  const config = buildAutoKillConfig({
    clRangeHealth: { minTimeInRangePct24h: 0.80, maxIlExceedsFeesHours: 24 },
  });
  const result = evaluateClRangeHealth({ clStatus: {}, config: config.clRangeHealth });
  assert.equal(result, null);
});

// --- evaluateProtocolIncident ---

test("protocolIncident trips when an active protocol is in the incident list", () => {
  const config = buildAutoKillConfig({
    protocolIncident: { incidentList: ["bad-protocol", "exploited-vault"] },
  });
  const result = evaluateProtocolIncident({
    activeProtocols: ["good-protocol", "bad-protocol"],
    config: config.protocolIncident,
  });
  assert.ok(result);
  assert.equal(result.trigger, "protocol_incident");
  assert.equal(result.protocol, "bad-protocol");
});

test("protocolIncident returns null when no active protocol is incident-flagged", () => {
  const config = buildAutoKillConfig({
    protocolIncident: { incidentList: ["bad-protocol"] },
  });
  const result = evaluateProtocolIncident({
    activeProtocols: ["good-protocol", "another-good"],
    config: config.protocolIncident,
  });
  assert.equal(result, null);
});

test("protocolIncident reads incident list from file when incidentFilePath is set", () => {
  const path = "/tmp/test-incident-file.json";
  writeFileSync(path, JSON.stringify(["file-flagged"]));
  const config = buildAutoKillConfig({
    protocolIncident: { incidentFilePath: path, incidentList: [] },
  });
  const result = evaluateProtocolIncident({
    activeProtocols: ["file-flagged"],
    config: config.protocolIncident,
  });
  assert.ok(result);
  assert.equal(result.trigger, "protocol_incident");
  assert.equal(result.protocol, "file-flagged");
  unlinkSync(path);
});

test("protocolIncident returns null when incident file is missing", () => {
  const config = buildAutoKillConfig({
    protocolIncident: { incidentFilePath: "/tmp/nonexistent-incident-12345.json" },
  });
  const result = evaluateProtocolIncident({
    activeProtocols: ["some-protocol"],
    config: config.protocolIncident,
  });
  assert.equal(result, null);
});

// --- evaluateCampaignDecay ---

test("campaignDecay trips when APR decay exceeds threshold", () => {
  const config = buildAutoKillConfig({
    campaignDecay: { aprDecayExitPct: 0.50, tvlDrainExitPct: 0.30, rewardTokenDropExitPct: 0.25 },
  });
  const result = evaluateCampaignDecay({
    campaignStatus: { entryAprPct: 20, currentAprPct: 5 },
    config: config.campaignDecay,
  });
  assert.ok(result);
  assert.equal(result.trigger, "campaign_decay");
  assert.equal(result.reason, "apr_decay");
  assert.equal(result.ratio, 0.25);
});

test("campaignDecay trips when TVL drain exceeds threshold", () => {
  const config = buildAutoKillConfig({
    campaignDecay: { aprDecayExitPct: 0.50, tvlDrainExitPct: 0.30, rewardTokenDropExitPct: 0.25 },
  });
  const result = evaluateCampaignDecay({
    campaignStatus: { entryTvlUsd: 1_000_000, currentTvlUsd: 600_000 },
    config: config.campaignDecay,
  });
  assert.ok(result);
  assert.equal(result.trigger, "campaign_decay");
  assert.equal(result.reason, "tvl_drain");
  assert.equal(result.ratio, 0.6);
});

test("campaignDecay trips when reward token drop exceeds threshold", () => {
  const config = buildAutoKillConfig({
    campaignDecay: { aprDecayExitPct: 0.50, tvlDrainExitPct: 0.30, rewardTokenDropExitPct: 0.25 },
  });
  const result = evaluateCampaignDecay({
    campaignStatus: { rewardTokenEntryPriceUsd: 1.0, rewardTokenCurrentPriceUsd: 0.5 },
    config: config.campaignDecay,
  });
  assert.ok(result);
  assert.equal(result.trigger, "campaign_decay");
  assert.equal(result.reason, "reward_token_drop");
  assert.equal(result.ratio, 0.5);
});

test("campaignDecay returns null when no decay thresholds are breached", () => {
  const config = buildAutoKillConfig({
    campaignDecay: { aprDecayExitPct: 0.50, tvlDrainExitPct: 0.30, rewardTokenDropExitPct: 0.25 },
  });
  const result = evaluateCampaignDecay({
    campaignStatus: {
      entryAprPct: 20,
      currentAprPct: 15,
      entryTvlUsd: 1_000_000,
      currentTvlUsd: 900_000,
      rewardTokenEntryPriceUsd: 1.0,
      rewardTokenCurrentPriceUsd: 0.90,
    },
    config: config.campaignDecay,
  });
  assert.equal(result, null);
});

// --- evaluateAutoKillTriggers integration with all 8 triggers ---

test("evaluateAutoKillTriggers aggregates all 8 triggers when each trips", () => {
  const config = buildAutoKillConfig({
    cumulativeLoss: { thresholdUsd: 50, windowMs: 60 * 60 * 1000 },
    failureBurst: { perStrategyFailureCount: 2, failureCount: 99 },
    oracleDivergence: { maxDivergencePct: 0.03 },
    heartbeat: { maxAgeMs: 60_000 },
    relativePriceMove: { maxMovePct: 0.10, windowMs: 60_000 },
    clRangeHealth: { minTimeInRangePct24h: 0.90, maxIlExceedsFeesHours: 12 },
    protocolIncident: { incidentList: ["exploited"] },
    campaignDecay: { aprDecayExitPct: 0.20, tvlDrainExitPct: 0.20, rewardTokenDropExitPct: 0.20 },
  });

  const result = evaluateAutoKillTriggers({
    auditRecords: [
      { timestamp: new Date(NOW_MS - 1 * 60_000).toISOString(), strategyId: "x", lifecycle: { stage: "confirmed" }, realized: { netUsd: -100 } },
      { timestamp: new Date(NOW_MS - 2 * 60_000).toISOString(), strategyId: "x", lifecycle: { stage: "rejected" } },
      { timestamp: new Date(NOW_MS - 3 * 60_000).toISOString(), strategyId: "x", lifecycle: { stage: "rejected" } },
    ],
    oracleSamples: [
      { source: "a", priceUsd: 100 },
      { source: "b", priceUsd: 110 },
    ],
    heartbeatAtMs: NOW_MS - 120_000,
    priceSamples: [
      { timestamp: NOW_MS - 40_000, priceUsd: 100 },
      { timestamp: NOW_MS - 20_000, priceUsd: 120 },
    ],
    clStatus: { timeInRangePct24h: 0.50, ilExceedsFeesHours: 20 },
    activeProtocols: ["exploited"],
    campaignStatus: { entryAprPct: 20, currentAprPct: 10 },
    config,
    now: NOW,
  });

  assert.equal(result.triggered, true);
  const names = result.triggers.map((t) => t.trigger).sort();
  assert.deepEqual(names, [
    "campaign_decay",
    "cl_range_health",
    "cumulative_loss",
    "failure_burst_per_strategy",
    "heartbeat_stale",
    "oracle_divergence",
    "protocol_incident",
    "relative_price_move",
  ]);
});

test("evaluateAutoKillTriggers returns triggered=false when no inputs trip", () => {
  const config = buildAutoKillConfig();
  const result = evaluateAutoKillTriggers({
    auditRecords: [],
    oracleSamples: [
      { source: "a", priceUsd: 100 },
      { source: "b", priceUsd: 100.5 },
    ],
    heartbeatAtMs: NOW_MS - 1_000,
    priceSamples: [
      { timestamp: NOW_MS - 10_000, priceUsd: 100 },
      { timestamp: NOW_MS - 5_000, priceUsd: 101 },
    ],
    clStatus: { timeInRangePct24h: 0.85, ilExceedsFeesHours: 5 },
    activeProtocols: ["safe-protocol"],
    campaignStatus: { entryAprPct: 20, currentAprPct: 18 },
    config,
    now: NOW,
  });
  assert.equal(result.triggered, false);
  assert.equal(result.triggers.length, 0);
});
