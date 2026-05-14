#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVM_CHAIN_CONFIGS } from "../config/chains.mjs";
import { isOfficialGatewayDestinationChain } from "../config/gateway-destinations.mjs";
import {
  SMALL_CAPITAL_CAMPAIGN_MODE,
  isEvidencePrimaryChain,
} from "../config/small-capital-campaign-mode.mjs";
import {
  computeTinyCanaryMinProfitablePositionUsd,
  resolveTinyCanaryExpectedHoldDays,
  tinyCanarySameChainRoundTripCostUsd,
} from "../config/sizing.mjs";
import { protocolsMatch } from "../config/protocol-id-aliases.mjs";

const MERKL_OPPORTUNITIES_URL = "https://api.merkl.xyz/v4/opportunities";
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

function normalizeChain(name) {
  if (!name) return "unknown";
  const normalized = name.toLowerCase().replace(/\s+/g, "").replace(/mainnet/g, "ethereum");
  const aliases = {
    berachain: "bera",
    bnb: "bsc",
    bnbchain: "bsc",
    bnbsmartchain: "bsc",
    binance: "bsc",
    binancesmartchain: "bsc",
    bobl2: "bob",
    bobnetwork: "bob",
  };
  return aliases[normalized] ?? normalized;
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

function tokenSymbol(token) {
  if (typeof token === "string") return token.toLowerCase();
  return (token?.displaySymbol || token?.symbol || "").toLowerCase();
}

function poolSymbols(pool) {
  return String(pool?.symbol || "")
    .toLowerCase()
    .split(/[-/,\s]+/)
    .filter(Boolean);
}

export function getDefiLlamaPool(merklItem, defiLlamaPools) {
  const chain = normalizeChain(merklItem.chain?.name || merklItem.chain);
  const rawProtocol = merklItem.protocol?.id ?? (typeof merklItem.protocol === "string" ? merklItem.protocol : "");
  const protocol = String(rawProtocol || "").toLowerCase();
  const merklSymbols = (merklItem.tokens || []).map(tokenSymbol).filter(Boolean);
  // Try to match by project + chain + symbol overlap
  const matches = defiLlamaPools.filter((pool) => {
    const pChain = normalizeChain(pool.chain);
    const pProject = (pool.project || "").toLowerCase();
    if (pChain !== chain) return false;
    if (!protocolsMatch(protocol, pProject)) return false;
    // Symbol overlap if available
    const symbols = poolSymbols(pool);
    if (merklSymbols.length && symbols.length) {
      return merklSymbols.some((s) => symbols.includes(s));
    }
    return true;
  });
  matches.sort((left, right) => {
    const leftSymbols = poolSymbols(left);
    const rightSymbols = poolSymbols(right);
    const leftCoverage = merklSymbols.filter((symbol) => leftSymbols.includes(symbol)).length;
    const rightCoverage = merklSymbols.filter((symbol) => rightSymbols.includes(symbol)).length;
    if (leftCoverage !== rightCoverage) return rightCoverage - leftCoverage;
    const leftTvl = Number.isFinite(Number(left.tvlUsd)) ? Number(left.tvlUsd) : -1;
    const rightTvl = Number.isFinite(Number(right.tvlUsd)) ? Number(right.tvlUsd) : -1;
    return rightTvl - leftTvl;
  });
  return matches[0];
}

function computeExpectedRealizedApr(displayedApr, rewardTokenHaircut) {
  if (typeof displayedApr !== "number" || Number.isNaN(displayedApr)) return 0;
  return displayedApr * (1 - rewardTokenHaircut);
}

function rewardExitLiquidityStatus({ rewardTokenType, rewardToken }) {
  if (!rewardToken) {
    return {
      status: "native_or_share_price_yield_no_reward_exit_required_for_candidate_report",
      ready: true,
      reason: null,
    };
  }
  if (rewardToken === "unknown") {
    return {
      status: "missing_explicit_reward_exit_liquidity_proof",
      ready: false,
      reason: "reward_token_unknown",
    };
  }
  if (rewardTokenType === "stable") {
    return {
      status: "stable_reward_no_swap_depth_required_for_candidate_report",
      ready: true,
      reason: null,
    };
  }
  return {
    status: "missing_explicit_reward_exit_liquidity_proof",
    ready: false,
    reason: "non_stable_reward_requires_depth_proof",
  };
}

function rewardCountedInDisplayedApr({ displayedApr = 0, nativeAprPct = null } = {}) {
  const displayed = Number(displayedApr);
  const nativeApr = Number(nativeAprPct);
  if (!Number.isFinite(displayed) || displayed <= 0) return false;
  if (!Number.isFinite(nativeApr)) return true;
  return nativeApr + 1e-9 < displayed;
}

export function campaignReportChainIds(policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  return Object.keys(policy.chainSelection?.chainProfiles ?? {})
    .map((chain) => EVM_CHAIN_CONFIGS[chain]?.chainId)
    .filter((chainId) => Number.isInteger(chainId));
}

function buildMerklUrl(chainId) {
  const params = new URLSearchParams();
  if (Number.isInteger(Number(chainId))) params.set("chainId", String(chainId));
  params.set("campaigns", "true");
  return `${MERKL_OPPORTUNITIES_URL}?${params.toString()}`;
}

function determineEntryStatus(candidate, policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  const blockers = [];
  const primaryChain = isEvidencePrimaryChain(candidate.chain, policy);
  const evStatus = candidate.tinyCanaryEvStatus || tinyCanaryEvStatus(candidate);

  if (evStatus.ready !== true) {
    blockers.push(evStatus.blocker || "tiny_canary_ev_unmeasured");
  }
  if (!isOfficialGatewayDestinationChain(candidate.chain)) {
    blockers.push("unsupported_gateway_destination");
  }
  if (candidate.tvlUsd < 50_000) blockers.push("tvl_below_50k");
  if (candidate.hoursRemaining !== null && candidate.hoursRemaining < 24) blockers.push("hours_remaining_below_24");
  if (candidate.expectedRealizedAprAfterHaircut <= 0) blockers.push("realized_apr_not_positive");
  if (candidate.rewardTokenHaircut === 0.85) {
    blockers.push("pre_tge_or_points_reward");
  }
  if (candidate.rewardExitLiquidityStatus?.ready !== true) {
    blockers.push("reward_exit_liquidity_unproven");
  }
  if (!KNOWN_PROTOCOLS.has(candidate.protocol)) blockers.push("protocol_not_bound");

  // Hard blockers check
  const hasHardBlocker =
    evStatus.ready !== true ||
    !isOfficialGatewayDestinationChain(candidate.chain) ||
    candidate.tvlUsd < 50_000 ||
    (candidate.hoursRemaining !== null && candidate.hoursRemaining < 24) ||
    candidate.expectedRealizedAprAfterHaircut <= 0 ||
    candidate.rewardExitLiquidityStatus?.ready !== true ||
    !KNOWN_PROTOCOLS.has(candidate.protocol);

  if (hasHardBlocker) {
    return { entryStatus: "blocked", blockers };
  }

  // Small-capital micro-test auto-approval: lower bar for tiny positions on
  // whichever chain currently has committed evidence-primary status.
  const isMicroTestEligible =
    primaryChain &&
    KNOWN_PROTOCOLS.has(candidate.protocol) &&
    candidate.rewardTokenHaircut !== 0.85 &&
    blockers.length === 0;

  if (isMicroTestEligible) {
    return { entryStatus: "auto_allowed", blockers, isMicroTest: true };
  }

  // policy_review triggers
  if (candidate.campaignAgeHours !== null && candidate.campaignAgeHours < 48) {
    blockers.push("campaign_age_under_48h");
  }
  if (candidate.expectedRealizedAprAfterHaircut < 10 && evStatus.ready !== true) {
    blockers.push("realized_apr_under_10pct");
  }

  const isPolicyReview =
    (candidate.campaignAgeHours !== null && candidate.campaignAgeHours < 48) ||
    candidate.rewardTokenHaircut === 0.85 ||
    (candidate.expectedRealizedAprAfterHaircut < 10 && evStatus.ready !== true) ||
    blockers.length > 0;

  if (isPolicyReview) {
    return { entryStatus: "policy_review", blockers };
  }

  // Standard auto_allowed (higher bar)
  if (
    primaryChain &&
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

function operatorPositionUsdForCampaign(candidate, policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  const primaryChain = isEvidencePrimaryChain(candidate.chain, policy);
  const knownProtocol = KNOWN_PROTOCOLS.has(candidate.protocol);
  return primaryChain && knownProtocol
    ? policy.defaultBudgetsUsd.initialMicroUsd
    : policy.defaultBudgetsUsd.initialCampaignUsd;
}

function campaignRoundTripCostUsd(candidate, policy = SMALL_CAPITAL_CAMPAIGN_MODE) {
  return tinyCanarySameChainRoundTripCostUsd({ chain: candidate.chain });
}

function tinyCanaryEvStatus(candidate = {}) {
  const neededUsd = computeTinyCanaryMinProfitablePositionUsd({
    chain: candidate.chain,
    aprPct: candidate.expectedRealizedAprAfterHaircut,
    expectedHoldDays: candidate.expectedHoldDays,
    estimatedGasCostUsd: candidate.estimatedGasClaimSwapBridgeCostUsd,
  });
  const currentAmountUsd = Number(candidate.operatorPositionUsd);
  const ready = neededUsd !== null && Number.isFinite(currentAmountUsd) && currentAmountUsd >= neededUsd;
  return {
    ready,
    status: ready ? "ready" : "blocked",
    blocker: ready || neededUsd === null ? null : `tiny_canary_unprofitable:need_$${Math.ceil(neededUsd)}_on_${candidate.chain}`,
    currentAmountUsd: Number.isFinite(currentAmountUsd) ? currentAmountUsd : null,
    neededUsd,
    holdDays: candidate.expectedHoldDays ?? null,
    roundTripCostUsd: candidate.estimatedGasClaimSwapBridgeCostUsd ?? null,
  };
}

function expectedGrossProfitUsd({ positionUsd, aprPct, holdDays }) {
  if (!Number.isFinite(positionUsd) || !Number.isFinite(aprPct) || !Number.isFinite(holdDays)) return null;
  return positionUsd * (aprPct / 100) * (holdDays / 365);
}

export async function fetchMerklOpportunities({
  fetchFn = global.fetch,
  chainIds = [EVM_CHAIN_CONFIGS.base.chainId],
} = {}) {
  const ids = [...new Set(chainIds.map(Number).filter((chainId) => Number.isInteger(chainId)))];
  const effectiveIds = ids.length > 0 ? ids : [EVM_CHAIN_CONFIGS.base.chainId];
  const responses = await Promise.all(effectiveIds.map(async (chainId) => {
    const res = await fetchFn(buildMerklUrl(chainId), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Merkl fetch failed for chainId=${chainId}: ${res.status}`);
    const body = await res.json();
    const items = Array.isArray(body) ? body : body.data || [];
    return items.map((item) => ({ ...item, sourceChainId: chainId }));
  }));
  return responses.flat();
}

export async function fetchDefiLlamaPools({ fetchFn = global.fetch } = {}) {
  try {
    const res = await fetchFn(DEFILLAMA_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      console.error(`DefiLlama fetch returned ${res.status}; continuing with empty pools`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : data.data || [];
  } catch (error) {
    console.error(`DefiLlama fetch error: ${error.message}; continuing with empty pools`);
    return [];
  }
}

export function buildCampaignAwareCandidates({
  merklOpportunities,
  defiLlamaPools,
  nowMs = Date.now(),
  policy = SMALL_CAPITAL_CAMPAIGN_MODE,
}) {
  const opportunities = Array.isArray(merklOpportunities) ? merklOpportunities : [];
  const pools = Array.isArray(defiLlamaPools) ? defiLlamaPools : [];

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

    // Cross-reference with DefiLlama for the candidate chain.
    const chainPools = pools.filter((p) => normalizeChain(p.chain) === chain);
    const matchedPool = getDefiLlamaPool(opp, chainPools);
    if (matchedPool) {
      if (typeof matchedPool.apy === "number" && displayedApr === 0) displayedApr = matchedPool.apy;
      if (typeof matchedPool.tvlUsd === "number" && tvlUsd === 0) tvlUsd = matchedPool.tvlUsd;
    }

    // Reward token info from campaigns if available
    let rewardToken = null;
    let rewardTokenType = "nativeOrSharePriceYield";
    let rewardTokenHaircut = 0;
    let campaignAgeHours = null;
    let hoursRemaining = null;
    const nativeAprPct = typeof opp.nativeAprRecord?.value === "number" ? opp.nativeAprRecord.value : null;

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
      const symbol = firstReward.displaySymbol || firstReward.symbol || null;
      if (symbol) {
        rewardToken = symbol;
        const classification = classifyRewardToken(rewardToken, firstReward.name || firstReward.symbol);
        rewardTokenType = classification.type;
        rewardTokenHaircut = classification.haircut;
      }
    } else if (opp.rewardsRecord?.breakdowns?.length) {
      const firstReward = opp.rewardsRecord.breakdowns[0].token || {};
      const symbol = firstReward.displaySymbol || firstReward.symbol || null;
      if (symbol) {
        rewardToken = symbol;
        const classification = classifyRewardToken(rewardToken, firstReward.name || firstReward.symbol);
        rewardTokenType = classification.type;
        rewardTokenHaircut = classification.haircut;
      }
    }

    const rewardCounted = rewardCountedInDisplayedApr({ displayedApr, nativeAprPct });
    if (!rewardCounted) {
      rewardToken = null;
      rewardTokenType = "nativeOrSharePriceYield";
      rewardTokenHaircut = 0;
    }
    const expectedRealizedAprAfterHaircut = computeExpectedRealizedApr(displayedApr, rewardTokenHaircut);
    const preliminaryCandidate = {
      chain,
      protocol,
      opportunityId,
      displayedApr,
      nativeAprPct,
      expectedRealizedAprAfterHaircut,
      tvlUsd,
      campaignAgeHours,
      hoursRemaining,
      rewardToken,
      rewardTokenType,
      rewardTokenHaircut,
      rewardCountedInDisplayedApr: rewardCounted,
      rewardExitLiquidityStatus: rewardExitLiquidityStatus({ rewardTokenType, rewardToken }),
    };
    const expectedHoldDays = resolveTinyCanaryExpectedHoldDays({
      campaignRemainingHours: hoursRemaining,
    });
    const operatorPositionUsd = operatorPositionUsdForCampaign(preliminaryCandidate, policy);
    const estimatedGasClaimSwapBridgeCostUsd = campaignRoundTripCostUsd(preliminaryCandidate, policy);
    const operatorExpectedGrossProfitUsd = expectedGrossProfitUsd({
      positionUsd: operatorPositionUsd,
      aprPct: expectedRealizedAprAfterHaircut,
      holdDays: expectedHoldDays,
    });
    const marketExpectedGrossProfitUsd = expectedGrossProfitUsd({
      positionUsd: tvlUsd,
      aprPct: expectedRealizedAprAfterHaircut,
      holdDays: expectedHoldDays,
    });
    const operatorExpectedNetProfitUsd =
      operatorExpectedGrossProfitUsd === null ? null : operatorExpectedGrossProfitUsd - estimatedGasClaimSwapBridgeCostUsd;
    const marketExpectedNetProfitUsd =
      marketExpectedGrossProfitUsd === null ? null : marketExpectedGrossProfitUsd - estimatedGasClaimSwapBridgeCostUsd;

    const candidate = {
      ...preliminaryCandidate,
      expectedHoldDays,
      operatorPositionUsd,
      estimatedGasClaimSwapBridgeCostUsd,
      operatorExpectedGrossProfitUsd,
      operatorExpectedNetProfitUsd,
      marketExpectedGrossProfitUsd,
      marketExpectedNetProfitUsd,
      expectedNetProfitUsd: operatorExpectedNetProfitUsd,
    };
    candidate.tinyCanaryEvStatus = tinyCanaryEvStatus(candidate);

    const statusResult = determineEntryStatus(candidate, policy);
    candidates.push({
      ...candidate,
      entryStatus: statusResult.entryStatus,
      blockers: statusResult.blockers,
      isMicroTest: statusResult.isMicroTest || false,
    });
  }

  return candidates;
}

export function parseArgs(argv) {
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
  };
}

export async function handleCampaignAwareReportOutput({
  output,
  args,
  cwd = process.cwd(),
  writeFileFn = writeFile,
  logFn = console.log,
} = {}) {
  const outPath = join(cwd, "data", "campaign-aware-opportunities.json");
  if (args.write) {
    await writeFileFn(outPath, `${JSON.stringify(output, null, 2)}\n`);
  }

  if (args.json) {
    logFn(JSON.stringify(output, null, 2));
    return { wrote: args.write === true, printed: "json", outPath };
  }

  if (args.write) {
    logFn(`Wrote ${output.candidateCount ?? output.candidates?.length ?? 0} candidates to ${outPath}`);
    return { wrote: true, printed: "summary", outPath };
  }

  logFn(JSON.stringify(output, null, 2));
  return { wrote: false, printed: "json", outPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [merklData, defiLlamaPools] = await Promise.all([
    fetchMerklOpportunities({ chainIds: campaignReportChainIds(SMALL_CAPITAL_CAMPAIGN_MODE) }),
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
      policy_review: candidates.filter((c) => c.entryStatus === "policy_review").length,
      auto_allowed: candidates.filter((c) => c.entryStatus === "auto_allowed").length,
      observe: candidates.filter((c) => c.entryStatus === "observe").length,
    },
    candidates,
  };

  await handleCampaignAwareReportOutput({ output, args });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
