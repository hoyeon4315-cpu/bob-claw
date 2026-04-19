import { getChainRpcUrls } from "./env.mjs";

export const EVM_CHAIN_CONFIGS = Object.freeze({
  avalanche: Object.freeze({
    family: "evm",
    chain: "avalanche",
    chainId: 43_114,
    nativeSymbol: "AVAX",
    nativePriceKey: "avalanche",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    rpcUrls: ["https://api.avax.network/ext/bc/C/rpc"],
    fallbackGasUnits: 260_000,
  }),
  base: Object.freeze({
    family: "evm",
    chain: "base",
    chainId: 8_453,
    nativeSymbol: "ETH",
    nativePriceKey: "base",
    rpcUrl: "https://mainnet.base.org",
    rpcUrls: ["https://mainnet.base.org", "https://mainnet-preconf.base.org"],
    fallbackGasUnits: 260_000,
  }),
  bera: Object.freeze({
    family: "evm",
    chain: "bera",
    chainId: 80_094,
    nativeSymbol: "BERA",
    nativePriceKey: "bera",
    rpcUrl: "https://rpc.berachain.com",
    rpcUrls: ["https://rpc.berachain.com"],
    fallbackGasUnits: 260_000,
  }),
  bob: Object.freeze({
    family: "evm",
    chain: "bob",
    chainId: 60_808,
    nativeSymbol: "ETH",
    nativePriceKey: "bob",
    rpcUrl: "https://rpc.gobob.xyz",
    rpcUrls: ["https://rpc.gobob.xyz"],
    fallbackGasUnits: 260_000,
  }),
  bsc: Object.freeze({
    family: "evm",
    chain: "bsc",
    chainId: 56,
    nativeSymbol: "BNB",
    nativePriceKey: "bsc",
    rpcUrl: "https://bsc-dataseed.binance.org",
    rpcUrls: ["https://bsc-dataseed.binance.org"],
    fallbackGasUnits: 260_000,
  }),
  ethereum: Object.freeze({
    family: "evm",
    chain: "ethereum",
    chainId: 1,
    nativeSymbol: "ETH",
    nativePriceKey: "ethereum",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    rpcUrls: ["https://ethereum-rpc.publicnode.com"],
    fallbackGasUnits: 260_000,
  }),
  soneium: Object.freeze({
    family: "evm",
    chain: "soneium",
    chainId: 1_868,
    nativeSymbol: "ETH",
    nativePriceKey: "soneium",
    rpcUrl: "https://rpc.soneium.org",
    rpcUrls: ["https://rpc.soneium.org"],
    fallbackGasUnits: 260_000,
  }),
  sonic: Object.freeze({
    family: "evm",
    chain: "sonic",
    chainId: 146,
    nativeSymbol: "S",
    nativePriceKey: "sonic",
    rpcUrl: "https://rpc.soniclabs.com",
    rpcUrls: ["https://rpc.soniclabs.com"],
    fallbackGasUnits: 260_000,
  }),
  unichain: Object.freeze({
    family: "evm",
    chain: "unichain",
    chainId: 130,
    nativeSymbol: "ETH",
    nativePriceKey: "unichain",
    rpcUrl: "https://mainnet.unichain.org",
    rpcUrls: ["https://mainnet.unichain.org"],
    fallbackGasUnits: 260_000,
  }),
});

export const BITCOIN_CHAIN_CONFIGS = Object.freeze({
  bitcoin: Object.freeze({
    family: "btc",
    chain: "bitcoin",
    network: "bitcoin",
    nativeSymbol: "BTC",
    nativePriceKey: "btc",
    decimals: 8,
    dustThresholdSats: 546,
    replaceByFeeSequence: 0xfffffffd,
    addressType: "p2tr",
  }),
});

export const CHAIN_CONFIGS = Object.freeze({
  ...EVM_CHAIN_CONFIGS,
  ...BITCOIN_CHAIN_CONFIGS,
});

export function listEvmChains() {
  return Object.keys(EVM_CHAIN_CONFIGS);
}

export function listSupportedChains() {
  return Object.keys(CHAIN_CONFIGS);
}

export function getChainConfig(chain) {
  return CHAIN_CONFIGS[chain] || null;
}

export function getEvmChainConfig(chain) {
  const base = EVM_CHAIN_CONFIGS[chain] || null;
  if (!base) return null;
  const rpcUrls = getChainRpcUrls(chain, base.rpcUrls || [base.rpcUrl].filter(Boolean));
  return {
    ...base,
    rpcUrls,
    rpcUrl: rpcUrls[0] || base.rpcUrl || null,
  };
}

export function getBitcoinChainConfig(chain = "bitcoin") {
  return BITCOIN_CHAIN_CONFIGS[chain] || null;
}

export function isEvmChain(chain) {
  return Boolean(getEvmChainConfig(chain));
}

export function isBitcoinChain(chain) {
  return Boolean(getBitcoinChainConfig(chain));
}
