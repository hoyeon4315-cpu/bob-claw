// Generated from data.jsx by src/cli/build-dashboard-public.mjs.

(() => {
const CHAINS = [
  { id: "bitcoin", name: "Bitcoin", role: "source" },
  { id: "bob", name: "BOB", role: "destination" },
  { id: "base", name: "Base", role: "destination" },
  { id: "ethereum", name: "Ethereum", role: "destination" },
  { id: "bsc", name: "BNB", role: "destination" },
  { id: "avalanche", name: "Avalanche", role: "destination" },
  { id: "unichain", name: "Unichain", role: "destination" },
  { id: "bera", name: "Berachain", role: "destination" },
  { id: "optimism", name: "Optimism", role: "destination" },
  { id: "soneium", name: "Soneium", role: "destination" },
  { id: "sei", name: "Sei", role: "destination" },
  { id: "sonic", name: "Sonic", role: "destination" }
];
const STRATEGY_CATALOG = [
  { id: "wrapped-btc-loop-base-moonwell", label: "Wrapped BTC loop", sub: "Base \xB7 Moonwell", chain: "base", protocol: "moonwell", type: "loop", pair: ["cbbtc", "usdc"], loops: 3, capUsd: null, desc: "Primary BTC-denominated lending loop. cbBTC collateral, USDC borrow, repeat." },
  { id: "recursive_wrapped_btc_lending_loop", label: "Recursive wrapped-BTC loop", sub: "Base \xB7 Moonwell", chain: "base", protocol: "moonwell", type: "loop", pair: ["cbbtc", "usdc"], loops: 4, capUsd: null, desc: "Recursive variant under shadow evaluation." },
  { id: "gateway-btc-onramp", label: "Gateway BTC onramp", sub: "Bitcoin \u2192 Base", chain: "base", protocol: "gateway", type: "bridge", pair: ["btc", "cbbtc"], capUsd: null, desc: "Native BTC to cbBTC on Base via Gateway createOrder." },
  { id: "gateway-btc-offramp", label: "Gateway BTC offramp", sub: "Destination \u2192 Bitcoin", chain: "bob", protocol: "gateway", type: "payback", pair: ["cbbtc", "btc"], capUsd: null, desc: "Weekly payback path to operator Bitcoin L1 wallet." },
  { id: "gateway-btc-funding-transfer", label: "Gateway funding transfer", sub: "Inter-chain wrapped-BTC", chain: "bob", protocol: "gateway", type: "bridge", pair: ["cbbtc"], capUsd: null, desc: "Moves wrapped-BTC float between Gateway destinations." },
  { id: "proxy-spread-experiment", label: "BTC proxy spread", sub: "Gateway + Odos", chain: "ethereum", protocol: "odos", type: "arb", pair: ["wbtc", "cbbtc"], capUsd: null, desc: "Wrapper-BTC spread measurement across Gateway and Odos." },
  { id: "token-dex-experiment", label: "Token DEX probe", sub: "BSC \xB7 Odos", chain: "bsc", protocol: "odos", type: "swap", pair: ["usdt", "usdc"], capUsd: null, desc: "Deterministic ERC20 swap probe." },
  { id: "native-dex-experiment", label: "Native DEX probe", sub: "Unichain \xB7 Odos", chain: "unichain", protocol: "odos", type: "swap", pair: ["eth", "usdc"], capUsd: null, desc: "Native-gas asset swap probe." },
  { id: "gas-zip-native-refuel", label: "Gas.Zip refuel", sub: "Gas float top-up", chain: "avalanche", protocol: "gaszip", type: "refuel", pair: ["eth", "avax"], capUsd: null, desc: "Per-chain native gas float top-up fallback." },
  { id: "wrapper-btc-arbitrage", label: "Wrapper BTC arbitrage", sub: "Gateway \xB7 candidate", chain: "bob", protocol: "gateway", type: "arb", pair: ["wbtc", "cbbtc"], capUsd: null, desc: "Measured-edge wrapper-BTC arbitrage lane. Not auto-exec yet." },
  // W4–W7 tick-evaluated strategies
  { id: "beefy-folding-vault", label: "Beefy folding", sub: "BSC \xB7 Beefy", chain: "bsc", protocol: "beefy", type: "fold", pair: ["wbtc", "usdc"], capUsd: null, desc: "Leveraged yield vault via Beefy on BSC." },
  { id: "pendle-pt-lbtc-base", label: "Pendle PT-LBTC", sub: "Base \xB7 Pendle", chain: "base", protocol: "pendle", type: "pt", pair: ["lbtc", "usdc"], capUsd: null, desc: "Fixed-yield PT-LBTC direct entry via Pendle on Base." },
  { id: "aerodrome-cl-base", label: "Aerodrome CL", sub: "Base \xB7 Aerodrome", chain: "base", protocol: "aerodrome", type: "cl_lp", pair: ["cbbtc", "usdc"], capUsd: null, desc: "Concentrated liquidity LP on Aerodrome Base." },
  { id: "pendle-pt-solvbtc-bbn-bsc", label: "Pendle PT-SolvBTC", sub: "BSC \xB7 Pendle", chain: "bsc", protocol: "pendle", type: "pt", pair: ["solvbtc", "usdc"], capUsd: null, desc: "PT-SolvBTC.BBN direct via Gateway Custom Action on BSC." },
  { id: "berachain-bend-bex-bgt", label: "Berachain Bend+BEX", sub: "Bera \xB7 Bend", chain: "bera", protocol: "bend", type: "lp_bgt", pair: ["wbtc", "honey"], capUsd: null, desc: "Bend collateral + BEX LP with BGT rewards on Berachain." },
  { id: "stablecoin_spread_loop", label: "Stable spread loop", sub: "Base \xB7 Moonwell", chain: "base", protocol: "moonwell", type: "loop", pair: ["usdc", "usdt"], capUsd: null, desc: "Stablecoin supply-borrow spread loop on Base." },
  { id: "proxy_spread_expansion", label: "Proxy spread expansion", sub: "Base \xB7 Morpho", chain: "base", protocol: "morpho", type: "loop", pair: ["usdc", "usdt"], capUsd: null, desc: "Leveraged proxy stable spread via Morpho on Base." },
  { id: "tokenized_reserve_sleeve", label: "Tokenized reserve", sub: "BSC \xB7 Pendle", chain: "bsc", protocol: "pendle", type: "reserve", pair: ["pt-solvbtc", "usdc"], capUsd: null, desc: "Tokenized BTC reserve sleeve on BSC." },
  { id: "gateway_native_asset_conversion_sleeve", label: "Gateway native sleeve", sub: "Base \xB7 Gateway", chain: "base", protocol: "gateway", type: "canary", pair: ["usdc", "usdc"], capUsd: 0.25, desc: "Multi-protocol yield sleeve via Gateway. Merkl-sourced." },
  // Tick-registered strategies missing from earlier catalog
  { id: "recursive_stablecoin_lending_loop", label: "Recursive stable lending", sub: "Base \xB7 Morpho/Aave", chain: "base", protocol: "morpho", type: "loop", pair: ["wbtc", "usdc"], capUsd: null, desc: "Recursive stablecoin lending loop via Merkl-discovered venues." },
  { id: "destination_wrapped_btc_rotation", label: "Wrapped BTC rotation", sub: "Multi-chain \xB7 Gateway", chain: "base", protocol: "gateway", type: "arb", pair: ["wbtc", "cbbtc"], capUsd: null, desc: "Destination-chain wrapped-BTC rotation." },
  { id: "stablecoin_treasury_rotation", label: "Stable treasury rotation", sub: "Multi-chain \xB7 Gateway", chain: "base", protocol: "gateway", type: "canary", pair: ["usdc", "usdt"], capUsd: null, desc: "Stablecoin treasury rotation across destinations." },
  { id: "gateway_proxy_spread_rebalance_recheck", label: "Proxy spread rebalance", sub: "Base \xB7 Gateway", chain: "base", protocol: "gateway", type: "arb", pair: ["wbtc", "cbbtc"], capUsd: null, desc: "Gateway proxy spread rebalance recheck." },
  { id: "macro_asset_rotation", label: "Macro asset rotation", sub: "Multi-chain \xB7 Gateway", chain: "base", protocol: "gateway", type: "canary", pair: ["usdc", "usdt"], capUsd: null, desc: "Macro-level asset rotation sleeve." },
  { id: "eth_destination_deployment", label: "ETH destination deploy", sub: "Ethereum \xB7 Multi", chain: "ethereum", protocol: "aave", type: "canary", pair: ["eth", "usdc"], capUsd: null, desc: "ETH-family destination deployment scaffold." },
  { id: "onchain_btc_perp_basis", label: "BTC perp basis", sub: "Avalanche \xB7 GMX", chain: "avalanche", protocol: "gmx", type: "basis", pair: ["btc.b", "usdc"], capUsd: null, desc: "Delta-neutral BTC perp basis via GMX V2." }
];
function normalizeStrategyId(id) {
  return String(id || "").replace(/-/g, "_");
}
function activeStrategyStatus({ hasLivePosition, isLiveCandidate, hasRecentActivity, tickMode, fallbackStatus }) {
  if (hasLivePosition) return "LIVE";
  if (isLiveCandidate) return "POLICY READY";
  if (hasRecentActivity) return "ACTIVITY";
  if (tickMode === "shadow_ready") return "SHADOW";
  if (tickMode === "blocked") return "BLOCKED";
  return fallbackStatus || "CANDIDATE";
}
function deriveStatus(live) {
  if (live?.autoExecute === true && live?.blockers?.length === 0) return "LIVE";
  if (live?.autoExecute === true) return "ARMED";
  if (live?.autoExecute === false && live?.preliveReady) return "DRY RUN";
  return "CANDIDATE";
}
function cleanUnknown(value) {
  if (typeof value !== "string") return value ?? null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "unknown") return null;
  return value;
}
function satsToUsd(sats, btcUsd) {
  if (!Number.isFinite(sats) || !Number.isFinite(btcUsd)) return null;
  return sats / 1e8 * btcUsd;
}
function estimateYieldUsd({ status, capUsd, apyPct, lastObservedAt, generatedAt }) {
  if (status !== "LIVE") return 0;
  if (!Number.isFinite(capUsd) || capUsd <= 0) return 0;
  if (!Number.isFinite(apyPct) || apyPct <= 0) return 0;
  if (!lastObservedAt || !generatedAt) return 0;
  const openedAtMs = new Date(lastObservedAt).getTime();
  const generatedAtMs = new Date(generatedAt).getTime();
  if (!Number.isFinite(openedAtMs) || !Number.isFinite(generatedAtMs) || generatedAtMs <= openedAtMs) return 0;
  const elapsedMs = generatedAtMs - openedAtMs;
  const yearMs = 365 * 24 * 60 * 60 * 1e3;
  return capUsd * (apyPct / 100) * (elapsedMs / yearMs);
}
function capitalProtocolKey(chainId, protocolId) {
  return chainId && protocolId ? `${chainId}:${protocolId}` : null;
}
function accumulateUsd(map, key, usd) {
  if (!key || !Number.isFinite(usd) || usd <= 0) return;
  map[key] = (map[key] || 0) + usd;
}
function buildCapitalMaps(holdings = null) {
  const byChain = {};
  const walletByChain = {};
  const deployedByChain = {};
  const byProtocol = {};
  const walletItems = Array.isArray(holdings?.all) ? holdings.all : [];
  const positionItems = Array.isArray(holdings?.positions) ? holdings.positions : [];
  walletItems.forEach((item) => {
    accumulateUsd(byChain, item?.chain || null, Number(item?.usd));
    accumulateUsd(walletByChain, item?.chain || null, Number(item?.usd));
  });
  positionItems.forEach((item) => {
    const usd = Number(item?.usd);
    accumulateUsd(byChain, item?.chain || null, usd);
    accumulateUsd(deployedByChain, item?.chain || null, usd);
    accumulateUsd(byProtocol, capitalProtocolKey(item?.chain || null, item?.protocol || null), usd);
  });
  return {
    byChain,
    walletByChain,
    deployedByChain,
    byProtocol,
    walletUsd: Number.isFinite(holdings?.walletUsd) ? holdings.walletUsd : null,
    deployedUsd: Number.isFinite(holdings?.deployedUsd) ? holdings.deployedUsd : null,
    totalUsd: Number.isFinite(holdings?.totalUsd) ? holdings.totalUsd : null,
    estimatedProtocolDeployedUsd: Number.isFinite(holdings?.estimatedProtocolDeployedUsd) ? holdings.estimatedProtocolDeployedUsd : null,
    estimatedCurrentTotalUsd: Number.isFinite(holdings?.estimatedCurrentTotalUsd) ? holdings.estimatedCurrentTotalUsd : null,
    estimatedUntrackedProtocolUsd: Number.isFinite(holdings?.estimatedUntrackedProtocolUsd) ? holdings.estimatedUntrackedProtocolUsd : null,
    verifiedMinimumUsd: Number.isFinite(holdings?.verifiedMinimumUsd) ? holdings.verifiedMinimumUsd : null,
    pending: holdings?.pending === true,
    generatedAt: holdings?.generatedAt || null
  };
}
function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
function firstFinite(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return null;
}
function capitalizeWord(value) {
  return String(value || "").split(/[\s._-]+/).filter(Boolean).map((part) => {
    const lower = part.toLowerCase();
    if (lower === "yo") return "YO";
    if (lower === "gmx") return "GMX";
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}
function inferActivityType(activity, strategy = null) {
  const detail = String(activity?.detail || "").toLowerCase();
  if (detail.includes("erc4626")) return "lp";
  if (detail.includes("approve")) return strategy?.type || "canary";
  if (detail.includes("redeem")) return "lp";
  return strategy?.type || "canary";
}
function inferActivityAction(activity) {
  const detail = String(activity?.detail || "").toLowerCase();
  if (detail.includes("approve")) return "approve";
  if (detail.includes("erc4626_deposit")) return "deposit";
  if (detail.includes("erc4626_redeem")) return "redeem";
  if (detail.includes("bridge")) return "bridge";
  if (detail.includes("swap")) return "swap";
  return activity?.status || "activity";
}
function addSurfaceAsset(summary, assetId) {
  if (!assetId) return;
  if (!summary.assets.includes(assetId)) summary.assets.push(assetId);
}
function updateLatestSurface(summary, observedAt) {
  if (!observedAt) return;
  if (!summary.latestAt || timestampMs(observedAt) > timestampMs(summary.latestAt)) {
    summary.latestAt = observedAt;
  }
}
function buildActivitySurfaces(activities = [], strategies = []) {
  const byProtocol = {};
  const byChain = {};
  const syntheticByProtocol = {};
  const strategyByNormalizedId = Object.fromEntries(
    (strategies || []).map((strategy) => [normalizeStrategyId(strategy.id), strategy])
  );
  const knownProtocolKeys = new Set(
    (strategies || []).map((strategy) => capitalProtocolKey(strategy.chain, strategy.protocol)).filter(Boolean)
  );
  for (const activity of activities || []) {
    const strategy = strategyByNormalizedId[normalizeStrategyId(activity?.strategyId)] || null;
    const chain = cleanUnknown(activity?.chain) || strategy?.chain || null;
    const protocol = cleanUnknown(activity?.protocol) || strategy?.protocol || null;
    const assetId = cleanUnknown(activity?.finalAssetId) || cleanUnknown(activity?.finalAssetLabel) || strategy?.pair?.[0] || null;
    const observedAt = activity?.observedAt || null;
    const action = inferActivityAction(activity);
    const positiveUsd = Number.isFinite(activity?.amountUsd) && activity.amountUsd > 0 ? activity.amountUsd : 0;
    if (chain) {
      const chainSurface = byChain[chain] || (byChain[chain] = {
        chain,
        count: 0,
        usd: 0,
        latestAt: null,
        assets: [],
        actions: []
      });
      chainSurface.count += 1;
      chainSurface.usd += positiveUsd;
      updateLatestSurface(chainSurface, observedAt);
      addSurfaceAsset(chainSurface, assetId);
      if (!chainSurface.actions.includes(action)) chainSurface.actions.push(action);
    }
    if (!chain || !protocol) continue;
    const key = capitalProtocolKey(chain, protocol);
    const protocolSurface = byProtocol[key] || (byProtocol[key] = {
      key,
      chain,
      protocol,
      count: 0,
      usd: 0,
      latestAt: null,
      assets: [],
      actions: [],
      statuses: []
    });
    protocolSurface.count += 1;
    protocolSurface.usd += positiveUsd;
    updateLatestSurface(protocolSurface, observedAt);
    addSurfaceAsset(protocolSurface, assetId);
    if (!protocolSurface.actions.includes(action)) protocolSurface.actions.push(action);
    if (activity?.status && !protocolSurface.statuses.includes(activity.status)) {
      protocolSurface.statuses.push(activity.status);
    }
    if (knownProtocolKeys.has(key)) continue;
    const synthetic = syntheticByProtocol[key] || (syntheticByProtocol[key] = {
      id: `activity:${chain}:${protocol}`,
      label: capitalizeWord(protocol),
      sub: `${capitalizeWord(chain)} \xB7 ${capitalizeWord(protocol)}`,
      chain,
      protocol,
      type: inferActivityType(activity, strategy),
      pair: assetId ? [assetId] : Array.isArray(strategy?.pair) && strategy.pair.length ? strategy.pair : ["usdc"],
      loops: null,
      capUsd: null,
      desc: `${capitalizeWord(protocol)} recent live activity.`,
      autoExecute: false,
      status: "ACTIVE",
      earnedUsd: 0,
      realizedYieldUsd: 0,
      estimatedYieldUsd: 0,
      yieldBasis: null,
      apyPct: null,
      tickMode: "live_activity",
      tickBlockers: [],
      microCanaryStatus: "active",
      blockerCount: 0,
      topBlocker: null,
      projectedNetUsd: null,
      lastTickAt: observedAt,
      riskHint: strategy?.riskHint || null,
      actualProtocolCapitalUsd: 0,
      actualChainCapitalUsd: 0,
      surfaceOnly: "mindmap",
      recentActivityCount: 0,
      recentActivityUsd: 0,
      recentActivityAssets: [],
      recentActivityActions: [],
      latestActivityAt: null
    });
    synthetic.recentActivityCount += 1;
    synthetic.recentActivityUsd += positiveUsd;
    synthetic.lastTickAt = observedAt || synthetic.lastTickAt;
    synthetic.latestActivityAt = observedAt || synthetic.latestActivityAt;
    addSurfaceAsset({ assets: synthetic.recentActivityAssets }, assetId);
    if (!synthetic.recentActivityActions.includes(action)) synthetic.recentActivityActions.push(action);
  }
  return {
    byProtocol,
    byChain,
    syntheticStrategies: Object.values(syntheticByProtocol)
  };
}
function buildMovementSurfaces(movements = []) {
  const byChain = {};
  const seenMovementKeys = /* @__PURE__ */ new Set();
  for (const movement of movements || []) {
    const movementKey = movement?.routeKey || `${movement?.fromChainId}->${movement?.toChainId}:${movement?.assetId || "asset"}`;
    if (seenMovementKeys.has(movementKey)) continue;
    seenMovementKeys.add(movementKey);
    const usd = Number.isFinite(movement?.amountUsd) && movement.amountUsd > 0 ? movement.amountUsd : 0;
    const assetId = cleanUnknown(movement?.assetId) || cleanUnknown(movement?.asset) || cleanUnknown(movement?.finalAssetId) || null;
    const observedAt = movement?.observedAt || movement?.createdAt || movement?.timestamp || null;
    const chainIds = [movement?.fromChainId, movement?.toChainId].map(cleanUnknown).filter(Boolean);
    const uniqueChainIds = [...new Set(chainIds)];
    for (const chain of uniqueChainIds) {
      const chainSurface = byChain[chain] || (byChain[chain] = {
        chain,
        count: 0,
        usd: 0,
        latestAt: null,
        assets: []
      });
      chainSurface.count += 1;
      chainSurface.usd += usd;
      updateLatestSurface(chainSurface, observedAt);
      addSurfaceAsset(chainSurface, assetId);
    }
  }
  return { byChain };
}
const LIVE_STATUS_PATH = "./api/live-status";
const LIVE_EVENTS_PATH = "./api/live-events";
const STATIC_STATUS_PATH = "./dashboard-status.json";
const LIVE_RUNTIME_PATH = "./live-runtime.json";
const LIVE_POLL_MS = 1500;
const STATIC_POLL_MS = 5e3;
const LIVE_RUNTIME_REFRESH_MS = 3e4;
const FETCH_TIMEOUT_MS = 1200;
const LIVE_FETCH_TIMEOUT_MS = 4500;
function statusGeneratedAtMs(status = null) {
  const ms = new Date(status?.generatedAt || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}
function statusReportingBaseline(status = null) {
  return status?.pnl?.reportingBaseline || status?.reportingPnlBaseline || null;
}
function hasActiveReportingBaseline(status = null) {
  const baseline = statusReportingBaseline(status);
  return baseline?.active === true && baseline?.applied !== false;
}
function hasDashboardCapital(status = null) {
  return Boolean(
    status?.capitalSummary && Number.isFinite(status.capitalSummary.currentTotalUsd) && status.capitalSummary.assetConfidence && status?.walletHoldings && status?.flow
  );
}
function statusSourceRank(source = null) {
  if (source === "remote-live-sse") return 5;
  if (source === "live-sse") return 4;
  if (source === "remote-live-api") return 3;
  if (source === "live-api") return 2;
  if (source === "static-snapshot") return 1;
  return 0;
}
function selectPreferredStatusPayload(candidates = []) {
  const available = candidates.filter((candidate) => candidate?.status);
  if (available.length === 0) return { status: null, source: "unavailable", live: false };
  const complete = available.filter((candidate) => hasDashboardCapital(candidate.status));
  const comparable = complete.length > 0 ? complete : available;
  return [...comparable].sort((left, right) => {
    const sourceDiff = statusSourceRank(right.source) - statusSourceRank(left.source);
    if (sourceDiff !== 0) return sourceDiff;
    const baselineDiff = Number(hasActiveReportingBaseline(right.status)) - Number(hasActiveReportingBaseline(left.status));
    if (baselineDiff !== 0) return baselineDiff;
    const generatedAtDiff = (statusGeneratedAtMs(right.status) || 0) - (statusGeneratedAtMs(left.status) || 0);
    if (generatedAtDiff !== 0) return generatedAtDiff;
    return 0;
  })[0];
}
async function fetchEndpointStatus(endpoint) {
  const controller = window.AbortController ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), endpoint.timeoutMs || FETCH_TIMEOUT_MS) : null;
  try {
    const resp = await fetch(endpoint.url, {
      cache: "no-store",
      mode: endpoint.remote ? "cors" : "same-origin",
      signal: controller?.signal
    });
    if (!resp.ok) return null;
    const status = await resp.json();
    return { status, source: endpoint.source, live: endpoint.live, remote: Boolean(endpoint.remote) };
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
async function fetchStaticStatusPayload() {
  return await fetchEndpointStatus({
    url: `${STATIC_STATUS_PATH}?t=${Date.now()}`,
    source: "static-snapshot",
    live: false,
    remote: false
  }) || { status: null, source: "unavailable", live: false };
}
async function resolveConfiguredLiveRuntime({ forceRefresh = false } = {}) {
  const cached = window._DASHBOARD_LIVE_RUNTIME || null;
  if (!forceRefresh && cached && Date.now() - window._DASHBOARD_LIVE_RUNTIME_RESOLVED_AT < LIVE_RUNTIME_REFRESH_MS) {
    return cached;
  }
  try {
    const resp = await fetch(`${LIVE_RUNTIME_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`live runtime ${resp.status}`);
    const payload = await resp.json();
    window._DASHBOARD_LIVE_RUNTIME = payload && payload.enabled && payload.origin ? {
      enabled: true,
      origin: String(payload.origin).replace(/\/$/, ""),
      statusUrl: payload.statusUrl || `${String(payload.origin).replace(/\/$/, "")}/api/live-status`,
      eventsUrl: payload.eventsUrl || `${String(payload.origin).replace(/\/$/, "")}/api/live-events`
    } : { enabled: false, origin: null, statusUrl: null, eventsUrl: null };
    window._DASHBOARD_LIVE_RUNTIME_RESOLVED_AT = Date.now();
  } catch {
    window._DASHBOARD_LIVE_RUNTIME = cached || { enabled: false, origin: null, statusUrl: null, eventsUrl: null };
    window._DASHBOARD_LIVE_RUNTIME_RESOLVED_AT = Date.now();
  }
  return window._DASHBOARD_LIVE_RUNTIME;
}
async function fetchStatusPayload() {
  const now = Date.now();
  const runtime = await resolveConfiguredLiveRuntime();
  const endpoints = [
    ...runtime?.enabled ? [{ url: `${runtime.statusUrl}?t=${now}`, source: "remote-live-api", live: true, origin: runtime.origin, remote: true, timeoutMs: LIVE_FETCH_TIMEOUT_MS }] : [],
    { url: `${LIVE_STATUS_PATH}?t=${now}`, source: "live-api", live: true },
    { url: `${STATIC_STATUS_PATH}?t=${now}`, source: "static-snapshot", live: false }
  ];
  const candidates = await Promise.all(endpoints.map(fetchEndpointStatus));
  const remoteLive = candidates.find((candidate) => candidate?.source === "remote-live-api" && candidate?.status);
  if (runtime?.enabled && !remoteLive) {
    const refreshedRuntime = await resolveConfiguredLiveRuntime({ forceRefresh: true });
    if (refreshedRuntime?.enabled && refreshedRuntime.statusUrl !== runtime.statusUrl) {
      const retry = await fetchEndpointStatus({
        url: `${refreshedRuntime.statusUrl}?t=${Date.now()}`,
        source: "remote-live-api",
        live: true,
        origin: refreshedRuntime.origin,
        remote: true,
        timeoutMs: LIVE_FETCH_TIMEOUT_MS
      });
      candidates.push(retry);
    }
  }
  return selectPreferredStatusPayload(candidates);
}
async function bootData(payload = null, { preserveCurrentOnMismatch = false } = {}) {
  const currentStatus = window.RAW_STATUS || null;
  const currentLiveStatus = window.LIVE_STATUS || {};
  const resolved = payload || await fetchStatusPayload();
  const incomingStatus = resolved?.status || null;
  if (preserveCurrentOnMismatch && currentStatus && hasActiveReportingBaseline(currentStatus) && !hasActiveReportingBaseline(incomingStatus)) {
    return {
      status: currentStatus,
      source: currentLiveStatus.source || "fallback",
      live: Boolean(currentLiveStatus.live),
      remote: Boolean(currentLiveStatus.remote)
    };
  }
  if (currentStatus && Number.isFinite(statusGeneratedAtMs(currentStatus)) && Number.isFinite(statusGeneratedAtMs(incomingStatus)) && statusGeneratedAtMs(incomingStatus) < statusGeneratedAtMs(currentStatus) && hasActiveReportingBaseline(currentStatus) === hasActiveReportingBaseline(incomingStatus)) {
    return {
      status: currentStatus,
      source: currentLiveStatus.source || "fallback",
      live: Boolean(currentLiveStatus.live),
      remote: Boolean(currentLiveStatus.remote)
    };
  }
  const status = resolved?.status || null;
  const holdings = status?.walletHoldings || null;
  const merklActive = status?.strategy?.merklActivePositions || null;
  const operations = status?.operations?.allChainAutopilot || null;
  const capitalSummary = status?.capitalSummary || null;
  const flow = status?.flow || null;
  const liveYield = flow?.liveYield || null;
  const statusAsOf = status?.liveTransport?.servedAt || status?.capitalSummary?.generatedAt || status?.generatedAt || null;
  const lanePolicy = status?.overall?.lanePolicy || {};
  const primaryId = lanePolicy?.candidateId || "wrapped-btc-loop-base-moonwell";
  const primaryPolicy = lanePolicy?.strategyPolicy || {};
  const payback = status?.payback || {};
  const pnl = status?.pnl || {};
  const realizedUsd = pnl?.realized?.valueUsd;
  const realizedEvidenceCostUsd = pnl?.realized?.evidenceCostUsd;
  const realizedTotalUsd = pnl?.realized?.totalValueUsd;
  const realizedBreakdown = pnl?.realized?.breakdown || {};
  const btcUsd = status?.market?.btcUsd || status?.market?.btc?.usd || null;
  const liveApr = holdings?.protocolApr || {};
  const assetTracking = status?.assetTracking || null;
  const summaryDisplayWalletUsd = Number.isFinite(capitalSummary?.walletUsd) ? capitalSummary.walletUsd : Number.isFinite(capitalSummary?.displayWalletUsd) ? capitalSummary.displayWalletUsd : null;
  const summaryDisplayTotalUsd = Number.isFinite(summaryDisplayWalletUsd) && Number.isFinite(capitalSummary?.deployedUsd) ? summaryDisplayWalletUsd + capitalSummary.deployedUsd : Number.isFinite(capitalSummary?.displayTotalUsd) ? capitalSummary.displayTotalUsd : null;
  const summaryCurrentWalletUsd = Number.isFinite(capitalSummary?.currentWalletUsd) ? capitalSummary.currentWalletUsd : summaryDisplayWalletUsd;
  const summaryProtocolDeployedUsd = Number.isFinite(capitalSummary?.protocolDeployedUsd) ? capitalSummary.protocolDeployedUsd : Number.isFinite(capitalSummary?.deployedUsd) ? capitalSummary.deployedUsd : null;
  const summaryCurrentTotalUsd = Number.isFinite(capitalSummary?.currentTotalUsd) ? capitalSummary.currentTotalUsd : Number.isFinite(summaryCurrentWalletUsd) && Number.isFinite(summaryProtocolDeployedUsd) ? summaryCurrentWalletUsd + summaryProtocolDeployedUsd : summaryDisplayTotalUsd;
  const summaryHasCurrentExternalReference = capitalSummary?.walletCoverage === "full_external" && capitalSummary?.fullWalletStale !== true && Number.isFinite(capitalSummary?.fullWalletUsd);
  const summaryReferenceFullWalletGapUsd = Number.isFinite(capitalSummary?.referenceFullWalletGapUsd) ? capitalSummary.referenceFullWalletGapUsd : summaryHasCurrentExternalReference && Number.isFinite(summaryCurrentTotalUsd) ? Math.max(0, Math.round((capitalSummary.fullWalletUsd - summaryCurrentTotalUsd) * 100) / 100) : null;
  const summaryPlanGapUsd = Number.isFinite(capitalSummary?.planGapUsd) ? capitalSummary.planGapUsd : null;
  const summaryProtocolTrackingGapUsd = Number.isFinite(capitalSummary?.protocolTrackingGapUsd) ? capitalSummary.protocolTrackingGapUsd : Number.isFinite(capitalSummary?.trackingGapUsd) ? capitalSummary.trackingGapUsd : null;
  const summaryEstimatedUntrackedProtocolUsd = Number.isFinite(capitalSummary?.estimatedUntrackedProtocolUsd) ? capitalSummary.estimatedUntrackedProtocolUsd : null;
  const summaryEstimatedProtocolDeployedUsd = Number.isFinite(capitalSummary?.estimatedProtocolDeployedUsd) ? capitalSummary.estimatedProtocolDeployedUsd : Number.isFinite(summaryProtocolDeployedUsd) && Number.isFinite(summaryEstimatedUntrackedProtocolUsd) ? Math.round((summaryProtocolDeployedUsd + summaryEstimatedUntrackedProtocolUsd) * 100) / 100 : summaryProtocolDeployedUsd;
  const summaryEstimatedCurrentTotalUsd = Number.isFinite(capitalSummary?.estimatedCurrentTotalUsd) ? capitalSummary.estimatedCurrentTotalUsd : Number.isFinite(summaryCurrentWalletUsd) && Number.isFinite(summaryEstimatedProtocolDeployedUsd) ? Math.round((summaryCurrentWalletUsd + summaryEstimatedProtocolDeployedUsd) * 100) / 100 : summaryCurrentTotalUsd;
  const summaryVerifiedMinimumUsd = Number.isFinite(capitalSummary?.verifiedMinimumUsd) ? capitalSummary.verifiedMinimumUsd : summaryCurrentTotalUsd;
  const summaryNeedsReconciliation = capitalSummary?.assetConfidence === "verified_minimum" || capitalSummary?.reconciliationState === "needs_reconciliation" || Number(capitalSummary?.walletScanErrorCount || 0) > 0 || Number.isFinite(summaryReferenceFullWalletGapUsd) && summaryReferenceFullWalletGapUsd > 1 || Boolean(capitalSummary?.accountingWarning);
  const summaryAssetConfidence = capitalSummary?.assetConfidence || (summaryNeedsReconciliation ? "verified_minimum" : "verified_current");
  const summaryAssetHeadline = capitalSummary?.assetHeadline || (summaryAssetConfidence === "verified_minimum" ? "Verified minimum assets" : "Current total assets");
  const summaryReconciliationState = capitalSummary?.reconciliationState || (summaryNeedsReconciliation ? "needs_reconciliation" : "reconciled");
  const summaryDisplayTotalUsdSource = summaryHasCurrentExternalReference ? capitalSummary?.fullWalletStale === true ? "supported_wallet_plus_positions_cached_external_reference" : capitalSummary?.displayTotalUsdSource || "supported_wallet_plus_positions_external_reference" : capitalSummary?.displayTotalUsdSource || null;
  const fallbackDisplayWalletUsd = Number.isFinite(holdings?.totalUsd) ? holdings.totalUsd : null;
  const fallbackHasCurrentExternalReference = holdings?.walletCoverage === "full_external" && holdings?.fullWalletStale !== true && Number.isFinite(holdings?.fullWalletUsd);
  const HOLDINGS = capitalSummary && Array.isArray(capitalSummary.walletItems) ? {
    all: capitalSummary.walletItems,
    positions: Array.isArray(capitalSummary.positionItems) ? capitalSummary.positionItems : [],
    totalUsd: Number.isFinite(capitalSummary.totalUsd) ? capitalSummary.totalUsd : null,
    walletUsd: Number.isFinite(capitalSummary.walletUsd) ? capitalSummary.walletUsd : null,
    deployedUsd: Number.isFinite(capitalSummary.deployedUsd) ? capitalSummary.deployedUsd : null,
    currentWalletUsd: summaryCurrentWalletUsd,
    protocolDeployedUsd: summaryProtocolDeployedUsd,
    currentTotalUsd: summaryCurrentTotalUsd,
    estimatedProtocolDeployedUsd: summaryEstimatedProtocolDeployedUsd,
    estimatedCurrentTotalUsd: summaryEstimatedCurrentTotalUsd,
    verifiedMinimumUsd: summaryVerifiedMinimumUsd,
    estimatedUntrackedProtocolUsd: summaryEstimatedUntrackedProtocolUsd,
    estimatedTotalUsdSource: capitalSummary.estimatedTotalUsdSource || null,
    assetFormula: capitalSummary.assetFormula || "current_wallet_plus_protocol_positions",
    accountedUsd: Number.isFinite(capitalSummary.accountedUsd) ? capitalSummary.accountedUsd : null,
    executorEstimatedTotalUsd: Number.isFinite(capitalSummary.executorEstimatedTotalUsd) ? capitalSummary.executorEstimatedTotalUsd : null,
    executorEstimateDeltaUsd: Number.isFinite(capitalSummary.executorEstimateDeltaUsd) ? capitalSummary.executorEstimateDeltaUsd : null,
    capitalPlanRefillRequiredUsd: Number.isFinite(capitalSummary.capitalPlanRefillRequiredUsd) ? capitalSummary.capitalPlanRefillRequiredUsd : null,
    totalUsdSource: capitalSummary.totalUsdSource || null,
    displayWalletUsd: summaryDisplayWalletUsd,
    displayTotalUsd: summaryDisplayTotalUsd,
    displayTotalUsdSource: summaryDisplayTotalUsdSource,
    itemizedSupportedWalletUsd: Number.isFinite(capitalSummary.itemizedSupportedWalletUsd) ? capitalSummary.itemizedSupportedWalletUsd : null,
    walletCoverage: summaryHasCurrentExternalReference ? capitalSummary.walletCoverage || null : capitalSummary.walletCoverage === "full_external_stale" ? "partial_supported" : capitalSummary.walletCoverage || null,
    fullWalletUsd: summaryHasCurrentExternalReference ? capitalSummary.fullWalletUsd : null,
    fullWalletObservedAt: summaryHasCurrentExternalReference ? capitalSummary.fullWalletObservedAt || null : null,
    fullWalletProvider: summaryHasCurrentExternalReference ? capitalSummary.fullWalletProvider || null : null,
    fullWalletStale: false,
    accountingWarning: capitalSummary.accountingWarning || null,
    assetConfidence: summaryAssetConfidence,
    assetHeadline: summaryAssetHeadline,
    reconciliationState: summaryReconciliationState,
    referenceFullWalletGapUsd: summaryReferenceFullWalletGapUsd,
    planGapUsd: summaryPlanGapUsd,
    protocolTrackingGapUsd: summaryProtocolTrackingGapUsd,
    trackingGapUsd: summaryProtocolTrackingGapUsd,
    trackingGapSource: capitalSummary.trackingGapSource || (Number.isFinite(summaryProtocolTrackingGapUsd) && summaryProtocolTrackingGapUsd > 0 ? "automation_estimate_minus_verified_assets" : null),
    reconciliationGapUsd: Number.isFinite(capitalSummary.reconciliationGapUsd) ? capitalSummary.reconciliationGapUsd : null,
    assetTracking: assetTracking ? {
      coverageState: assetTracking.coverageState || null,
      dashboardHeadline: assetTracking.dashboardHeadline || null,
      riskReady: assetTracking.riskReady === true,
      exactTotalUsd: Number.isFinite(assetTracking.exactTotalUsd) ? assetTracking.exactTotalUsd : null,
      verifiedKnownUsd: Number.isFinite(assetTracking.verifiedKnownUsd) ? assetTracking.verifiedKnownUsd : null,
      riskUsableUsd: Number.isFinite(assetTracking.riskUsableUsd) ? assetTracking.riskUsableUsd : null,
      externalReferenceUsd: Number.isFinite(assetTracking.externalReferenceUsd) ? assetTracking.externalReferenceUsd : null,
      externalUnclassifiedUsd: Number.isFinite(assetTracking.externalUnclassifiedUsd) ? assetTracking.externalUnclassifiedUsd : null,
      unexplainedGapUsd: Number.isFinite(assetTracking.unexplainedGapUsd) ? assetTracking.unexplainedGapUsd : null,
      blockers: Array.isArray(assetTracking.blockers) ? assetTracking.blockers : []
    } : null,
    systemConfidence: capitalSummary.systemConfidence || (summaryAssetConfidence === "verified_current" ? "high" : "medium"),
    autoExecutionSafe: capitalSummary.autoExecutionSafe === true,
    invariantViolationCount: Number.isFinite(capitalSummary.invariantViolationCount) ? capitalSummary.invariantViolationCount : 0,
    invariantViolations: Array.isArray(capitalSummary.invariantViolations) ? capitalSummary.invariantViolations : [],
    pendingSignerActionCount: Number.isFinite(capitalSummary.pendingSignerActionCount) ? capitalSummary.pendingSignerActionCount : 0,
    adapterCoverageGapCount: Number.isFinite(capitalSummary.adapterCoverageGapCount) ? capitalSummary.adapterCoverageGapCount : 0,
    currentProtocolMarkCount: Number.isFinite(capitalSummary.currentProtocolMarkCount) ? capitalSummary.currentProtocolMarkCount : 0,
    protocolMarkIssueCount: Number.isFinite(capitalSummary.protocolMarkIssueCount) ? capitalSummary.protocolMarkIssueCount : 0,
    protocolMarkCoverageState: capitalSummary.protocolMarkCoverageState || null,
    latestProtocolMarkObservedAt: capitalSummary.latestProtocolMarkObservedAt || null,
    walletSource: capitalSummary.walletSource || null,
    walletObservedAt: capitalSummary.walletObservedAt || null,
    walletScanErrorCount: Number.isFinite(capitalSummary.walletScanErrorCount) ? capitalSummary.walletScanErrorCount : 0,
    walletScanErrors: Array.isArray(capitalSummary.walletScanErrors) ? capitalSummary.walletScanErrors : [],
    externalWalletUsd: summaryHasCurrentExternalReference && Number.isFinite(capitalSummary.externalWalletUsd) ? capitalSummary.externalWalletUsd : null,
    unclassifiedUsd: summaryHasCurrentExternalReference && Number.isFinite(capitalSummary.unclassifiedUsd) ? capitalSummary.unclassifiedUsd : null,
    pending: false,
    generatedAt: capitalSummary.generatedAt || status?.generatedAt || null
  } : holdings && Array.isArray(holdings.items) ? {
    all: holdings.items,
    positions: [],
    totalUsd: Number.isFinite(holdings.totalUsd) ? holdings.totalUsd : null,
    walletUsd: Number.isFinite(holdings.totalUsd) ? holdings.totalUsd : null,
    deployedUsd: 0,
    currentWalletUsd: fallbackDisplayWalletUsd,
    protocolDeployedUsd: 0,
    currentTotalUsd: fallbackDisplayWalletUsd,
    estimatedProtocolDeployedUsd: 0,
    estimatedCurrentTotalUsd: fallbackDisplayWalletUsd,
    verifiedMinimumUsd: fallbackDisplayWalletUsd,
    estimatedUntrackedProtocolUsd: null,
    estimatedTotalUsdSource: null,
    assetFormula: "current_wallet_plus_protocol_positions",
    displayWalletUsd: fallbackDisplayWalletUsd,
    displayTotalUsd: fallbackDisplayWalletUsd,
    displayTotalUsdSource: fallbackHasCurrentExternalReference ? holdings.fullWalletStale === true ? "supported_wallet_cached_external_reference" : "supported_wallet_external_reference" : "partial_supported_wallet",
    itemizedSupportedWalletUsd: Number.isFinite(holdings.itemizedSupportedWalletUsd) ? holdings.itemizedSupportedWalletUsd : null,
    walletCoverage: fallbackHasCurrentExternalReference ? holdings.walletCoverage || null : holdings.walletCoverage === "full_external_stale" ? "partial_supported" : holdings.walletCoverage || null,
    fullWalletUsd: fallbackHasCurrentExternalReference ? holdings.fullWalletUsd : null,
    fullWalletObservedAt: fallbackHasCurrentExternalReference ? holdings.fullWalletObservedAt || null : null,
    fullWalletProvider: fallbackHasCurrentExternalReference ? holdings.fullWalletProvider || null : null,
    fullWalletStale: false,
    walletSource: holdings.source || null,
    walletObservedAt: holdings.observedAt || null,
    walletScanErrorCount: Number.isFinite(holdings.scanErrorCount) ? holdings.scanErrorCount : 0,
    walletScanErrors: Array.isArray(holdings.scanErrors) ? holdings.scanErrors : [],
    externalWalletUsd: fallbackHasCurrentExternalReference && Number.isFinite(holdings.externalWalletUsd) ? holdings.externalWalletUsd : null,
    unclassifiedUsd: fallbackHasCurrentExternalReference && Number.isFinite(holdings.unclassifiedUsd) ? holdings.unclassifiedUsd : null,
    assetConfidence: Number(holdings.scanErrorCount || 0) > 0 ? "verified_minimum" : "verified_current",
    assetHeadline: Number(holdings.scanErrorCount || 0) > 0 ? "Verified minimum assets" : "Current total assets",
    reconciliationState: Number(holdings.scanErrorCount || 0) > 0 ? "needs_reconciliation" : "reconciled",
    referenceFullWalletGapUsd: null,
    planGapUsd: null,
    protocolTrackingGapUsd: null,
    trackingGapUsd: null,
    trackingGapSource: null,
    reconciliationGapUsd: null,
    assetTracking: assetTracking ? {
      coverageState: assetTracking.coverageState || null,
      dashboardHeadline: assetTracking.dashboardHeadline || null,
      riskReady: assetTracking.riskReady === true,
      exactTotalUsd: Number.isFinite(assetTracking.exactTotalUsd) ? assetTracking.exactTotalUsd : null,
      verifiedKnownUsd: Number.isFinite(assetTracking.verifiedKnownUsd) ? assetTracking.verifiedKnownUsd : null,
      riskUsableUsd: Number.isFinite(assetTracking.riskUsableUsd) ? assetTracking.riskUsableUsd : null,
      externalReferenceUsd: Number.isFinite(assetTracking.externalReferenceUsd) ? assetTracking.externalReferenceUsd : null,
      externalUnclassifiedUsd: Number.isFinite(assetTracking.externalUnclassifiedUsd) ? assetTracking.externalUnclassifiedUsd : null,
      unexplainedGapUsd: Number.isFinite(assetTracking.unexplainedGapUsd) ? assetTracking.unexplainedGapUsd : null,
      blockers: Array.isArray(assetTracking.blockers) ? assetTracking.blockers : []
    } : null,
    systemConfidence: Number(holdings.scanErrorCount || 0) > 0 ? "medium" : "high",
    autoExecutionSafe: Number(holdings.scanErrorCount || 0) === 0,
    invariantViolationCount: Number(holdings.scanErrorCount || 0) > 0 ? 1 : 0,
    invariantViolations: Number(holdings.scanErrorCount || 0) > 0 ? [{ code: "wallet_scan_errors" }] : [],
    pendingSignerActionCount: 0,
    adapterCoverageGapCount: 0,
    currentProtocolMarkCount: 0,
    protocolMarkIssueCount: 0,
    protocolMarkCoverageState: null,
    latestProtocolMarkObservedAt: null,
    pending: holdings.pending === true || holdings.items.length === 0,
    generatedAt: holdings.generatedAt || null
  } : {
    all: [],
    positions: [],
    pending: true,
    totalUsd: null,
    walletUsd: null,
    deployedUsd: null,
    currentWalletUsd: null,
    protocolDeployedUsd: null,
    currentTotalUsd: null,
    estimatedProtocolDeployedUsd: null,
    estimatedCurrentTotalUsd: null,
    verifiedMinimumUsd: null,
    estimatedUntrackedProtocolUsd: null,
    estimatedTotalUsdSource: null,
    assetFormula: null,
    displayWalletUsd: null,
    displayTotalUsd: null,
    displayTotalUsdSource: null,
    itemizedSupportedWalletUsd: null,
    walletCoverage: null,
    fullWalletUsd: null,
    fullWalletObservedAt: null,
    fullWalletProvider: null,
    fullWalletStale: false,
    walletSource: null,
    walletObservedAt: null,
    walletScanErrorCount: 0,
    walletScanErrors: [],
    externalWalletUsd: null,
    unclassifiedUsd: null,
    assetConfidence: "verified_current",
    assetHeadline: "Current total assets",
    reconciliationState: null,
    referenceFullWalletGapUsd: null,
    planGapUsd: null,
    protocolTrackingGapUsd: null,
    trackingGapUsd: null,
    trackingGapSource: null,
    reconciliationGapUsd: null,
    assetTracking: null,
    systemConfidence: "high",
    autoExecutionSafe: false,
    invariantViolationCount: 0,
    invariantViolations: [],
    pendingSignerActionCount: 0,
    adapterCoverageGapCount: 0,
    currentProtocolMarkCount: 0,
    protocolMarkIssueCount: 0,
    protocolMarkCoverageState: null,
    latestProtocolMarkObservedAt: null
  };
  const CAPITAL = buildCapitalMaps(HOLDINGS);
  const strategyParity = status?.strategy?.strategyParity || {};
  const chainParity = status?.strategy?.chainParity || {};
  const microCanary = status?.strategy?.microCanarySummary || {};
  const riskById = flow?.strategyRiskById || {};
  const tickById = strategyParity.byStrategy || {};
  const microById = microCanary.byStrategy || {};
  const tickByNormalized = {};
  for (const [k, v] of Object.entries(tickById)) tickByNormalized[normalizeStrategyId(k)] = v;
  const microByNormalized = {};
  for (const [k, v] of Object.entries(microById)) microByNormalized[normalizeStrategyId(k)] = v;
  const riskByNormalized = {};
  for (const [k, v] of Object.entries(riskById)) riskByNormalized[normalizeStrategyId(k)] = v;
  const knownProtocols = new Set(STRATEGY_CATALOG.map((s) => s.protocol));
  function deriveFallbackMeta(id) {
    const lower = id.toLowerCase();
    const chain = CHAINS.find((c) => lower.includes(c.id))?.id || "base";
    const protocol = cleanUnknown([...knownProtocols].find((p) => lower.includes(p)) || null);
    const chainLabel = chain.charAt(0).toUpperCase() + chain.slice(1);
    const protocolLabel = protocol ? protocol.charAt(0).toUpperCase() + protocol.slice(1) : "Strategy";
    return {
      id,
      label: id.split(/[-_]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
      sub: `${chainLabel} \xB7 ${protocolLabel}`,
      chain,
      protocol,
      type: "candidate",
      pair: ["usdc", "usdc"],
      loops: null,
      capUsd: null,
      desc: `Auto-discovered strategy ${id}.`
    };
  }
  const allIds = /* @__PURE__ */ new Set([
    ...STRATEGY_CATALOG.map((s) => s.id),
    ...Object.keys(tickByNormalized),
    ...Object.keys(microByNormalized)
  ]);
  const fallbackActivityCatalog = Array.from(allIds).filter((id) => !STRATEGY_CATALOG.some((s) => s.id === id)).map(deriveFallbackMeta);
  const activitySurfaces = buildActivitySurfaces(flow?.recentActivities || [], [
    ...STRATEGY_CATALOG,
    ...fallbackActivityCatalog
  ]);
  const movementSurfaces = buildMovementSurfaces(flow?.recentMovements || []);
  const STRATEGIES = Array.from(allIds).map((id) => {
    const catalogEntry = STRATEGY_CATALOG.find((s2) => s2.id === id);
    const s = catalogEntry || deriveFallbackMeta(id);
    const isPrimary = s.id === primaryId;
    const live = isPrimary ? primaryPolicy : null;
    const normalizedId = normalizeStrategyId(s.id);
    const parity = tickByNormalized[normalizedId] || tickById[s.id] || null;
    const micro = microByNormalized[normalizedId] || microById[s.id] || null;
    const tickMode = parity?.readinessVerdict || parity?.tickMode || null;
    const protocolCapitalUsd = CAPITAL.byProtocol[capitalProtocolKey(s.chain, s.protocol)] || 0;
    const chainCapitalUsd = CAPITAL.byChain[s.chain] || 0;
    const activitySurface = activitySurfaces.byProtocol[capitalProtocolKey(s.chain, s.protocol)] || null;
    const allocatedSats = Number(parity?.scoredAllocation?.allocatedSats ?? 0);
    const allocatedCapitalUsd = Number.isFinite(allocatedSats) && allocatedSats > 0 ? satsToUsd(allocatedSats, btcUsd) : null;
    const effectiveCapUsd = Number.isFinite(s.capUsd) && s.capUsd > 0 ? s.capUsd : allocatedCapitalUsd && allocatedCapitalUsd > 0 ? allocatedCapitalUsd : null;
    const effectiveProtocolCapitalUsd = protocolCapitalUsd;
    const hasLivePosition = protocolCapitalUsd > 0;
    const hasRecentActivity = Number(activitySurface?.count || 0) > 0;
    let fallbackStatus;
    if (tickMode === "live_candidate") fallbackStatus = "POLICY READY";
    else if (tickMode === "live_ready") fallbackStatus = "POLICY READY";
    else if (tickMode === "shadow_ready") fallbackStatus = "SHADOW";
    else if (tickMode === "blocked") fallbackStatus = "BLOCKED";
    else {
      const autoExec = live?.autoExecute != null ? Boolean(live.autoExecute) : defaultAutoExec(s.id);
      if (isPrimary) {
        fallbackStatus = Array.isArray(live?.blockers) && live.blockers.length === 0 && autoExec ? "POLICY READY" : autoExec ? "ARMED" : "DRY RUN";
      } else {
        fallbackStatus = defaultAutoExec(s.id) ? "ARMED" : "CANDIDATE";
      }
    }
    const isLiveCandidate = tickMode === "live_candidate" || tickMode === "live_ready" || fallbackStatus === "POLICY READY";
    const statusLabel = activeStrategyStatus({
      hasLivePosition,
      isLiveCandidate,
      hasRecentActivity,
      tickMode,
      fallbackStatus
    });
    const apyPct = liveAprFor(s, liveApr) ?? apyHint(s.id);
    const realizedYieldUsd = isPrimary && Number.isFinite(realizedUsd) && realizedUsd > 0 ? realizedUsd : 0;
    const estimatedYieldUsd = estimateYieldUsd({
      status: statusLabel,
      capUsd: effectiveCapUsd,
      apyPct,
      lastObservedAt: parity?.lastTickAt || null,
      generatedAt: statusAsOf
    });
    const earnedUsd = realizedYieldUsd > 0 ? realizedYieldUsd : estimatedYieldUsd;
    return {
      ...s,
      autoExecute: defaultAutoExec(s.id),
      status: statusLabel,
      earnedUsd,
      realizedYieldUsd,
      estimatedYieldUsd,
      yieldBasis: realizedYieldUsd > 0 ? "realized" : estimatedYieldUsd > 0 ? "estimated" : null,
      apyPct,
      tickMode,
      activeStrategyState: hasLivePosition ? "live_position" : isLiveCandidate ? "live_candidate" : hasRecentActivity ? "activity_only" : "inactive",
      activitySurfaceCount: activitySurface?.count || 0,
      tickBlockers: parity?.blockers || [],
      microCanaryStatus: micro?.microCanaryStatus || parity?.microCanaryStatus || "not_started",
      blockerCount: parity?.blockers?.length ?? 0,
      topBlocker: parity?.topBlocker || null,
      projectedNetUsd: null,
      lastTickAt: parity?.lastTickAt || null,
      riskHint: riskByNormalized[normalizedId] || null,
      capUsd: effectiveCapUsd,
      actualProtocolCapitalUsd: effectiveProtocolCapitalUsd,
      actualChainCapitalUsd: chainCapitalUsd
    };
  });
  const grossProfitSats = Number(flow?.metrics?.grossProfitSatsPeriod ?? payback?.grossProfitSatsPeriod ?? 0);
  const pendingCarrySats = Number(flow?.metrics?.pendingCarrySats ?? payback?.carry?.pendingSats ?? payback?.accumulatorPendingSats ?? 0);
  const paidSatsLifetime = Number(flow?.metrics?.paidBackSatsLifetime ?? payback?.paidBackSatsLifetime ?? 0);
  const flowAssetValueUsd = Number.isFinite(flow?.metrics?.assetValueUsd) ? flow.metrics.assetValueUsd : null;
  const grossProfitUsd = Number.isFinite(flow?.metrics?.grossProfitUsdPeriod) ? flow.metrics.grossProfitUsdPeriod : satsToUsd(grossProfitSats, btcUsd);
  const liveYieldSats = firstFinite(flow?.metrics?.liveEstimatedYieldSats, liveYield?.estimatedYieldSats);
  const liveYieldUsd = firstFinite(flow?.metrics?.liveEstimatedYieldUsd, liveYield?.estimatedYieldUsd);
  const totalEarnedUsd = STRATEGIES.reduce((acc, s) => acc + (s.earnedUsd || 0), 0);
  const KPI = {
    totalEarning: { sats: grossProfitSats, usd: grossProfitUsd ?? (totalEarnedUsd > 0 ? totalEarnedUsd : satsToUsd(grossProfitSats, btcUsd)) },
    nativeReserve: { sats: null, usd: null },
    paidBack: { sats: paidSatsLifetime, usd: satsToUsd(paidSatsLifetime, btcUsd) },
    pendingCarry: { sats: pendingCarrySats, usd: satsToUsd(pendingCarrySats, btcUsd) },
    periodDue: { sats: pendingCarrySats, usd: satsToUsd(pendingCarrySats, btcUsd), eta: payback?.scheduler?.nextEtaLabel || "\u2014" },
    assetValue: { usd: flowAssetValueUsd },
    realizedUsd,
    source: resolved?.source || (status ? "snapshot" : "pending"),
    generatedAt: status?.generatedAt || null
  };
  const FLOW_METRICS = {
    ...flow?.metrics || {},
    liveEstimatedYieldSats: liveYieldSats,
    liveEstimatedYieldUsd: liveYieldUsd,
    liveAnnualizedYieldSats: firstFinite(flow?.metrics?.liveAnnualizedYieldSats, liveYield?.annualizedYieldSats),
    liveAnnualizedYieldUsd: firstFinite(flow?.metrics?.liveAnnualizedYieldUsd, liveYield?.annualizedYieldUsd),
    liveYieldAprPct: firstFinite(flow?.metrics?.liveYieldAprPct, liveYield?.weightedAprPct),
    liveYieldPositionCount: firstFinite(flow?.metrics?.liveYieldPositionCount, liveYield?.positionCount) ?? 0,
    liveYieldObservedAt: flow?.metrics?.liveYieldObservedAt || liveYield?.observedAt || null,
    liveYieldBasis: flow?.metrics?.liveYieldBasis || liveYield?.basis || null,
    realizedStrategyUsd: Number.isFinite(realizedUsd) ? realizedUsd : null,
    realizedEvidenceCostUsd: Number.isFinite(realizedEvidenceCostUsd) ? realizedEvidenceCostUsd : null,
    realizedTotalUsd: Number.isFinite(realizedTotalUsd) ? realizedTotalUsd : null,
    realizedStrategyTradeCount: Number.isFinite(pnl?.realized?.tradeCount) ? pnl.realized.tradeCount : 0,
    realizedEvidenceCount: Number.isFinite(pnl?.realized?.evidenceCount) ? pnl.realized.evidenceCount : 0,
    realizedByKind: Array.isArray(realizedBreakdown?.byKind) ? realizedBreakdown.byKind : []
  };
  const merklItems = Array.isArray(merklActive?.items) ? merklActive.items : [];
  for (const m of merklItems) {
    if (!m?.chain || !m?.protocol) continue;
    const normalizedId = normalizeStrategyId(m.id);
    const apyPct = Number.isFinite(m.aprPct) ? m.aprPct : liveAprFor({ protocol: m.protocol, chain: m.chain, type: m.type || "lp" }, liveApr) ?? null;
    const estimatedYieldUsd = estimateYieldUsd({
      status: "LIVE",
      capUsd: Number.isFinite(m.capUsd) ? m.capUsd : null,
      apyPct,
      lastObservedAt: m.lastObservedAt || null,
      generatedAt: statusAsOf
    });
    STRATEGIES.push({
      id: m.id,
      label: m.label || `Merkl ${m.opportunityId}`,
      sub: `${m.chain} \xB7 ${m.protocol}`,
      chain: m.chain,
      protocol: m.protocol,
      type: m.type || "lp",
      pair: Array.isArray(m.pair) && m.pair.length ? m.pair : ["usdc"],
      loops: null,
      capUsd: Number.isFinite(m.capUsd) ? m.capUsd : null,
      desc: `Merkl-discovered position. opportunity ${m.opportunityId}.`,
      autoExecute: true,
      status: "LIVE",
      earnedUsd: estimatedYieldUsd,
      realizedYieldUsd: 0,
      estimatedYieldUsd,
      yieldBasis: estimatedYieldUsd > 0 ? "estimated" : null,
      apyPct,
      tickMode: "live_candidate",
      tickBlockers: [],
      microCanaryStatus: "active",
      blockerCount: 0,
      topBlocker: null,
      projectedNetUsd: null,
      lastTickAt: m.lastObservedAt || null,
      source: "merkl",
      opportunityId: m.opportunityId,
      activeStrategyState: "live_position",
      activitySurfaceCount: 0,
      riskHint: riskByNormalized[normalizedId] || null,
      actualProtocolCapitalUsd: CAPITAL.byProtocol[capitalProtocolKey(m.chain, m.protocol)] || 0,
      actualChainCapitalUsd: CAPITAL.byChain[m.chain] || 0
    });
  }
  for (const strategy of STRATEGIES) {
    const activitySurface = activitySurfaces.byProtocol[capitalProtocolKey(strategy.chain, strategy.protocol)] || null;
    if (!activitySurface) continue;
    strategy.recentActivityCount = activitySurface.count;
    strategy.recentActivityUsd = activitySurface.usd;
    strategy.recentActivityAssets = activitySurface.assets;
    strategy.recentActivityActions = activitySurface.actions;
    strategy.latestActivityAt = activitySurface.latestAt;
  }
  STRATEGIES.push(...activitySurfaces.syntheticStrategies);
  const CHAINS_PARITY = CHAINS.map((c) => {
    const p = chainParity.byChain?.[c.id] || null;
    const chainSurface = activitySurfaces.byChain?.[c.id] || null;
    const movementSurface = movementSurfaces.byChain?.[c.id] || null;
    return {
      ...c,
      capitalUsd: CAPITAL.byChain[c.id] || 0,
      wrappedBtcVenueStatus: cleanUnknown(p?.wrappedBtcVenueStatus),
      stableVenueStatus: cleanUnknown(p?.stableVenueStatus),
      nativeEthArrivalClass: cleanUnknown(p?.nativeEthArrivalClass),
      strategySurfacePresence: p?.strategySurfacePresence ?? 0,
      currentMaturity: cleanUnknown(p?.currentMaturity),
      topBlocker: cleanUnknown(p?.topBlocker) || null,
      recentActivityCount: chainSurface?.count || 0,
      recentActivityUsd: chainSurface?.usd || 0,
      recentActivityAssets: chainSurface?.assets || [],
      recentActivityActions: chainSurface?.actions || [],
      latestActivityAt: chainSurface?.latestAt || null,
      recentMovementCount: movementSurface?.count || 0,
      recentMovementUsd: movementSurface?.usd || 0,
      recentMovementAssets: movementSurface?.assets || [],
      latestMovementAt: movementSurface?.latestAt || null
    };
  });
  Object.assign(window, {
    CHAINS: CHAINS_PARITY,
    STRATEGIES,
    KPI,
    HOLDINGS,
    FLOW: {
      ...flow || {},
      metrics: FLOW_METRICS,
      recentActivities: Array.isArray(flow?.recentActivities) ? flow.recentActivities : [],
      recentMovements: Array.isArray(flow?.recentMovements) ? flow.recentMovements : [],
      strategyRiskById: flow?.strategyRiskById || {}
    },
    ACTIVITY_SURFACES: activitySurfaces,
    MOVEMENT_SURFACES: movementSurfaces,
    MERKL_ACTIVE: merklActive,
    OPERATIONS: operations,
    CAPITAL,
    RADAR: status?.radar || null,
    STATUS: status,
    RAW_STATUS: status,
    LIVE_STATUS: {
      source: resolved?.source || "fallback",
      live: Boolean(resolved?.live && status),
      generatedAt: status?.liveTransport?.servedAt || status?.capitalSummary?.generatedAt || status?.generatedAt || null,
      remote: Boolean(resolved?.source === "remote-live-api" || resolved?.source === "remote-live-sse")
    }
  });
  window._DASHBOARD_LIVE_AVAILABLE = Boolean(resolved?.live && status);
  window._DASHBOARD_PREFERRED_POLL_MS = window._DASHBOARD_LIVE_AVAILABLE ? LIVE_POLL_MS : STATIC_POLL_MS;
  return {
    status,
    source: resolved?.source || "fallback",
    live: window._DASHBOARD_LIVE_AVAILABLE
  };
}
async function refreshDashboardData({ dispatch = true, payload = null } = {}) {
  if (!window._DASHBOARD_REFRESH_IN_FLIGHT) {
    window._DASHBOARD_REFRESH_IN_FLIGHT = (async () => {
      const snapshot = await bootData(payload, { preserveCurrentOnMismatch: Boolean(payload) });
      if (dispatch) {
        window.dispatchEvent(new CustomEvent("dashboard:datarefresh"));
      }
      if (window._DASHBOARD_POLL_INTERVAL_MS !== window._DASHBOARD_PREFERRED_POLL_MS) {
        startDashboardPolling(window._DASHBOARD_PREFERRED_POLL_MS);
      }
      if (snapshot?.live) {
        setupLiveEventStream();
      }
      return snapshot;
    })().finally(() => {
      window._DASHBOARD_REFRESH_IN_FLIGHT = null;
    });
  }
  return window._DASHBOARD_REFRESH_IN_FLIGHT;
}
async function bootstrapDashboardData() {
  const initialSnapshot = await fetchStatusPayload();
  await bootData(initialSnapshot);
  window.dispatchEvent(new CustomEvent("dashboard:datarefresh"));
  if (!initialSnapshot?.live) {
    void refreshDashboardData().catch(() => {
    });
  }
  return initialSnapshot;
}
function setupDashboardRefreshHooks() {
  if (window._DASHBOARD_REFRESH_HOOKS) return;
  const refreshVisibleData = () => {
    if (document.hidden) return;
    refreshDashboardData().catch(() => {
    });
  };
  window.addEventListener("focus", refreshVisibleData);
  document.addEventListener("visibilitychange", refreshVisibleData);
  window._DASHBOARD_REFRESH_HOOKS = refreshVisibleData;
}
function startDashboardPolling(intervalMs = STATIC_POLL_MS) {
  if (window._DASHBOARD_POLL) clearInterval(window._DASHBOARD_POLL);
  window._DASHBOARD_POLL_INTERVAL_MS = intervalMs;
  window._DASHBOARD_POLL = setInterval(async () => {
    try {
      await refreshDashboardData();
    } catch {
    }
  }, intervalMs);
}
function setupLiveEventStream() {
  if (!window._DASHBOARD_LIVE_AVAILABLE || !window.EventSource) return;
  if (window._DASHBOARD_LIVE_STREAM_RETRY_AT && Date.now() < window._DASHBOARD_LIVE_STREAM_RETRY_AT) return;
  const runtime = window._DASHBOARD_LIVE_RUNTIME;
  const preferRemoteStream = window.LIVE_STATUS?.remote === true;
  const eventsBasePath = preferRemoteStream && runtime?.enabled && runtime.eventsUrl ? runtime.eventsUrl : LIVE_EVENTS_PATH;
  if (window._DASHBOARD_LIVE_STREAM && window._DASHBOARD_LIVE_STREAM_URL === eventsBasePath) return;
  if (window._DASHBOARD_LIVE_STREAM) {
    window._DASHBOARD_LIVE_STREAM.close();
    window._DASHBOARD_LIVE_STREAM = null;
  }
  const eventsPath = preferRemoteStream && runtime?.enabled && runtime.eventsUrl ? `${eventsBasePath}?t=${Date.now()}` : `${LIVE_EVENTS_PATH}?t=${Date.now()}`;
  const stream = new EventSource(eventsPath);
  let opened = false;
  const handleSnapshot = async (event) => {
    try {
      const status = JSON.parse(event.data);
      await refreshDashboardData({
        payload: {
          status,
          source: preferRemoteStream ? "remote-live-sse" : "live-sse",
          live: true
        }
      });
    } catch {
    }
  };
  stream.addEventListener("open", () => {
    opened = true;
    window._DASHBOARD_LIVE_STREAM_ACTIVE = true;
    startDashboardPolling(LIVE_POLL_MS);
  });
  stream.addEventListener("snapshot", handleSnapshot);
  stream.onmessage = handleSnapshot;
  stream.onerror = () => {
    window._DASHBOARD_LIVE_STREAM_ACTIVE = false;
    if (!opened) window._DASHBOARD_LIVE_STREAM_RETRY_AT = Date.now() + 3e4;
    stream.close();
    window._DASHBOARD_LIVE_STREAM = null;
    window._DASHBOARD_LIVE_STREAM_URL = null;
  };
  window.addEventListener("beforeunload", () => stream.close(), { once: true });
  window._DASHBOARD_LIVE_STREAM = stream;
  window._DASHBOARD_LIVE_STREAM_URL = eventsBasePath;
}
function liveAprFor(strategy, aprMap) {
  if (!aprMap || !strategy) return null;
  const strategyEntry = aprMap[strategy.id];
  const key = `${strategy.protocol}:${strategy.chain}`;
  const entry = strategyEntry || aprMap[key] || aprMap[strategy.protocol];
  if (!entry) return null;
  if (Number.isFinite(entry.netApyPct)) return entry.netApyPct;
  if (Number.isFinite(entry.apyPct)) return entry.apyPct;
  if (Number.isFinite(entry.supplyApyPct) && Number.isFinite(entry.borrowApyPct) && strategy.type === "loop") {
    return entry.supplyApyPct - entry.borrowApyPct;
  }
  return null;
}
function defaultAutoExec(id) {
  return ![
    "gateway-instant-swap-verification",
    "wrapper-btc-arbitrage"
  ].includes(id);
}
function apyHint(id) {
  return {
    "wrapped-btc-loop-base-moonwell": 6.1,
    "recursive_wrapped_btc_lending_loop": 7.4
  }[id] ?? null;
}
Object.assign(window, {
  CHAINS,
  STRATEGIES: [],
  KPI: { source: "pending" },
  HOLDINGS: { all: [] },
  FLOW: { metrics: {}, recentActivities: [], strategyRiskById: {} },
  OPERATIONS: null,
  CAPITAL: { byChain: {}, walletByChain: {}, deployedByChain: {}, byProtocol: {}, walletUsd: null, deployedUsd: null, totalUsd: null, pending: true, generatedAt: null },
  STATUS: null,
  RAW_STATUS: null,
  LIVE_STATUS: { source: "pending", live: false, generatedAt: null }
});
window.DATA_READY = bootstrapDashboardData();
window.DATA_READY.then(() => {
  setupDashboardRefreshHooks();
  setupLiveEventStream();
  startDashboardPolling(window._DASHBOARD_PREFERRED_POLL_MS || STATIC_POLL_MS);
});
})();
