function inferAssets(name = "") {
  const stripped = String(name)
    .replace(/\s+on\s+(ethereum|base|bsc|arbitrum|optimism|polygon|avalanche|berachain|sonic|sei|soneium|unichain).*$/i, "")
    .toLowerCase();
  const tokens = [];
  const order = ["rlusd", "weth", "wbtc", "cbbtc", "lbtc", "solvbtc", "btcb", "usdc", "usdt", "dai", "btc", "eth"];
  for (const token of order) {
    const re = new RegExp(`\\b${token}\\b`);
    if (re.test(stripped) && !tokens.includes(token)) tokens.push(token);
  }
  return tokens.length ? tokens.slice(0, 2) : ["usdc"];
}

function inferType(name = "", protocolId = "") {
  const lower = String(name || "").toLowerCase();
  if (lower.includes("vault") || lower.includes("supply") || lower.includes("lend") || lower.includes("deposit")) {
    return "lp";
  }
  if (protocolId === "pendle") return "pt";
  return "lp";
}

function observedAtMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positionMarkUsd(event = {}) {
  return finiteNumber(event.valueUsd) ??
    finiteNumber(event.markUsd) ??
    finiteNumber(event.currentValueUsd) ??
    finiteNumber(event.positionValueUsd) ??
    finiteNumber(event.principalUsd);
}

function markSource(event = {}) {
  if (finiteNumber(event.valueUsd) != null) return event.valueSource || event.markSource || "position_value";
  if (finiteNumber(event.markUsd) != null) return event.markSource || "position_mark";
  if (finiteNumber(event.currentValueUsd) != null) return event.markSource || "current_value";
  if (finiteNumber(event.positionValueUsd) != null) return event.markSource || "position_value";
  if (finiteNumber(event.principalUsd) != null) return event.markSource || "principal";
  return null;
}

function isProtocolPositionMark(event = {}) {
  return markSource(event) === "protocol_position_mark";
}

function positionEventKey(event = {}, index = 0) {
  return String(
    event.positionId ||
    event.entryTxHash ||
    event.txHash ||
    event.id ||
    `${event.opportunityId || "unknown"}:${event.observedAt || "unknown"}:${index}`,
  );
}

function activePositionRecords(events = []) {
  const byPositionId = new Map();
  events.forEach((event, index) => {
    const id = positionEventKey(event, index);
    const current = byPositionId.get(id);
    if (!current || observedAtMs(event.observedAt) >= observedAtMs(current.observedAt)) {
      byPositionId.set(id, event);
    }
  });
  return [...byPositionId.values()].filter((event) => event?.status === "open" || event?.event === "position_opened");
}

function aggregateByOpportunity(events = []) {
  const byId = new Map();
  for (const event of activePositionRecords(events)) {
    const key = event?.opportunityId || positionEventKey(event);
    const current = byId.get(key) || {
      opportunityId: event.opportunityId || null,
      eventCount: 0,
      totalEntryUsd: 0,
      lastObservedAt: null,
      activePositionCount: 0,
      entryAprNumerator: 0,
      entryAprWeightUsd: 0,
      latestEntryAprPct: null,
      latestEntryAprAt: null,
      totalValueUsd: 0,
      markedPositionCount: 0,
      latestMarkAt: null,
      latestMarkSource: null,
      latestMarkFreshness: null,
      latestMarkConfidence: null,
      latestMarkFailureKind: null,
      latestMarkFailureMessage: null,
      hasCurrentValue: false,
    };
    current.eventCount += 1;
    current.activePositionCount += 1;
    current.lastEvent = event.event || current.lastEvent;
    current.lastStatus = event.status || current.lastStatus;
    current.lastObservedAt =
      observedAtMs(event.observedAt) >= observedAtMs(current.lastObservedAt)
        ? (event.observedAt || current.lastObservedAt)
        : current.lastObservedAt;
    current.chain = event.chain || current.chain;
    current.protocolId = event.protocolId || current.protocolId;
    current.name = event.name || current.name;
    current.strategyId = event.strategyId || current.strategyId;
    current.bindingKind = event.bindingKind || current.bindingKind;
    current.score = Number.isFinite(event.score) ? event.score : current.score;
    if (Number.isFinite(event.amountUsd)) {
      current.totalEntryUsd += event.amountUsd;
    }
    const markUsd = positionMarkUsd(event);
    if (Number.isFinite(markUsd)) {
      current.totalValueUsd += markUsd;
      current.hasCurrentValue = true;
      if (isProtocolPositionMark(event)) {
        current.markedPositionCount += 1;
        if (!current.latestMarkAt || observedAtMs(event.markObservedAt || event.observedAt) >= observedAtMs(current.latestMarkAt)) {
          current.latestMarkAt = event.markObservedAt || event.observedAt || current.latestMarkAt;
          current.latestMarkSource = markSource(event) || current.latestMarkSource;
          current.latestMarkFreshness = event.markFreshness || current.latestMarkFreshness;
          current.latestMarkConfidence = event.markConfidence || current.latestMarkConfidence;
        }
      }
    } else if (!event.liveMarkRequired && Number.isFinite(event.amountUsd)) {
      current.totalValueUsd += event.amountUsd;
      current.hasCurrentValue = true;
    }
    if (event.markFailure && (!current.latestMarkAt || observedAtMs(event.markFailure.observedAt || event.observedAt) >= observedAtMs(current.latestMarkAt))) {
      current.latestMarkFailureKind = event.markFailure.failureKind || current.latestMarkFailureKind;
      current.latestMarkFailureMessage = event.markFailure.message || current.latestMarkFailureMessage;
    }
    const entryAprPct = finiteNumber(event.entryAprPct);
    if (Number.isFinite(entryAprPct)) {
      const amountUsd = finiteNumber(event.amountUsd);
      if (Number.isFinite(amountUsd) && amountUsd > 0) {
        current.entryAprNumerator += amountUsd * entryAprPct;
        current.entryAprWeightUsd += amountUsd;
      }
      if (!current.latestEntryAprAt || observedAtMs(event.observedAt) >= observedAtMs(current.latestEntryAprAt)) {
        current.latestEntryAprPct = entryAprPct;
        current.latestEntryAprAt = event.observedAt || current.latestEntryAprAt;
      }
    }
    byId.set(key, current);
  }
  return [...byId.values()].sort((a, b) => (b.totalEntryUsd || 0) - (a.totalEntryUsd || 0));
}

