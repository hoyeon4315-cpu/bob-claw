// W5-B — Stablecoin treasury rotation venue registry.
//
// Per-chain stable venues ranked by exit-cost and round-trip
// economics.  Used by the treasury allocator and stable sleeve
// strategies.
//
// This is config, not code. Updates require a committed diff.

export const STABLE_VENUES = Object.freeze({
  base: Object.freeze({
    chain: "base",
    venues: Object.freeze([
      Object.freeze({ protocol: "aave_v3", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
      Object.freeze({ protocol: "moonwell", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
      Object.freeze({ protocol: "morpho", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
    ]),
  }),
  ethereum: Object.freeze({
    chain: "ethereum",
    venues: Object.freeze([
      Object.freeze({ protocol: "aave_v3", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
      Object.freeze({ protocol: "compound_v3", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
    ]),
  }),
  bsc: Object.freeze({
    chain: "bsc",
    venues: Object.freeze([
      Object.freeze({ protocol: "venus", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
      Object.freeze({ protocol: "pancakeswap", family: "amm_stable", depositAsset: "USDC", pairAsset: "USDT" }),
    ]),
  }),
  optimism: Object.freeze({
    chain: "optimism",
    venues: Object.freeze([
      Object.freeze({ protocol: "aave_v3", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
      Object.freeze({ protocol: "velodrome", family: "amm_stable", depositAsset: "USDC", pairAsset: "USDT" }),
    ]),
  }),
  avalanche: Object.freeze({
    chain: "avalanche",
    venues: Object.freeze([
      Object.freeze({ protocol: "aave_v3", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
      Object.freeze({ protocol: "benqi", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
    ]),
  }),
  bera: Object.freeze({
    chain: "bera",
    venues: Object.freeze([
      Object.freeze({ protocol: "aave_v3", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
      Object.freeze({ protocol: "dolomite", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
    ]),
  }),
  bob: Object.freeze({
    chain: "bob",
    venues: Object.freeze([
      Object.freeze({ protocol: "aave_v3", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
      Object.freeze({ protocol: "euler_v2", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
    ]),
  }),
  sonic: Object.freeze({
    chain: "sonic",
    venues: Object.freeze([
      Object.freeze({ protocol: "aave_v3", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
      Object.freeze({ protocol: "shadow", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
    ]),
  }),
  soneium: Object.freeze({
    chain: "soneium",
    venues: Object.freeze([
      Object.freeze({ protocol: "aave_v3", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
      Object.freeze({ protocol: "kyo", family: "amm_stable", depositAsset: "USDC", pairAsset: "USDT" }),
    ]),
  }),
  unichain: Object.freeze({
    chain: "unichain",
    venues: Object.freeze([
      Object.freeze({ protocol: "aave_v3", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
      Object.freeze({ protocol: "catex", family: "amm_stable", depositAsset: "USDC", pairAsset: "USDT" }),
    ]),
  }),
  sei: Object.freeze({
    chain: "sei",
    venues: Object.freeze([
      Object.freeze({ protocol: "aave_v3", family: "lending", depositAsset: "USDC", borrowAsset: "USDT" }),
    ]),
  }),
});

export function listStableVenueChains() {
  return Object.keys(STABLE_VENUES);
}

export function getStableVenues(chain) {
  return STABLE_VENUES[chain] || null;
}

export function listConfirmedStableVenueChains() {
  return Object.keys(STABLE_VENUES).filter(
    (c) => STABLE_VENUES[c].status !== "template_only",
  );
}

export function resolveStableProtocols(chain, depositAsset = "USDC", borrowAsset = "USDT") {
  const entry = STABLE_VENUES[chain];
  if (!entry) return null;
  if (entry.status === "template_only") {
    return { protocols: [], status: "template_only", blockers: [...entry.blockers] };
  }
  const matches = entry.venues.filter((v) =>
    v.depositAsset === depositAsset || v.borrowAsset === borrowAsset || v.pairAsset === borrowAsset
  );
  const protocols = matches.map((v) => v.protocol);
  return { protocols, status: "confirmed", blockers: [] };
}

export function getFirstStableProtocol(chain) {
  const entry = STABLE_VENUES[chain];
  if (!entry || entry.status === "template_only" || !entry.venues?.length) return null;
  return entry.venues[0].protocol;
}
