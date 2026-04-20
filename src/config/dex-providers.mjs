import { getEnv } from "./env.mjs";

// PancakeSwap V3 contract addresses on BSC mainnet
export const PANCAKE_SWAP_V3 = Object.freeze({
  // V3 SwapRouter (standard exactInputSingle)
  swapRouter: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
  // QuoterV2 for on-chain quotes via eth_call
  quoterV2: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
  // Fee tiers to try when quoting (sorted by typical liquidity)
  feeTiers: [500, 2500, 100, 10000],
});

// 1inch API configuration
export const ONE_INCH_API_BASE = "https://api.1inch.com";
export const ONE_INCH_SWAP_VERSION = "v6.1";
export const ONE_INCH_CHAIN_IDS = Object.freeze({
  bsc: 56,
});

export function oneInchApiKey() {
  return getEnv("BOB_CLAW_INCH_API_KEY", null);
}

// DEX provider priority per chain (first = highest priority)
// Chains not listed default to ["odos"]
export const DEX_PROVIDER_PRIORITY = Object.freeze({
  bsc: ["odos", "pancake_swap", "one_inch"],
});

export function dexProviderPriority(chain) {
  return DEX_PROVIDER_PRIORITY[chain] || ["odos"];
}