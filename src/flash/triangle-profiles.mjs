import { join } from "node:path";

export const DEFAULT_TRIANGLE_PROFILE_ID = "base-btc";

export const BASE_USDC = Object.freeze({
  symbol: "USDC",
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  decimals: 6,
  assetClass: "stablecoin",
});

const BASE_TOKENS = Object.freeze({
  LBTC: Object.freeze({ symbol: "LBTC", address: "0xecAc9C5F704e954931349Da37F60E39f515c11c1", decimals: 8, assetClass: "btc" }),
  cbBTC: Object.freeze({ symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, assetClass: "btc" }),
  tBTC: Object.freeze({ symbol: "tBTC", address: "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b", decimals: 18, assetClass: "btc" }),
  WETH: Object.freeze({ symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, assetClass: "eth" }),
});

export const TRIANGLE_PROFILES = Object.freeze({
  "base-btc": Object.freeze({
    id: "base-btc",
    label: "Base BTC derivatives",
    chainId: 8453,
    stableToken: BASE_USDC,
    routeTokens: [BASE_TOKENS.LBTC, BASE_TOKENS.cbBTC, BASE_TOKENS.tBTC],
    supportsContractSimulation: true,
    contractMode: "balancer_btc_triangular",
    strategyFamily: "btc_flash_and_spread",
  }),
  "base-eth-btc-mixed": Object.freeze({
    id: "base-eth-btc-mixed",
    label: "Base ETH/BTC mixed",
    chainId: 8453,
    stableToken: BASE_USDC,
    routeTokens: [BASE_TOKENS.WETH, BASE_TOKENS.LBTC, BASE_TOKENS.cbBTC, BASE_TOKENS.tBTC],
    supportsContractSimulation: false,
    contractMode: "analysis_only",
    strategyFamily: "eth_mixed_flash_and_spread",
  }),
});

function normalizeProfileId(profileId = DEFAULT_TRIANGLE_PROFILE_ID) {
  return String(profileId || DEFAULT_TRIANGLE_PROFILE_ID).trim().toLowerCase();
}

export function listTriangleProfiles() {
  return Object.values(TRIANGLE_PROFILES);
}

export function getTriangleProfile(profileId = DEFAULT_TRIANGLE_PROFILE_ID) {
  const normalized = normalizeProfileId(profileId);
  return TRIANGLE_PROFILES[normalized] || TRIANGLE_PROFILES[DEFAULT_TRIANGLE_PROFILE_ID];
}

export function triangleRouteSymbols(profileId = DEFAULT_TRIANGLE_PROFILE_ID) {
  return getTriangleProfile(profileId).routeTokens.map((token) => token.symbol);
}

export function trianglePermutations(profileId = DEFAULT_TRIANGLE_PROFILE_ID) {
  const profile = getTriangleProfile(profileId);
  const pairs = [];
  for (let i = 0; i < profile.routeTokens.length; i += 1) {
    for (let j = 0; j < profile.routeTokens.length; j += 1) {
      if (i === j) continue;
      pairs.push([profile.routeTokens[i], profile.routeTokens[j]]);
    }
  }
  return pairs;
}

export function triangleRouteLabels(profileId = DEFAULT_TRIANGLE_PROFILE_ID) {
  const profile = getTriangleProfile(profileId);
  return trianglePermutations(profile.id).map(
    ([tokenA, tokenB]) => `${profile.stableToken.symbol}→${tokenA.symbol}→${tokenB.symbol}→${profile.stableToken.symbol}`,
  );
}

export function triangleDatasetNames(profileId = DEFAULT_TRIANGLE_PROFILE_ID) {
  const normalized = normalizeProfileId(profileId);
  const suffix = normalized === DEFAULT_TRIANGLE_PROFILE_ID ? "" : `-${normalized}`;
  return {
    sampleLogName: `triangular-spread-samples${suffix}`,
    latestFileName: `triangular-spread-latest${suffix}.json`,
    analysisFileName: `triangular-spread-analysis${suffix}.json`,
    alertLogName: `triangular-alerts${suffix}`,
    triggerLogName: `triangular-trigger-log${suffix}`,
    overfitReportFileName: `triangular-spread-overfit${suffix}.json`,
    autoReportFileName: `spread-analysis-report${suffix}.json`,
  };
}

export function triangleDatasetPaths(dataDir, profileId = DEFAULT_TRIANGLE_PROFILE_ID) {
  const names = triangleDatasetNames(profileId);
  return {
    sampleLogPath: join(dataDir, `${names.sampleLogName}.jsonl`),
    latestPath: join(dataDir, names.latestFileName),
    analysisPath: join(dataDir, names.analysisFileName),
    alertLogPath: join(dataDir, `${names.alertLogName}.jsonl`),
    triggerLogPath: join(dataDir, `${names.triggerLogName}.jsonl`),
    overfitReportPath: join(dataDir, names.overfitReportFileName),
    autoReportPath: join(dataDir, names.autoReportFileName),
  };
}
