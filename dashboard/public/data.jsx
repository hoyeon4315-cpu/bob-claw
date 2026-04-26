// Live data adapter for BOB Claw dashboard.
// Fetches dashboard-status.json and maps into UI shape (CHAINS, STRATEGIES, KPI, HOLDINGS).
// Unmeasured fields stay null / empty — the UI treats them as pending, not zero.

const CHAINS = [
  { id: 'bitcoin',   name: 'Bitcoin',   role: 'source'      },
  { id: 'bob',       name: 'BOB',       role: 'destination' },
  { id: 'base',      name: 'Base',      role: 'destination' },
  { id: 'ethereum',  name: 'Ethereum',  role: 'destination' },
  { id: 'bsc',       name: 'BNB',       role: 'destination' },
  { id: 'avalanche', name: 'Avalanche', role: 'destination' },
  { id: 'unichain',  name: 'Unichain',  role: 'destination' },
  { id: 'bera',      name: 'Berachain', role: 'destination' },
  { id: 'optimism',  name: 'Optimism',  role: 'destination' },
  { id: 'soneium',   name: 'Soneium',   role: 'destination' },
  { id: 'sei',       name: 'Sei',       role: 'destination' },
  { id: 'sonic',     name: 'Sonic',     role: 'destination' },
];

// Base strategy catalog — mirrors src/config/strategy-caps.mjs.
// Live fields (status, earnedUsd, autoExecute) are overlaid after fetch.
const STRATEGY_CATALOG = [
  { id: 'wrapped-btc-loop-base-moonwell',      label: 'Wrapped BTC loop',         sub: 'Base · Moonwell',           chain: 'base',      protocol: 'moonwell', type: 'loop',    pair: ['cbbtc','usdc'], loops: 3, capUsd: null, desc: 'Primary BTC-denominated lending loop. cbBTC collateral, USDC borrow, repeat.' },
  { id: 'recursive_wrapped_btc_lending_loop',  label: 'Recursive wrapped-BTC loop', sub: 'Base · Moonwell',         chain: 'base',      protocol: 'moonwell', type: 'loop',    pair: ['cbbtc','usdc'], loops: 4, capUsd: null, desc: 'Recursive variant under shadow evaluation.' },
  { id: 'gateway-btc-onramp',                  label: 'Gateway BTC onramp',       sub: 'Bitcoin → Base',            chain: 'base',      protocol: 'gateway',  type: 'bridge',  pair: ['btc','cbbtc'],             capUsd: null, desc: 'Native BTC to cbBTC on Base via Gateway createOrder.' },
  { id: 'gateway-btc-offramp',                 label: 'Gateway BTC offramp',      sub: 'Destination → Bitcoin',     chain: 'bob',       protocol: 'gateway',  type: 'payback', pair: ['cbbtc','btc'],             capUsd: null,  desc: 'Weekly payback path to operator Bitcoin L1 wallet.' },
  { id: 'gateway-btc-funding-transfer',        label: 'Gateway funding transfer', sub: 'Inter-chain wrapped-BTC',   chain: 'bob',       protocol: 'gateway',  type: 'bridge',  pair: ['cbbtc'],                   capUsd: null,  desc: 'Moves wrapped-BTC float between Gateway destinations.' },
  { id: 'proxy-spread-experiment',             label: 'BTC proxy spread',         sub: 'Gateway + Odos',            chain: 'ethereum',  protocol: 'odos',     type: 'arb',     pair: ['wbtc','cbbtc'],            capUsd: null,  desc: 'Wrapper-BTC spread measurement across Gateway and Odos.' },
  { id: 'token-dex-experiment',                label: 'Token DEX probe',          sub: 'BSC · Odos',                chain: 'bsc',       protocol: 'odos',     type: 'swap',    pair: ['usdt','usdc'],             capUsd: null,  desc: 'Deterministic ERC20 swap probe.' },
  { id: 'native-dex-experiment',               label: 'Native DEX probe',         sub: 'Unichain · Odos',           chain: 'unichain',  protocol: 'odos',     type: 'swap',    pair: ['eth','usdc'],              capUsd: null,  desc: 'Native-gas asset swap probe.' },
  { id: 'gas-zip-native-refuel',               label: 'Gas.Zip refuel',           sub: 'Gas float top-up',          chain: 'avalanche', protocol: 'gaszip',   type: 'refuel',  pair: ['eth','avax'],              capUsd: null,  desc: 'Per-chain native gas float top-up fallback.' },
  { id: 'wrapper-btc-arbitrage',               label: 'Wrapper BTC arbitrage',    sub: 'Gateway · candidate',       chain: 'bob',       protocol: 'gateway',  type: 'arb',     pair: ['wbtc','cbbtc'],            capUsd: null, desc: 'Measured-edge wrapper-BTC arbitrage lane. Not auto-exec yet.' },
  // W4–W7 tick-evaluated strategies
  { id: 'beefy-folding-vault',                   label: 'Beefy folding',            sub: 'BSC · Beefy',               chain: 'bsc',       protocol: 'beefy',    type: 'fold',    pair: ['wbtc','usdc'],             capUsd: null, desc: 'Leveraged yield vault via Beefy on BSC.' },
  { id: 'pendle-pt-lbtc-base',                   label: 'Pendle PT-LBTC',           sub: 'Base · Pendle',             chain: 'base',      protocol: 'pendle',   type: 'pt',      pair: ['lbtc','usdc'],             capUsd: null, desc: 'Fixed-yield PT-LBTC direct entry via Pendle on Base.' },
  { id: 'aerodrome-cl-base',                     label: 'Aerodrome CL',             sub: 'Base · Aerodrome',          chain: 'base',      protocol: 'aerodrome', type: 'cl_lp',  pair: ['cbbtc','usdc'],            capUsd: null, desc: 'Concentrated liquidity LP on Aerodrome Base.' },
  { id: 'pendle-pt-solvbtc-bbn-bsc',            label: 'Pendle PT-SolvBTC',        sub: 'BSC · Pendle',              chain: 'bsc',       protocol: 'pendle',   type: 'pt',      pair: ['solvbtc','usdc'],          capUsd: null, desc: 'PT-SolvBTC.BBN direct via Gateway Custom Action on BSC.' },
  { id: 'berachain-bend-bex-bgt',               label: 'Berachain Bend+BEX',       sub: 'Bera · Bend',               chain: 'bera',      protocol: 'bend',     type: 'lp_bgt',  pair: ['wbtc','honey'],            capUsd: null, desc: 'Bend collateral + BEX LP with BGT rewards on Berachain.' },
  { id: 'stablecoin_spread_loop',               label: 'Stable spread loop',       sub: 'Base · Moonwell',           chain: 'base',      protocol: 'moonwell', type: 'loop',    pair: ['usdc','usdt'],             capUsd: null, desc: 'Stablecoin supply-borrow spread loop on Base.' },
  { id: 'proxy_spread_expansion',               label: 'Proxy spread expansion',   sub: 'Base · Morpho',             chain: 'base',      protocol: 'morpho',   type: 'loop',    pair: ['usdc','usdt'],             capUsd: null, desc: 'Leveraged proxy stable spread via Morpho on Base.' },
  { id: 'tokenized_reserve_sleeve',             label: 'Tokenized reserve',        sub: 'BSC · Pendle',              chain: 'bsc',       protocol: 'pendle',   type: 'reserve', pair: ['pt-solvbtc','usdc'],       capUsd: null, desc: 'Tokenized BTC reserve sleeve on BSC.' },
  { id: 'gateway_native_asset_conversion_sleeve', label: 'Gateway native sleeve',  sub: 'Base · Gateway',            chain: 'base',      protocol: 'gateway',  type: 'canary',  pair: ['usdc','usdc'],             capUsd: 0.25, desc: 'Multi-protocol yield sleeve via Gateway. Merkl-sourced.' },
  // Tick-registered strategies missing from earlier catalog
  { id: 'recursive_stablecoin_lending_loop',    label: 'Recursive stable lending', sub: 'Base · Morpho/Aave',        chain: 'base',      protocol: 'morpho',   type: 'loop',    pair: ['wbtc','usdc'],             capUsd: null, desc: 'Recursive stablecoin lending loop via Merkl-discovered venues.' },
  { id: 'destination_wrapped_btc_rotation',     label: 'Wrapped BTC rotation',     sub: 'Multi-chain · Gateway',   chain: 'base',      protocol: 'gateway',  type: 'arb',     pair: ['wbtc','cbbtc'],            capUsd: null, desc: 'Destination-chain wrapped-BTC rotation.' },
  { id: 'stablecoin_treasury_rotation',         label: 'Stable treasury rotation', sub: 'Multi-chain · Gateway',   chain: 'base',      protocol: 'gateway',  type: 'canary',  pair: ['usdc','usdt'],             capUsd: null, desc: 'Stablecoin treasury rotation across destinations.' },
  { id: 'gateway_proxy_spread_rebalance_recheck', label: 'Proxy spread rebalance', sub: 'Base · Gateway',          chain: 'base',      protocol: 'gateway',  type: 'arb',     pair: ['wbtc','cbbtc'],            capUsd: null, desc: 'Gateway proxy spread rebalance recheck.' },
  { id: 'macro_asset_rotation',                 label: 'Macro asset rotation',     sub: 'Multi-chain · Gateway',   chain: 'base',      protocol: 'gateway',  type: 'canary',  pair: ['usdc','usdt'],             capUsd: null, desc: 'Macro-level asset rotation sleeve.' },
  { id: 'eth_destination_deployment',           label: 'ETH destination deploy',   sub: 'Ethereum · Multi',        chain: 'ethereum',  protocol: 'aave',     type: 'canary',  pair: ['eth','usdc'],              capUsd: null, desc: 'ETH-family destination deployment scaffold.' },
  { id: 'onchain_btc_perp_basis',               label: 'BTC perp basis',           sub: 'Avalanche · GMX',         chain: 'avalanche', protocol: 'gmx',      type: 'basis',   pair: ['btc.b','usdc'],            capUsd: null, desc: 'Delta-neutral BTC perp basis via GMX V2.' },
];

