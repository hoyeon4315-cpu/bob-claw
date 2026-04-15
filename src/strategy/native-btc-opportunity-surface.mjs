import { buildGatewayInventorySummary } from "../cli/inventory-gateway.mjs";
import { tokenAsset } from "../assets/tokens.mjs";
import { routeKey } from "../gateway/client.mjs";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function liveRouteRecord(route) {
  const dstAsset = tokenAsset(route.dstChain, route.dstToken);
  return {
    routeKey: routeKey(route),
    dstChain: route.dstChain,
    dstToken: route.dstToken,
    dstTicker: dstAsset.ticker,
    dstFamily: dstAsset.family,
  };
}

function routeFamily(route) {
  const dstAsset = tokenAsset(route.dstChain, route.dstToken);
  if (dstAsset.family === "wrapped_btc") return "wrapped_btc";
  if (dstAsset.family === "stablecoin") return "stablecoin";
  if (dstAsset.ticker === "ETH" || dstAsset.family === "native_or_wrapped") return "eth_like";
  if (dstAsset.ticker === "PAXG" || dstAsset.ticker === "XAUT") return "store_of_value";
  return "other";
}

function staleAssumptionEntry(item) {
  return {
    ticker: item?.ticker || null,
    chain: item?.chain || null,
    token: item?.token || null,
    status: item?.status || null,
    sourceLabel: item?.source?.label || null,
    sourceUrl: item?.source?.url || null,
  };
}

function proxySpreadEvidence(strategySnapshot = null) {
  const entry = strategySnapshot?.implementedStrategies?.find((item) => item.id === "btc_proxy_spreads") || null;
  return {
    status: entry?.status || null,
    reason: entry?.reason || null,
    overfitRisks: entry?.overfitRisks || [],
    observedNetUsd: entry?.capitalGuidance?.observedNetUsd ?? null,
    observedNetPct: entry?.capitalGuidance?.observedNetPct ?? null,
    observedNotionalUsd: entry?.capitalGuidance?.observedNotionalUsd ?? null,
  };
}

function triangularEvidence(strategySnapshot = null) {
  const entry = strategySnapshot?.implementedStrategies?.find((item) => item.id === "triangular_flash_btc") || null;
  return {
    status: entry?.status || null,
    reason: entry?.reason || null,
    sampleCount: entry?.evidence?.sampleCount ?? null,
    bestNetPct: entry?.evidence?.bestNetPct ?? null,
  };
}

function strategyTemplate({
  id,
  label,
  category,
  actionType,
  arrivalFamily,
  supportType,
  status,
  thesis,
  supportedChains = [],
  liveRouteCount = 0,
  blockers = [],
  notes = [],
}) {
  return {
    id,
    label,
    category,
    actionType,
    arrivalFamily,
    supportType,
    status,
    thesis,
    supportedChains: unique(supportedChains),
    liveRouteCount,
    blockers,
    notes,
  };
}

