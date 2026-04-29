#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SMALL_CAPITAL_CAMPAIGN_MODE } from "../config/small-capital-campaign-mode.mjs";

const MERKL_URL = "https://api.merkl.xyz/v4/opportunities?chainId=8453&campaigns=true";
const DEFILLAMA_URL = "https://yields.llama.fi/pools";

const KNOWN_PROTOCOLS = new Set([
  "aerodrome",
  "yo",
  "morpho",
  "aave",
  "euler",
  "moonwell",
  "pendle",
  "beefy",
]);

const BASE_FIRST_CHAINS = new Set(SMALL_CAPITAL_CAMPAIGN_MODE.baseFirstChains);

const STABLE_SYMBOLS = new Set([
  "usdc", "usdt", "dai", "fdusd", "lusd", "frax", "pyusd", "usde", "susde",
  "usds", "gusd", "tusd", "usdp", "alusd", "eusd", "crvusd", "aegus",
]);

const LIQUID_BLUECHIP_SYMBOLS = new Set([
  "eth", "weth", "wsteth", "reth", "cbeth", "wbtc", "tbtc", "sbtc",
  "cbbtc", "btc", "sol", "wbtc.oft", "weth.oft",
]);

const PRE_TGE_MARKERS = new Set([
  "points", "pre-tge", "pretge", "drop", "airdrop", "phase", "season",
]);

const GAS_ESTIMATE_USD = {
  base: 0.50,
  ethereum: 5.00,
  default: 2.00,
};

function normalizeChain(name) {
  if (!name) return "unknown";
  return name.toLowerCase().replace(/\s+/g, "").replace(/mainnet/g, "ethereum");
}

export function classifyRewardToken(tokenSymbol, tokenName = "") {
  const sym = (tokenSymbol || "").toLowerCase();
  const nm = (tokenName || "").toLowerCase();
  if (STABLE_SYMBOLS.has(sym)) return { type: "stable", haircut: 0.0 };
  if (LIQUID_BLUECHIP_SYMBOLS.has(sym)) return { type: "liquidBluechip", haircut: 0.25 };
  for (const marker of PRE_TGE_MARKERS) {
    if (sym.includes(marker) || nm.includes(marker)) return { type: "preTgeOrPoints", haircut: 0.85 };
  }
  return { type: "defaultRewardToken", haircut: 0.50 };
}

function getCampaignAgeHours(campaignStartTime, nowMs = Date.now()) {
  if (!campaignStartTime) return null;
  const start = Number(campaignStartTime) * 1000;
  if (Number.isNaN(start)) return null;
  return (nowMs - start) / 36e5;
}

function getHoursRemaining(campaignEndTime, nowMs = Date.now()) {
  if (!campaignEndTime) return null;
  const end = Number(campaignEndTime) * 1000;
  if (Number.isNaN(end)) return null;
  return (end - nowMs) / 36e5;
}

function getDefiLlamaPool(merklItem, defiLlamaPools) {
  const chain = normalizeChain(merklItem.chain?.name || merklItem.chain);
  const protocol = (merklItem.protocol?.id || merklItem.protocol || "").toLowerCase();
  // Try to match by project + chain + symbol overlap
  return defiLlamaPools.find((pool) => {
    const pChain = normalizeChain(pool.chain);
    const pProject = (pool.project || "").toLowerCase();
    if (pChain !== chain) return false;
    // Loose project match
    if (!pProject.includes(protocol) && !protocol.includes(pProject)) return false;
    // Symbol overlap if available
    const merklSymbols = (merklItem.tokens || []).map((t) => (t.displaySymbol || t.symbol || "").toLowerCase());
    const poolSymbols = (pool.symbol || "").toLowerCase().split("-");
    if (merklSymbols.length && poolSymbols.length) {
      return merklSymbols.some((s) => poolSymbols.includes(s));
    }
    return true;
  });
}

function computeExpectedRealizedApr(displayedApr, rewardTokenHaircut) {
  if (typeof displayedApr !== "number" || Number.isNaN(displayedApr)) return 0;
  return displayedApr * (1 - rewardTokenHaircut);
}

function getGasEstimateUsd(chain) {
  const c = normalizeChain(chain);
  if (c === "base") return GAS_ESTIMATE_USD.base;
  if (c === "ethereum" || c === "mainnet") return GAS_ESTIMATE_USD.ethereum;
  return GAS_ESTIMATE_USD.default;
}

