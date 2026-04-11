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

export async function getCoinGeckoPricesUsd() {
  const ids = [...new Set([...Object.values(PRICE_IDS), ...Object.values(TOKEN_PRICE_IDS)])];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
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
}
