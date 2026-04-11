export function matchesRouteSelection(item, filters = {}) {
  if (filters.routeKey && item.routeKey !== filters.routeKey) return false;
  if (filters.amount && String(item.amount) !== String(filters.amount)) return false;
  return true;
}
