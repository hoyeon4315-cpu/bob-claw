import { resolveProtocolPositionAdapter } from "./protocol-position-adapter-registry.mjs";
import { normalizeProtocolPositionMark } from "./protocol-position-mark-schema.mjs";

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "Unknown protocol position marker error");
}

function contractReadCacheKey({ chain, address, functionName, args = [] } = {}) {
  return JSON.stringify([
    chain || null,
    String(address || "").toLowerCase(),
    functionName || null,
    args.map((arg) => typeof arg === "bigint" ? arg.toString() : arg),
  ]);
}

export function createCachedRetryingContractReader(contractReader, { attempts = 2 } = {}) {
  if (typeof contractReader !== "function") return contractReader;
  const cache = new Map();
  const maxAttempts = Math.max(1, Number(attempts) || 1);

  return async (request = {}) => {
    const key = contractReadCacheKey(request);
    if (cache.has(key)) return cache.get(key);

    const readPromise = (async () => {
      let lastError = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await contractReader(request);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    })();

    cache.set(key, readPromise);
    return readPromise;
  };
}

function failedPositionMark({
  position = {},
  observedAt,
  adapterId = null,
  failureKind,
  message,
}) {
  return normalizeProtocolPositionMark({
    event: "position_mark_failed",
    status: position.status || "open",
    observedAt,
    positionId: position.positionId,
    opportunityId: position.opportunityId,
    strategyId: position.strategyId,
    chain: position.chain,
    protocolId: position.protocolId,
    bindingKind: position.bindingKind,
    adapterId,
    failureKind,
    message,
  }, { now: observedAt });
}

export async function markActiveProtocolPositions({
  positions = [],
  walletAddress,
  contractReader,
  priceReader,
  btcPriceUsd,
  observedAt = new Date().toISOString(),
} = {}) {
  const events = [];
  const readContract = createCachedRetryingContractReader(contractReader);

  for (const position of positions) {
    const adapter = resolveProtocolPositionAdapter(position);
    if (!adapter) {
      events.push(failedPositionMark({
        position,
        observedAt,
        failureKind: "adapter_missing",
        message: `No protocol position adapter for bindingKind ${position?.bindingKind || "unknown"}`,
      }));
      continue;
    }

    try {
      events.push(await adapter.mark({
        position,
        walletAddress,
        contractReader: readContract,
        priceReader,
        btcPriceUsd,
        observedAt,
      }));
    } catch (error) {
      events.push(failedPositionMark({
        position,
        observedAt,
        adapterId: adapter.id,
        failureKind: "adapter_error",
        message: errorMessage(error),
      }));
    }
  }

  return events.sort((left, right) => String(left.positionId || "").localeCompare(String(right.positionId || "")));
}

export function buildProtocolPositionMarkSummary({
  observedAt = new Date().toISOString(),
  events = [],
} = {}) {
  const markedEvents = events.filter((event) => event.event === "position_marked");
  const failedEvents = events.filter((event) => event.event === "position_mark_failed");
  const totalValueUsd = markedEvents.reduce((sum, event) => {
    const valueUsd = Number(event.valueUsd);
    return Number.isFinite(valueUsd) ? sum + valueUsd : sum;
  }, 0);

  return {
    schemaVersion: 1,
    observedAt,
    markedCount: markedEvents.length,
    failedCount: failedEvents.length,
    totalValueUsd,
    events,
  };
}
