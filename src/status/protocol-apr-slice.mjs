function bpsToPct(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric / 100 : null;
}

function loopAprEntry({ strategyId, protocol, chain, observedAt, marketAssumptions } = {}) {
  const supplyApyPct = bpsToPct(marketAssumptions?.supplyAprBps);
  const borrowApyPct = bpsToPct(marketAssumptions?.borrowAprBps);
  if (!strategyId || !Number.isFinite(supplyApyPct) || !Number.isFinite(borrowApyPct)) return null;
  return {
    strategyId,
    protocol: protocol || null,
    chain: chain || null,
    source: "strategy_market_assumptions",
    observedAt: observedAt || null,
    supplyApyPct,
    borrowApyPct,
    netApyPct: Math.round((supplyApyPct - borrowApyPct) * 100) / 100,
  };
}

export function buildProtocolAprSlice({
  wrappedBtcLoopSlice = null,
  recursiveWrappedBtcLoopScaffold = null,
} = {}) {
  const entries = {};

  const wrappedBtcLoopEntry = loopAprEntry({
    strategyId: wrappedBtcLoopSlice?.strategy?.id,
    protocol: wrappedBtcLoopSlice?.strategy?.protocol,
    chain: wrappedBtcLoopSlice?.strategy?.chain,
    observedAt: wrappedBtcLoopSlice?.generatedAt || null,
    marketAssumptions: wrappedBtcLoopSlice?.marketAssumptions || null,
  });
  if (wrappedBtcLoopEntry) entries[wrappedBtcLoopEntry.strategyId] = wrappedBtcLoopEntry;

  const recursiveWrappedBtcLoopEntry = loopAprEntry({
    strategyId: recursiveWrappedBtcLoopScaffold?.strategy?.id,
    protocol: recursiveWrappedBtcLoopScaffold?.strategy?.protocol,
    chain: recursiveWrappedBtcLoopScaffold?.strategy?.chain,
    observedAt: recursiveWrappedBtcLoopScaffold?.generatedAt || null,
    marketAssumptions: recursiveWrappedBtcLoopScaffold?.marketAssumptions || null,
  });
  if (recursiveWrappedBtcLoopEntry) entries[recursiveWrappedBtcLoopEntry.strategyId] = recursiveWrappedBtcLoopEntry;

  return entries;
}
