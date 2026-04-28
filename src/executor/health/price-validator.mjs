// Price Validator
// Prevents the #2 bug: priceMap assumptions wildly different from market reality
//
// Critical fact learned:
// - We assumed cbBTC = $95,000
// - Actual Base market price = $76,730 (19% error)
// - This caused "$20 cbBTC" to actually be $16.15, but we planned strategies as if $20
//
// This module:
// 1. Takes a priceMap
// 2. Validates against Odos spot quotes for key tokens
// 3. Flags any token with >5% divergence
// 4. Returns corrected priceMap with market-derived prices

const ODOS_API = "https://api.odos.xyz";
const DEFAULT_DIVERGENCE_PCT = 5.0;

export async function validatePriceMap({
  priceMap = {},
  tokenConfigs = [], // [{ chainId, symbol, address, decimals, assumedPrice }]
  signerAddress = "0x0000000000000000000000000000000000000001",
  maxDivergencePct = DEFAULT_DIVERGENCE_PCT,
} = {}) {
  const validated = { ...priceMap };
  const warnings = [];
  const corrections = [];

  for (const config of tokenConfigs) {
    const { chainId, symbol, address, decimals, assumedPrice } = config;
    if (!assumedPrice || assumedPrice <= 0) continue;

    try {
      const marketPrice = await getOdosPrice(chainId, address, decimals, signerAddress);
      if (!marketPrice || marketPrice <= 0) continue;

      const divergence = Math.abs(marketPrice - assumedPrice) / assumedPrice * 100;

      if (divergence > maxDivergencePct) {
        warnings.push({
          type: "price_divergence",
          symbol,
          address,
          assumedPrice,
          marketPrice,
          divergencePct: Number(divergence.toFixed(2)),
          message: `${symbol}: assumed $${assumedPrice}, market $${marketPrice.toFixed(2)} (${divergence.toFixed(1)}% off)`,
        });
        validated[symbol] = marketPrice;
        corrections.push({ symbol, from: assumedPrice, to: marketPrice });
      }
    } catch (e) {
      warnings.push({
        type: "price_check_failed",
        symbol,
        error: e.message,
      });
    }
  }

  return {
    validated,
    original: priceMap,
    corrections,
    warnings,
    divergenceCount: corrections.length,
    timestamp: new Date().toISOString(),
  };
}

async function getOdosPrice(chainId, tokenAddress, decimals, userAddr) {
  // Quote a small probe amount (1 unit) to get per-token price without slippage
  const probeAmount = decimals === 8 ? "100000000" : "1000000000000000000"; // 1.0 token
  const USDC_ADDRESS = chainId === 8453
    ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    : chainId === 1
      ? "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
      : null;

  if (!USDC_ADDRESS) return null;

  const body = {
    chainId,
    inputTokens: [{ tokenAddress, amount: probeAmount }],
    outputTokens: [{ tokenAddress: USDC_ADDRESS, proportion: 1 }],
    userAddr,
    slippageLimitPercent: 0.5,
    disableRFQs: true,
    compact: true,
  };

  const r = await fetch(`${ODOS_API}/sor/quote/v3`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!r.ok) return null;
  const data = await r.json();
  const usdcOut = Number(data.outAmounts?.[0] || 0) / 1e6;
  return usdcOut; // price per 1.0 token in USD
}

export async function buildValidatedPriceMap({
  assumedPriceMap = {},
  chainId = 8453,
  signerAddress = "0x0000000000000000000000000000000000000001",
} = {}) {
  const tokenConfigs = Object.entries(assumedPriceMap)
    .filter(([, price]) => price > 0)
    .map(([symbol, assumedPrice]) => {
      const address = resolveTokenAddress(chainId, symbol);
      const decimals = resolveTokenDecimals(symbol);
      return { chainId, symbol, address, decimals, assumedPrice };
    })
    .filter((c) => c.address && c.decimals !== undefined);

  return validatePriceMap({ priceMap: assumedPriceMap, tokenConfigs, signerAddress });
}

function resolveTokenAddress(chainId, symbol) {
  const map = {
    8453: {
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      WETH: "0x4200000000000000000000000000000000000006",
      ETH: "0x4200000000000000000000000000000000000006",
      AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    },
    1: {
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      ETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    },
  };
  return map[chainId]?.[symbol] || null;
}

function resolveTokenDecimals(symbol) {
  const map = {
    USDC: 6, USDT: 6, RLUSD: 18,
    WBTC: 8, cbBTC: 8, "wBTC.OFT": 8, BTC: 8,
    WETH: 18, ETH: 18,
    BNB: 18, WBNB: 18,
    AVAX: 18, BERA: 18, AERO: 18,
  };
  return map[symbol];
}
