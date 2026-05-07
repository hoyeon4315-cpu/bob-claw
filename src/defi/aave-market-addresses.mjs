const AAVE_MARKETS = Object.freeze({
  ethereum: Object.freeze({
    proto_mainnet_v3: Object.freeze({
      poolAddressProviderAddress: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
      poolAddress: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    }),
  }),
});

const AAVE_ASSET_MARKETS = Object.freeze({
  sei: Object.freeze({
    // Mirrors src/config/destination-representative-bindings.mjs sei:stablecoin_lending_carry.
    "0xe15fc38f6d8c56af07bbcbe3baf5708a2bf42392": Object.freeze({
      marketName: "yei_sei_usdc",
      poolAddress: "0x4a4d9abD36F923cBA0Af62A39C01dEC2944fb638",
      poolAddressProviderAddress: null,
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

export function underlyingAssetFromAaveDepositUrl(depositUrl) {
  const url = parseUrl(depositUrl);
  return normalize(url?.searchParams?.get("underlyingAsset"));
}

export function resolveAaveMarketBinding({
  chain = null,
  marketName = null,
  assetAddress = null,
  depositUrl = null,
  binding = null,
} = {}) {
  const normalizedChain = normalize(chain);
  const normalizedMarketName =
    normalize(marketName) ||
    normalize(binding?.marketName) ||
    marketNameFromAaveDepositUrl(depositUrl || binding?.depositUrl);
  const normalizedAssetAddress =
    normalize(assetAddress) ||
    normalize(binding?.assetAddress) ||
    underlyingAssetFromAaveDepositUrl(depositUrl || binding?.depositUrl);
  const configuredMarket = AAVE_MARKETS[normalizedChain]?.[normalizedMarketName] || null;
  const configuredAssetMarket = AAVE_ASSET_MARKETS[normalizedChain]?.[normalizedAssetAddress] || null;

  return {
    marketName: normalizedMarketName || configuredAssetMarket?.marketName || null,
    poolAddress: binding?.poolAddress || configuredMarket?.poolAddress || configuredAssetMarket?.poolAddress || null,
    poolAddressProviderAddress:
      binding?.poolAddressProviderAddress ||
      configuredMarket?.poolAddressProviderAddress ||
      configuredAssetMarket?.poolAddressProviderAddress ||
      null,
  };
}