function normalizeStrategyId(id) {
  // Tick parity uses snake_case; catalog uses kebab-case.
  return String(id || '').replace(/-/g, '_');
}

function deriveStatus(live) {
  if (live?.autoExecute === true && live?.blockers?.length === 0) return 'LIVE';
  if (live?.autoExecute === true) return 'ARMED';
  if (live?.autoExecute === false && live?.preliveReady) return 'DRY RUN';
  return 'CANDIDATE';
}

function cleanUnknown(value) {
  if (typeof value !== 'string') return value ?? null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'unknown') return null;
  return value;
}

function satsToUsd(sats, btcUsd) {
  if (!Number.isFinite(sats) || !Number.isFinite(btcUsd)) return null;
  return (sats / 1e8) * btcUsd;
}

function estimateYieldUsd({ status, capUsd, apyPct, lastObservedAt, generatedAt }) {
  if (status !== 'LIVE') return 0;
  if (!Number.isFinite(capUsd) || capUsd <= 0) return 0;
  if (!Number.isFinite(apyPct) || apyPct <= 0) return 0;
  if (!lastObservedAt || !generatedAt) return 0;
  const openedAtMs = new Date(lastObservedAt).getTime();
  const generatedAtMs = new Date(generatedAt).getTime();
  if (!Number.isFinite(openedAtMs) || !Number.isFinite(generatedAtMs) || generatedAtMs <= openedAtMs) return 0;
  const elapsedMs = generatedAtMs - openedAtMs;
  const yearMs = 365 * 24 * 60 * 60 * 1000;
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
  const byProtocol = {};
  const walletItems = Array.isArray(holdings?.all) ? holdings.all : [];
  const positionItems = Array.isArray(holdings?.positions) ? holdings.positions : [];

  walletItems.forEach((item) => {
    accumulateUsd(byChain, item?.chain || null, Number(item?.usd));
  });

  positionItems.forEach((item) => {
    const usd = Number(item?.usd);
    accumulateUsd(byChain, item?.chain || null, usd);
    accumulateUsd(byProtocol, capitalProtocolKey(item?.chain || null, item?.protocol || null), usd);
  });

  return {
    byChain,
    byProtocol,
    walletUsd: Number.isFinite(holdings?.walletUsd) ? holdings.walletUsd : null,
    deployedUsd: Number.isFinite(holdings?.deployedUsd) ? holdings.deployedUsd : null,
    totalUsd: Number.isFinite(holdings?.totalUsd) ? holdings.totalUsd : null,
    pending: holdings?.pending === true,
    generatedAt: holdings?.generatedAt || null,
  };
}

