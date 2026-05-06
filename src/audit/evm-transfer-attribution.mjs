export const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function normalizeHex(value) {
  return String(value || "").trim().toLowerCase();
}

function strip0x(value) {
  const normalized = normalizeHex(value);
  return normalized.startsWith("0x") ? normalized.slice(2) : normalized;
}

function hexQuantity(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const bigint = typeof value === "bigint" ? value : BigInt(value);
  return `0x${bigint.toString(16)}`;
}

function numberFromHex(value) {
  if (value === undefined || value === null || value === "") return null;
  return Number(BigInt(value));
}

function bigintFromHex(value) {
  if (!value || value === "0x") return 0n;
  return BigInt(value);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function addressTopic(address) {
  const raw = strip0x(address);
  if (!/^[0-9a-f]{40}$/u.test(raw)) {
    throw new Error(`Invalid EVM address for topic: ${address}`);
  }
  return `0x${raw.padStart(64, "0")}`;
}

export function topicAddress(topic) {
  const raw = strip0x(topic);
  if (!/^[0-9a-f]{64}$/u.test(raw)) {
    throw new Error(`Invalid indexed address topic: ${topic}`);
  }
  return `0x${raw.slice(24)}`;
}

export function buildErc20InboundTransferFilter({
  token,
  to,
  fromBlock,
  toBlock,
} = {}) {
  if (!token) throw new Error("Missing token for ERC20 transfer filter");
  if (!to) throw new Error("Missing recipient for ERC20 transfer filter");
  return {
    address: token,
    ...(fromBlock !== undefined ? { fromBlock: hexQuantity(fromBlock) } : {}),
    ...(toBlock !== undefined ? { toBlock: hexQuantity(toBlock) } : {}),
    topics: [
      ERC20_TRANSFER_TOPIC,
      null,
      addressTopic(to),
    ],
  };
}

export function normalizeErc20TransferLog({ chain, token, log } = {}) {
  const topics = log?.topics || [];
  if (normalizeHex(topics[0]) !== ERC20_TRANSFER_TOPIC) return null;
  if (topics.length < 3) return null;
  return {
    chain: String(chain || "").trim().toLowerCase(),
    token: normalizeHex(token || log.address),
    txHash: log.transactionHash || null,
    blockNumber: numberFromHex(log.blockNumber),
    logIndex: numberFromHex(log.logIndex),
    from: topicAddress(topics[1]),
    to: topicAddress(topics[2]),
    amount: bigintFromHex(log.data).toString(),
  };
}

export function attributeInboundEventFromTransferLogs({
  event,
  logs = [],
  operatorAddress,
  sourceFile = "rpc:eth_getLogs",
} = {}) {
  const eventChain = String(event?.chain || "").trim().toLowerCase();
  const eventToken = normalizeHex(event?.token);
  const eventAmount = event?.amount === undefined || event?.amount === null ? null : String(event.amount);
  const operator = normalizeHex(operatorAddress);
  const matches = logs
    .map((log) => normalizeErc20TransferLog({ chain: eventChain, token: eventToken || log.address, log }))
    .filter(Boolean)
    .filter((log) => log.chain === eventChain)
    .filter((log) => log.token === eventToken)
    .filter((log) => normalizeHex(log.to) === operator)
    .filter((log) => eventAmount === null || log.amount === eventAmount);
  if (matches.length === 0) return null;
  const match = [...matches].sort((left, right) => {
    return (left.blockNumber ?? 0) - (right.blockNumber ?? 0) ||
      (left.logIndex ?? 0) - (right.logIndex ?? 0) ||
      String(left.txHash).localeCompare(String(right.txHash));
  })[0];
  return {
    schemaVersion: 1,
    eventId: event.eventId || null,
    observedAt: event.observedAt || null,
    chain: eventChain,
    token: eventToken,
    txHash: match.txHash,
    blockNumber: match.blockNumber,
    logIndex: match.logIndex,
    from: match.from,
    to: match.to,
    amount: match.amount,
    amountDecimal: finiteNumber(event.amountDecimal),
    estimatedUsd: finiteNumber(event.estimatedUsd),
    sourceFile,
    confidence: "tx_attributed_erc20_transfer_log",
  };
}
