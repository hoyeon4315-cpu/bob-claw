// BOB Claw system structure — structural mock only, no live numbers.
// 11 Gateway destinations + Bitcoin L1 source. Strategies mirror src/config/strategy-caps.mjs.

const CHAINS = [
  { id: 'bitcoin',   name: 'Bitcoin',   role: 'source'      },
  { id: 'bob',       name: 'BOB',       role: 'gateway'     },
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

const STRATEGIES = [
  {
    id: 'wrapped-btc-loop-base-moonwell',
    label: 'Wrapped BTC loop', sub: 'Base · Moonwell',
    chain: 'base', protocol: 'moonwell', type: 'loop',
    pair: ['cbbtc','usdc'], loops: 3,
    autoExecute: true, status: 'LIVE',
    capUsd: 300, earnedUsd: 184.20, apyPct: 6.1,
    desc: 'Primary BTC-denominated lending loop. cbBTC collateral, USDC borrow, repeat.',
  },
  {
    id: 'recursive_wrapped_btc_lending_loop',
    label: 'Recursive wrapped-BTC loop', sub: 'Base · Moonwell',
    chain: 'base', protocol: 'moonwell', type: 'loop',
    pair: ['cbbtc','usdc'], loops: 4,
    autoExecute: false, status: 'DRY RUN',
    capUsd: 300, earnedUsd: 0, apyPct: 7.4,
    desc: 'Recursive variant under shadow evaluation.',
  },
  {
    id: 'gateway-btc-onramp',
    label: 'Gateway BTC onramp', sub: 'Bitcoin → Base',
    chain: 'base', protocol: 'gateway', type: 'bridge',
    pair: ['btc','cbbtc'],
    autoExecute: true, status: 'LIVE',
    capUsd: 300, earnedUsd: 0,
    desc: 'Native BTC to cbBTC on Base via Gateway createOrder.',
  },
  {
    id: 'gateway-btc-offramp',
    label: 'Gateway BTC offramp', sub: 'Destination → Bitcoin',
    chain: 'bob', protocol: 'gateway', type: 'payback',
    pair: ['cbbtc','btc'],
    autoExecute: true, status: 'LIVE',
    capUsd: 75, earnedUsd: 0,
    desc: 'Weekly payback path to operator Bitcoin L1 wallet.',
  },
  {
    id: 'gateway-btc-funding-transfer',
    label: 'Gateway funding transfer', sub: 'Inter-chain wrapped-BTC',
    chain: 'bob', protocol: 'gateway', type: 'bridge',
    pair: ['cbbtc'],
    autoExecute: true, status: 'LIVE',
    capUsd: 75, earnedUsd: 0,
    desc: 'Moves wrapped-BTC float between Gateway destinations.',
  },
  {
    id: 'proxy-spread-experiment',
    label: 'BTC proxy spread', sub: 'Gateway + Odos',
    chain: 'ethereum', protocol: 'odos', type: 'arb',
    pair: ['wbtc','cbbtc'],
    autoExecute: true, status: 'LIVE',
    capUsd: 25, earnedUsd: 12.40, apyPct: 2.3,
    desc: 'Wrapper-BTC spread measurement across Gateway and Odos.',
  },
  {
    id: 'token-dex-experiment',
    label: 'Token DEX probe', sub: 'BSC · Odos',
    chain: 'bsc', protocol: 'odos', type: 'swap',
    pair: ['usdt','usdc'],
    autoExecute: true, status: 'LIVE',
    capUsd: 75, earnedUsd: 3.10, apyPct: 0.9,
    desc: 'Deterministic ERC20 swap probe.',
  },
  {
    id: 'native-dex-experiment',
    label: 'Native DEX probe', sub: 'Unichain · Odos',
    chain: 'unichain', protocol: 'odos', type: 'swap',
    pair: ['eth','usdc'],
    autoExecute: true, status: 'LIVE',
    capUsd: 15, earnedUsd: 1.80, apyPct: 0.7,
    desc: 'Native-gas asset swap probe.',
  },
  {
    id: 'gas-zip-native-refuel',
    label: 'Gas.Zip refuel', sub: 'Gas float top-up',
    chain: 'avalanche', protocol: 'gaszip', type: 'refuel',
    pair: ['eth','avax'],
    autoExecute: true, status: 'LIVE',
    capUsd: 10, earnedUsd: 0,
    desc: 'Per-chain native gas float top-up fallback.',
  },
  {
    id: 'wrapper-btc-arbitrage',
    label: 'Wrapper BTC arbitrage', sub: 'Gateway · candidate',
    chain: 'bob', protocol: 'gateway', type: 'arb',
    pair: ['wbtc','cbbtc'],
    autoExecute: false, status: 'CANDIDATE',
    capUsd: 250, earnedUsd: 0, apyPct: null,
    desc: 'Measured-edge wrapper-BTC arbitrage lane. Not auto-exec yet.',
  },
];

const KPI = {
  totalEarning:  { sats: null, usd: null },
  nativeReserve: { sats: null, usd: null },
  paidBack:      { sats: null, usd: null },
  periodDue:     { sats: null, usd: null, eta: '—' },
  mock: true,
};

const HOLDINGS = {
  all: [
    { sym: 'btc',   name: 'BTC',   chain: 'Bitcoin',  amount: 0.5124, usd: 50_100 },
    { sym: 'cbbtc', name: 'cbBTC', chain: 'Base',     amount: 0.3041, usd: 29_750 },
    { sym: 'wbtc',  name: 'wBTC',  chain: 'Ethereum', amount: 0.1512, usd: 14_800 },
    { sym: 'usdc',  name: 'USDC',  chain: 'Base',     amount: 4_250,  usd: 4_250 },
    { sym: 'eth',   name: 'ETH',   chain: 'Unichain', amount: 0.85,   usd: 2_550 },
    { sym: 'usdt',  name: 'USDT',  chain: 'BSC',      amount: 800,    usd: 800 },
    { sym: 'avax',  name: 'AVAX',  chain: 'Avalanche',amount: 12,     usd: 360 },
  ],
  mock: true,
};

Object.assign(window, { CHAINS, STRATEGIES, KPI, HOLDINGS });