function determineEntryStatus(candidate) {
  const blockers = [];

  if (candidate.displayedApr < 5) blockers.push("apr_below_5pct");
  if (candidate.tvlUsd < 50_000) blockers.push("tvl_below_50k");
  if (candidate.hoursRemaining !== null && candidate.hoursRemaining < 24) blockers.push("hours_remaining_below_24");
  if (candidate.expectedRealizedAprAfterHaircut <= 0) blockers.push("realized_apr_not_positive");
  if (!BASE_FIRST_CHAINS.has(candidate.chain) && candidate.expectedNetProfitUsd < 10) {
    blockers.push("non_base_chain_and_low_net_profit");
  }
  if (!KNOWN_PROTOCOLS.has(candidate.protocol)) blockers.push("protocol_not_bound");

  // Hard blockers check
  const hasHardBlocker =
    candidate.displayedApr < 5 ||
    candidate.tvlUsd < 50_000 ||
    (candidate.hoursRemaining !== null && candidate.hoursRemaining < 24) ||
    candidate.expectedRealizedAprAfterHaircut <= 0 ||
    (!BASE_FIRST_CHAINS.has(candidate.chain) && candidate.expectedNetProfitUsd < 10) ||
    !KNOWN_PROTOCOLS.has(candidate.protocol);

  if (hasHardBlocker) {
    return { entryStatus: "blocked", blockers };
  }

  // Small-capital micro-test auto-approval: lower bar for $10-25 positions on Base
  const isMicroTestEligible =
    candidate.chain === "base" &&
    KNOWN_PROTOCOLS.has(candidate.protocol) &&
    candidate.rewardTokenHaircut !== 0.85 &&
    blockers.length === 0;

  if (isMicroTestEligible) {
    return { entryStatus: "auto_allowed", blockers, isMicroTest: true };
  }

  // manual_confirm triggers
  if (candidate.campaignAgeHours !== null && candidate.campaignAgeHours < 48) {
    blockers.push("campaign_age_under_48h");
  }
  if (candidate.rewardTokenHaircut === 0.85) {
    blockers.push("pre_tge_or_points_reward");
  }
  if (candidate.expectedRealizedAprAfterHaircut < 10) {
    blockers.push("realized_apr_under_10pct");
  }

  const isManualConfirm =
    (candidate.campaignAgeHours !== null && candidate.campaignAgeHours < 48) ||
    candidate.rewardTokenHaircut === 0.85 ||
    candidate.expectedRealizedAprAfterHaircut < 10 ||
    blockers.length > 0;

  if (isManualConfirm) {
    return { entryStatus: "manual_confirm", blockers };
  }

  // Standard auto_allowed (higher bar)
  if (
    candidate.chain === "base" &&
    KNOWN_PROTOCOLS.has(candidate.protocol) &&
    candidate.expectedRealizedAprAfterHaircut >= 15 &&
    candidate.tvlUsd >= 100_000 &&
    (candidate.hoursRemaining === null || candidate.hoursRemaining >= 48) &&
    blockers.length === 0
  ) {
    return { entryStatus: "auto_allowed", blockers };
  }

  return { entryStatus: "observe", blockers };
}

