import { tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { EVM_CHAINS } from "../chains/registry.mjs";
import { latestBy } from "../lib/jsonl-read.mjs";

function bigint(value) {
  return BigInt(value || 0);
}

function chooseHigherShortfall(current, candidate) {
  if (!current) return candidate;
  const currentShortfall = bigint(current.shortfall);
  const candidateShortfall = bigint(candidate.shortfall);
  if (candidateShortfall > currentShortfall) return candidate;
  if (candidateShortfall < currentShortfall) return current;
  return bigint(candidate.required) > bigint(current.required) ? candidate : current;
}

function summarizeRequirementState(source, asset) {
  return {
    token: source.token || asset.token,
    ticker: asset.ticker,
    decimals: asset.decimals,
    actual: source.actual,
    required: source.required,
    shortfall: source.shortfall,
    ok: source.ok,
  };
}

function sortByShortfall(items) {
  return [...items].sort((left, right) => {
    const diff = bigint(right.shortfall) - bigint(left.shortfall);
    if (diff !== 0n) return diff > 0n ? 1 : -1;
    return String(left.ticker || left.token || "").localeCompare(String(right.ticker || right.token || ""));
  });
}

function latestForAddress(records, address) {
  const filtered = address
    ? records.filter((item) => String(item.address || "").toLowerCase() === address.toLowerCase())
    : records;
  return [...latestBy(filtered, (item) => `${item.address}|${item.routeKey}|${item.amount}`).values()];
}

function latestFailuresForAddress(records, address) {
  const filtered = address
    ? records.filter((item) => String(item.address || "").toLowerCase() === address.toLowerCase())
    : records;
  return [...latestBy(filtered, (item) => `${item.address}|${item.routeKey}|${item.amount}|${item.reason}`).values()];
}

function routeBlockers(record) {
  const blockers = [];
  if (record.native && !record.native.ok) blockers.push("native");
  if (record.token && !record.token.ok) blockers.push("token");
  if (record.allowance && !record.allowance.ok) blockers.push("allowance");
  return blockers;
}

function toDecimalString(value, decimals) {
  const formatted = unitsToDecimal(value, decimals);
  if (!Number.isFinite(formatted)) return null;
  return formatted;
}

export function buildEstimatorFundingPlan({ readinessRecords = [], readinessFailures = [] }, options = {}) {
  const address = options.address || null;
  const records = latestForAddress(readinessRecords, address);
  const failures = latestFailuresForAddress(readinessFailures, address);
  const chains = new Map();
  const failureReasonCounts = new Map();
  const routes = [];

  for (const failure of failures) {
    failureReasonCounts.set(failure.reason, (failureReasonCounts.get(failure.reason) || 0) + 1);
  }

  for (const record of records) {
    const nativeAsset = tokenAsset(record.srcChain, "0x0000000000000000000000000000000000000000");
    if (!chains.has(record.srcChain)) {
      chains.set(record.srcChain, {
        chain: record.srcChain,
        nativeSymbol: EVM_CHAINS[record.srcChain]?.nativeSymbol || nativeAsset.ticker,
        native: null,
        tokens: new Map(),
        allowances: new Map(),
        routes: [],
      });
    }

    const chainPlan = chains.get(record.srcChain);
    const nativeState = summarizeRequirementState(
      {
        token: nativeAsset.token,
        actual: record.native.balanceWei,
        required: record.native.requiredWei,
        shortfall: record.native.shortfallWei,
        ok: record.native.ok,
      },
      nativeAsset,
    );
    chainPlan.native = chooseHigherShortfall(chainPlan.native, nativeState);

    if (record.token) {
      const asset = tokenAsset(record.srcChain, record.token.token || record.srcToken);
      const tokenState = summarizeRequirementState(record.token, asset);
      const existing = chainPlan.tokens.get(asset.token.toLowerCase());
      chainPlan.tokens.set(asset.token.toLowerCase(), chooseHigherShortfall(existing, tokenState));
    }

    if (record.allowance) {
      const asset = tokenAsset(record.srcChain, record.token?.token || record.srcToken);
      const allowanceState = {
        ...summarizeRequirementState(record.allowance, asset),
        spender: record.allowance.spender,
      };
      const key = `${asset.token.toLowerCase()}|${record.allowance.spender.toLowerCase()}`;
      const existing = chainPlan.allowances.get(key);
      chainPlan.allowances.set(key, chooseHigherShortfall(existing, allowanceState));
    }

    routes.push({
      routeKey: record.routeKey,
      srcChain: record.srcChain,
      dstChain: record.dstChain,
      amount: record.amount,
      blockers: routeBlockers(record),
      overallReady: record.overallReady,
    });
    chainPlan.routes.push({
      routeKey: record.routeKey,
      dstChain: record.dstChain,
      amount: record.amount,
      blockers: routeBlockers(record),
      overallReady: record.overallReady,
    });
  }

  const chainPlans = [...chains.values()]
    .map((chainPlan) => ({
      chain: chainPlan.chain,
      nativeSymbol: chainPlan.nativeSymbol,
      native: chainPlan.native
        ? {
            ...chainPlan.native,
            actualDecimal: toDecimalString(chainPlan.native.actual, chainPlan.native.decimals),
            requiredDecimal: toDecimalString(chainPlan.native.required, chainPlan.native.decimals),
            shortfallDecimal: toDecimalString(chainPlan.native.shortfall, chainPlan.native.decimals),
          }
        : null,
      tokens: sortByShortfall([...chainPlan.tokens.values()]).map((item) => ({
        ...item,
        actualDecimal: toDecimalString(item.actual, item.decimals),
        requiredDecimal: toDecimalString(item.required, item.decimals),
        shortfallDecimal: toDecimalString(item.shortfall, item.decimals),
      })),
      allowances: sortByShortfall([...chainPlan.allowances.values()]).map((item) => ({
        ...item,
        actualDecimal: toDecimalString(item.actual, item.decimals),
        requiredDecimal: toDecimalString(item.required, item.decimals),
        shortfallDecimal: toDecimalString(item.shortfall, item.decimals),
      })),
      routes: chainPlan.routes.sort((left, right) => {
        if (left.overallReady !== right.overallReady) return left.overallReady ? 1 : -1;
        return left.routeKey.localeCompare(right.routeKey);
      }),
    }))
    .sort((left, right) => {
      const leftNativeShortfall = bigint(left.native?.shortfall || 0);
      const rightNativeShortfall = bigint(right.native?.shortfall || 0);
      if (leftNativeShortfall !== rightNativeShortfall) return rightNativeShortfall > leftNativeShortfall ? 1 : -1;
      return left.chain.localeCompare(right.chain);
    });

  const readyRouteCount = routes.filter((route) => route.overallReady).length;
  const blockedRouteCount = routes.length - readyRouteCount;

  return {
    address,
    routeCount: routes.length,
    readyRouteCount,
    blockedRouteCount,
    skippedRouteCount: failures.length,
    failureReasons: [...failureReasonCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([reason, count]) => ({ reason, count })),
    chains: chainPlans,
    routes,
  };
}
