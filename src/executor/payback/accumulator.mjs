import { pricesFromSnapshot } from "../../market/prices.mjs";

const DEFAULT_ROLLING_WINDOW_DAYS = 365;
const BTC_SATS = 100_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_PROFIT_SATS_PATHS = Object.freeze([
  "realized.grossProfitSats",
  "realized.realizedGrossProfitSats",
  "realized.realizedNetProfitSats",
  "realized.realizedNetPnlSats",
  "realized.realizedBtcProfitSats",
  "realized.realizedNetCarrySats",
  "realized.netProfitSats",
  "realized.pnlSats",
  "grossProfitSats",
  "realizedGrossProfitSats",
  "realizedNetProfitSats",
  "realizedNetPnlSats",
  "realizedBtcProfitSats",
  "realizedNetCarrySats",
  "netProfitSats",
  "pnlSats",
]);

const DEFAULT_PROFIT_USD_PATHS = Object.freeze([
  "realized.realizedNetPnlUsd",
  "realized.realizedNetCarryUsd",
  "realizedNetPnlUsd",
  "realizedNetCarryUsd",
]);

const DEFAULT_PAID_BACK_SATS_PATHS = Object.freeze([
  "payback.paidBackSats",
  "payback.settledSats",
  "realized.paidBackSats",
  "realized.settledPaybackSats",
  "paidBackSats",
  "settledPaybackSats",
]);

const DEFAULT_PAID_BACK_USD_PATHS = Object.freeze([
  "payback.paidBackUsd",
  "payback.settledUsd",
  "realized.paidBackUsd",
  "paidBackUsd",
]);

const DEFAULT_PENDING_SNAPSHOT_PATHS = Object.freeze([
  "payback.pendingDeferredSats",
  "payback.accumulatorPendingSats",
  "pendingDeferredSats",
  "accumulatorPendingSats",
]);

const DEFAULT_OFFRAMP_COST_SATS_PATHS = Object.freeze([
  "payback.offrampCostSats",
  "realized.offrampCostSats",
  "offrampCostSats",
]);

const DEFAULT_OFFRAMP_COST_USD_PATHS = Object.freeze([
  "payback.offrampCostUsd",
  "realized.offrampCostUsd",
  "offrampCostUsd",
]);

