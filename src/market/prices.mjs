const PRICE_IDS = {
  btc: "bitcoin",
  ethereum: "ethereum",
  avalanche: "avalanche-2",
  base: "ethereum",
  bera: "berachain-bera",
  bob: "ethereum",
  bsc: "binancecoin",
  optimism: "ethereum",
  sei: "sei-network",
  soneium: "ethereum",
  sonic: "sonic-3",
  unichain: "ethereum",
};

const TOKEN_PRICE_IDS = {
  wbtc: "wrapped-bitcoin",
  paxg: "pax-gold",
  xaut: "tether-gold",
};

const ETH_LIKE_CHAINS = ["ethereum", "base", "bob", "optimism", "soneium", "unichain"];
const CORE_PRICE_FALLBACK_SOURCES = Object.freeze({
  btc: [
    { provider: "coinbase", symbol: "BTC" },
    { provider: "binance", symbol: "BTCUSDT" },
    { provider: "bybit", symbol: "BTCUSDT" },
  ],
  ethereum: [
    { provider: "coinbase", symbol: "ETH" },
    { provider: "binance", symbol: "ETHUSDT" },
    { provider: "bybit", symbol: "ETHUSDT" },
  ],
});
const NATIVE_PRICE_BACKFILL_SOURCES = Object.freeze({
  avalanche: [
    { provider: "coinbase", symbol: "AVAX" },
    { provider: "binance", symbol: "AVAXUSDT" },
    { provider: "bybit", symbol: "AVAXUSDT" },
  ],
  bera: [
    { provider: "binance", symbol: "BERAUSDT" },
    { provider: "bybit", symbol: "BERAUSDT" },
  ],
  bsc: [
    { provider: "coinbase", symbol: "BNB" },
    { provider: "binance", symbol: "BNBUSDT" },
    { provider: "bybit", symbol: "BNBUSDT" },
  ],
  sei: [
    { provider: "binance", symbol: "SEIUSDT" },
    { provider: "bybit", symbol: "SEIUSDT" },
  ],
  sonic: [
    { provider: "binance", symbol: "SUSDT" },
    { provider: "bybit", symbol: "SUSDT" },
  ],
});

function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function ageMs(observedAt, now) {
  const observed = new Date(observedAt || 0).getTime();
  const current = new Date(now || Date.now()).getTime();
  if (!Number.isFinite(observed) || !Number.isFinite(current)) return null;
  return Math.max(0, current - observed);
}

export function emptyPricesUsd() {
  return {
    btc: null,
    tokenByKey: {
      btc: null,
      wbtc: null,
      ethereum: null,
      usd_stable: 1,
      paxg: null,
      xaut: null,
    },
    nativeByChain: Object.fromEntries(Object.keys(PRICE_IDS).filter((key) => key !== "btc").map((chain) => [chain, null])),
  };
}

export function buildPriceSnapshot(prices, options = {}) {
  const empty = emptyPricesUsd();
  return {
    schemaVersion: 1,
    observedAt: options.observedAt || new Date().toISOString(),
    source: options.source || "market_api",
    btcUsd: Number.isFinite(prices?.btc) ? prices.btc : null,
    tokenByKey: {
      ...empty.tokenByKey,
      ...(prices?.tokenByKey || {}),
    },
    nativeByChain: {
      ...empty.nativeByChain,
      ...(prices?.nativeByChain || {}),
    },
  };
}

export function pricesFromSnapshot(snapshot) {
  const empty = emptyPricesUsd();
  return {
    btc: Number.isFinite(snapshot?.btcUsd) ? snapshot.btcUsd : null,
    tokenByKey: {
      ...empty.tokenByKey,
      ...(snapshot?.tokenByKey || {}),
    },
    nativeByChain: {
      ...empty.nativeByChain,
      ...(snapshot?.nativeByChain || {}),
    },
  };
}

export function latestPriceSnapshot(priceSnapshots = []) {
  let latest = null;
  let latestMs = null;
  for (const snapshot of priceSnapshots) {
    const observedAtMs = new Date(snapshot?.observedAt || 0).getTime();
    if (!Number.isFinite(observedAtMs)) continue;
    if (latestMs === null || observedAtMs > latestMs) {
      latest = snapshot;
      latestMs = observedAtMs;
    }
  }
  return latest;
}