export async function fetchMerklOpportunities({ fetchFn = global.fetch } = {}) {
  const res = await fetchFn(MERKL_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Merkl fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchDefiLlamaPools({ fetchFn = global.fetch } = {}) {
  const res = await fetchFn(DEFILLAMA_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`DefiLlama fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data || [];
}

export function buildCampaignAwareCandidates({ merklOpportunities, defiLlamaPools, nowMs = Date.now() }) {
  const opportunities = Array.isArray(merklOpportunities) ? merklOpportunities : [];
  const pools = Array.isArray(defiLlamaPools) ? defiLlamaPools : [];
  const basePools = pools.filter((p) => normalizeChain(p.chain) === "base");

  const candidates = [];

  for (const opp of opportunities) {
    const chain = normalizeChain(opp.chain?.name || opp.chain);
    const protocol = (opp.protocol?.id || opp.protocol || "").toLowerCase();
    const opportunityId = String(opp.id || opp.opportunityId || "unknown");

    // Determine displayedApr and TVL from Merkl first, fall back to DefiLlama
    let displayedApr = 0;
    let tvlUsd = 0;

    if (typeof opp.apr === "number") displayedApr = opp.apr;
    else if (typeof opp.apy === "number") displayedApr = opp.apy;
    else if (typeof opp.meanAPR === "number") displayedApr = opp.meanAPR;

    if (typeof opp.tvl === "number") tvlUsd = opp.tvl;
    else if (typeof opp.tvlUsd === "number") tvlUsd = opp.tvlUsd;

    // Cross-reference with DefiLlama for Base
    const matchedPool = chain === "base" ? getDefiLlamaPool(opp, basePools) : null;
    if (matchedPool) {
      if (typeof matchedPool.apy === "number" && displayedApr === 0) displayedApr = matchedPool.apy;
      if (typeof matchedPool.tvlUsd === "number" && tvlUsd === 0) tvlUsd = matchedPool.tvlUsd;
    }

    // Reward token info from campaigns if available
    let rewardToken = "unknown";
    let rewardTokenHaircut = 0.50;
    let campaignAgeHours = null;
    let hoursRemaining = null;

    const campaigns = Array.isArray(opp.campaigns) ? opp.campaigns : [];
    if (campaigns.length) {
      // Use the earliest start and latest end
      const starts = campaigns
        .map((c) => c.start || c.startTimestamp || c.startTime)
        .filter(Boolean)
        .map(Number);
      const ends = campaigns
        .map((c) => c.end || c.endTimestamp || c.endTime)
        .filter(Boolean)
        .map(Number);

      if (starts.length) campaignAgeHours = getCampaignAgeHours(Math.min(...starts), nowMs);
      if (ends.length) hoursRemaining = getHoursRemaining(Math.max(...ends), nowMs);

      // Use first campaign reward token for classification
      const firstReward = campaigns[0].rewardToken || campaigns[0].token || {};
      rewardToken = firstReward.displaySymbol || firstReward.symbol || "unknown";
      const classification = classifyRewardToken(rewardToken, firstReward.name || firstReward.symbol);
      rewardTokenHaircut = classification.haircut;
    } else if (opp.rewardsRecord?.breakdowns?.length) {
      const firstReward = opp.rewardsRecord.breakdowns[0].token || {};
      rewardToken = firstReward.displaySymbol || firstReward.symbol || "unknown";
      const classification = classifyRewardToken(rewardToken, firstReward.name || firstReward.symbol);
      rewardTokenHaircut = classification.haircut;
    }

    const expectedRealizedAprAfterHaircut = computeExpectedRealizedApr(displayedApr, rewardTokenHaircut);
    const estimatedGasClaimSwapBridgeCostUsd = getGasEstimateUsd(chain);
    const expectedNetProfitUsd = (expectedRealizedAprAfterHaircut / 100) * tvlUsd * (1 / 365) - estimatedGasClaimSwapBridgeCostUsd;

    const candidate = {
      chain,
      protocol,
      opportunityId,
      displayedApr,
      expectedRealizedAprAfterHaircut,
      tvlUsd,
      campaignAgeHours,
      hoursRemaining,
      estimatedGasClaimSwapBridgeCostUsd,
      rewardToken,
      rewardTokenHaircut,
      expectedNetProfitUsd,
    };

    const statusResult = determineEntryStatus(candidate);
    candidates.push({
      ...candidate,
      entryStatus: statusResult.entryStatus,
      blockers: statusResult.blockers,
      isMicroTest: statusResult.isMicroTest || false,
    });
  }

  return candidates;
}

function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [merklData, defiLlamaPools] = await Promise.all([
    fetchMerklOpportunities(),
    fetchDefiLlamaPools(),
  ]);

  const candidates = buildCampaignAwareCandidates({
    merklOpportunities: merklData,
    defiLlamaPools,
  });

  const output = {
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    summary: {
      blocked: candidates.filter((c) => c.entryStatus === "blocked").length,
      manual_confirm: candidates.filter((c) => c.entryStatus === "manual_confirm").length,
      auto_allowed: candidates.filter((c) => c.entryStatus === "auto_allowed").length,
      observe: candidates.filter((c) => c.entryStatus === "observe").length,
    },
    candidates,
  };

  if (args.json) {
    const outPath = join(process.cwd(), "data", "campaign-aware-opportunities.json");
    await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`Wrote ${candidates.length} candidates to ${outPath}`);
    return;
  }

  console.log(JSON.stringify(output, null, 2));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
