import { createHash } from "node:crypto";
import { ZERO_TOKEN, tokenAsset, unitsToDecimal } from "../assets/tokens.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { buildInboundRoutingPlan } from "./inbound-routing.mjs";

function normalizedToken(value) {
  return String(value || ZERO_TOKEN).toLowerCase();
}

function balanceKey(item = {}) {
  return `${item.chain}:${normalizedToken(item.token)}`;
}

function bigint(value) {
  return BigInt(value || 0);
}

function eventId(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

function pendingWhitelistKey(item = {}) {
  return [
    item.sourceEventId || "",
    item.chain || "",
    normalizedToken(item.token),
    item.reviewReason || "",
  ].join(":");
}

function estimatedDeltaUsd(item = {}, deltaDecimal = null) {
  if (Number.isFinite(item.priceUsd) && Number.isFinite(deltaDecimal)) {
    return deltaDecimal * item.priceUsd;
  }
  const actual = Number(item.actualDecimal);
  const estimated = Number(item.estimatedUsd);
  if (actual > 0 && Number.isFinite(estimated) && Number.isFinite(deltaDecimal)) {
    return (deltaDecimal / actual) * estimated;
  }
  return null;
}

export function flattenInventorySnapshot(snapshot = {}) {
  const native = (snapshot.native || []).map((item) => ({
    kind: "native",
    chain: item.chain,
    token: item.token || ZERO_TOKEN,
    ticker: item.asset,
    decimals: tokenAsset(item.chain, item.token || ZERO_TOKEN).decimals,
    actual: item.actual || "0",
    actualDecimal: item.actualDecimal,
    estimatedUsd: item.estimatedUsd ?? null,
    priceUsd: item.priceUsd ?? null,
  }));
  const tokens = (snapshot.tokens || []).map((item) => ({
    kind: "token",
    chain: item.chain,
    token: item.token,
    ticker: item.ticker,
    decimals: tokenAsset(item.chain, item.token).decimals ?? item.decimals ?? null,
    actual: item.actual || "0",
    actualDecimal: item.actualDecimal,
    estimatedUsd: item.estimatedUsd ?? null,
    priceUsd: item.priceUsd ?? null,
  }));
  return [...native, ...tokens].filter((item) => item.chain && item.token);
}

export function diffInventorySnapshots({
  previousSnapshot = null,
  currentSnapshot,
  emitInitial = false,
  minDeltaUsd = 0,
} = {}) {
  if (!currentSnapshot) throw new Error("currentSnapshot is required");
  if (!previousSnapshot && !emitInitial) return [];
  const previousByKey = new Map(flattenInventorySnapshot(previousSnapshot || {}).map((item) => [balanceKey(item), item]));
  const observedAt = currentSnapshot.observedAt || new Date().toISOString();
  const previousObservedAt = previousSnapshot?.observedAt || null;
  const address = currentSnapshot.address || previousSnapshot?.address || null;
  const events = [];

  for (const item of flattenInventorySnapshot(currentSnapshot)) {
    const previous = previousByKey.get(balanceKey(item));
    const before = bigint(previous?.actual);
    const after = bigint(item.actual);
    if (after <= before) continue;
    const delta = after - before;
    const deltaDecimal = Number.isInteger(item.decimals) ? unitsToDecimal(delta, item.decimals) : null;
    const estimatedUsd = estimatedDeltaUsd(item, deltaDecimal);
    if (Number.isFinite(minDeltaUsd) && Number.isFinite(estimatedUsd) && estimatedUsd < minDeltaUsd) continue;
    const basis = {
      address,
      chain: item.chain,
      token: normalizedToken(item.token),
      amount: delta.toString(),
      observedAt,
      previousObservedAt,
    };
    events.push({
      schemaVersion: 1,
      eventId: eventId(basis),
      event: "inbound_deposit_detected",
      observedAt,
      previousObservedAt,
      address,
      chain: item.chain,
      token: normalizedToken(item.token),
      ticker: item.ticker,
      kind: item.kind,
      amount: delta.toString(),
      amountDecimal: deltaDecimal,
      balanceBefore: before.toString(),
      balanceAfter: after.toString(),
      estimatedUsd,
      txHash: null,
      blockNumber: null,
      detectionSource: "treasury_inventory_diff",
    });
  }

  return events.sort(
    (left, right) =>
      String(left.chain).localeCompare(String(right.chain)) ||
      String(left.ticker).localeCompare(String(right.ticker)) ||
      String(left.token).localeCompare(String(right.token)),
  );
}

export function buildInventoryWatcherReport({
  previousSnapshot = null,
  currentSnapshot,
  emitInitial = false,
  minDeltaUsd = 0,
} = {}) {
  const events = diffInventorySnapshots({ previousSnapshot, currentSnapshot, emitInitial, minDeltaUsd });
  const routingPlan = buildInboundRoutingPlan({ events });
  return {
    schemaVersion: 1,
    observedAt: currentSnapshot?.observedAt || new Date().toISOString(),
    previousObservedAt: previousSnapshot?.observedAt || null,
    summary: {
      inboundEventCount: events.length,
      routeReadyCount: routingPlan.summary.routeReadyCount,
      manualReviewCount: routingPlan.summary.manualReviewCount,
      candidateQueueCount: routingPlan.summary.candidateQueueCount,
    },
    events,
    routingPlan,
  };
}

export async function appendInventoryWatcherReport(report, {
  dataDir = "./data",
  existingEvents = null,
  existingJobs = null,
  existingPendingWhitelist = null,
} = {}) {
  const store = new JsonlStore(dataDir);
  const seenIds = new Set(
    (existingEvents || await readJsonl(dataDir, "treasury/inbound-events").catch(() => []))
      .map((item) => item.eventId)
      .filter(Boolean),
  );
  const seenJobIds = new Set(
    (existingJobs || await readJsonl(dataDir, "treasury-refill-jobs").catch(() => []))
      .map((item) => item.jobId)
      .filter(Boolean),
  );
  const seenPendingKeys = new Set(
    (existingPendingWhitelist || await readJsonl(dataDir, "treasury/pending-whitelist").catch(() => []))
      .map((item) => pendingWhitelistKey(item)),
  );
  const appended = {
    events: 0,
    jobs: 0,
    pendingWhitelist: 0,
  };

  for (const event of report.events || []) {
    if (seenIds.has(event.eventId)) continue;
    await store.append("treasury/inbound-events", event);
    seenIds.add(event.eventId);
    appended.events += 1;
  }
  for (const job of report.routingPlan?.jobs || []) {
    if (job.sourceEventId && !seenIds.has(job.sourceEventId)) continue;
    if (job.jobId && seenJobIds.has(job.jobId)) continue;
    await store.append("treasury-refill-jobs", job);
    if (job.jobId) seenJobIds.add(job.jobId);
    appended.jobs += 1;
  }
  for (const item of report.routingPlan?.pendingWhitelist || []) {
    const key = pendingWhitelistKey(item);
    if (seenPendingKeys.has(key)) continue;
    await store.append("treasury/pending-whitelist", item);
    seenPendingKeys.add(key);
    appended.pendingWhitelist += 1;
  }

  return appended;
}