function entryAprPct(position = {}) {
  if (position.entryAprWeightUsd > 0) {
    return position.entryAprNumerator / position.entryAprWeightUsd;
  }
  return finiteNumber(position.latestEntryAprPct);
}

function aprForPosition(position = {}, aprByOpportunity = {}) {
  const opportunityApr = finiteNumber(aprByOpportunity?.[position.opportunityId]);
  if (Number.isFinite(opportunityApr)) return { value: opportunityApr, source: "opportunity_current" };
  const entryApr = entryAprPct(position);
  if (Number.isFinite(entryApr)) return { value: entryApr, source: "position_entry" };
  return { value: null, source: null };
}

export function buildMerklActivePositions(
  events = [],
  { generatedAt = new Date().toISOString(), aprByOpportunity = {} } = {},
) {
  const items = aggregateByOpportunity(events).map((position) => {
    const apr = aprForPosition(position, aprByOpportunity);
    return {
      id: `merkl_${position.opportunityId}`,
      opportunityId: position.opportunityId,
      label: position.name?.trim() || `Merkl ${position.opportunityId}`,
      chain: position.chain || null,
      protocol: position.protocolId || null,
      type: inferType(position.name, position.protocolId),
      pair: inferAssets(position.name),
      capUsd: Number.isFinite(position.totalEntryUsd) ? Number(position.totalEntryUsd.toFixed(6)) : null,
      valueUsd: position.hasCurrentValue && Number.isFinite(position.totalValueUsd) ? Number(position.totalValueUsd.toFixed(6)) : null,
      markUsd: position.markedPositionCount > 0 && Number.isFinite(position.totalValueUsd)
        ? Number(position.totalValueUsd.toFixed(6))
        : null,
      markSource: position.latestMarkSource,
      markObservedAt: position.latestMarkAt,
      markFreshness: position.latestMarkFreshness,
      markConfidence: position.latestMarkConfidence || (position.latestMarkFailureKind ? "adapter_missing" : null),
      markFailureKind: position.latestMarkFailureKind,
      markFailureMessage: position.latestMarkFailureMessage,
      markedPositionCount: position.markedPositionCount ?? 0,
      aprPct: apr.value,
      aprSource: apr.source,
      score: position.score ?? null,
      bindingKind: position.bindingKind ?? null,
      lastObservedAt: position.lastObservedAt || null,
      activePositionCount: position.activePositionCount ?? 1,
      source: "merkl",
    };
  });
  return {
    schemaVersion: 1,
    generatedAt,
    activeCount: items.length,
    positionRecordCount: items.reduce((sum, item) => sum + (item.activePositionCount || 0), 0),
    items,
  };
}
