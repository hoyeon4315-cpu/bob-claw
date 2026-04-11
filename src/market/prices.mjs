const PRICE_IDS = {
  btc: "bitcoin",
  ethereum: "ethereum",
  avalanche: "avalanche-2",
  base: "ethereum",
  bera: "berachain-bera",
  bob: "ethereum",
  bsc: "binancecoin",
  soneium: "ethereum",
  sonic: "sonic-3",
  unichain: "ethereum",
};

const TOKEN_PRICE_IDS = {
  wbtc: "wrapped-bitcoin",
  paxg: "pax-gold",
  xaut: "tether-gold",
};

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