export function isFreshPriceSnapshot(snapshot, options = {}) {
  const observedAtMs = new Date(snapshot?.observedAt || 0).getTime();
  if (!Number.isFinite(observedAtMs)) return false;
  const nowMs = new Date(options.now || Date.now()).getTime();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : 300_000;
  return nowMs - observedAtMs <= maxAgeMs;
}

function numericValuesEqualWithinBps(left, right, minChangeBps) {
  if (!Number.isFinite(left) && !Number.isFinite(right)) return true;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (left === right) return true;
  const baseline = Math.max(Math.abs(left), Math.abs(right), 1);
  return (Math.abs(left - right) / baseline) * 10_000 < minChangeBps;
}

export function hasMaterialPriceChange(previousSnapshot, nextSnapshot, options = {}) {
  if (!previousSnapshot) return true;
  const minChangeBps = Number.isFinite(options.minChangeBps) ? options.minChangeBps : 5;
  const checks = [
    [previousSnapshot.btcUsd, nextSnapshot.btcUsd],
    [previousSnapshot.tokenByKey?.btc, nextSnapshot.tokenByKey?.btc],
    [previousSnapshot.tokenByKey?.wbtc, nextSnapshot.tokenByKey?.wbtc],
    [previousSnapshot.tokenByKey?.ethereum, nextSnapshot.tokenByKey?.ethereum],
    ...Object.keys({ ...(previousSnapshot.nativeByChain || {}), ...(nextSnapshot.nativeByChain || {}) }).map((chain) => [
      previousSnapshot.nativeByChain?.[chain],
      nextSnapshot.nativeByChain?.[chain],
    ]),
  ];
  return checks.some(([left, right]) => !numericValuesEqualWithinBps(left, right, minChangeBps));
}

export function shouldPersistPriceSnapshot(previousSnapshot, nextSnapshot, options = {}) {
  if (!previousSnapshot) {
    return { shouldPersist: true, reason: "first_snapshot" };
  }
  if (hasMaterialPriceChange(previousSnapshot, nextSnapshot, options)) {
    return { shouldPersist: true, reason: "material_price_change" };
  }
  const observedAtMs = new Date(previousSnapshot.observedAt || 0).getTime();
  const nowMs = new Date(options.now || nextSnapshot.observedAt || Date.now()).getTime();
  const maxUnchangedAgeMs = Number.isFinite(options.maxUnchangedAgeMs) ? options.maxUnchangedAgeMs : 900_000;
  if (!Number.isFinite(observedAtMs) || nowMs - observedAtMs >= maxUnchangedAgeMs) {
    return { shouldPersist: true, reason: "stale_snapshot_rollover" };
  }
  return { shouldPersist: false, reason: "recently_unchanged" };
}

