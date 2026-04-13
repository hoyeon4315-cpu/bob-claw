export const gatewayNode = "bob_gateway";
export const viewBoxWidth = 1000;
export const viewBoxHeight = 1000;
export const trailLimit = 18;

export const chainMeta = {
  avalanche: { label: "Avalanche", domain: "avax.network", color: "#e84142" },
  base: { label: "Base", domain: "base.org", color: "#2456ff" },
  bera: { label: "Berachain", domain: "berachain.com", color: "#8d6b42" },
  bitcoin: { label: "Bitcoin", domain: "bitcoin.org", color: "#f7931a" },
  bob: { label: "BOB Mainnet", domain: "gobob.xyz", color: "#f36b21" },
  [gatewayNode]: { label: "BOB Gateway", domain: "gobob.xyz", color: "#177245" },
  bsc: { label: "BNB Chain", domain: "bnbchain.org", color: "#f0b90b" },
  ethereum: { label: "Ethereum", domain: "ethereum.org", color: "#627eea" },
  optimism: { label: "Optimism", domain: "optimism.io", color: "#ff0420" },
  sei: { label: "Sei", domain: "sei.io", color: "#e23f3f" },
  soneium: { label: "Soneium", domain: "soneium.org", color: "#111111" },
  sonic: { label: "Sonic", domain: "soniclabs.com", color: "#00a6a6" },
  unichain: { label: "Unichain", domain: "unichain.org", color: "#ff2d8f" },
};

export function labelFor(chain) {
  return chainMeta[chain]?.label || chain;
}

export function displayChains(status) {
  return [
    ...new Set([
      ...(status.gateway.chains || []),
      ...(status.gateway.announcedChainCoverage?.missingAnnouncedChains || []),
    ]),
  ];
}

export function liveChains(status) {
  return new Set(status.gateway.chains || []);
}

export function orderedChains(chains) {
  const uniqueChains = [...new Set(chains)];
  const order = Array(uniqueChains.length).fill(null);
  const remaining = uniqueChains
    .filter((chain) => chain !== "bitcoin" && chain !== "ethereum")
    .sort((left, right) => {
      if (left === "bob") return -1;
      if (right === "bob") return 1;
      return left.localeCompare(right);
    });

  if (uniqueChains.includes("bitcoin")) order[0] = "bitcoin";
  if (uniqueChains.includes("ethereum")) order[Math.floor(uniqueChains.length / 2)] = "ethereum";

  for (const chain of remaining) {
    const slot = order.findIndex((item) => item === null);
    if (slot >= 0) order[slot] = chain;
  }

  return order.filter(Boolean);
}

function routeAnimationPaths(status) {
  return [
    ...(status.gateway.recentFlowEvents || []).map((event) => ({
      path: event.path,
      segments: event.segments,
      originChain: event.path?.[0],
      direction: event.direction,
      asset: event.asset,
    })),
    ...(status.gateway.flowRoutes || []).flatMap((route) =>
      (route.assets || []).map((asset) => ({
        path: route.path,
        originChain: route.srcChain || route.path?.[0],
        direction: route.direction,
        asset,
      })),
    ),
  ].filter((route) => route.path?.length > 1);
}

export function buildSceneModel(status) {
  const chains = displayChains(status);
  const live = liveChains(status);
  return {
    displayChains: chains,
    liveChains: live,
    pendingChains: chains.filter((chain) => !live.has(chain)),
    animationPaths: routeAnimationPaths(status),
  };
}
