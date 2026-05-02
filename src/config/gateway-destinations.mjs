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

export function isOfficialGatewayDestinationChain(chain) {
  return OFFICIAL_GATEWAY_DESTINATION_CHAINS.includes(chain);
}

export function isOfficialGatewayRouteChain(chain) {
  return OFFICIAL_GATEWAY_ROUTE_CHAINS.includes(chain);
}
