import { EVM_CHAIN_CONFIGS } from "../../config/chains.mjs";

export const AERODROME_NFP_ADDRESS = "0x827922686190790b37229fd06084350E74485b72";

const ERC721_ENUMERABLE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
];

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const _cache = new Map();

function cacheKey({ chain, ownerAddress, positionManagerAddress }) {
  return [
    String(chain || "base").toLowerCase(),
    String(positionManagerAddress || AERODROME_NFP_ADDRESS).toLowerCase(),
    String(ownerAddress || "").toLowerCase(),
  ].join(":");
}

export async function enumerateAerodromeTokenIds({
  chain = "base",
  ownerAddress,
  positionManagerAddress = AERODROME_NFP_ADDRESS,
  ttlMs = DEFAULT_TTL_MS,
  nowMs = Date.now(),
  _providerFactory = null,
} = {}) {
  if (!ownerAddress) return [];
  const key = cacheKey({ chain, ownerAddress, positionManagerAddress });
  const cached = _cache.get(key);
  if (cached && nowMs - cached.at < ttlMs) return [...cached.tokenIds];

  const nfp = await loadContract({
    chain,
    address: positionManagerAddress,
    abi: ERC721_ENUMERABLE_ABI,
    _providerFactory,
  });
  const balance = BigInt(await nfp.balanceOf(ownerAddress));
  const tokenIds = [];
  for (let index = 0n; index < balance; index += 1n) {
    const tokenId = await nfp.tokenOfOwnerByIndex(ownerAddress, index);
    tokenIds.push(tokenId.toString());
  }
  _cache.set(key, { at: nowMs, tokenIds });
  return [...tokenIds];
}

async function loadContract({ chain, address, abi, _providerFactory }) {
  if (_providerFactory) return _providerFactory({ chain, address, abi });
  const { ethers } = await import("ethers");
  const cfg = EVM_CHAIN_CONFIGS[chain];
  if (!cfg) throw new Error(`unknown chain ${chain}`);
  const rpcUrls = [
    ...new Set((Array.isArray(cfg.rpcUrls) && cfg.rpcUrls.length > 0 ? cfg.rpcUrls : [cfg.rpcUrl]).filter(Boolean)),
  ];
  if (rpcUrls.length === 0) throw new Error(`missing rpcUrl for chain ${chain}`);
  const contracts = rpcUrls.map((rpcUrl) => {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    return new ethers.Contract(address, abi, provider);
  });
  if (contracts.length === 1) return contracts[0];
  return new Proxy(contracts[0], {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async (...args) => {
        let lastError = null;
        for (const contract of contracts) {
          try {
            const fn = Reflect.get(contract, prop, contract);
            return await fn.apply(contract, args);
          } catch (error) {
            lastError = error;
          }
        }
        throw (
          lastError ||
          new Error(`all rpcUrls failed for ${String(prop)} on chain ${chain} (tried: ${rpcUrls.join(", ")})`)
        );
      };
    },
  });
}

export function clearAerodromeTokenIdCacheForTesting() {
  _cache.clear();
}
