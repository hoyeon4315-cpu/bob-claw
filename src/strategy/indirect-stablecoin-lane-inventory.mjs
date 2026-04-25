// Per-chain inventory of indirect stablecoin arrival paths.
//
// "Indirect stable" means: Gateway wBTC.OFT arrival → local DEX swap → USDC/USDT.
// This is distinct from "direct stable" (Gateway stable arrival → deploy).
//
// Evidence tiers:
//   allocation_ready  — live end-to-end proof with policy-passing economics
//   review_only       — key prerequisite proven, secondary gap remains
//   blocked           — prerequisite evidence missing
//
// DEX conversion proof values:
//   quote_only_untrusted — quote path observed only when unsafe/untrusted routing is allowed; not executable policy proof
//   not_proven           — no quote/conversion proof in repo-safe routing

const INDIRECT_STABLE_CHAIN_DATA = {
  // Direct stable arrival (Gateway stablecoin → chain) possible.
  // Registry arrivalAssetFamilies includes "stablecoin".
  // Economics evidence 100% covered but stale (>24h freshnessHours).
  // Gate blocked: evidence_stale + estimated_below_policy (stale artifact).
  // Indirect stable path not needed — direct stable is the right lane here.
  base: {
    directStableGatewayArrival: {
      status: "review_only",
      blockers: ["evidence_stale"],
      evidence: "Registry confirms stablecoin arrivalAssetFamily. Economics ledger coverage 100%, 4 sources, latest 2026-04-14. Gate artifact from 2026-04-14 not yet refreshed.",
      noteForDirectLane: "Refresh evidence_stale blocker by rerunning promotion gate with fresh economics observations.",
    },
    indirectStableViaWrappedBtc: {
      status: "blocked",
      blockers: ["direct_stable_gateway_arrival_available"],
      evidence: "Direct stable arrival via Gateway is the correct lane for base; indirect wBTC→DEX path is redundant here.",
    },
  },
  bsc: {
    directStableGatewayArrival: {
      status: "review_only",
      blockers: ["evidence_stale"],
      evidence: "Registry confirms stablecoin arrivalAssetFamily. Economics ledger coverage 100%, 3 sources, latest 2026-04-14. Gate artifact stale.",
      noteForDirectLane: "Same stale artifact issue as base. Refresh economics observations to unblock.",
    },
    indirectStableViaWrappedBtc: {
      status: "blocked",
      blockers: ["direct_stable_gateway_arrival_available"],
      evidence: "Direct stable arrival available; indirect path not needed.",
    },
  },
  // No direct stable Gateway arrival (registry: arrivalAssetFamilies = ["wrapped_btc"] only).
  // Indirect stable requires: wBTC.OFT arrival → local DEX → USDC/USDT.
  avalanche: {
    directStableGatewayArrival: {
      status: "blocked",
      blockers: ["no_stablecoin_gateway_arrival_route"],
      evidence: "Registry arrivalAssetFamilies=[\"wrapped_btc\"]. No Gateway stable arrival route to Avalanche as of current route inventory.",
    },
    indirectStableViaWrappedBtc: {
      status: "review_only",
      blockers: ["dex_execution_trust_not_allowlisted", "wrapped_btc_to_stable_dex_swap_not_live_executed"],
      evidence: "wBTC.OFT arrival to Avalanche proven live (Gateway consolidation executed per AGENTS.md). Native→USDC via Odos proven live on Avalanche. On 2026-04-20 KST, repo-safe Odos whitelist failed for wBTC.OFT→USDC, while --allow-unsafe-sources produced quote-only observations for 25k, 50k, and 100k sats. This proves route observability but not execution-trusted policy readiness.",
      dexVenue: "odos",
      arrivalProof: "live_delivery",
      dexConversionProof: "quote_only_untrusted",
      latestDexQuoteAt: "2026-04-19T22:40:30.715Z",
      latestDexQuoteTrust: "quote_only_untrusted",
      nextAction: "Promote Avalanche only after wBTC.OFT→USDC quotes clear the safe whitelist or a dedicated trusted venue path is added and live-executed.",
    },
  },
  sonic: {
    directStableGatewayArrival: {
      status: "blocked",
      blockers: ["no_stablecoin_gateway_arrival_route"],
      evidence: "Registry arrivalAssetFamilies=[\"wrapped_btc\"]. No Gateway stable arrival to Sonic.",
    },
    indirectStableViaWrappedBtc: {
      status: "review_only",
      blockers: ["dex_execution_trust_not_allowlisted", "wrapped_btc_to_stable_dex_swap_not_live_executed"],
      evidence: "wBTC.OFT arrival to Sonic proven live (Gateway BTC offramp from Sonic proven per AGENTS.md). Native→USDC via Odos proven live on Sonic. On 2026-04-20 KST, repo-safe Odos whitelist failed for wBTC.OFT→USDC, while --allow-unsafe-sources produced a quote-only 10k-sat observation with 0.8431% price impact. This proves route observability but not execution-trusted policy readiness.",
      dexVenue: "shadow_or_odos",
      arrivalProof: "live_delivery",
      dexConversionProof: "quote_only_untrusted",
      latestDexQuoteAt: "2026-04-19T22:40:24.037Z",
      latestDexQuoteTrust: "quote_only_untrusted",
      nextAction: "Promote Sonic only after wBTC.OFT→USDC quotes clear the safe whitelist or a dedicated trusted Shadow/Odos route is added and live-executed.",
    },
  },
  bera: {
    directStableGatewayArrival: {
      status: "blocked",
      blockers: ["no_stablecoin_gateway_arrival_route"],
      evidence: "Registry arrivalAssetFamilies=[\"wrapped_btc\"]. No Gateway stable arrival to Berachain.",
    },
    indirectStableViaWrappedBtc: {
      status: "review_only",
      blockers: ["repo_safe_router_missing", "wrapped_btc_to_stable_dex_swap_not_live_proven", "no_native_dex_conversion_proof"],
      evidence: "wBTC.OFT arrival to Bera proven live (wBTC.OFT delivery proof exists per AGENTS.md). On 2026-04-20 KST, repo-safe/Odos routing for Berachain returned no_supported_router_for_chain:80094 for wBTC.OFT→stable, so the next step is adding or validating a dedicated Kodiak route rather than retrying Odos blindly.",
      dexVenue: "kodiak",
      arrivalProof: "live_delivery",
      dexConversionProof: "not_proven",
      routerSupport: "repo_safe_router_missing",
      nextAction: "Add or validate a Kodiak quote path for Berachain wBTC.OFT→USDC, then record a live quote/execution proof.",
    },
  },
  unichain: {
    directStableGatewayArrival: {
      status: "blocked",
      blockers: ["no_stablecoin_gateway_arrival_route"],
      evidence: "Registry arrivalAssetFamilies=[\"wrapped_btc\"]. No Gateway stable arrival to Unichain.",
    },
    indirectStableViaWrappedBtc: {
      status: "review_only",
      blockers: ["dex_execution_trust_not_allowlisted", "wrapped_btc_to_stable_dex_swap_not_live_executed", "no_native_dex_conversion_proof"],
      evidence: "wBTC.OFT arrival to Unichain proven live (wBTC.OFT delivery proof exists per AGENTS.md). On 2026-04-20 KST, repo-safe Odos whitelist failed for wBTC.OFT→USDC, while --allow-unsafe-sources produced a quote-only 25k-sat observation with 0% price impact. This proves route observability but not execution-trusted policy readiness.",
      dexVenue: "catex",
      arrivalProof: "live_delivery",
      dexConversionProof: "quote_only_untrusted",
      latestDexQuoteAt: "2026-04-19T22:40:24.319Z",
      latestDexQuoteTrust: "quote_only_untrusted",
      nextAction: "Promote Unichain only after wBTC.OFT→USDC quotes clear a trusted route or a dedicated Catex path is added and live-executed.",
    },
  },
  soneium: {
    directStableGatewayArrival: {
      status: "blocked",
      blockers: ["no_stablecoin_gateway_arrival_route"],
      evidence: "Registry arrivalAssetFamilies=[\"wrapped_btc\"]. No Gateway stable arrival to Soneium.",
    },
    indirectStableViaWrappedBtc: {
      status: "review_only",
      blockers: ["repo_safe_router_missing", "wrapped_btc_to_stable_dex_swap_not_live_proven", "no_native_dex_conversion_proof"],
      evidence: "wBTC.OFT arrival to Soneium proven live (wBTC.OFT delivery proof exists per AGENTS.md). On 2026-04-20 KST, repo-safe routing returned no_supported_router_for_chain:1868 for wBTC.OFT→stable. This needs a dedicated Kyo/Soneium route integration before conversion can be promoted.",
      dexVenue: "kyo",
      arrivalProof: "live_delivery",
      dexConversionProof: "not_proven",
      routerSupport: "repo_safe_router_missing",
      nextAction: "Add or validate a Kyo/Soneium quote path for wBTC.OFT→USDC, then record a live quote/execution proof.",
    },
  },
};

