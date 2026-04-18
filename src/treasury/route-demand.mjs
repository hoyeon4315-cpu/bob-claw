import { ANNOUNCED_GATEWAY_CHAINS } from "../chains/gateway-announced.mjs";

function normalizedToken(token) {
  return token ? String(token).toLowerCase() : null;
}

function dedupeRouteDemand(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.chain}:${normalizedToken(item.token) || "native"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildTreasuryRouteDemand({ routePlan = null, inventory = null, policy = null } = {}) {
  const activeChains = new Set(policy?.activeChains || inventory?.activeChains || []);
  const supportedChains = new Set(policy?.supportedChains || inventory?.supportedChains || []);
  const announcedChains = new Set((ANNOUNCED_GATEWAY_CHAINS || []).filter((chain) => chain !== "bitcoin"));

  const canaryDrivenDemand = (routePlan?.topCandidates || [])
    .filter((item) => item.viableForPrep)
    .flatMap((item) => [
      { chain: item.srcChain },
      { chain: item.srcChain, token: item.routeKey.split(":")[1]?.split("->")[0] || null },
    ]);

  const expansionBootstrapDemand = (inventory?.native || [])
    .filter((item) =>
      item?.enabled &&
      item?.status === "observe_only_low" &&
      !activeChains.has(item.chain) &&
      supportedChains.has(item.chain) &&
      announcedChains.has(item.chain),
    )
    .map((item) => ({ chain: item.chain }));

  return dedupeRouteDemand([
    ...canaryDrivenDemand,
    ...expansionBootstrapDemand,
  ]);
}