function latestFiniteValue(items, selector) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const value = selector(items[index]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function overlayObservedPricesUsd(prices, options = {}) {
  const gasSnapshots = options.gasSnapshots || [];
  const bitcoinFeeSnapshots = options.bitcoinFeeSnapshots || [];
  const next = {
    btc: prices?.btc ?? null,
    tokenByKey: { ...(prices?.tokenByKey || {}) },
    nativeByChain: { ...(prices?.nativeByChain || {}) },
  };

  const observedBtc = latestFiniteValue(bitcoinFeeSnapshots, (item) => item?.btcUsd);
  if (!Number.isFinite(next.btc)) next.btc = observedBtc;
  if (!Number.isFinite(next.tokenByKey.btc)) next.tokenByKey.btc = next.btc;
  if (!Number.isFinite(next.tokenByKey.wbtc)) next.tokenByKey.wbtc = next.btc;

  for (let index = gasSnapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = gasSnapshots[index];
    if (!snapshot?.chain || !Number.isFinite(snapshot.nativeUsd)) continue;
    if (!Number.isFinite(next.nativeByChain[snapshot.chain])) {
      next.nativeByChain[snapshot.chain] = snapshot.nativeUsd;
    }
  }

  const observedEthereum = latestFiniteValue(gasSnapshots, (item) =>
    ETH_LIKE_CHAINS.includes(item?.chain) ? item?.nativeUsd : null,
  );
  if (!Number.isFinite(next.tokenByKey.ethereum)) {
    next.tokenByKey.ethereum = Number.isFinite(next.nativeByChain.ethereum) ? next.nativeByChain.ethereum : observedEthereum;
  }
  for (const chain of ETH_LIKE_CHAINS) {
    if (!Number.isFinite(next.nativeByChain[chain]) && Number.isFinite(next.tokenByKey.ethereum)) {
      next.nativeByChain[chain] = next.tokenByKey.ethereum;
    }
  }

  if (!Number.isFinite(next.tokenByKey.usd_stable)) next.tokenByKey.usd_stable = 1;

  return next;
}

function firstFinite(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function mergeMissingPricesUsd(primary, fallback) {
  const empty = emptyPricesUsd();
  const primaryTokenByKey = primary?.tokenByKey || {};
  const fallbackTokenByKey = fallback?.tokenByKey || {};
  const primaryNativeByChain = primary?.nativeByChain || {};
  const fallbackNativeByChain = fallback?.nativeByChain || {};
  const tokenKeys = new Set([
    ...Object.keys(empty.tokenByKey),
    ...Object.keys(primaryTokenByKey),
    ...Object.keys(fallbackTokenByKey),
  ]);
  const nativeKeys = new Set([
    ...Object.keys(empty.nativeByChain),
    ...Object.keys(primaryNativeByChain),
    ...Object.keys(fallbackNativeByChain),
  ]);
  const tokenByKey = {};
  for (const key of tokenKeys) {
    tokenByKey[key] = firstFinite(primaryTokenByKey[key], fallbackTokenByKey[key], empty.tokenByKey[key]);
  }
  const nativeByChain = {};
  for (const key of nativeKeys) {
    nativeByChain[key] = firstFinite(primaryNativeByChain[key], fallbackNativeByChain[key], empty.nativeByChain[key]);
  }
  const btc = firstFinite(primary?.btc, fallback?.btc, tokenByKey.btc);
  if (!Number.isFinite(tokenByKey.btc)) tokenByKey.btc = btc;
  if (!Number.isFinite(tokenByKey.wbtc)) tokenByKey.wbtc = btc;
  if (!Number.isFinite(tokenByKey.usd_stable)) tokenByKey.usd_stable = 1;
  return {
    btc,
    tokenByKey,
    nativeByChain,
  };
}

export function priceForAssetUsd(asset, prices) {
  if (!asset?.priceKey) return null;
  if (asset.priceKey === "btc") return prices?.btc ?? prices?.tokenByKey?.btc ?? null;
  if (asset.priceKey === "usd_stable") return prices?.tokenByKey?.usd_stable ?? 1;
  return prices?.tokenByKey?.[asset.priceKey] ?? prices?.nativeByChain?.[asset.priceKey] ?? null;
}

async function fetchCoinbaseSpotUsd(symbol) {
  const response = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Coinbase spot request failed for ${symbol}: ${response.status}`);
  }
  const body = await response.json();
  const amount = Number(body?.data?.amount);
  return Number.isFinite(amount) ? amount : null;
}

async function fetchBinanceSpotUsd(symbol) {
  const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Binance spot request failed for ${symbol}: ${response.status}`);
  }
  const body = await response.json();
  const amount = Number(body?.price);
  return Number.isFinite(amount) ? amount : null;
}

