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
    byId.set(key, current);
  }
  return [...byId.values()].sort((a, b) => (b.totalEntryUsd || 0) - (a.totalEntryUsd || 0));
}

export function buildMerklActivePositions(
  events = [],
  { generatedAt = new Date().toISOString(), aprByOpportunity = {} } = {},
) {
  const items = aggregateByOpportunity(events).map((position) => ({
    id: `merkl_${position.opportunityId}`,
    opportunityId: position.opportunityId,
    label: position.name?.trim() || `Merkl ${position.opportunityId}`,
    chain: position.chain || null,
    protocol: position.protocolId || null,
    type: inferType(position.name, position.protocolId),
    pair: inferAssets(position.name),
    capUsd: Number.isFinite(position.totalEntryUsd) ? Number(position.totalEntryUsd.toFixed(2)) : null,
    aprPct: Number.isFinite(aprByOpportunity?.[position.opportunityId]) ? aprByOpportunity[position.opportunityId] : null,
    score: position.score ?? null,
    bindingKind: position.bindingKind ?? null,
    lastObservedAt: position.lastObservedAt || null,
    activePositionCount: position.activePositionCount ?? 1,
    source: "merkl",
  }));
  return {
    schemaVersion: 1,
    generatedAt,
    activeCount: items.length,
    positionRecordCount: items.reduce((sum, item) => sum + (item.activePositionCount || 0), 0),
    items,
  };
}
