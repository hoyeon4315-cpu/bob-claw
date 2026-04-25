import { shellQuote } from "../lib/shell-quote.mjs";

function dedupe(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function routeQuoteCommand(routeKey, { includeStableEntry = false } = {}) {
  if (!routeKey) return null;
  return `npm run quote:dex -- --route-key=${shellQuote(routeKey)}${includeStableEntry ? " --include-stable-entry" : ""}`;
}

function chainQuoteCommand(chains = [], { includeStableEntry = false, routeLimit = 48 } = {}) {
  const selected = dedupe(chains);
  if (!selected.length) return null;
  return `npm run quote:dex -- --chains=${selected.join(",")}${includeStableEntry ? " --include-stable-entry" : ""} --route-limit=${routeLimit}`;
}

function stableLoopRefreshPlan(crossAssetArbitrage = null) {
  const bestPair = crossAssetArbitrage?.bestAmountLadderPair || null;
  if (!bestPair) {
    return {
      kind: "stable_loop",
      nextAction: "collect_stable_loop_coverage",
      reason: "no_paired_stable_loop_ladder",
      command: null,
      routeKeys: [],
    };
  }
  const routeKeys = dedupe([bestPair.entryRouteKey, bestPair.exitRouteKey]);
  const amountMismatch = (bestPair.blockerCounts || []).find((item) => item.blocker === "amount_mismatch") || null;
  return {
    kind: "stable_loop",
    nextAction: amountMismatch ? "expand_amount_ladder" : "refresh_stable_loop_quotes",
    reason: amountMismatch ? "amount_mismatch" : (bestPair.blockerCounts?.[0]?.blocker || "refresh_stable_loop_quotes"),
    command: routeQuoteCommand(bestPair.entryRouteKey, { includeStableEntry: true }),
    routeKeys,
  };
}

function proxySpreadRefreshPlan(btcProxySpreads = null) {
  const target = btcProxySpreads?.nextCoverageTarget || null;
  if (!target) {
    return {
      kind: "proxy_spread",
      nextAction: "watch_proxy_surface",
      reason: "no_proxy_target",
      command: null,
      chains: [],
    };
  }
  const chains = dedupe([...(target.buyChains || []), ...(target.sellChains || [])]);
  return {
    kind: "proxy_spread",
    proxyGroup: target.proxyGroup || null,
    nextAction: target.nextAction || "watch_surface",
    reason: target.reason || "coverage_ok",
    command:
      target.nextAction === "expand_amount_ladder" || target.nextAction === "refresh_stale_quotes" || target.nextAction === "expand_missing_side"
        ? chainQuoteCommand(chains, { includeStableEntry: true, routeLimit: 64 })
        : null,
    chains,
  };
}

export function buildStrategyRefreshPlans({ crossAssetArbitrage = null, btcProxySpreads = null } = {}) {
  return {
    stableLoop: stableLoopRefreshPlan(crossAssetArbitrage),
    proxySpread: proxySpreadRefreshPlan(btcProxySpreads),
  };
}
