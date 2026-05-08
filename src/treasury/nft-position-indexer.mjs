// NFT position indexer — Aerodrome CL + Uniswap v3 NonfungiblePositionManager.
// Output: data/treasury/nft-positions.json (30m cache). Pure-data; no signing.
//
// Reads: signerAddress + chain configs (PositionManager addresses).
// Returns: { generatedAt, perWallet: { addr: { chain: { positions: [...] } } } }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_CACHE_PATH = "data/treasury/nft-positions.json";
export const NFT_POSITION_CACHE_TTL_MS = 30 * 60 * 1000;
const ETH_BTC_INVALIDATE_MOVE_PCT = 0.03;

export const POSITION_MANAGER_REGISTRY = Object.freeze({
  ethereum: Object.freeze({ uniswapV3: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" }),
  base: Object.freeze({
    uniswapV3: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
    aerodromeCl: "0x827922686190790b37229fd06084350E74485b72",
  }),
  optimism: Object.freeze({ uniswapV3: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" }),
  bnb: Object.freeze({ uniswapV3: "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613" }),
  avalanche: Object.freeze({ uniswapV3: "0x655C406EBFa14EE2006250925e54ec43AD184f8B" }),
});

function timeMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function cacheStale(cache, now) {
  if (!cache || !cache.generatedAt) return true;
  return new Date(now).getTime() - new Date(cache.generatedAt).getTime() > NFT_POSITION_CACHE_TTL_MS;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function rebalanceEventId(event) {
  if (!event) return null;
  if (typeof event === "string") return event;
  return event.id || event.eventId || event.txHash || event.observedAt || null;
}

function cacheInvalidationReasons(wallet, {
  now,
  currentEthBtcRatio = null,
  ethBtcMovePct = null,
  rebalanceEvent = null,
  killSwitchToggledAt = null,
} = {}) {
  const reasons = [];
  if (cacheStale({ generatedAt: wallet?.generatedAt }, now)) {
    reasons.push("cache_ttl_expired");
  }

  const cachedRatio = finitePositive(wallet?.cacheMetadata?.ethBtcRatio);
  const currentRatio = finitePositive(currentEthBtcRatio);
  const explicitMove = ethBtcMovePct === null || ethBtcMovePct === undefined || ethBtcMovePct === ""
    ? null
    : Number(ethBtcMovePct);
  const movePct = Number.isFinite(explicitMove)
    ? Math.abs(explicitMove)
    : cachedRatio && currentRatio
      ? Math.abs((currentRatio - cachedRatio) / cachedRatio)
      : null;
  if (Number.isFinite(movePct) && movePct >= ETH_BTC_INVALIDATE_MOVE_PCT) {
    reasons.push("eth_btc_price_move");
  }

  const eventId = rebalanceEventId(rebalanceEvent);
  const lastEventId = wallet?.cacheMetadata?.lastRebalanceEventId || null;
  if (eventId && eventId !== lastEventId) {
    const eventMs = timeMs(rebalanceEvent?.observedAt || rebalanceEvent?.timestamp || rebalanceEvent);
    const generatedMs = timeMs(wallet?.generatedAt);
    if (eventMs === null || generatedMs === null || eventMs >= generatedMs) {
      reasons.push("explicit_rebalance_event");
    }
  }

  const killMs = timeMs(killSwitchToggledAt);
  const generatedMs = timeMs(wallet?.generatedAt);
  if (killMs !== null && (generatedMs === null || killMs >= generatedMs)) {
    reasons.push("kill_switch_toggled");
  }

  return [...new Set(reasons)];
}

function readCache(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function writeCache(path, value) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

// indexerFn: async ({ chain, address, contract, _providerFactory }) => Position[]
// Default uses ethers; tests inject _providerFactory.
async function defaultIndexer({ chain, address, contract, _providerFactory }) {
  if (!_providerFactory) {
    return { error: "no_provider_factory" };
  }
  const provider = await _providerFactory({ chain });
  if (!provider) return { error: "provider_unavailable" };
  // ABI fragments — tests stub provider; in production call PositionManager.
  const balanceOfAbi = ["function balanceOf(address) view returns (uint256)", "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)"];
  if (typeof provider.getContract !== "function") return { error: "provider_missing_getContract" };
  const c = await provider.getContract({ address: contract, abi: balanceOfAbi });
  const balance = Number(await c.balanceOf(address));
  const tokenIds = [];
  for (let i = 0; i < balance; i++) {
    tokenIds.push(String(await c.tokenOfOwnerByIndex(address, i)));
  }
  return tokenIds.map((id) => ({ tokenId: id, contract, chain }));
}

export async function indexNftPositions({
  walletAddress,
  registry = POSITION_MANAGER_REGISTRY,
  cachePath = DEFAULT_CACHE_PATH,
  now = new Date(),
  forceRefresh = false,
  currentEthBtcRatio = null,
  ethBtcMovePct = null,
  rebalanceEvent = null,
  killSwitchToggledAt = null,
  indexerFn = defaultIndexer,
  _providerFactory,
} = {}) {
  if (!walletAddress) throw new TypeError("walletAddress required");
  const cache = readCache(cachePath) || { generatedAt: null, perWallet: {} };
  const wallet = (cache.perWallet || {})[walletAddress];
  const invalidationReasons = wallet
    ? cacheInvalidationReasons(wallet, {
        now,
        currentEthBtcRatio,
        ethBtcMovePct,
        rebalanceEvent,
        killSwitchToggledAt,
      })
    : ["cache_missing"];
  if (!forceRefresh && wallet && invalidationReasons.length === 0) {
    return { ...wallet, fromCache: true };
  }
  const perChain = {};
  for (const [chain, contracts] of Object.entries(registry)) {
    const positions = [];
    const errors = [];
    for (const [protocolKey, addr] of Object.entries(contracts)) {
      try {
        const out = await indexerFn({ chain, address: walletAddress, contract: addr, _providerFactory });
        if (out && out.error) {
          errors.push({ protocolKey, error: out.error });
          continue;
        }
        for (const p of (out || [])) positions.push({ ...p, protocolKey });
      } catch (err) {
        errors.push({ protocolKey, error: String(err?.message || err) });
      }
    }
    perChain[chain] = { positions, errors };
  }
  const result = {
    generatedAt: new Date(now).toISOString(),
    positions: perChain,
    cacheMetadata: {
      ethBtcRatio: finitePositive(currentEthBtcRatio),
      lastRebalanceEventId: rebalanceEventId(rebalanceEvent),
      lastKillSwitchToggledAt: killSwitchToggledAt || wallet?.cacheMetadata?.lastKillSwitchToggledAt || null,
    },
    cacheInvalidationReasons: forceRefresh ? ["force_refresh"] : invalidationReasons,
  };
  cache.perWallet = { ...(cache.perWallet || {}), [walletAddress]: result };
  cache.generatedAt = result.generatedAt;
  writeCache(cachePath, cache);
  return { ...result, fromCache: false };
}
