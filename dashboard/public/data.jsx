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

function satsToUsd(sats, btcUsd) {
  if (!Number.isFinite(sats) || !Number.isFinite(btcUsd)) return null;
  return (sats / 1e8) * btcUsd;
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

  const lanePolicy = status?.overall?.lanePolicy || {};
  const primaryId = lanePolicy?.candidateId || 'wrapped-btc-loop-base-moonwell';
  const primaryPolicy = lanePolicy?.strategyPolicy || {};

  const payback = status?.payback || {};
  const pnl = status?.pnl || {};
  // Pre-payback earning: realized PnL today (USD). Only reported on primary lane for now.
  const realizedUsd = pnl?.realized?.valueUsd;

  const liveApr = holdings?.protocolApr || {};

  // P3 — unified read from dashboard-status.json only
  const strategyParity = status?.strategy?.strategyParity || {};
  const chainParity = status?.strategy?.chainParity || {};
  const microCanary = status?.strategy?.microCanarySummary || {};
  const promotion = status?.strategy?.promotionSummary || {};

  const tickById = strategyParity.byStrategy || {};
  const microById = microCanary.byStrategy || {};

  // Build normalized tick lookup tables.
  const tickByNormalized = {};
  for (const [k, v] of Object.entries(tickById)) tickByNormalized[normalizeStrategyId(k)] = v;
  const microByNormalized = {};
  for (const [k, v] of Object.entries(microById)) microByNormalized[normalizeStrategyId(k)] = v;

  // Dynamic strategy discovery: catalog + tick + micro.
  const knownProtocols = new Set(STRATEGY_CATALOG.map(s => s.protocol));

  function deriveFallbackMeta(id) {
    const lower = id.toLowerCase();
    const chain = CHAINS.find(c => lower.includes(c.id))?.id || 'base';
    const protocol = [...knownProtocols].find(p => lower.includes(p)) || 'unknown';
    return {
      id,
      label: id.split(/[-_]/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      sub: `${chain.charAt(0).toUpperCase() + chain.slice(1)} · ${protocol.charAt(0).toUpperCase() + protocol.slice(1)}`,
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

    const earnedUsd = isPrimary && Number.isFinite(realizedUsd) && realizedUsd > 0 ? realizedUsd : 0;
    return {
      ...s,
      autoExecute: defaultAutoExec(s.id),
      status: statusLabel,
      earnedUsd,
      apyPct: liveAprFor(s, liveApr) ?? apyHint(s.id),
      tickMode,
      tickBlockers: parity?.blockers || [],
      microCanaryStatus: micro?.microCanaryStatus || parity?.microCanaryStatus || 'not_started',
      blockerCount: parity?.blockers?.length ?? 0,
      topBlocker: parity?.topBlocker || null,
      projectedNetUsd: null,
      lastTickAt: parity?.lastTickAt || null,
    };
  });

  const btcUsd = status?.market?.btcUsd || status?.market?.btc?.usd || null;
  const periodSats = Number(payback?.accumulatorPendingSats || 0);
  const paidSatsLifetime = Number(payback?.paidBackSatsLifetime || 0);

  const totalEarnedUsd = STRATEGIES.reduce((acc, s) => acc + (s.earnedUsd || 0), 0);

  const KPI = {
    totalEarning:  { sats: periodSats, usd: totalEarnedUsd > 0 ? totalEarnedUsd : satsToUsd(periodSats, btcUsd) },
    nativeReserve: { sats: null, usd: null },
    paidBack:      { sats: paidSatsLifetime, usd: satsToUsd(paidSatsLifetime, btcUsd) },
    periodDue:     { sats: periodSats, usd: satsToUsd(periodSats, btcUsd), eta: payback?.scheduler?.nextEtaLabel || '—' },
    realizedUsd,
    source: status ? 'live' : 'fallback',
    generatedAt: status?.generatedAt || null,
  };

  const HOLDINGS = holdings && Array.isArray(holdings.items)
    ? {
        all: holdings.items,
        totalUsd: Number.isFinite(holdings.totalUsd) ? holdings.totalUsd : null,
        pending: holdings.pending === true || holdings.items.length === 0,
        generatedAt: holdings.generatedAt || null,
      }
    : { all: [], pending: true, totalUsd: null };

  // P1 — fold chain parity into CHAINS so the UI shows explicit maturity/blockers
  const CHAINS_PARITY = CHAINS.map(c => {
    const p = chainParity.byChain?.[c.id] || null;
    return {
      ...c,
      wrappedBtcVenueStatus: p?.wrappedBtcVenueStatus || 'unknown',
      stableVenueStatus: p?.stableVenueStatus || 'unknown',
      nativeEthArrivalClass: p?.nativeEthArrivalClass || 'unknown',
      strategySurfacePresence: p?.strategySurfacePresence ?? 0,
      currentMaturity: p?.currentMaturity || 'unknown',
      topBlocker: p?.topBlocker || null,
    };
  });

  // Merkl-active strategies — only positions currently open (live).
  // Each Merkl item becomes a STRATEGIES entry so DefiPane (groups by protocol)
  // and Mindmap pick them up automatically. Inactive opportunities are excluded.
  const merklItems = Array.isArray(merklActive?.items) ? merklActive.items : [];
  for (const m of merklItems) {
    if (!m?.chain || !m?.protocol) continue;
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
      earnedUsd: 0,
      apyPct: liveAprFor({ protocol: m.protocol, chain: m.chain, type: m.type || 'lp' }, liveApr) ?? null,
      tickMode: 'live_candidate',
      tickBlockers: [],
      microCanaryStatus: 'active',
      blockerCount: 0,
      topBlocker: null,
      projectedNetUsd: null,
      lastTickAt: m.lastObservedAt || null,
      source: 'merkl',
      opportunityId: m.opportunityId,
    });
  }

  Object.assign(window, { CHAINS: CHAINS_PARITY, STRATEGIES, KPI, HOLDINGS, MERKL_ACTIVE: merklActive, OPERATIONS: operations, RAW_STATUS: status });
  return true;
}

function startDashboardPolling(intervalMs = 30000) {
  if (window._DASHBOARD_POLL) clearInterval(window._DASHBOARD_POLL);
  window._DASHBOARD_POLL = setInterval(async () => {
    try {
      await bootData();
      window.dispatchEvent(new CustomEvent('dashboard:datarefresh'));
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

Object.assign(window, { CHAINS, STRATEGIES: [], KPI: { source:'pending' }, HOLDINGS: { all: [] }, OPERATIONS: null });
window.DATA_READY = bootData();
window.DATA_READY.then(() => startDashboardPolling(30000));