const CHAIN_ORDER = ["base", "bsc", "avalanche", "sonic", "bera", "unichain", "soneium"];

function laneStatusRank(status = "blocked") {
  if (status === "allocation_ready") return 0;
  if (status === "review_only") return 1;
  return 2;
}

function buildChainLaneSummary(chain, chainData) {
  const direct = chainData.directStableGatewayArrival;
  const indirect = chainData.indirectStableViaWrappedBtc;
  const hasDirectReview = direct.status !== "blocked";
  const hasIndirectReview = indirect.status !== "blocked";
  const primaryStableLane = hasDirectReview ? "direct" : hasIndirectReview ? "indirect_via_wrapped_btc" : "none";
  return {
    chain,
    directStableGatewayArrival: {
      status: direct.status,
      blockers: direct.blockers || [],
      evidence: direct.evidence || null,
      noteForDirectLane: direct.noteForDirectLane || null,
    },
    indirectStableViaWrappedBtc: {
      status: indirect.status,
      blockers: indirect.blockers || [],
      evidence: indirect.evidence || null,
      dexVenue: indirect.dexVenue || null,
      arrivalProof: indirect.arrivalProof || null,
      dexConversionProof: indirect.dexConversionProof || null,
      latestDexQuoteAt: indirect.latestDexQuoteAt || null,
      latestDexQuoteTrust: indirect.latestDexQuoteTrust || null,
      routerSupport: indirect.routerSupport || null,
      nextAction: indirect.nextAction || null,
    },
    primaryStableLane,
    stableAccessible: hasDirectReview || hasIndirectReview,
  };
}

