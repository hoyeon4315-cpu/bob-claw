function normalizeRouteKey(routeKey) {
  return String(routeKey || "").toLowerCase();
}

export function matchesRouteSelection(item, filters = {}) {
  if (filters.routeKey && normalizeRouteKey(item.routeKey) !== normalizeRouteKey(filters.routeKey)) return false;
  if (filters.amount && String(item.amount) !== String(filters.amount)) return false;
  if (filters.touchChains?.length) {
    const srcChain = item.route?.srcChain || item.srcChain || null;
    const dstChain = item.route?.dstChain || item.dstChain || null;
    if (!filters.touchChains.includes(srcChain) && !filters.touchChains.includes(dstChain)) return false;
  }
  if (filters.dstChains?.length) {
    const dstChain = item.route?.dstChain || item.dstChain || null;
    if (!filters.dstChains.includes(dstChain)) return false;
  }
  return true;
}
