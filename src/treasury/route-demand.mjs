import { ANNOUNCED_GATEWAY_CHAINS } from "../chains/gateway-announced.mjs";

function normalizedToken(token) {
  return token ? String(token).toLowerCase() : null;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function indicativeNetUsd(candidate = null) {
  return finite(candidate?.effectiveSystemNetPnlUsd) ?? finite(candidate?.executableNetEdgeUsd) ?? finite(candidate?.netEdgeUsd);
}

function supportsRefillDemand(candidate = null) {
  if (!candidate) return false;
  if (!candidate.viableForPrep) return false;
  if (candidate.tradeReadiness === "reject_no_net_edge") return false;
  const netUsd = indicativeNetUsd(candidate);
  return !Number.isFinite(netUsd) || netUsd > 0;
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

function positiveInsufficientDemand(routePlan = null) {
  return (routePlan?.candidates || [])
    .filter(
      (item) =>
        item?.txReady &&
        item?.tradeReadiness === "insufficient_data" &&
        Number.isFinite(indicativeNetUsd(item)) &&
        indicativeNetUsd(item) > 0,
    )
    .flatMap((item) => [
      { chain: item.srcChain },
      item.srcToken ? { chain: item.srcChain, token: item.srcToken } : null,
    ])
    .filter(Boolean);
}

export function selectFundingRouteContext(routePlan = null) {
  const positiveInsufficient = (routePlan?.candidates || [])
    .filter(
      (item) =>
        item?.txReady &&
        item?.tradeReadiness === "insufficient_data" &&
        Number.isFinite(indicativeNetUsd(item)) &&
        indicativeNetUsd(item) > 0,
    )
    .sort(
      (left, right) =>
        indicativeNetUsd(right) - indicativeNetUsd(left) ||
        (left.prepFundingUsd ?? Number.POSITIVE_INFINITY) - (right.prepFundingUsd ?? Number.POSITIVE_INFINITY),
    )[0];

  return positiveInsufficient || routePlan?.topCandidates?.find((item) => item.viableForPrep) || routePlan?.topCandidates?.[0] || null;
}

export function buildTreasuryRouteDemand({ routePlan = null, inventory = null, policy = null } = {}) {
  const activeChains = new Set(policy?.activeChains || inventory?.activeChains || []);
  const supportedChains = new Set(policy?.supportedChains || inventory?.supportedChains || []);
  const announcedChains = new Set((ANNOUNCED_GATEWAY_CHAINS || []).filter((chain) => chain !== "bitcoin"));

  const canaryDrivenDemand = (routePlan?.topCandidates || [])
    .filter((item) => supportsRefillDemand(item))
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
    ...positiveInsufficientDemand(routePlan),
    ...expansionBootstrapDemand,
  ]);
}
