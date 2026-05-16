import { getChainRpcUrls } from "./env.mjs";

export const EVM_CHAIN_CONFIGS = Object.freeze({
  avalanche: Object.freeze({
    family: "evm",
    chain: "avalanche",
    chainId: 43_114,
    nativeSymbol: "AVAX",
    nativePriceKey: "avalanche",
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    rpcUrls: getChainRpcUrls("avalanche", ["https://api.avax.network/ext/bc/C/rpc"]),
    fallbackGasUnits: 260_000,
  }),
  base: Object.freeze({
    family: "evm",
    chain: "base",
    chainId: 8_453,
    nativeSymbol: "ETH",
    nativePriceKey: "base",
    rpcUrl: "https://mainnet.base.org",
    rpcUrls: getChainRpcUrls("base", [
      "https://mainnet.base.org",
      "https://mainnet-preconf.base.org",
      "https://base-rpc.publicnode.com",
      "https://base.drpc.org",
    ]),
    fallbackGasUnits: 260_000,
  }),
  bera: Object.freeze({
    family: "evm",
    chain: "bera",
    chainId: 80_094,
    nativeSymbol: "BERA",
    nativePriceKey: "bera",
    rpcUrl: "https://rpc.berachain.com",
    rpcUrls: getChainRpcUrls("bera", ["https://rpc.berachain.com"]),
    fallbackGasUnits: 260_000,
  }),
  bob: Object.freeze({
    family: "evm",
    chain: "bob",
    chainId: 60_808,
    nativeSymbol: "ETH",
    nativePriceKey: "bob",
    rpcUrl: "https://rpc.gobob.xyz",
    rpcUrls: getChainRpcUrls("bob", ["https://rpc.gobob.xyz"]),
    fallbackGasUnits: 260_000,
  }),
  bsc: Object.freeze({
    family: "evm",
    chain: "bsc",
    chainId: 56,
    nativeSymbol: "BNB",
    nativePriceKey: "bsc",
    rpcUrl: "https://bsc-dataseed.binance.org",
    rpcUrls: getChainRpcUrls("bsc", ["https://bsc-dataseed.binance.org"]),
    fallbackGasUnits: 260_000,
    legacyTxType: true,
  }),
  ethereum: Object.freeze({
    family: "evm",
    chain: "ethereum",
    chainId: 1,
    nativeSymbol: "ETH",
    nativePriceKey: "ethereum",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    rpcUrls: getChainRpcUrls("ethereum", [
      "https://ethereum-rpc.publicnode.com",
      "https://rpc.flashbots.net",
      "https://ethereum.publicnode.com",
    ]),
    fallbackGasUnits: 260_000,
    minPriorityFeePerGasWei: "500000000",
    maxFeePerGasBufferBps: 10000,
  }),
  optimism: Object.freeze({
    family: "evm",
    chain: "optimism",
    chainId: 10,
    nativeSymbol: "ETH",
    nativePriceKey: "ethereum",
    rpcUrl: "https://mainnet.optimism.io",
    rpcUrls: getChainRpcUrls("optimism", [
      "https://mainnet.optimism.io",
      "https://optimism-rpc.publicnode.com",
      "https://optimism.drpc.org",
    ]),
    fallbackGasUnits: 260_000,
  }),
  sei: Object.freeze({
    family: "evm",
    chain: "sei",
    chainId: 1_329,
    nativeSymbol: "SEI",
    nativePriceKey: "sei",
    rpcUrl: "https://evm-rpc.sei-apis.com",
    rpcUrls: getChainRpcUrls("sei", ["https://evm-rpc.sei-apis.com"]),
    fallbackGasUnits: 260_000,
  }),
  soneium: Object.freeze({
    family: "evm",
    chain: "soneium",
    chainId: 1_868,
    nativeSymbol: "ETH",
    nativePriceKey: "soneium",
    rpcUrl: "https://rpc.soneium.org",
    rpcUrls: getChainRpcUrls("soneium", ["https://rpc.soneium.org"]),
    fallbackGasUnits: 260_000,
  }),
  sonic: Object.freeze({
    family: "evm",
    chain: "sonic",
    chainId: 146,
    nativeSymbol: "S",
    nativePriceKey: "sonic",
    rpcUrl: "https://rpc.soniclabs.com",
    rpcUrls: getChainRpcUrls("sonic", ["https://rpc.soniclabs.com"]),
    fallbackGasUnits: 260_000,
  }),
  unichain: Object.freeze({
    family: "evm",
    chain: "unichain",
    chainId: 130,
    nativeSymbol: "ETH",
    nativePriceKey: "unichain",
    rpcUrl: "https://mainnet.unichain.org",
    rpcUrls: getChainRpcUrls("unichain", ["https://mainnet.unichain.org", "https://unichain-rpc.publicnode.com"]),
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
