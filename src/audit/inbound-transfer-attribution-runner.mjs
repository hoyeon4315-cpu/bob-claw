import { URL } from "node:url";
import { ZERO_TOKEN } from "../assets/tokens.mjs";
import { getEvmChainConfig } from "../config/chains.mjs";
import { rpc } from "../evm/json-rpc.mjs";
import {
  attributeInboundEventFromTransferLogs,
  buildErc20InboundTransferFilter,
} from "./evm-transfer-attribution.mjs";

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberFromHex(value) {
  if (value === undefined || value === null || value === "") return null;
  return Number(BigInt(value));
}

function hexQuantity(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const bigint = typeof value === "bigint" ? value : BigInt(value);
  return `0x${bigint.toString(16)}`;
}

function safeRpcSource(chain, rpcUrl) {
  try {
    return `rpc:${chain}:eth_getLogs:${new URL(rpcUrl).host}`;
  } catch {
    return `rpc:${chain}:eth_getLogs`;
  }
}

function isZeroToken(token) {
  return normalized(token) === normalized(ZERO_TOKEN);
}

function attributionKey(record = {}) {
  return [
    record.eventId || "",
    normalized(record.chain),
    normalized(record.token),
    normalized(record.txHash),
    record.logIndex ?? "",
  ].join(":");
}

export function inboundTransferAttributionCandidates({
  inboundEvents = [],
  existingAttributions = [],
  chainConfigFor = getEvmChainConfig,
} = {}) {
  const existingEventIds = new Set(
    existingAttributions
      .map((record) => record.eventId)
      .filter(Boolean),
  );
  return inboundEvents
    .filter((event) => event && !event.txHash)
    .filter((event) => event.eventId && !existingEventIds.has(event.eventId))
    .filter((event) => event.kind !== "native")
    .filter((event) => event.address)
    .filter((event) => event.token && !isZeroToken(event.token))
    .filter((event) => event.amount !== null && event.amount !== undefined && event.amount !== "")
    .filter((event) => Boolean(chainConfigFor(normalized(event.chain))))
    .sort((left, right) =>
      timestampMs(left.observedAt) - timestampMs(right.observedAt) ||
      String(left.eventId).localeCompare(String(right.eventId)),
    );
}

export async function firstSuccessfulRpcCall({ rpcUrls = [], method, params = [], rpcImpl = rpc } = {}) {
  const errors = [];
  for (const rpcUrl of rpcUrls) {
    try {
      return { rpcUrl, result: await rpcImpl(rpcUrl, method, params) };
    } catch (error) {
      errors.push(`${rpcUrl}: ${error.message}`);
    }
  }
  const failure = new Error(`All RPC URLs failed for ${method}: ${errors.join("; ")}`);
  failure.errors = errors;
  throw failure;
}