function finiteNumber(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function finiteNonNegative(value) {
  const numeric = finiteNumber(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function roundSats(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function readPath(target, path) {
  if (!target || typeof target !== "object" || !path) return undefined;
  return path.split(".").reduce((value, segment) => (value == null ? undefined : value[segment]), target);
}

function firstFinitePathValue(target, paths = []) {
  for (const path of paths) {
    const value = finiteNumber(readPath(target, path));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function firstPresentPathValue(target, paths = []) {
  for (const path of paths) {
    const value = readPath(target, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeRecord(item) {
  if (!item) return null;
  if (typeof item === "string") {
    try {
      const parsed = JSON.parse(item);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof item === "object" ? item : null;
}

function normalizeRecordList(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeRecord).filter(Boolean);
}

function latestTimestampMs(records = []) {
  return records.reduce((latest, item) => {
    const next = normalizeTimestamp(
      item?.observedAt ||
        item?.timestamp ||
        item?.settledAt ||
        item?.signedAt ||
        item?.generatedAt,
    );
    return next != null && next > latest ? next : latest;
  }, 0);
}

function isWithinWindow(timestampMs, startMs, endMs) {
  if (!Number.isFinite(timestampMs)) return false;
  if (Number.isFinite(startMs) && timestampMs < startMs) return false;
  if (Number.isFinite(endMs) && timestampMs > endMs) return false;
  return true;
}

function btcUsdFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (Number.isFinite(snapshot?.btcUsd)) return snapshot.btcUsd;
  return pricesFromSnapshot(snapshot)?.btc ?? null;
}

function latestBtcUsd(receiptStore, config) {
  const configBtcUsd =
    finiteNumber(config?.btcUsd) ??
    finiteNumber(config?.prices?.btc) ??
    finiteNumber(config?.priceSnapshot?.btcUsd) ??
    btcUsdFromSnapshot(config?.priceSnapshot);
  if (Number.isFinite(configBtcUsd)) return configBtcUsd;

  const snapshots = normalizeRecordList([
    ...(Array.isArray(receiptStore?.marketPriceSnapshots) ? receiptStore.marketPriceSnapshots : []),
    ...(Array.isArray(receiptStore?.priceSnapshots) ? receiptStore.priceSnapshots : []),
  ]);
  const latest = snapshots.reduce((winner, item) => {
    if (!winner) return item;
    return latestTimestampMs([item]) > latestTimestampMs([winner]) ? item : winner;
  }, null);
  return btcUsdFromSnapshot(latest);
}

function btcUsdFromRecord(record) {
  return firstFinitePathValue(record, [
    "pricing.btcUsd",
    "priceSnapshot.btcUsd",
    "marketPriceSnapshot.btcUsd",
    "btcUsd",
  ]);
}

function btcUsdForRecord(record, marketPriceSnapshots = [], config = {}) {
  const directRecordPrice = btcUsdFromRecord(record);
  if (Number.isFinite(directRecordPrice)) return directRecordPrice;

  const observedAtMs = latestTimestampMs([record]);
  let winner = null;
  let winnerDistance = Number.POSITIVE_INFINITY;
  let winnerTs = Number.POSITIVE_INFINITY;
  for (const snapshot of marketPriceSnapshots) {
    const btcUsd = btcUsdFromSnapshot(snapshot);
    const snapshotMs = latestTimestampMs([snapshot]);
    if (!Number.isFinite(btcUsd) || !Number.isFinite(snapshotMs)) continue;
    const distance = Number.isFinite(observedAtMs)
      ? Math.abs(snapshotMs - observedAtMs)
      : 0;
    if (
      distance < winnerDistance ||
      (distance === winnerDistance && snapshotMs < winnerTs)
    ) {
      winner = btcUsd;
      winnerDistance = distance;
      winnerTs = snapshotMs;
    }
  }
  if (Number.isFinite(winner)) return winner;
  const configBtcUsd =
    finiteNumber(config?.btcUsd) ??
    finiteNumber(config?.prices?.btc) ??
    finiteNumber(config?.priceSnapshot?.btcUsd) ??
    btcUsdFromSnapshot(config?.priceSnapshot);
  if (Number.isFinite(configBtcUsd)) return configBtcUsd;
  return latestBtcUsd({ marketPriceSnapshots }, config);
}

function usdToSats(usdValue, btcUsd) {
  if (!Number.isFinite(usdValue) || !Number.isFinite(btcUsd) || btcUsd <= 0) return null;
  return roundSats((usdValue / btcUsd) * BTC_SATS);
}

function profitSatsFromRecord(record, marketPriceSnapshots, config) {
  const direct = firstFinitePathValue(record, config?.profitSatsPaths || DEFAULT_PROFIT_SATS_PATHS);
  if (Number.isFinite(direct)) return roundSats(direct);
  const projectedUsd = firstFinitePathValue(record, config?.profitUsdPaths || DEFAULT_PROFIT_USD_PATHS);
  const btcUsd = btcUsdForRecord(record, marketPriceSnapshots, config);
  return usdToSats(projectedUsd, btcUsd);
}

function paybackMarkers(config) {
  return {
    strategyIds: new Set(config?.paybackStrategyIds || []),
    intentTypes: new Set(config?.paybackIntentTypes || []),
  };
}

function isPaybackRecord(record, markers) {
  if (!markers.strategyIds.size && !markers.intentTypes.size) return false;
  const strategyId =
    record?.strategyId ??
    record?.plan?.strategyId ??
    record?.intent?.strategyId ??
    record?.signerResult?.signed?.strategyId ??
    null;
  const intentType =
    record?.intent?.intentType ??
    record?.plan?.intent?.intentType ??
    record?.plan?.steps?.find?.((item) => item?.intent?.intentType)?.intent?.intentType ??
    null;
  return markers.strategyIds.has(strategyId) || markers.intentTypes.has(intentType);
}

function settlementSatsFromPaybackRecord(record) {
  const deliveryCandidates = [
    "destinationProof.observedDelta",
    "payback.settledBalanceDeltaSats",
    "realized.settledBalanceDeltaSats",
    "settledBalanceDeltaSats",
  ];
  return firstFinitePathValue(record, deliveryCandidates);
}

function paybackThreeWayReceipt(record) {
  return {
    sourceTxHash: firstPresentPathValue(record, [
      "signerResult.broadcast.txHash",
      "broadcast.txHash",
      "receipt.hash",
      "txHash",
    ]),
    gatewayOrderId: firstPresentPathValue(record, [
      "metadata.gatewayOrderId",
      "plan.intent.metadata.gatewayOrderId",
      "plan.order.orderId",
      "order.orderId",
      "gatewayOrderId",
    ]),
    bitcoinTxid: firstPresentPathValue(record, [
      "destinationProof.txid",
      "destinationProof.bitcoinTxid",
      "metadata.bitcoinTxid",
      "payback.bitcoinTxid",
      "bitcoinTxid",
    ]),
  };
}

function hasDeliveredPaybackReceipt(record) {
  const receipt = paybackThreeWayReceipt(record);
  const hasThreeWayReceipt = Boolean(receipt.sourceTxHash && receipt.gatewayOrderId && receipt.bitcoinTxid);
  if (!hasThreeWayReceipt) return false;
  // Payback completion must keep the full three-way receipt; source confirmation alone is not delivery.
  return record?.settlementStatus === "delivered" || record?.destinationProof?.status === "delivered";
}

function paidBackSatsFromRecord(record, btcUsd, config, markers) {
  const direct = firstFinitePathValue(record, config?.paidBackSatsPaths || DEFAULT_PAID_BACK_SATS_PATHS);
  if (Number.isFinite(direct)) return roundSats(direct);
  const projectedUsd = firstFinitePathValue(record, config?.paidBackUsdPaths || DEFAULT_PAID_BACK_USD_PATHS);
  if (Number.isFinite(projectedUsd)) return usdToSats(projectedUsd, btcUsd);
  if (!isPaybackRecord(record, markers)) return null;
  if (!hasDeliveredPaybackReceipt(record)) return null;

  const settled = settlementSatsFromPaybackRecord(record);
  return Number.isFinite(settled) ? roundSats(settled) : null;
}

function offrampCostSatsFromRecord(record, btcUsd, config, markers) {
  const direct = firstFinitePathValue(record, config?.offrampCostSatsPaths || DEFAULT_OFFRAMP_COST_SATS_PATHS);
  if (Number.isFinite(direct)) return roundSats(direct);
  const projectedUsd = firstFinitePathValue(record, config?.offrampCostUsdPaths || DEFAULT_OFFRAMP_COST_USD_PATHS);
  if (Number.isFinite(projectedUsd)) return usdToSats(projectedUsd, btcUsd);
  if (!isPaybackRecord(record, markers)) return null;
  const quotedFees = firstFinitePathValue(record, ["plan.quote.fees.amount", "quote.fees.amount", "fees.amount"]);
  return Number.isFinite(quotedFees) ? roundSats(quotedFees) : null;
}

function pendingSnapshotValue(records, config) {
  const paths = config?.pendingSnapshotPaths || DEFAULT_PENDING_SNAPSHOT_PATHS;
  let latest = null;
  let latestMs = -1;
  for (const record of records) {
    const pending = firstFinitePathValue(record, paths);
    if (!Number.isFinite(pending)) continue;
    const observedAtMs = latestTimestampMs([record]);
    if (observedAtMs >= latestMs) {
      latest = roundSats(pending);
      latestMs = observedAtMs;
    }
  }
  return latest;
}

function isBtcLikeEntry(entry = {}) {
  const ticker = String(entry.ticker || entry.asset || entry.symbol || "").toUpperCase();
  const priceKey = String(entry.priceKey || "").toLowerCase();
  return ticker.includes("BTC") || priceKey === "btc";
}

function inventoryEntrySats(entry, btcUsd) {
  if (!entry || typeof entry !== "object") return 0;

  const explicitSats =
    finiteNonNegative(entry.operatingFloatSats) ??
    finiteNonNegative(entry.balanceSats) ??
    finiteNonNegative(entry.actualSats);
  if (Number.isFinite(explicitSats)) return roundSats(explicitSats);

  if (isBtcLikeEntry(entry)) {
    const actualDecimal = finiteNumber(entry.actualDecimal);
    if (Number.isFinite(actualDecimal)) return roundSats(actualDecimal * BTC_SATS);
    const actual = finiteNonNegative(entry.actual);
    if (Number.isFinite(actual)) return roundSats(actual);
  }

  const estimatedUsd = finiteNumber(entry.estimatedUsd);
  if (Number.isFinite(estimatedUsd)) return usdToSats(estimatedUsd, btcUsd) ?? 0;

  const actualDecimal = finiteNumber(entry.actualDecimal);
  const priceUsd = finiteNumber(entry.priceUsd);
  if (Number.isFinite(actualDecimal) && Number.isFinite(priceUsd)) {
    return usdToSats(actualDecimal * priceUsd, btcUsd) ?? 0;
  }

  return 0;
}

function normalizeReceiptStore(receiptStore) {
  if (Array.isArray(receiptStore)) {
    const records = normalizeRecordList(receiptStore);
    return {
      allRecords: records,
      marketPriceSnapshots: [],
      treasuryInventory: [],
    };
  }

  if (!receiptStore || typeof receiptStore !== "object") {
    return {
      allRecords: [],
      marketPriceSnapshots: [],
      treasuryInventory: [],
    };
  }

  const arrays = Object.values(receiptStore)
    .filter(Array.isArray)
    .flatMap((items) => normalizeRecordList(items));

  const treasuryInventory = normalizeRecordList([
    ...(Array.isArray(receiptStore.treasuryInventory) ? receiptStore.treasuryInventory : []),
    ...(Array.isArray(receiptStore.inventorySnapshots) ? receiptStore.inventorySnapshots : []),
    ...(receiptStore.native || receiptStore.tokens ? [receiptStore] : []),
  ]);

  const marketPriceSnapshots = normalizeRecordList([
    ...(Array.isArray(receiptStore.marketPriceSnapshots) ? receiptStore.marketPriceSnapshots : []),
    ...(Array.isArray(receiptStore.priceSnapshots) ? receiptStore.priceSnapshots : []),
  ]);

  return {
    allRecords: arrays,
    marketPriceSnapshots,
    treasuryInventory,
  };
}

function latestInventorySnapshot(inventorySnapshots = []) {
  let latest = null;
  let latestMs = -1;
  for (const snapshot of inventorySnapshots) {
    const observedAtMs = latestTimestampMs([snapshot]);
    if (observedAtMs >= latestMs) {
      latest = snapshot;
      latestMs = observedAtMs;
    }
  }
  return latest;
}

function earliestInventorySnapshot(inventorySnapshots = []) {
  let earliest = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  for (const snapshot of inventorySnapshots) {
    const observedAtMs = latestTimestampMs([snapshot]);
    if (observedAtMs >= 0 && observedAtMs <= earliestMs) {
      earliest = snapshot;
      earliestMs = observedAtMs;
    }
  }
  return earliest;
}

function operatingFloatByChain(snapshot, btcUsd) {
  if (!snapshot) return {};
  const totals = {};
  for (const entry of [...(snapshot.native || []), ...(snapshot.tokens || [])]) {
    const chain = entry?.chain;
    if (!chain) continue;
    totals[chain] = (totals[chain] || 0) + inventoryEntrySats(entry, btcUsd);
  }
  return Object.fromEntries(Object.entries(totals).sort(([left], [right]) => left.localeCompare(right)));
}

function totalFloatSats(snapshot, btcUsd) {
  return Object.values(operatingFloatByChain(snapshot, btcUsd)).reduce((sum, value) => sum + value, 0);
}

function selectInventoryWindowSnapshots(inventorySnapshots, startMs, endMs) {
  return inventorySnapshots.filter((snapshot) => isWithinWindow(latestTimestampMs([snapshot]), startMs, endMs));
}

function periodBounds(config) {
  const startMs = normalizeTimestamp(config?.periodStartAt);
  const endMs = normalizeTimestamp(config?.periodEndAt);
  return {
    periodId: config?.periodId || (Number.isFinite(startMs) || Number.isFinite(endMs) ? "configured_period" : "all_time"),
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null,
  };
}

function rollingBounds(nowMs, config) {
  const rollingWindowDays = finiteNonNegative(config?.rollingWindowDays) ?? DEFAULT_ROLLING_WINDOW_DAYS;
  return {
    nowMs,
    startMs: nowMs > 0 ? nowMs - (rollingWindowDays * DAY_MS) : null,
  };
}

function summarizeRecords(records, predicate) {
  return records.filter((item) => predicate(latestTimestampMs([item])));
}

function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

export default function snapshot(auditLogLines = [], receiptStore = {}, config = {}) {
  const auditRecords = normalizeRecordList(auditLogLines);
  const store = normalizeReceiptStore(receiptStore);
  const allRecords = [...auditRecords, ...store.allRecords];
  const btcUsd = latestBtcUsd(
    {
      ...receiptStore,
      marketPriceSnapshots: store.marketPriceSnapshots,
    },
    config,
  );
  const markers = paybackMarkers(config);
  const period = periodBounds(config);
  const latestObservedMs = Math.max(
    latestTimestampMs(allRecords),
    latestTimestampMs(store.marketPriceSnapshots),
    latestTimestampMs(store.treasuryInventory),
  );
  const rolling = rollingBounds(latestObservedMs, config);

  const profitRecords = allRecords
    .map((record) => ({
      record,
      sats: profitSatsFromRecord(record, store.marketPriceSnapshots, config),
      observedAtMs: latestTimestampMs([record]),
    }))
    .filter((item) => !isPaybackRecord(item.record, markers) && Number.isFinite(item.sats) && item.sats > 0);

  const paybackRecords = allRecords
    .map((record) => ({
      record,
      settledSats: paidBackSatsFromRecord(record, btcUsd, config, markers),
      offrampCostSats: offrampCostSatsFromRecord(record, btcUsd, config, markers),
      observedAtMs: latestTimestampMs([record]),
    }))
    .filter((item) => Number.isFinite(item.settledSats) || Number.isFinite(item.offrampCostSats));

  const grossProfitSatsLifetime = profitRecords.reduce((sum, item) => sum + item.sats, 0);
  const grossProfitSatsPeriod = profitRecords
    .filter((item) => isWithinWindow(item.observedAtMs, period.startMs, period.endMs))
    .reduce((sum, item) => sum + item.sats, 0);
  const grossProfitSatsRolling12m = profitRecords
    .filter((item) => isWithinWindow(item.observedAtMs, rolling.startMs, rolling.nowMs))
    .reduce((sum, item) => sum + item.sats, 0);

  const paidBackSatsLifetime = paybackRecords.reduce((sum, item) => sum + (item.settledSats || 0), 0);
  const paidBackSatsRolling12m = paybackRecords
    .filter((item) => isWithinWindow(item.observedAtMs, rolling.startMs, rolling.nowMs))
    .reduce((sum, item) => sum + (item.settledSats || 0), 0);
  const offrampCostSatsPeriod = paybackRecords
    .filter((item) => isWithinWindow(item.observedAtMs, period.startMs, period.endMs))
    .reduce((sum, item) => sum + (item.offrampCostSats || 0), 0);
  const offrampCostSatsRolling12m = paybackRecords
    .filter((item) => isWithinWindow(item.observedAtMs, rolling.startMs, rolling.nowMs))
    .reduce((sum, item) => sum + (item.offrampCostSats || 0), 0);

  const pendingSnapshot = pendingSnapshotValue(allRecords, config);
  const pendingDeferredSats =
    pendingSnapshot != null
      ? pendingSnapshot
      : Math.max(0, grossProfitSatsLifetime - paidBackSatsLifetime);

  const latestInventory = latestInventorySnapshot(store.treasuryInventory);
  const operatingFloatSatsByChain = operatingFloatByChain(latestInventory, btcUsd);

  const rollingSnapshots = selectInventoryWindowSnapshots(store.treasuryInventory, rolling.startMs, rolling.nowMs);
  const rollingStartSnapshot = earliestInventorySnapshot(rollingSnapshots) || earliestInventorySnapshot(store.treasuryInventory) || null;
  const rollingEndSnapshot = latestInventory;
  const rollingStartFloatSats = totalFloatSats(rollingStartSnapshot, btcUsd);
  const rollingEndFloatSats = totalFloatSats(rollingEndSnapshot, btcUsd);
  const recentPaybackWindowDays = finiteNonNegative(config?.recentPaybackWindowDays) ?? (finiteNonNegative(config?.rollingWindowDays) ?? DEFAULT_ROLLING_WINDOW_DAYS);
  const recentPaybackWindowStartMs =
    latestObservedMs > 0 ? latestObservedMs - (recentPaybackWindowDays * DAY_MS) : null;
  const recentSettledPaybackRecords = paybackRecords.filter((item) =>
    Number.isFinite(item.settledSats) && isWithinWindow(item.observedAtMs, recentPaybackWindowStartMs, rolling.nowMs),
  );
  const activePaybackDays = new Set(
    recentSettledPaybackRecords.map((item) => new Date(item.observedAtMs).toISOString().slice(0, 10)),
  ).size;
  const averageDailyPaybackSatsRecent =
    activePaybackDays > 0
      ? recentSettledPaybackRecords.reduce((sum, item) => sum + (item.settledSats || 0), 0) / activePaybackDays
      : 0;
  const initialRoundTripEntrySats = finiteNonNegative(config?.initialRoundTripEntrySats);
  const remainingEntryRecoverySats =
    Number.isFinite(initialRoundTripEntrySats)
      ? Math.max(0, initialRoundTripEntrySats - paidBackSatsLifetime)
      : 0;
  const daysToBreakeven =
    averageDailyPaybackSatsRecent > 0 && remainingEntryRecoverySats > 0
      ? remainingEntryRecoverySats / averageDailyPaybackSatsRecent
      : 0;

  return {
    periodId: period.periodId,
    grossProfitSats_period: grossProfitSatsPeriod,
    paidBackSats_lifetime: paidBackSatsLifetime,
    pendingDeferredSats,
    operatingFloatSats_byChain: operatingFloatSatsByChain,
    kpi: {
      byr_rolling12m: safeRatio(paidBackSatsRolling12m, rollingStartFloatSats),
      cg_rolling12m: safeRatio(rollingEndFloatSats, rollingStartFloatSats) - (rollingStartFloatSats > 0 ? 1 : 0),
      tbr_rolling12m: safeRatio(paidBackSatsRolling12m + rollingEndFloatSats, rollingStartFloatSats) - (rollingStartFloatSats > 0 ? 1 : 0),
      roundTripEfficiency_period: grossProfitSatsPeriod > 0 ? safeRatio(grossProfitSatsPeriod - offrampCostSatsPeriod, grossProfitSatsPeriod) : 0,
      daysToBreakeven,
    },
  };
}
