const AAVE_MARKETS = Object.freeze({
  ethereum: Object.freeze({
    proto_mainnet_v3: Object.freeze({
      poolAddressProviderAddress: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
      poolAddress: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    }),
  }),
});

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function marketNameFromAaveDepositUrl(depositUrl) {
  const url = parseUrl(depositUrl);
  return normalize(url?.searchParams?.get("marketName"));
}

export function resolveAaveMarketBinding({
  chain = null,
  marketName = null,
  depositUrl = null,
  binding = null,
} = {}) {
  const normalizedChain = normalize(chain);
  const normalizedMarketName =
    normalize(marketName) ||
    normalize(binding?.marketName) ||
    marketNameFromAaveDepositUrl(depositUrl || binding?.depositUrl);
  const configuredMarket = AAVE_MARKETS[normalizedChain]?.[normalizedMarketName] || null;

  return {
    marketName: normalizedMarketName || null,
    poolAddress: binding?.poolAddress || configuredMarket?.poolAddress || null,
    poolAddressProviderAddress:
      binding?.poolAddressProviderAddress ||
      configuredMarket?.poolAddressProviderAddress ||
      null,
  };
}
