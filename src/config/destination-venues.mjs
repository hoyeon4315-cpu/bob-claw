// W5-A — Destination wrapped-BTC venue registry.
//
// Per-chain primary venues for wrapped-BTC rotation.
// Each entry declares the venue, its protocol family, and the
// measurement fields the allocator expects.
//
// This is config, not code. Updates require a committed diff.

export const WRAPPED_BTC_VENUES = Object.freeze({
  base: Object.freeze({
    chain: "base",
    venues: Object.freeze([
      Object.freeze({ protocol: "moonwell", family: "lending", asset: "wBTC.OFT" }),
      Object.freeze({ protocol: "aerodrome", family: "cl_lp", asset: "cbBTC/LBTC" }),
    ]),
  }),
  bsc: Object.freeze({
    chain: "bsc",
    venues: Object.freeze([
      Object.freeze({ protocol: "venus", family: "lending", asset: "wBTC.OFT" }),
      Object.freeze({ protocol: "pancakeswap", family: "amm", asset: "wBTC.OFT/BNB" }),
      Object.freeze({ protocol: "pendle", family: "pt_direct", asset: "PT-SolvBTC.BBN" }),
    ]),
  }),
  avalanche: Object.freeze({
    chain: "avalanche",
    venues: Object.freeze([
      Object.freeze({ protocol: "benqi", family: "lending", asset: "wBTC.OFT" }),
      Object.freeze({ protocol: "gmx_v2", family: "perp_basis_spot", asset: "BTC.b" }),
    ]),
  }),
  bera: Object.freeze({
    chain: "bera",
    venues: Object.freeze([
      Object.freeze({ protocol: "bend", family: "lending", asset: "wBTC.OFT" }),
      Object.freeze({ protocol: "bex", family: "amm", asset: "wBTC.OFT/HONEY" }),
    ]),
  }),
  bob: Object.freeze({
    chain: "bob",
    venues: Object.freeze([
      Object.freeze({ protocol: "euler_v2", family: "lending", asset: "wBTC.OFT" }),
      Object.freeze({ protocol: "avalon", family: "lending", asset: "wBTC.OFT" }),
      Object.freeze({ protocol: "velodrome", family: "amm", asset: "wBTC.OFT/ETH" }),
    ]),
  }),
  sonic: Object.freeze({
    chain: "sonic",
    venues: Object.freeze([
      Object.freeze({ protocol: "shadow", family: "lending", asset: "wBTC.OFT" }),
    ]),
  }),
  soneium: Object.freeze({
    chain: "soneium",
    venues: Object.freeze([
      Object.freeze({ protocol: "kyo", family: "amm", asset: "wBTC.OFT/ETH" }),
    ]),
  }),
  unichain: Object.freeze({
    chain: "unichain",
    venues: Object.freeze([
      Object.freeze({ protocol: "catex", family: "amm", asset: "wBTC.OFT/ETH" }),
    ]),
  }),
  optimism: Object.freeze({
    chain: "optimism",
    venues: Object.freeze([
      Object.freeze({ protocol: "aave_v3", family: "lending", asset: "wBTC.OFT" }),
    ]),
    status: "template_only",
    blockers: Object.freeze(["no_current_destination_venue", "venue_unconfirmed"]),
  }),
  sei: Object.freeze({
    chain: "sei",
    venues: Object.freeze([]),
    status: "template_only",
    blockers: Object.freeze(["no_current_destination_venue", "venue_unconfirmed"]),
  }),
});

export function listWrappedBtcVenueChains() {
  return Object.keys(WRAPPED_BTC_VENUES);
}

export function getWrappedBtcVenues(chain) {
  return WRAPPED_BTC_VENUES[chain] || null;
}

export function listConfirmedVenueChains() {
  return Object.keys(WRAPPED_BTC_VENUES).filter(
    (c) => WRAPPED_BTC_VENUES[c].status !== "template_only",
  );
}

export function listTemplateOnlyChains() {
  return Object.keys(WRAPPED_BTC_VENUES).filter(
    (c) => WRAPPED_BTC_VENUES[c].status === "template_only",
  );
}