export async function blockTimestampMs({ rpcUrl, blockNumber, rpcImpl = rpc } = {}) {
  const block = await rpcImpl(rpcUrl, "eth_getBlockByNumber", [hexQuantity(blockNumber), false]);
  const seconds = numberFromHex(block?.timestamp);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

export async function latestBlockNumber({ rpcUrl, rpcImpl = rpc } = {}) {
  return numberFromHex(await rpcImpl(rpcUrl, "eth_blockNumber", []));
}

export async function findBlockAtOrBeforeTimestamp({
  rpcUrl,
  targetMs,
  latestBlock = null,
  rpcImpl = rpc,
} = {}) {
  if (!Number.isFinite(targetMs) || targetMs <= 0) return null;
  const highWater = Number.isFinite(latestBlock) ? latestBlock : await latestBlockNumber({ rpcUrl, rpcImpl });
  if (!Number.isFinite(highWater)) return null;
  let low = 0;
  let high = highWater;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTs = await blockTimestampMs({ rpcUrl, blockNumber: mid, rpcImpl });
    if (!Number.isFinite(midTs)) break;
    if (midTs <= targetMs) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

export async function resolveInboundEventBlockWindow({
  event,
  rpcUrl,
  rpcImpl = rpc,
  blockPadding = 25,
} = {}) {
  const observed = timestampMs(event?.observedAt);
  const previous = timestampMs(event?.previousObservedAt) || observed;
  if (!observed) return { fromBlock: null, toBlock: null };
  const latest = await latestBlockNumber({ rpcUrl, rpcImpl });
  const [from, to] = await Promise.all([
    findBlockAtOrBeforeTimestamp({ rpcUrl, targetMs: previous, latestBlock: latest, rpcImpl }),
    findBlockAtOrBeforeTimestamp({ rpcUrl, targetMs: observed, latestBlock: latest, rpcImpl }),
  ]);
  return {
    fromBlock: Math.max(0, (from ?? 0) - blockPadding),
    toBlock: Math.min(latest, (to ?? latest) + blockPadding),
  };
}

export async function attributeInboundEventViaRpc({
  event,
  rpcUrl,
  rpcImpl = rpc,
  blockWindowResolver = resolveInboundEventBlockWindow,
  maxBlockRange = 1_000,
} = {}) {
  const chain = normalized(event?.chain);
  const operatorAddress = event?.address;
  const { fromBlock, toBlock } = await blockWindowResolver({ event, rpcUrl, rpcImpl });
  const filter = buildErc20InboundTransferFilter({
    token: event.token,
    to: operatorAddress,
    fromBlock,
    toBlock,
  });
  const logs = await fetchErc20TransferLogsChunked({
    rpcUrl,
    filter,
    rpcImpl,
    maxBlockRange,
  });
  const record = attributeInboundEventFromTransferLogs({
    event,
    logs,
    operatorAddress,
    sourceFile: safeRpcSource(chain, rpcUrl),
  });
  return { record, filter, logCount: logs.length };
}

export async function fetchErc20TransferLogsChunked({
  rpcUrl,
  filter,
  rpcImpl = rpc,
  maxBlockRange = 1_000,
} = {}) {
  const fromBlock = numberFromHex(filter.fromBlock);
  const toBlock = numberFromHex(filter.toBlock);
  if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock) || toBlock < fromBlock) {
    return rpcImpl(rpcUrl, "eth_getLogs", [filter]);
  }
  const chunkSize = Math.max(1, Number(maxBlockRange) || 1_000);
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(toBlock, start + chunkSize - 1);
    logs.push(...await rpcImpl(rpcUrl, "eth_getLogs", [{
      ...filter,
      fromBlock: hexQuantity(start),
      toBlock: hexQuantity(end),
    }]));
  }
  return logs;
}

export async function buildInboundTransferAttributionReport({
  inboundEvents = [],
  existingAttributions = [],
  chainConfigFor = getEvmChainConfig,
  rpcImpl = rpc,
  blockWindowResolver = resolveInboundEventBlockWindow,
  limit = Infinity,
  eventId = null,
  now = new Date().toISOString(),
} = {}) {
  const existingKeys = new Set(existingAttributions.map(attributionKey));
  const candidates = inboundTransferAttributionCandidates({ inboundEvents, existingAttributions, chainConfigFor })
    .filter((event) => !eventId || event.eventId === eventId)
    .slice(0, Number.isFinite(limit) ? limit : Infinity);
  const records = [];
  const failures = [];
  const misses = [];

  for (const event of candidates) {
    const chain = normalized(event.chain);
    const chainConfig = chainConfigFor(chain);
    const rpcUrls = chainConfig?.rpcUrls || [chainConfig?.rpcUrl].filter(Boolean);
    try {
      const { result } = await firstSuccessfulRpcCall({
        rpcUrls,
        method: "eth_chainId",
        params: [],
        rpcImpl,
      });
      if (Number(BigInt(result)) !== chainConfig.chainId) {
        throw new Error(`RPC chainId mismatch: expected ${chainConfig.chainId}, got ${Number(BigInt(result))}`);
      }
      const attempts = [];
      for (const rpcUrl of rpcUrls) {
        try {
          const attributed = await attributeInboundEventViaRpc({
            event,
            rpcUrl,
            rpcImpl,
            blockWindowResolver,
          });
          if (attributed.record) {
            const key = attributionKey(attributed.record);
            if (!existingKeys.has(key)) {
              records.push(attributed.record);
              existingKeys.add(key);
            }
            break;
          }
          attempts.push({ rpcUrl: safeRpcSource(chain, rpcUrl), logCount: attributed.logCount });
        } catch (error) {
          attempts.push({ rpcUrl: safeRpcSource(chain, rpcUrl), error: error.message });
        }
      }
      if (!records.some((record) => record.eventId === event.eventId)) {
        misses.push({ eventId: event.eventId, chain, token: normalized(event.token), attempts });
      }
    } catch (error) {
      failures.push({ eventId: event.eventId, chain, token: normalized(event.token), error: error.message });
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: typeof now === "string" ? now : now.toISOString(),
    summary: {
      candidateEventCount: candidates.length,
      attributedCount: records.length,
      missCount: misses.length,
      failureCount: failures.length,
      existingAttributionCount: existingAttributions.length,
    },
    records,
    misses,
    failures,
  };
}
