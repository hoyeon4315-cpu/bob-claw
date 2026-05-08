// Canonical BOB Gateway chain surface.
//
// AGENTS.md is the operating-law source for this list: the 11 official
// destination chains are in scope; Bitcoin is the native on/offramp side.
// Arbitrum and Polygon may appear in fallback/manual bridge modules, but must
// not be treated as Gateway destinations.

export const OFFICIAL_GATEWAY_DESTINATION_CHAINS = Object.freeze([
  "ethereum",
  "bob",
  "base",
  "bsc",
  "avalanche",
  "unichain",
  "bera",
  "optimism",
  "soneium",
  "sei",
  "sonic",
]);

export const OFFICIAL_GATEWAY_ROUTE_CHAINS = Object.freeze([
  "bitcoin",
  ...OFFICIAL_GATEWAY_DESTINATION_CHAINS,
]);

const GATEWAY_CHAIN_ALIASES = Object.freeze({
  "bitcoin l1": "bitcoin",
  btc: "bitcoin",
  "bob l2": "bob",
  "bob chain": "bob",
  bnb: "bsc",
  "bnb chain": "bsc",
  bsc: "bsc",
  avax: "avalanche",
  avalanche: "avalanche",
  berachain: "bera",
  "bera chain": "bera",
  bera: "bera",
});

export function canonicalGatewayChain(chain) {
  const normalized = String(chain || "").trim().toLowerCase();
  if (!normalized) return null;
  return GATEWAY_CHAIN_ALIASES[normalized] || normalized;
}

export function isOfficialGatewayDestinationChain(chain) {
  return OFFICIAL_GATEWAY_DESTINATION_CHAINS.includes(canonicalGatewayChain(chain));
}

export function isOfficialGatewayRouteChain(chain) {
  return OFFICIAL_GATEWAY_ROUTE_CHAINS.includes(canonicalGatewayChain(chain));
}