async function fetchBybitSpotUsd(symbol) {
  const response = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Bybit spot request failed for ${symbol}: ${response.status}`);
  }
  const body = await response.json();
  const ticker = body?.result?.list?.[0];
  const amount = Number(ticker?.usdIndexPrice ?? ticker?.lastPrice);
  return Number.isFinite(amount) ? amount : null;
}

async function resolveBackfillSpotUsd(sources, fetchers) {
  for (const source of sources || []) {
    const fetcher =
      source.provider === "coinbase"
        ? fetchers.coinbaseSpotFetcher
        : source.provider === "binance"
          ? fetchers.binanceSpotFetcher
          : source.provider === "bybit"
            ? fetchers.bybitSpotFetcher
            : null;
    if (typeof fetcher !== "function") continue;
    const price = await fetcher(source.symbol).catch(() => null);
    if (Number.isFinite(price)) return price;
  }
  return null;
}

export async function backfillMissingNativePricesUsd(
  prices,
  {
    spotFetcher = fetchCoinbaseSpotUsd,
    binanceSpotFetcher = fetchBinanceSpotUsd,
    bybitSpotFetcher = fetchBybitSpotUsd,
  } = {},
) {
  const next = {
    ...prices,
    tokenByKey: { ...(prices?.tokenByKey || {}) },
    nativeByChain: { ...(prices?.nativeByChain || {}) },
  };

  await Promise.all(Object.entries(NATIVE_PRICE_BACKFILL_SOURCES).map(async ([chain, sources]) => {
    if (Number.isFinite(next.nativeByChain[chain])) return;
    const price = await resolveBackfillSpotUsd(sources, {
      coinbaseSpotFetcher: spotFetcher,
      binanceSpotFetcher,
      bybitSpotFetcher,
    });
    if (Number.isFinite(price)) {
      next.nativeByChain[chain] = price;
      next.tokenByKey[chain] = price;
    }
  }));

  return next;
}

async function fallbackPricesUsd() {
  const fetchers = {
    coinbaseSpotFetcher: fetchCoinbaseSpotUsd,
    binanceSpotFetcher: fetchBinanceSpotUsd,
    bybitSpotFetcher: fetchBybitSpotUsd,
  };
  const [btc, eth, bnb, avax] = await Promise.all([
    resolveBackfillSpotUsd(CORE_PRICE_FALLBACK_SOURCES.btc, fetchers),
    resolveBackfillSpotUsd(CORE_PRICE_FALLBACK_SOURCES.ethereum, fetchers),
    resolveBackfillSpotUsd(NATIVE_PRICE_BACKFILL_SOURCES.bsc, fetchers),
    resolveBackfillSpotUsd(NATIVE_PRICE_BACKFILL_SOURCES.avalanche, fetchers),
  ]);
  return backfillMissingNativePricesUsd({
    btc,
    tokenByKey: {
      btc,
      wbtc: btc,
      ethereum: eth,
      usd_stable: 1,
      paxg: null,
      xaut: null,
      bsc: bnb,
      avalanche: avax,
    },
    nativeByChain: {
      avalanche: avax,
      base: eth,
      bera: null,
      bob: eth,
      bsc: bnb,
      ethereum: eth,
      optimism: eth,
      sei: null,
      soneium: eth,
      sonic: null,
      unichain: eth,
    },
  });
}

export async function getCoinbaseReferencePricesUsd({ spotFetcher = fetchCoinbaseSpotUsd } = {}) {
  const [btc, eth, bnb, avax] = await Promise.all([
    spotFetcher("BTC"),
    spotFetcher("ETH"),
    spotFetcher("BNB").catch(() => null),
    spotFetcher("AVAX").catch(() => null),
  ]);
  return backfillMissingNativePricesUsd({
    btc,
    tokenByKey: {
      btc,
      wbtc: btc,
      ethereum: eth,
      usd_stable: 1,
      paxg: null,
      xaut: null,
      bsc: bnb,
      avalanche: avax,
    },
      nativeByChain: {
        avalanche: avax,
        base: eth,
        bera: null,
        bob: eth,
      bsc: bnb,
      ethereum: eth,
      optimism: eth,
      sei: null,
      soneium: eth,
      sonic: null,
      unichain: eth,
    },
  }, { spotFetcher });
}

function priceSamplesForMap(map = {}, { source, observedAt, namespace }) {
  return Object.entries(map)
    .filter(([, priceUsd]) => Number.isFinite(priceUsd))
    .map(([key, priceUsd]) => ({
      source,
      observedAt,
      namespace,
      key,
      priceUsd,
    }));
}

export function priceSamplesFromSnapshot(prices = {}, { source = "unknown", observedAt = new Date().toISOString() } = {}) {
  return [
    Number.isFinite(prices.btc)
      ? { source, observedAt, namespace: "root", key: "btc", priceUsd: prices.btc }
      : null,
    ...priceSamplesForMap(prices.tokenByKey || {}, { source, observedAt, namespace: "tokenByKey" }),
    ...priceSamplesForMap(prices.nativeByChain || {}, { source, observedAt, namespace: "nativeByChain" }),
  ].filter(Boolean);
}

export function mergePriceSourceSamples(samples = [], {
  now = new Date().toISOString(),
  maxSampleAgeMs = 300_000,
} = {}) {
  const empty = emptyPricesUsd();
  const fresh = samples.filter((sample) => {
    if (!Number.isFinite(sample?.priceUsd)) return false;
    const sampleAgeMs = ageMs(sample.observedAt, now);
    return sampleAgeMs == null || sampleAgeMs <= maxSampleAgeMs;
  });
  const valuesByField = new Map();
  for (const sample of fresh) {
    const key = `${sample.namespace}:${sample.key}`;
    const list = valuesByField.get(key) || [];
    list.push(sample.priceUsd);
    valuesByField.set(key, list);
  }
  const tokenByKey = { ...empty.tokenByKey };
  const nativeByChain = { ...empty.nativeByChain };
  let btc = null;
  for (const [key, values] of valuesByField) {
    const [namespace, field] = key.split(":");
    const value = median(values);
    if (namespace === "root" && field === "btc") btc = value;
    if (namespace === "tokenByKey") tokenByKey[field] = value;
    if (namespace === "nativeByChain") nativeByChain[field] = value;
  }
  if (!Number.isFinite(btc)) btc = tokenByKey.btc;
  if (!Number.isFinite(tokenByKey.btc)) tokenByKey.btc = btc;
  if (!Number.isFinite(tokenByKey.wbtc)) tokenByKey.wbtc = btc;
  if (!Number.isFinite(tokenByKey.usd_stable)) tokenByKey.usd_stable = 1;
  return {
    btc,
    tokenByKey,
    nativeByChain,
    samples: fresh,
    sourceCount: new Set(fresh.map((sample) => sample.source)).size,
    observedAt: now,
  };
}

export async function getMultiSourcePricesUsd({
  now = new Date().toISOString(),
  coingeckoFetcher = getCoinGeckoPricesUsd,
  coinbaseFetcher = getCoinbaseReferencePricesUsd,
} = {}) {
  const settled = await Promise.allSettled([
    coingeckoFetcher().then((prices) => ({ source: "coingecko", prices })),
    coinbaseFetcher().then((prices) => ({ source: "coinbase", prices })),
  ]);
  const samples = settled.flatMap((item) => (
    item.status === "fulfilled"
      ? priceSamplesFromSnapshot(item.value.prices, { source: item.value.source, observedAt: now })
      : []
  ));
  if (samples.length === 0) {
    return {
      ...emptyPricesUsd(),
      oracleSamples: [],
      sourceCount: 0,
    };
  }
  const merged = mergePriceSourceSamples(samples, { now });
  return {
    btc: merged.btc,
    tokenByKey: merged.tokenByKey,
    nativeByChain: merged.nativeByChain,
    oracleSamples: merged.samples,
    sourceCount: merged.sourceCount,
  };
}

export async function getCoinGeckoPricesUsd() {
  const ids = [...new Set([...Object.values(PRICE_IDS), ...Object.values(TOKEN_PRICE_IDS)])];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      throw new Error(`CoinGecko price request failed: ${response.status}`);
    }
    const body = await response.json();

    return backfillMissingNativePricesUsd({
      btc: body.bitcoin?.usd || null,
      tokenByKey: {
        btc: body.bitcoin?.usd || null,
        wbtc: body["wrapped-bitcoin"]?.usd || body.bitcoin?.usd || null,
        ethereum: body.ethereum?.usd || null,
        usd_stable: 1,
        paxg: body["pax-gold"]?.usd || null,
        xaut: body["tether-gold"]?.usd || null,
        bsc: body.binancecoin?.usd || null,
        avalanche: body["avalanche-2"]?.usd || null,
      },
      nativeByChain: Object.fromEntries(
        Object.entries(PRICE_IDS)
          .filter(([key]) => key !== "btc")
          .map(([chain, id]) => [chain, body[id]?.usd || null]),
      ),
    });
  } catch (error) {
    const fallback = await fallbackPricesUsd().catch(() => null);
    if (fallback) return fallback;
    throw error;
  }
}