async function bootData() {
  let status = null;
  try {
    const resp = await fetch(`./dashboard-status.json?t=${Date.now()}`, { cache: 'no-store' });
    if (resp.ok) status = await resp.json();
  } catch {}

  const holdings = status?.walletHoldings || null;
  const merklActive = status?.strategy?.merklActivePositions || null;
  const operations = status?.operations?.allChainAutopilot || null;
  const capitalSummary = status?.capitalSummary || null;
  const flow = status?.flow || null;

  const lanePolicy = status?.overall?.lanePolicy || {};
  const primaryId = lanePolicy?.candidateId || 'wrapped-btc-loop-base-moonwell';
  const primaryPolicy = lanePolicy?.strategyPolicy || {};

  const payback = status?.payback || {};
  const pnl = status?.pnl || {};
  // Pre-payback earning: realized PnL today (USD). Only reported on primary lane for now.
  const realizedUsd = pnl?.realized?.valueUsd;
  const btcUsd = status?.market?.btcUsd || status?.market?.btc?.usd || null;

  const liveApr = holdings?.protocolApr || {};
  const HOLDINGS = capitalSummary && Array.isArray(capitalSummary.walletItems)
    ? {
        all: capitalSummary.walletItems,
        positions: Array.isArray(capitalSummary.positionItems) ? capitalSummary.positionItems : [],
        totalUsd: Number.isFinite(capitalSummary.totalUsd) ? capitalSummary.totalUsd : null,
        walletUsd: Number.isFinite(capitalSummary.walletUsd) ? capitalSummary.walletUsd : null,
        deployedUsd: Number.isFinite(capitalSummary.deployedUsd) ? capitalSummary.deployedUsd : null,
        pending: false,
        generatedAt: capitalSummary.generatedAt || status?.generatedAt || null,
      }
    : holdings && Array.isArray(holdings.items)
    ? {
        all: holdings.items,
        positions: [],
        totalUsd: Number.isFinite(holdings.totalUsd) ? holdings.totalUsd : null,
        walletUsd: Number.isFinite(holdings.totalUsd) ? holdings.totalUsd : null,
        deployedUsd: 0,
        pending: holdings.pending === true || holdings.items.length === 0,
        generatedAt: holdings.generatedAt || null,
      }
    : { all: [], positions: [], pending: true, totalUsd: null, walletUsd: null, deployedUsd: null };
  const CAPITAL = buildCapitalMaps(HOLDINGS);

  // P3 — unified read from dashboard-status.json only
  const strategyParity = status?.strategy?.strategyParity || {};
  const chainParity = status?.strategy?.chainParity || {};
  const microCanary = status?.strategy?.microCanarySummary || {};
  const promotion = status?.strategy?.promotionSummary || {};
  const riskById = flow?.strategyRiskById || {};

  const tickById = strategyParity.byStrategy || {};
  const microById = microCanary.byStrategy || {};

  // Build normalized tick lookup tables.
  const tickByNormalized = {};
  for (const [k, v] of Object.entries(tickById)) tickByNormalized[normalizeStrategyId(k)] = v;
  const microByNormalized = {};
  for (const [k, v] of Object.entries(microById)) microByNormalized[normalizeStrategyId(k)] = v;
  const riskByNormalized = {};
  for (const [k, v] of Object.entries(riskById)) riskByNormalized[normalizeStrategyId(k)] = v;

  // Dynamic strategy discovery: catalog + tick + micro.
  const knownProtocols = new Set(STRATEGY_CATALOG.map(s => s.protocol));

  function deriveFallbackMeta(id) {
    const lower = id.toLowerCase();
    const chain = CHAINS.find(c => lower.includes(c.id))?.id || 'base';
    const protocol = cleanUnknown([...knownProtocols].find(p => lower.includes(p)) || null);
    const chainLabel = chain.charAt(0).toUpperCase() + chain.slice(1);
    const protocolLabel = protocol
      ? protocol.charAt(0).toUpperCase() + protocol.slice(1)
      : 'Strategy';
    return {
      id,
      label: id.split(/[-_]/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      sub: `${chainLabel} · ${protocolLabel}`,
      chain,
      protocol,
      type: 'candidate',
      pair: ['usdc', 'usdc'],
      loops: null,
      capUsd: null,
      desc: `Auto-discovered strategy ${id}.`,
    };
  }

  const allIds = new Set([
    ...STRATEGY_CATALOG.map(s => s.id),
    ...Object.keys(tickByNormalized),
    ...Object.keys(microByNormalized),
  ]);

  const STRATEGIES = Array.from(allIds).map(id => {
    const catalogEntry = STRATEGY_CATALOG.find(s => s.id === id);
    const s = catalogEntry || deriveFallbackMeta(id);
    const isPrimary = s.id === primaryId;
    const live = isPrimary ? primaryPolicy : null;
    const normalizedId = normalizeStrategyId(s.id);
    const parity = tickByNormalized[normalizedId] || tickById[s.id] || null;
    const micro = microByNormalized[normalizedId] || microById[s.id] || null;
    const tickMode = parity?.promotionVerdict || parity?.tickMode || null;
    const protocolCapitalUsd = CAPITAL.byProtocol[capitalProtocolKey(s.chain, s.protocol)] || 0;
    const chainCapitalUsd = CAPITAL.byChain[s.chain] || 0;
    const allocatedSats = Number(parity?.scoredAllocation?.allocatedSats ?? 0);
    const allocatedCapitalUsd = Number.isFinite(allocatedSats) && allocatedSats > 0
      ? satsToUsd(allocatedSats, btcUsd)
      : null;
    const effectiveCapUsd = Number.isFinite(s.capUsd) && s.capUsd > 0
      ? s.capUsd
      : (allocatedCapitalUsd && allocatedCapitalUsd > 0 ? allocatedCapitalUsd : null);
    const effectiveProtocolCapitalUsd = protocolCapitalUsd > 0
      ? protocolCapitalUsd
      : (allocatedCapitalUsd && allocatedCapitalUsd > 0 ? allocatedCapitalUsd : 0);

    let statusLabel;
    if (tickMode === 'live_candidate') statusLabel = 'LIVE CANDIDATE';
    else if (tickMode === 'fast_track_eligible') statusLabel = 'FAST TRACK';
    else if (tickMode === 'shadow_ready') statusLabel = 'SHADOW';
    else if (tickMode === 'blocked') statusLabel = 'BLOCKED';
    else {
      const autoExec = live?.autoExecute != null ? Boolean(live.autoExecute) : defaultAutoExec(s.id);
      if (isPrimary) {
        statusLabel = Array.isArray(live?.blockers) && live.blockers.length === 0 && autoExec ? 'LIVE' : (autoExec ? 'ARMED' : 'DRY RUN');
      } else {
        statusLabel = defaultAutoExec(s.id) ? 'ARMED' : 'CANDIDATE';
      }
    }

    const apyPct = liveAprFor(s, liveApr) ?? apyHint(s.id);
    const realizedYieldUsd = isPrimary && Number.isFinite(realizedUsd) && realizedUsd > 0 ? realizedUsd : 0;
    const estimatedYieldUsd = estimateYieldUsd({
      status: statusLabel,
      capUsd: effectiveCapUsd,
      apyPct,
      lastObservedAt: parity?.lastTickAt || null,
      generatedAt: status?.generatedAt || null,
    });
    const earnedUsd = realizedYieldUsd > 0 ? realizedYieldUsd : estimatedYieldUsd;
    return {
      ...s,
      autoExecute: defaultAutoExec(s.id),
      status: statusLabel,
      earnedUsd,
      realizedYieldUsd,
      estimatedYieldUsd,
      yieldBasis: realizedYieldUsd > 0 ? 'realized' : (estimatedYieldUsd > 0 ? 'estimated' : null),
      apyPct,
      tickMode,
      tickBlockers: parity?.blockers || [],
      microCanaryStatus: micro?.microCanaryStatus || parity?.microCanaryStatus || 'not_started',
      blockerCount: parity?.blockers?.length ?? 0,
      topBlocker: parity?.topBlocker || null,
      projectedNetUsd: null,
      lastTickAt: parity?.lastTickAt || null,
      riskHint: riskByNormalized[normalizedId] || null,
      capUsd: effectiveCapUsd,
      actualProtocolCapitalUsd: effectiveProtocolCapitalUsd,
      actualChainCapitalUsd: chainCapitalUsd,
    };
  });

  const grossProfitSats = Number(flow?.metrics?.grossProfitSatsPeriod ?? payback?.grossProfitSatsPeriod ?? 0);
  const pendingCarrySats = Number(flow?.metrics?.pendingCarrySats ?? payback?.carry?.pendingSats ?? payback?.accumulatorPendingSats ?? 0);
  const paidSatsLifetime = Number(flow?.metrics?.paidBackSatsLifetime ?? payback?.paidBackSatsLifetime ?? 0);
  const flowAssetValueUsd = Number.isFinite(flow?.metrics?.assetValueUsd) ? flow.metrics.assetValueUsd : null;
  const grossProfitUsd = Number.isFinite(flow?.metrics?.grossProfitUsdPeriod)
    ? flow.metrics.grossProfitUsdPeriod
    : satsToUsd(grossProfitSats, btcUsd);

  const totalEarnedUsd = STRATEGIES.reduce((acc, s) => acc + (s.earnedUsd || 0), 0);

  const KPI = {
    totalEarning:  { sats: grossProfitSats, usd: grossProfitUsd ?? (totalEarnedUsd > 0 ? totalEarnedUsd : satsToUsd(grossProfitSats, btcUsd)) },
    nativeReserve: { sats: null, usd: null },
    paidBack:      { sats: paidSatsLifetime, usd: satsToUsd(paidSatsLifetime, btcUsd) },
    pendingCarry:  { sats: pendingCarrySats, usd: satsToUsd(pendingCarrySats, btcUsd) },
    periodDue:     { sats: pendingCarrySats, usd: satsToUsd(pendingCarrySats, btcUsd), eta: payback?.scheduler?.nextEtaLabel || '—' },
    assetValue:    { usd: flowAssetValueUsd },
    realizedUsd,
    source: status ? 'live' : 'fallback',
    generatedAt: status?.generatedAt || null,
  };

  // P1 — fold chain parity into CHAINS so the UI shows explicit maturity/blockers
  const CHAINS_PARITY = CHAINS.map(c => {
    const p = chainParity.byChain?.[c.id] || null;
    return {
      ...c,
      capitalUsd: CAPITAL.byChain[c.id] || 0,
      wrappedBtcVenueStatus: cleanUnknown(p?.wrappedBtcVenueStatus),
      stableVenueStatus: cleanUnknown(p?.stableVenueStatus),
      nativeEthArrivalClass: cleanUnknown(p?.nativeEthArrivalClass),
      strategySurfacePresence: p?.strategySurfacePresence ?? 0,
      currentMaturity: cleanUnknown(p?.currentMaturity),
      topBlocker: cleanUnknown(p?.topBlocker) || null,
    };
  });

  // Merkl-active strategies — only positions currently open (live).
  // Each Merkl item becomes a STRATEGIES entry so DefiPane (groups by protocol)
  // and Mindmap pick them up automatically. Inactive opportunities are excluded.
  const merklItems = Array.isArray(merklActive?.items) ? merklActive.items : [];
  for (const m of merklItems) {
    if (!m?.chain || !m?.protocol) continue;
    const normalizedId = normalizeStrategyId(m.id);
    const apyPct = Number.isFinite(m.aprPct)
      ? m.aprPct
      : (liveAprFor({ protocol: m.protocol, chain: m.chain, type: m.type || 'lp' }, liveApr) ?? null);
    const estimatedYieldUsd = estimateYieldUsd({
      status: 'LIVE',
      capUsd: Number.isFinite(m.capUsd) ? m.capUsd : null,
      apyPct,
      lastObservedAt: m.lastObservedAt || null,
      generatedAt: status?.generatedAt || null,
    });
    STRATEGIES.push({
      id: m.id,
      label: m.label || `Merkl ${m.opportunityId}`,
      sub: `${m.chain} · ${m.protocol}`,
      chain: m.chain,
      protocol: m.protocol,
      type: m.type || 'lp',
      pair: Array.isArray(m.pair) && m.pair.length ? m.pair : ['usdc'],
      loops: null,
      capUsd: Number.isFinite(m.capUsd) ? m.capUsd : null,
      desc: `Merkl-discovered position. opportunity ${m.opportunityId}.`,
      autoExecute: true,
      status: 'LIVE',
      earnedUsd: estimatedYieldUsd,
      realizedYieldUsd: 0,
      estimatedYieldUsd,
      yieldBasis: estimatedYieldUsd > 0 ? 'estimated' : null,
      apyPct,
      tickMode: 'live_candidate',
      tickBlockers: [],
      microCanaryStatus: 'active',
      blockerCount: 0,
      topBlocker: null,
      projectedNetUsd: null,
      lastTickAt: m.lastObservedAt || null,
      source: 'merkl',
      opportunityId: m.opportunityId,
      riskHint: riskByNormalized[normalizedId] || null,
      actualProtocolCapitalUsd: CAPITAL.byProtocol[capitalProtocolKey(m.chain, m.protocol)] || 0,
      actualChainCapitalUsd: CAPITAL.byChain[m.chain] || 0,
    });
  }

  Object.assign(window, {
    CHAINS: CHAINS_PARITY,
    STRATEGIES,
    KPI,
    HOLDINGS,
    FLOW: flow || { metrics: {}, recentActivities: [], strategyRiskById: {} },
    MERKL_ACTIVE: merklActive,
    OPERATIONS: operations,
    CAPITAL,
    RAW_STATUS: status,
  });
  return true;
}

async function refreshDashboardData({ dispatch = true } = {}) {
  if (!window._DASHBOARD_REFRESH_IN_FLIGHT) {
    window._DASHBOARD_REFRESH_IN_FLIGHT = (async () => {
      await bootData();
      if (dispatch) {
        window.dispatchEvent(new CustomEvent('dashboard:datarefresh'));
      }
    })().finally(() => {
      window._DASHBOARD_REFRESH_IN_FLIGHT = null;
    });
  }
  return window._DASHBOARD_REFRESH_IN_FLIGHT;
}

function setupDashboardRefreshHooks() {
  if (window._DASHBOARD_REFRESH_HOOKS) return;
  const refreshVisibleData = () => {
    if (document.hidden) return;
    refreshDashboardData().catch(() => {});
  };
  window.addEventListener('focus', refreshVisibleData);
  document.addEventListener('visibilitychange', refreshVisibleData);
  window._DASHBOARD_REFRESH_HOOKS = refreshVisibleData;
}

function startDashboardPolling(intervalMs = 10000) {
  if (window._DASHBOARD_POLL) clearInterval(window._DASHBOARD_POLL);
  window._DASHBOARD_POLL = setInterval(async () => {
    try {
      await refreshDashboardData();
    } catch {}
  }, intervalMs);
}

function liveAprFor(strategy, aprMap) {
  if (!aprMap || !strategy) return null;
  const key = `${strategy.protocol}:${strategy.chain}`;
  const entry = aprMap[key] || aprMap[strategy.protocol];
  if (!entry) return null;
  if (Number.isFinite(entry.netApyPct)) return entry.netApyPct;
  if (Number.isFinite(entry.apyPct)) return entry.apyPct;
  if (Number.isFinite(entry.supplyApyPct) && Number.isFinite(entry.borrowApyPct) && strategy.type === 'loop') {
    return entry.supplyApyPct - entry.borrowApyPct;
  }
  return null;
}

function defaultAutoExec(id) {
  return ![
    'gateway-instant-swap-verification',
    'wrapper-btc-arbitrage',
  ].includes(id);
}

function apyHint(id) {
  // Display-only hints until live APY ingestion lands.
  return ({
    'wrapped-btc-loop-base-moonwell': 6.1,
    'recursive_wrapped_btc_lending_loop': 7.4,
  })[id] ?? null;
}

Object.assign(window, {
  CHAINS,
  STRATEGIES: [],
  KPI: { source:'pending' },
  HOLDINGS: { all: [] },
  FLOW: { metrics: {}, recentActivities: [], strategyRiskById: {} },
  OPERATIONS: null,
  CAPITAL: { byChain: {}, byProtocol: {}, walletUsd: null, deployedUsd: null, totalUsd: null, pending: true, generatedAt: null },
});
window.DATA_READY = bootData();
window.DATA_READY.then(() => {
  setupDashboardRefreshHooks();
  startDashboardPolling(10000);
});
