#!/usr/bin/env node
// Lightweight aggregator for auto-kill trigger source files.
// Reads existing status artifacts and writes trigger inputs.
// No network calls. Deterministic. No keys.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AUTO_KILL_DEFAULTS } from "../config/auto-kill.mjs";

const MAX_PRICE_SAMPLE_COUNT = 5_000;
const MARKET_PRICE_SNAPSHOT_MAX_AGE_MS = 20 * 60 * 1000;

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function readLatestJsonl(path) {
  try {
    const raw = await readFile(path, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function finiteNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function sampleTimestampMs(sample = {}) {
  const value = sample.timestamp ?? sample.observedAt ?? null;
  const parsed = Number.isFinite(value) ? value : new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function artifactTimestampMs(payload = {}) {
  const value = payload?.observedAt ?? payload?.generatedAt ?? payload?.timestamp ?? null;
  const parsed = Number.isFinite(value) ? value : new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function artifactAgeMs(payload = {}, { now = new Date() } = {}) {
  const timestampMs = artifactTimestampMs(payload);
  if (!Number.isFinite(timestampMs)) return null;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return null;
  return Math.max(0, nowMs - timestampMs);
}

function isFreshArtifact(payload = {}, { now = new Date(), maxAgeMs = MARKET_PRICE_SNAPSHOT_MAX_AGE_MS } = {}) {
  const ageMs = artifactAgeMs(payload, { now });
  return Number.isFinite(ageMs) && ageMs <= maxAgeMs;
}

function freshnessSummary(payload = {}, { now = new Date(), maxAgeMs = MARKET_PRICE_SNAPSHOT_MAX_AGE_MS } = {}) {
  const observedAt = payload?.observedAt ?? payload?.generatedAt ?? payload?.timestamp ?? null;
  const ageMs = artifactAgeMs(payload, { now });
  return {
    observedAt,
    ageMs,
    maxAgeMs,
    fresh: Number.isFinite(ageMs) && ageMs <= maxAgeMs,
  };
}

function selectFreshestArtifact(artifacts = [], { now = new Date(), maxAgeMs = MARKET_PRICE_SNAPSHOT_MAX_AGE_MS } = {}) {
  return artifacts
    .filter((artifact) => artifact?.payload && isFreshArtifact(artifact.payload, { now, maxAgeMs }))
    .sort((left, right) => artifactTimestampMs(right.payload) - artifactTimestampMs(left.payload))[0] || null;
}

function isLegacyUnsafeEthSample(sample = {}) {
  if (!["ETH/USD", "ETH/BTC"].includes(sample.pair)) return false;
  return ["dashboard", "computed_ratio"].includes(sample.source);
}

function pruneAndMergePriceSamples(previousSamples = [], currentSamples = [], { now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const cutoff = nowMs - AUTO_KILL_DEFAULTS.relativePriceMove.windowMs;
  const byKey = new Map();
  for (const sample of [...previousSamples, ...currentSamples]) {
    const timestampMs = sampleTimestampMs(sample);
    const priceUsd = Number(sample.priceUsd);
    if (!Number.isFinite(timestampMs) || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    if (timestampMs < cutoff) continue;
    if (isLegacyUnsafeEthSample(sample)) continue;
    const normalized = {
      timestamp: new Date(timestampMs).toISOString(),
      pair: sample.pair,
      priceUsd,
      source: sample.source || "unknown",
    };
    byKey.set(`${normalized.timestamp}:${normalized.pair}:${normalized.source}`, normalized);
  }
  return [...byKey.values()]
    .sort((a, b) => sampleTimestampMs(a) - sampleTimestampMs(b))
    .slice(-MAX_PRICE_SAMPLE_COUNT);
}

async function buildPriceSamples() {
  const now = new Date();
  const latestPriceSnapshot = await readJson("data/price-snapshot.json");
  const latestMarketJsonlSnapshot = await readLatestJsonl("data/market-price-snapshots.jsonl");
  const dashboard = await readJson("data/dashboard-status.json");
  const dashboardMarket = dashboard?.market
    ? {
        ...dashboard.market,
        observedAt: dashboard.market.observedAt || dashboard.generatedAt,
      }
    : null;
  const selectedMarket = selectFreshestArtifact([
    { kind: "price-snapshot", payload: latestPriceSnapshot },
    { kind: "market-price-snapshots", payload: latestMarketJsonlSnapshot },
  ], { now });
  const selectedDashboard = dashboardMarket && isFreshArtifact(dashboardMarket, { now })
    ? { kind: "dashboard-market", payload: dashboardMarket }
    : null;
  const latestMarketSnapshot = selectedMarket?.payload || null;
  const fallbackMarket = selectedDashboard?.payload || null;
  const btcUsd = finiteNumber(
    latestMarketSnapshot?.btcUsd,
    latestMarketSnapshot?.tokenByKey?.btc,
    latestMarketSnapshot?.tokenByKey?.wbtc,
    fallbackMarket?.btcUsd,
    fallbackMarket?.wbtcUsd,
  );
  const ethUsd = finiteNumber(
    latestMarketSnapshot?.tokenByKey?.ethereum,
    latestMarketSnapshot?.nativeByChain?.ethereum,
    fallbackMarket?.ethUsd,
  );
  const timestamp = latestMarketSnapshot?.observedAt || fallbackMarket?.observedAt || now.toISOString();
  const source = latestMarketSnapshot ? "market_price_snapshot" : "dashboard_market";
  const computedSource = latestMarketSnapshot
    ? "computed_from_market_price_snapshot"
    : "computed_from_dashboard_market";
  const currentSamples = [];
  if (btcUsd) {
    currentSamples.push({ timestamp, pair: "BTC/USD", priceUsd: btcUsd, source });
  }
  if (ethUsd) {
    currentSamples.push({ timestamp, pair: "ETH/USD", priceUsd: ethUsd, source });
  }
  if (btcUsd && ethUsd) {
    currentSamples.push({
      timestamp,
      pair: "ETH/BTC",
      priceUsd: ethUsd / btcUsd,
      source: computedSource,
    });
  }
  const existing = await readJson("data/price-samples.json");
  const previousSamples = Array.isArray(existing) ? existing : (existing?.samples || []);
  return {
    samples: pruneAndMergePriceSamples(previousSamples, currentSamples, { now }),
    freshness: {
      selectedMarketSource: selectedMarket?.kind || selectedDashboard?.kind || null,
      priceSnapshot: freshnessSummary(latestPriceSnapshot, { now }),
      marketPriceSnapshotsJsonl: freshnessSummary(latestMarketJsonlSnapshot, { now }),
      dashboardMarket: freshnessSummary(dashboardMarket, { now }),
    },
  };
}

async function buildActiveProtocols() {
  const anchorHealth = await readJson("data/anchor-position-health.json");
  const protocols = new Set();
  if (anchorHealth?.positions?.length > 0) {
    protocols.add("aerodrome");
  }
  // Add protocols from campaign opportunities with active/manual-confirm status
  const campaign = await readJson("data/campaign-aware-opportunities.json");
  if (campaign?.candidates) {
    for (const c of campaign.candidates) {
      if (c.entryStatus === "auto_allowed" || c.entryStatus === "manual_confirm") {
        if (c.protocol) protocols.add(c.protocol);
      }
    }
  }
  // Add protocols from realtime portfolio
  const portfolio = await readJson("dashboard/public/wallet-holdings.json");
  if (portfolio?.items) {
    for (const item of portfolio.items) {
      if (item.protocol) protocols.add(item.protocol);
    }
  }
  return [...protocols];
}

async function buildCampaignStatus() {
  const campaign = await readJson("data/campaign-aware-opportunities.json");
  const candidates = campaign?.candidates || [];
  if (candidates.length === 0) return {};
  // Aggregate the most significant campaign
  const top = candidates
    .filter((c) => c.entryStatus === "auto_allowed" || c.entryStatus === "manual_confirm")
    .sort((a, b) => (b.expectedRealizedAprAfterHaircut || 0) - (a.expectedRealizedAprAfterHaircut || 0))[0];
  if (!top) return {};
  return {
    opportunityId: top.opportunityId,
    protocol: top.protocol,
    chain: top.chain,
    entryAprPct: top.expectedRealizedAprAfterHaircut,
    currentAprPct: top.expectedRealizedAprAfterHaircut,
    displayedAprPct: top.displayedApr,
    entryTvlUsd: top.tvlUsd,
    currentTvlUsd: top.tvlUsd,
    rewardTokenEntryPriceUsd: null,
    rewardTokenCurrentPriceUsd: null,
  };
}

async function main() {
  const priceSamples = await buildPriceSamples();
  await writeJson("data/price-samples.json", { generatedAt: new Date().toISOString(), ...priceSamples });

  const activeProtocols = await buildActiveProtocols();
  await writeJson("data/active-protocols.json", { generatedAt: new Date().toISOString(), protocols: activeProtocols });

  const campaignStatus = await buildCampaignStatus();
  await writeJson("data/campaign-status.json", { generatedAt: new Date().toISOString(), ...campaignStatus });

  console.log("Wrote auto-kill trigger inputs:");
  console.log(`  data/price-samples.json        (${priceSamples.samples.length} samples)`);
  console.log(`  data/active-protocols.json     (${activeProtocols.length} protocols)`);
  console.log(`  data/campaign-status.json      (${Object.keys(campaignStatus).length} fields)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