export function buildIndirectStablecoinLaneInventory() {
  const chains = CHAIN_ORDER.map((chain) => {
    const data = INDIRECT_STABLE_CHAIN_DATA[chain];
    if (!data) return null;
    return buildChainLaneSummary(chain, data);
  }).filter(Boolean);

  const directStableChains = chains.filter((c) => c.directStableGatewayArrival.status !== "blocked").map((c) => c.chain);
  const indirectStableReviewChains = chains
    .filter((c) => c.directStableGatewayArrival.status === "blocked" && c.indirectStableViaWrappedBtc.status === "review_only")
    .map((c) => c.chain);
  const fullyBlockedStableChains = chains.filter((c) => !c.stableAccessible).map((c) => c.chain);
  const indirectQuoteOnlyChains = chains
    .filter((c) => c.indirectStableViaWrappedBtc.dexConversionProof === "quote_only_untrusted")
    .map((c) => c.chain);
  const indirectRouterMissingChains = chains
    .filter((c) => c.indirectStableViaWrappedBtc.routerSupport === "repo_safe_router_missing")
    .map((c) => c.chain);

  const indirectLanesWithDexVenue = chains
    .filter((c) => c.indirectStableViaWrappedBtc.dexVenue && c.indirectStableViaWrappedBtc.status === "review_only")
    .map((c) => ({
      chain: c.chain,
      dexVenue: c.indirectStableViaWrappedBtc.dexVenue,
      arrivalProof: c.indirectStableViaWrappedBtc.arrivalProof,
      dexConversionProof: c.indirectStableViaWrappedBtc.dexConversionProof,
      latestDexQuoteAt: c.indirectStableViaWrappedBtc.latestDexQuoteAt,
      latestDexQuoteTrust: c.indirectStableViaWrappedBtc.latestDexQuoteTrust,
      routerSupport: c.indirectStableViaWrappedBtc.routerSupport,
      nextAction: c.indirectStableViaWrappedBtc.nextAction,
    }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      chainCount: chains.length,
      directStableChains,
      indirectStableReviewChains,
      fullyBlockedStableChains,
      indirectQuoteOnlyChains,
      indirectRouterMissingChains,
      indirectLanesWithDexVenue,
      note: [
        "direct stable = Gateway stablecoin arrival (no DEX hop needed)",
        "indirect stable = Gateway wBTC.OFT arrival → local DEX → USDC/USDT",
        "review_only indirect lane means wBTC.OFT arrival is live-proven but wBTC→stable DEX swap is not yet live-proven",
        "allocation_ready requires: arrival proven + DEX swap live-proven + economics pass policy",
      ],
    },
    chains,
  };
}

export function summarizeIndirectStablecoinLaneInventory(inventory = null) {
  if (!inventory) return null;
  return {
    directStableChains: inventory.summary?.directStableChains || [],
    indirectStableReviewChains: inventory.summary?.indirectStableReviewChains || [],
    fullyBlockedStableChains: inventory.summary?.fullyBlockedStableChains || [],
    indirectQuoteOnlyChains: inventory.summary?.indirectQuoteOnlyChains || [],
    indirectRouterMissingChains: inventory.summary?.indirectRouterMissingChains || [],
    indirectLanesWithDexVenue: inventory.summary?.indirectLanesWithDexVenue || [],
    chainCount: inventory.summary?.chainCount ?? 0,
  };
}
