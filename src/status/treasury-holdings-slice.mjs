import { tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";

function latestByObservedAt(records = []) {
  return [...records]
    .filter((record) => record?.observedAt)
    .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime())
    .at(-1) || null;
}

const WHOLE_WALLET_PREFERENCE_WINDOW_MS = 15 * 60 * 1000;

function normalizeSymbol(value = "") {
  return String(value || "").toLowerCase().replace(/\.oft$/u, "");
}

function inventoryItem(entry = {}, family) {
  const symbol = entry.ticker || entry.asset || entry.symbol || entry.name || "asset";
  const amount = Number(entry.actualDecimal);
  const usd = Number(entry.estimatedUsd);
  return {
    sym: normalizeSymbol(symbol),
    name: symbol,
    chain: entry.chain || null,
    amount: Number.isFinite(amount) ? amount : 0,
    usd: Number.isFinite(usd) ? usd : 0,
    family,
    status: entry.status || null,
  };
}

function observedAtMs(value) {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function hasWholeWalletValue(record = null) {
  if (Number.isFinite(record?.totalUsd)) return record.totalUsd > 0;
  return [...(record?.native || []), ...(record?.tokenBalances || [])].some((item) => {
    const usd = Number(item?.estimatedUsd);
    const amount = Number(item?.actualDecimal);
    return usd > 0 || amount > 0;
  });
}

function selectWalletSource(treasuryRecord, wholeWalletRecord) {
  if (!wholeWalletRecord) return { record: treasuryRecord, source: "treasury_inventory" };
  if (!treasuryRecord) return { record: wholeWalletRecord, source: "whole_wallet_inventory" };
  const treasuryObservedAtMs = observedAtMs(treasuryRecord?.observedAt);
  const wholeObservedAtMs = observedAtMs(wholeWalletRecord?.observedAt);
  if (
    hasWholeWalletValue(wholeWalletRecord) &&
    (wholeObservedAtMs >= treasuryObservedAtMs || treasuryObservedAtMs - wholeObservedAtMs <= WHOLE_WALLET_PREFERENCE_WINDOW_MS)
  ) {
    return { record: wholeWalletRecord, source: "whole_wallet_inventory" };
  }
  return { record: treasuryRecord, source: "treasury_inventory" };
}

function stablecoinUsd(amount, asset) {
  if (!Number.isFinite(amount) || !asset) return null;
  return asset.family === "stablecoin" ? amount : null;
}

function buildMerklExitReconciliationItems(events = [], { afterObservedAt = null } = {}) {
  const afterMs = observedAtMs(afterObservedAt);
  const metaByOpportunity = new Map();
  for (const event of events) {
    if (!event?.opportunityId) continue;
    const current = metaByOpportunity.get(event.opportunityId) || {};
    metaByOpportunity.set(event.opportunityId, {
      chain: event.chain || current.chain || null,
      assetAddress: event.assetAddress || current.assetAddress || null,
      name: event.name || current.name || null,
      observedAt: event.observedAt || current.observedAt || null,
    });
  }

  const reconciledByKey = new Map();
  for (const event of events) {
    if (!event?.opportunityId || !String(event.event || "").startsWith("position_exit")) continue;
    const proof = event.redeemProof || {};
    const balanceUnits = proof.assetBalance ?? proof.settledBalance ?? null;
    if (!balanceUnits) continue;
    if (observedAtMs(event.observedAt) <= afterMs) continue;
    const meta = metaByOpportunity.get(event.opportunityId) || {};
    if (!meta.chain || !meta.assetAddress) continue;
    const asset = tokenAsset(meta.chain, meta.assetAddress);
    const amount = unitsToDecimal(balanceUnits, asset.decimals);
    if (!Number.isFinite(amount)) continue;
    const key = `${meta.chain}:${normalizeSymbol(asset.ticker)}`;
    const candidate = {
      sym: normalizeSymbol(asset.ticker),
      name: asset.ticker,
      chain: meta.chain,
      amount,
      usd: stablecoinUsd(amount, asset),
      family: asset.family === "stablecoin" ? "token" : "position_exit",
      status: "reconciled_exit_proof",
      observedAt: event.observedAt,
    };
    const current = reconciledByKey.get(key);
    if (!current || observedAtMs(candidate.observedAt) >= observedAtMs(current.observedAt)) {
      reconciledByKey.set(key, candidate);
    }
  }
  return [...reconciledByKey.values()];
}

function applyReconciledExitBalances(items = [], events = [], latestObservedAt = null) {
  if (!events.length) return items;
  const reconciled = buildMerklExitReconciliationItems(events, { afterObservedAt: latestObservedAt });
  if (!reconciled.length) return items;
  const byKey = new Map(items.map((item) => [`${item.chain}:${item.sym}`, { ...item }]));
  for (const item of reconciled) {
    const key = `${item.chain}:${item.sym}`;
    const current = byKey.get(key) || null;
    byKey.set(key, {
      ...current,
      ...item,
      usd: Number.isFinite(item.usd) ? item.usd : (current?.usd ?? 0),
    });
  }
  return [...byKey.values()];
}

export function buildTreasuryHoldingsSlice(
  records = [],
  { generatedAt = new Date().toISOString(), merklPositionEvents = [], wholeWalletRecords = [] } = {},
) {
  const latestTreasury = latestByObservedAt(records);
  const latestWholeWallet = latestByObservedAt(wholeWalletRecords);
  const selected = selectWalletSource(latestTreasury, latestWholeWallet);
  const latest = selected.record;
  if (!latest) {
    return {
      schemaVersion: 1,
      generatedAt,
      observedAt: null,
      pending: true,
      totalUsd: null,
      activeChainCount: 0,
      items: [],
      protocolApr: {},
    };
  }

  const items = applyReconciledExitBalances([
    ...(latest.native || []).map((entry) => inventoryItem(entry, "native")),
    ...((selected.source === "whole_wallet_inventory" ? latest.tokenBalances : latest.tokens) || []).map((entry) =>
      inventoryItem(entry, "token"),
    ),
  ], merklPositionEvents, latest.observedAt)
    .filter((item) => item.usd > 0 || item.amount > 0)
    .sort((a, b) => (b.usd || 0) - (a.usd || 0));

  const itemTotalUsd = items.reduce((sum, item) => sum + (Number(item.usd) || 0), 0);

  return {
    schemaVersion: 1,
    generatedAt,
    observedAt: latest.observedAt || null,
    pending: false,
    totalUsd: itemTotalUsd > 0
      ? itemTotalUsd
      : Number.isFinite(latest.summary?.estimatedWalletUsd)
      ? latest.summary.estimatedWalletUsd
      : Number.isFinite(latest.totalUsd)
      ? latest.totalUsd
      : itemTotalUsd,
    activeChainCount:
      latest.summary?.activeChainCount ?? latest.summary?.chainCount ?? latest.activeChains?.length ?? 0,
    supportedChainCount:
      latest.summary?.supportedChainCount ?? latest.summary?.chainCount ?? latest.supportedChains?.length ?? 0,
    refillRequiredCount:
      (latest.summary?.nativeRefillRequiredCount ?? 0) + (latest.summary?.tokenRefillRequiredCount ?? 0),
    items,
    protocolApr: {},
    source: selected.source,
    scanErrorCount: latest.summary?.scanErrorCount ?? 0,
    externalWalletUsd: latest.summary?.externalWalletUsd ?? null,
    unclassifiedUsd: latest.summary?.externalUnclassifiedUsd ?? null,
  };
}