export function buildNativeBtcOpportunitySurface({
  routes = [],
  strategySnapshot = null,
  generatedAt = null,
} = {}) {
  const now = generatedAt || new Date().toISOString();
  const inventory = buildGatewayInventorySummary(routes);
  const nativeBtcRoutes = routes.filter(
    (route) => route.srcChain === "bitcoin" && String(route.srcToken).toLowerCase() === "0x0000000000000000000000000000000000000000",
  );

  const liveRoutes = nativeBtcRoutes.map(liveRouteRecord);
  const wrapperRoutes = liveRoutes.filter((route) => route.dstFamily === "wrapped_btc");
  const stableRoutes = liveRoutes.filter((route) => route.dstFamily === "stablecoin");
  const ethRoutes = liveRoutes.filter((route) => route.dstTicker === "ETH" || route.dstFamily === "native_or_wrapped");
  const storeOfValueRoutes = liveRoutes.filter((route) => route.dstTicker === "PAXG" || route.dstTicker === "XAUT");
  const otherRoutes = liveRoutes.filter((route) => route.dstFamily === "other");

  const families = [
    {
      rank: 1,
      id: "destination_wrapped_btc_rotation",
      label: "Wrapped BTC destination rotation",
      status: "live_route_supported_research_needed",
      thesis:
        "Start with native BTC, settle into wrapped BTC on low-fee destination chains, then allocate into chain-local yield, LP, or loop strategies.",
      liveRouteCount: wrapperRoutes.length,
      destinationChains: unique(wrapperRoutes.map((route) => route.dstChain)),
      destinationAssets: unique(wrapperRoutes.map((route) => route.dstTicker)),
      currentFit:
        "Best fit for a Gateway-native capital allocator because the transport leg is live across the widest chain set, while the deployment leg can be scored independently.",
      blockers: [
        "destination yield and unwind surfaces are not yet measured deterministically",
        "current repo has transport and scoring, but not a live destination opportunity registry",
      ],
    },
    {
      rank: 2,
      id: "stablecoin_treasury_rotation",
      label: "Stablecoin treasury rotation",
      status: "live_route_supported_research_needed",
      thesis:
        "Swap native BTC into destination stablecoins, then park capital in lending, LP, or cash-like strategies on the target chain with explicit exit paths back to BTC.",
      liveRouteCount: stableRoutes.length,
      destinationChains: unique(stableRoutes.map((route) => route.dstChain)),
      destinationAssets: unique(stableRoutes.map((route) => route.dstTicker)),
      currentFit:
        "Cleaner than pure arbitrage because the Gateway leg is already live and the strategy can optimize for yield net of entry and exit costs.",
      blockers: [
        "current repo invalidated stable loop profitability due to amount mismatch",
        "destination stablecoin venues are not yet ranked by exit cost, capacity, and latency",
      ],
    },
    {
      rank: 3,
      id: "gateway_proxy_spread_rebalance",
      label: "Gateway BTC proxy spread rebalance",
      status: "measured_but_overfit_blocked",
      thesis:
        "Use native BTC and wrapped BTC routes as the funding rail for measured BTC proxy dislocations, then rebalance across Gateway-connected wrappers.",
      liveRouteCount: wrapperRoutes.length,
      destinationChains: unique(wrapperRoutes.map((route) => route.dstChain)),
      destinationAssets: unique(wrapperRoutes.map((route) => route.dstTicker)),
      currentFit:
        "This remains the only measured arb-like family with some positive readings, but it is still blocked by thin coverage and stale samples.",
      blockers: proxySpreadEvidence(strategySnapshot).overfitRisks,
      evidence: proxySpreadEvidence(strategySnapshot),
    },
    {
      rank: 4,
      id: "macro_asset_rotation",
      label: "Macro asset rotation",
      status: "live_route_supported_research_needed",
      thesis:
        "Use native BTC routes into ETH or hard-asset proxies such as PAXG/XAUT for tactical allocation or collateral deployment when destination strategy edges justify the switch.",
      liveRouteCount: ethRoutes.length + storeOfValueRoutes.length + otherRoutes.length,
      destinationChains: unique([...ethRoutes, ...storeOfValueRoutes, ...otherRoutes].map((route) => route.dstChain)),
      destinationAssets: unique([...ethRoutes, ...storeOfValueRoutes, ...otherRoutes].map((route) => route.dstTicker)),
      currentFit:
        "This is broader than arbitrage and can matter when BTC-native opportunities are weak, but it requires stricter policy because it adds market-risk drift.",
      blockers: [
        "not delta-neutral by default",
        "requires destination strategy evidence rather than route availability alone",
      ],
    },
    {
      rank: 5,
      id: "integrator_referral_revenue",
      label: "Integrator and referral revenue",
      status: "product_surface_supported",
      thesis:
        "Capture revenue from Gateway distribution itself while keeping trading capital separate; useful as a parallel income layer, not as a capital deployment strategy.",
      liveRouteCount: 0,
      destinationChains: [],
      destinationAssets: [],
      currentFit:
        "Fits the BOB thesis and does not depend on proving a trading edge, but it is not a direct answer to capital allocation.",
      blockers: [
        "depends on external user flow or product distribution",
        "not a portfolio-yield strategy",
      ],
    },
  ];

  const allStrategyFamilies = [
    strategyTemplate({
      id: "btc_to_wrapped_btc_hold",
      label: "BTC -> wrapped BTC carry and hold",
      category: "transport",
      actionType: "hold",
      arrivalFamily: "wrapped_btc",
      supportType: "live_route_inventory",
      status: "supported_now",
      thesis: "Move native BTC into WBTC, wBTC.OFT, or uniBTC and hold where downstream opportunity quality is highest.",
      supportedChains: wrapperRoutes.map((route) => route.dstChain),
      liveRouteCount: wrapperRoutes.length,
    }),
    strategyTemplate({
      id: "btc_to_wrapped_btc_closed_loop",
      label: "BTC-family closed-loop arbitrage",
      category: "arbitrage",
      actionType: "closed_loop_arb",
      arrivalFamily: "wrapped_btc",
      supportType: "live_route_inventory",
      status: "measured_blocked",
      thesis: "Rotate wrapped BTC across Gateway-connected chains and close back into BTC-family inventory for spread capture.",
      supportedChains: wrapperRoutes.map((route) => route.dstChain),
      liveRouteCount: wrapperRoutes.length,
      blockers: [
        "measured no-edge on current exact loops",
        "current canary remains economically blocked",
      ],
    }),
    strategyTemplate({
      id: "btc_proxy_spread_rebalance",
      label: "Wrapped BTC proxy spread rebalance",
      category: "arbitrage",
      actionType: "cross_wrapper_spread",
      arrivalFamily: "wrapped_btc",
      supportType: "live_route_inventory",
      status: "research_only_overfit_blocked",
      thesis: "Exploit dislocations between WBTC, wBTC.OFT, and uniBTC, then rebalance over Gateway.",
      supportedChains: wrapperRoutes.map((route) => route.dstChain),
      liveRouteCount: wrapperRoutes.length,
      blockers: proxySpreadEvidence(strategySnapshot).overfitRisks,
      notes: ["Only measured arb-like family with some positive reads, but still high overfit risk."],
    }),
    strategyTemplate({
      id: "wrapped_btc_destination_yield",
      label: "Wrapped BTC destination yield allocation",
      category: "yield",
      actionType: "yield_action",
      arrivalFamily: "wrapped_btc",
      supportType: "live_route_plus_destination_scoring_needed",
      status: "research_needed",
      thesis: "Move BTC into wrapped BTC on destination chains, then allocate to deterministic yield venues with unwind scoring.",
      supportedChains: wrapperRoutes.map((route) => route.dstChain),
      liveRouteCount: wrapperRoutes.length,
      blockers: [
        "destination venue registry not yet built",
        "unwind cost and withdrawal delay not yet measured",
      ],
    }),
    strategyTemplate({
      id: "wrapped_btc_lending",
      label: "Wrapped BTC -> lending positions",
      category: "yield",
      actionType: "lending",
      arrivalFamily: "wrapped_btc",
      supportType: "docs_use_case_plus_live_arrival_assets",
      status: "product_surface_supported",
      thesis: "Use Gateway to deliver BTC directly into lending-compatible wrapped BTC positions on destination chains.",
      supportedChains: wrapperRoutes.map((route) => route.dstChain),
      liveRouteCount: wrapperRoutes.length,
      blockers: ["protocol allowlist and deterministic scoring missing"],
    }),
    strategyTemplate({
      id: "wrapped_btc_lp_positions",
      label: "Wrapped BTC -> LP positions",
      category: "yield",
      actionType: "lp_position",
      arrivalFamily: "wrapped_btc",
      supportType: "docs_use_case_plus_live_arrival_assets",
      status: "product_surface_supported",
      thesis: "Deploy wrapped BTC straight into destination DEX liquidity positions when fee yield exceeds transport and unwind drag.",
      supportedChains: wrapperRoutes.map((route) => route.dstChain),
      liveRouteCount: wrapperRoutes.length,
      blockers: ["IL and unwind model missing", "LP venue scoring missing"],
    }),
    strategyTemplate({
      id: "stablecoin_treasury_hold",
      label: "BTC -> stablecoin treasury parking",
      category: "transport",
      actionType: "hold",
      arrivalFamily: "stablecoin",
      supportType: "live_route_inventory",
      status: "supported_now",
      thesis: "Convert native BTC into destination USDC or USDT as a treasury state before redeploying or exiting.",
      supportedChains: stableRoutes.map((route) => route.dstChain),
      liveRouteCount: stableRoutes.length,
    }),
    strategyTemplate({
      id: "stablecoin_direct_loop_arb",
      label: "BTC <-> stablecoin direct loop arbitrage",
      category: "arbitrage",
      actionType: "inventory_conversion",
      arrivalFamily: "stablecoin",
      supportType: "live_route_inventory",
      status: "measured_blocked",
      thesis: "Round-trip native BTC into stablecoins and back to BTC on low-fee chains for spread capture.",
      supportedChains: stableRoutes.map((route) => route.dstChain),
      liveRouteCount: stableRoutes.length,
      blockers: ["amount mismatch and one-way losses dominate current evidence"],
    }),
    strategyTemplate({
      id: "stablecoin_lending_carry",
      label: "Stablecoin lending carry",
      category: "yield",
      actionType: "lending",
      arrivalFamily: "stablecoin",
      supportType: "docs_use_case_plus_live_arrival_assets",
      status: "research_needed",
      thesis: "Route native BTC into USDC/USDT and lend or park in cash-like protocols with explicit BTC exit scoring.",
      supportedChains: stableRoutes.map((route) => route.dstChain),
      liveRouteCount: stableRoutes.length,
      blockers: ["destination protocol scoring and BTC re-entry economics missing"],
    }),
    strategyTemplate({
      id: "stablecoin_lp_or_basis",
      label: "Stablecoin LP or basis deployment",
      category: "yield",
      actionType: "lp_position",
      arrivalFamily: "stablecoin",
      supportType: "docs_use_case_plus_live_arrival_assets",
      status: "research_needed",
      thesis: "Use stablecoin landings for LP, delta-light carry, or basis-like deployment on low-fee chains.",
      supportedChains: stableRoutes.map((route) => route.dstChain),
      liveRouteCount: stableRoutes.length,
      blockers: ["not yet represented in repo", "venue scoring missing"],
    }),
    strategyTemplate({
      id: "eth_rotation",
      label: "BTC -> ETH rotation",
      category: "macro_rotation",
      actionType: "asset_rotation",
      arrivalFamily: "eth_like",
      supportType: "live_route_inventory",
      status: "supported_now_policy_sensitive",
      thesis: "Move BTC into ETH on supported chains for tactical positioning or collateral deployment.",
      supportedChains: ethRoutes.map((route) => route.dstChain),
      liveRouteCount: ethRoutes.length,
      blockers: ["adds market-risk drift", "Ethereum L1 remains observe-only in live ring"],
    }),
    strategyTemplate({
      id: "eth_destination_deployment",
      label: "ETH destination deployment",
      category: "yield",
      actionType: "custom_destination_action",
      arrivalFamily: "eth_like",
      supportType: "docs_use_case_plus_live_arrival_assets",
      status: "product_surface_supported",
      thesis: "Route BTC into ETH, then deploy into chain-native DeFi actions where ETH is the required arrival asset.",
      supportedChains: ethRoutes.map((route) => route.dstChain),
      liveRouteCount: ethRoutes.length,
      blockers: ["ETH branch in repo remains underobserved", "destination action scoring missing"],
    }),
    strategyTemplate({
      id: "gold_rotation",
      label: "BTC -> gold proxy rotation",
      category: "macro_rotation",
      actionType: "asset_rotation",
      arrivalFamily: "store_of_value",
      supportType: "live_route_inventory",
      status: "supported_now_policy_sensitive",
      thesis: "Rotate BTC into PAXG or XAUT for tactical hard-asset positioning.",
      supportedChains: storeOfValueRoutes.map((route) => route.dstChain),
      liveRouteCount: storeOfValueRoutes.length,
      blockers: ["small route surface", "Ethereum fee domain is hostile to the $300 phase"],
    }),
    strategyTemplate({
      id: "other_asset_rotation",
      label: "BTC -> other destination assets",
      category: "experimental",
      actionType: "asset_rotation",
      arrivalFamily: "other",
      supportType: "live_route_inventory",
      status: "experimental_only",
      thesis: "Investigate non-core destination assets that appear in the route set, but only after token verification and venue review.",
      supportedChains: otherRoutes.map((route) => route.dstChain),
      liveRouteCount: otherRoutes.length,
      blockers: ["unknown token metadata or unclear risk", "not suitable for autonomous deployment yet"],
    }),
    strategyTemplate({
      id: "custom_destination_actions",
      label: "Gateway custom destination actions",
      category: "platform",
      actionType: "custom_destination_action",
      arrivalFamily: "multi_asset",
      supportType: "official_docs_surface",
      status: "product_surface_supported",
      thesis: "Use Gateway SDK/API to send native BTC directly into custom DeFi workflows such as lending, LP, collateralization, or vault entry.",
      supportedChains: unique(liveRoutes.map((route) => route.dstChain)),
      liveRouteCount: liveRoutes.length,
      blockers: ["specific destination action registry and allowlist not implemented in repo"],
      notes: ["Docs explicitly list staking, lending, LP positions, and custom actions as supported use cases."],
    }),
    strategyTemplate({
      id: "partner_fee_monetization",
      label: "Partner fee monetization",
      category: "monetization",
      actionType: "partner_fee",
      arrivalFamily: "none",
      supportType: "official_docs_surface",
      status: "product_surface_supported",
      thesis: "Embed Gateway flows and charge configurable partner monetization without relying on a self-funded trade edge.",
      supportedChains: unique(liveRoutes.map((route) => route.dstChain)),
      liveRouteCount: 0,
      blockers: ["requires distribution or product integration rather than capital allocation"],
    }),
    strategyTemplate({
      id: "referral_revenue",
      label: "Referral revenue share",
      category: "monetization",
      actionType: "referral",
      arrivalFamily: "none",
      supportType: "official_blog_surface",
      status: "product_surface_supported",
      thesis: "Earn revenue share from referred Gateway swap flow while keeping capital deployment logic separate.",
      supportedChains: [],
      liveRouteCount: 0,
      blockers: ["requires user flow acquisition", "not a trading strategy"],
    }),
  ];

  return {
    schemaVersion: 1,
    generatedAt: now,
    liveSurface: {
      nativeBtcRouteCount: nativeBtcRoutes.length,
      destinationChains: unique(liveRoutes.map((route) => route.dstChain)),
      destinationFamilies: {
        wrappedBtc: wrapperRoutes.length,
        stablecoin: stableRoutes.length,
        ethLike: ethRoutes.length,
        storeOfValue: storeOfValueRoutes.length,
        other: otherRoutes.length,
      },
      liveRoutes,
    },
    staleAssumptionsRemoved: {
      missingFromLiveRoutes: (inventory?.btcWatchlistMissing || []).map(staleAssumptionEntry),
      note:
        "Items listed here may exist in old blogs or watchlists, but they are not present in the current live Gateway route inventory.",
    },
    currentReality: {
      topConclusion:
        "The live surface is no longer just BOB-local loops. Native BTC can already land on multiple destination chains and asset families, so the next agent should score destination deployment opportunities, not only transport spreads.",
      directWrappedBtcChains: unique(wrapperRoutes.map((route) => route.dstChain)),
      directStablecoinChains: unique(stableRoutes.map((route) => route.dstChain)),
      directEthLikeChains: unique(ethRoutes.map((route) => route.dstChain)),
      proxySpread: proxySpreadEvidence(strategySnapshot),
      triangularFlash: triangularEvidence(strategySnapshot),
    },
    allStrategyFamilies,
    rankedOpportunityFamilies: families.map((family) => ({
      ...family,
      liveRouteCount: family.liveRouteCount,
      supportBreadthScore: round(family.liveRouteCount / Math.max(1, nativeBtcRoutes.length), 4),
    })),
  };
}
