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
  { id: 'gmx-v2-perp-basis-avax',              label: 'GMX V2 perp basis',         sub: 'Avax · GMX',                chain: 'avalanche', protocol: 'gmx',      type: 'basis',   pair: ['btc.b','usdc'],            capUsd: null, desc: 'Delta-neutral perp basis via GMX V2 on Avalanche.' },
  { id: 'stablecoin-spread-loop',               label: 'Stable spread loop',       sub: 'Base · Moonwell',           chain: 'base',      protocol: 'moonwell', type: 'loop',    pair: ['usdc','usdt'],             capUsd: null, desc: 'Stablecoin supply-borrow spread loop on Base.' },
  { id: 'proxy-spread-expansion',               label: 'Proxy spread expansion',   sub: 'Base · Morpho',             chain: 'base',      protocol: 'morpho',   type: 'loop',    pair: ['usdc','usdt'],             capUsd: null, desc: 'Leveraged proxy stable spread via Morpho on Base.' },
  { id: 'tokenized-reserve-sleeve',             label: 'Tokenized reserve',        sub: 'BSC · Pendle',              chain: 'bsc',       protocol: 'pendle',   type: 'reserve', pair: ['pt-solvbtc','usdc'],       capUsd: null, desc: 'Tokenized BTC reserve sleeve on BSC.' },
];

function deriveStatus(live) {
  if (live?.autoExecute === true && live?.blockers?.length === 0) return 'LIVE';
  if (live?.autoExecute === true) return 'LIVE';
  if (live?.autoExecute === false && live?.preliveReady) return 'DRY RUN';
  return 'CANDIDATE';
}

function satsToUsd(sats, btcUsd) {
  if (!Number.isFinite(sats) || !Number.isFinite(btcUsd)) return null;
  return (sats / 1e8) * btcUsd;
}

async function bootData() {
  let status = null;
  let holdings = null;
  let tickStatus = null;
  try {
    const resp = await fetch('./dashboard-status.json', { cache: 'no-store' });
    if (resp.ok) status = await resp.json();
  } catch {}
  try {
    const resp = await fetch('./wallet-holdings.json', { cache: 'no-store' });
    if (resp.ok) holdings = await resp.json();
  } catch {}
  try {
    const resp = await fetch('./strategy-tick-status.json', { cache: 'no-store' });
    if (resp.ok) tickStatus = await resp.json();
  } catch {}

  const lanePolicy = status?.overall?.lanePolicy || {};
  const primaryId = lanePolicy?.candidateId || 'wrapped-btc-loop-base-moonwell';
  const primaryPolicy = lanePolicy?.strategyPolicy || {};

  const payback = status?.payback || {};
  const pnl = status?.pnl || {};
  // Pre-payback earning: realized PnL today (USD). Only reported on primary lane for now.
  const realizedUsd = pnl?.realized?.valueUsd;

  const liveApr = holdings?.protocolApr || {};

  const tickById = Object.fromEntries((tickStatus?.strategies || []).map(r => [r.strategyId, r]));
  const microById = tickStatus?.microCanary?.byStrategy || {};
  const stageById = tickStatus?.strategyStage?.byStrategy || {};

  // Fold live flags onto the catalog.
  const STRATEGIES = STRATEGY_CATALOG.map(s => {
    const isPrimary = s.id === primaryId;
    const live = isPrimary ? primaryPolicy : null;
    const autoExec = live?.autoExecute != null ? Boolean(live.autoExecute) : defaultAutoExec(s.id);
    const status = isPrimary
      ? (Array.isArray(live?.blockers) && live.blockers.length === 0 && autoExec ? 'LIVE' : (autoExec ? 'LIVE' : 'DRY RUN'))
      : (defaultAutoExec(s.id) ? 'LIVE' : (s.id === 'recursive_wrapped_btc_lending_loop' ? 'DRY RUN' : 'CANDIDATE'));
    const earnedUsd = isPrimary && Number.isFinite(realizedUsd) && realizedUsd > 0 ? realizedUsd : 0;
    const tick = tickById[s.id] || null;
    const micro = microById[s.id] || null;
    const stage = stageById[s.id] || null;
    const tickMode = tick?.lastTickMode || stage?.mode || null;
    const tickStatusLabel = tickMode === 'live_candidate' ? 'LIVE CANDIDATE' : tickMode === 'shadow_ready' ? 'SHADOW' : tickMode === 'blocked' ? 'BLOCKED' : status;
    return {
      ...s,
      autoExecute: autoExec,
      status: tickStatusLabel || status,
      earnedUsd,
      apyPct: liveAprFor(s, liveApr) ?? apyHint(s.id),
      tickMode,
      tickBlockers: tick?.lastTickBlockers || [],
      microCanaryStatus: micro?.microCanaryStatus || 'not_started',
      blockerCount: stage?.blockerCount ?? tick?.lastTickBlockers?.length ?? 0,
      topBlocker: stage?.topBlocker || tick?.lastTickBlockers?.[0] || null,
      projectedNetUsd: stage?.projectedNetUsd ?? null,
      lastTickAt: tick?.lastTickAt || null,
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

  Object.assign(window, { CHAINS, STRATEGIES, KPI, HOLDINGS, RAW_STATUS: status });
  return true;
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
    'recursive_wrapped_btc_lending_loop',
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

Object.assign(window, { CHAINS, STRATEGIES: [], KPI: { source:'pending' }, HOLDINGS: { all: [] } });
window.DATA_READY = bootData();
