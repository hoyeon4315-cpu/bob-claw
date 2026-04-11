// Public BOB copy currently describes 11 EVM destination chains, plus native Bitcoin as the on/offramp side.
export const ANNOUNCED_GATEWAY_CHAINS = [
  "avalanche",
  "base",
  "bera",
  "bitcoin",
  "bob",
  "bsc",
  "ethereum",
  "optimism",
  "sei",
  "soneium",
  "sonic",
  "unichain",
];

export function compareAnnouncedGatewayChains(currentChains = []) {
  const current = new Set(currentChains);
  const announced = new Set(ANNOUNCED_GATEWAY_CHAINS);
  return {
    announcedChains: ANNOUNCED_GATEWAY_CHAINS,
    announcedChainCount: ANNOUNCED_GATEWAY_CHAINS.length,
    currentChainCount: current.size,
    missingAnnouncedChains: ANNOUNCED_GATEWAY_CHAINS.filter((chain) => !current.has(chain)),
    extraApiChains: [...current].filter((chain) => !announced.has(chain)).sort(),
  };
}
