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

async function fallbackPricesUsd() {
  const [btc, eth] = await Promise.all([fetchCoinbaseSpotUsd("BTC"), fetchCoinbaseSpotUsd("ETH")]);
  return {
    btc,
    tokenByKey: {
      btc,
      wbtc: btc,
      ethereum: eth,
      usd_stable: 1,
      paxg: null,
      xaut: null,
    },
    nativeByChain: {
      avalanche: null,
      base: eth,
      bera: null,
      bob: eth,
      bsc: null,
      ethereum: eth,
      optimism: eth,
      sei: null,
      soneium: eth,
      sonic: null,
      unichain: eth,
    },
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

    return {
      btc: body.bitcoin?.usd || null,
      tokenByKey: {
        btc: body.bitcoin?.usd || null,
        wbtc: body["wrapped-bitcoin"]?.usd || body.bitcoin?.usd || null,
        ethereum: body.ethereum?.usd || null,
        usd_stable: 1,
        paxg: body["pax-gold"]?.usd || null,
        xaut: body["tether-gold"]?.usd || null,
      },
      nativeByChain: Object.fromEntries(
        Object.entries(PRICE_IDS)
          .filter(([key]) => key !== "btc")
          .map(([chain, id]) => [chain, body[id]?.usd || null]),
      ),
    };
  } catch (error) {
    const fallback = await fallbackPricesUsd().catch(() => null);
    if (fallback) return fallback;
    throw error;
  }
}
