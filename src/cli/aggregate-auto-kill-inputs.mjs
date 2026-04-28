#!/usr/bin/env node
// Lightweight aggregator for auto-kill trigger source files.
// Reads existing status artifacts and writes trigger inputs.
// No network calls. Deterministic. No keys.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function buildPriceSamples() {
  // Derive from dashboard market data or existing price snapshots
  const dashboard = await readJson("data/dashboard-status.json");
  const btcUsd = dashboard?.market?.btcUsd ?? null;
  const ethUsd = dashboard?.market?.chainWbtcPrices?.find(c => c.chain === "ethereum")?.usd ?? null;
  const samples = [];
  const now = new Date().toISOString();
  if (btcUsd) {
    samples.push({ timestamp: now, pair: "BTC/USD", priceUsd: btcUsd, source: "dashboard" });
  }
  if (ethUsd) {
    samples.push({ timestamp: now, pair: "ETH/USD", priceUsd: ethUsd, source: "dashboard" });
  }
  if (btcUsd && ethUsd) {
    samples.push({ timestamp: now, pair: "ETH/BTC", priceUsd: ethUsd / btcUsd, source: "computed_ratio" });
  }
  return samples;
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
    entryAprPct: top.displayedApr,
    currentAprPct: top.expectedRealizedAprAfterHaircut,
    entryTvlUsd: top.tvlUsd,
    currentTvlUsd: top.tvlUsd,
    rewardTokenEntryPriceUsd: null,
    rewardTokenCurrentPriceUsd: null,
  };
}

async function main() {
  const priceSamples = await buildPriceSamples();
  await writeJson("data/price-samples.json", { generatedAt: new Date().toISOString(), samples: priceSamples });

  const activeProtocols = await buildActiveProtocols();
  await writeJson("data/active-protocols.json", { generatedAt: new Date().toISOString(), protocols: activeProtocols });

  const campaignStatus = await buildCampaignStatus();
  await writeJson("data/campaign-status.json", { generatedAt: new Date().toISOString(), ...campaignStatus });

  console.log("Wrote auto-kill trigger inputs:");
  console.log(`  data/price-samples.json        (${priceSamples.length} samples)`);
  console.log(`  data/active-protocols.json     (${activeProtocols.length} protocols)`);
  console.log(`  data/campaign-status.json      (${Object.keys(campaignStatus).length} fields)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
