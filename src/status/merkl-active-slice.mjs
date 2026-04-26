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

function aggregateByOpportunity(events = []) {
  const byId = new Map();
  for (const event of events) {
    if (!event?.opportunityId) continue;
    const current = byId.get(event.opportunityId) || {
      opportunityId: event.opportunityId,
      eventCount: 0,
      totalEntryUsd: 0,
    };
    current.eventCount += 1;
    current.lastEvent = event.event || current.lastEvent;
    current.lastStatus = event.status || current.lastStatus;
    current.lastObservedAt = event.observedAt || current.lastObservedAt;
    current.chain = event.chain || current.chain;
    current.protocolId = event.protocolId || current.protocolId;
    current.name = event.name || current.name;
    current.strategyId = event.strategyId || current.strategyId;
    current.bindingKind = event.bindingKind || current.bindingKind;
    current.score = Number.isFinite(event.score) ? event.score : current.score;
    if (event.event === "position_opened" && Number.isFinite(event.amountUsd)) {
      current.totalEntryUsd += event.amountUsd;
    }
    byId.set(event.opportunityId, current);
  }
  return [...byId.values()]
    .filter((item) => item.lastStatus === "open" || item.lastEvent === "position_opened")
    .sort((a, b) => (b.totalEntryUsd || 0) - (a.totalEntryUsd || 0));
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
    source: "merkl",
  }));
  return {
    schemaVersion: 1,
    generatedAt,
    activeCount: items.length,
    items,
  };
}
