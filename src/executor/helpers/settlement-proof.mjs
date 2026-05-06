import { MempoolClient } from "../../bitcoin/fees.mjs";
import { readErc20Balance, readNativeBalance } from "../../evm/account-state.mjs";

export function defaultSettlementTimeoutMs(estimatedSeconds, { minimumMs = 180_000, extraSeconds = 60 } = {}) {
  const normalizedSeconds = Number(estimatedSeconds);
  if (Number.isFinite(normalizedSeconds) && normalizedSeconds > 0) {
    return Math.max(minimumMs, (normalizedSeconds + extraSeconds) * 1_000);
  }
  return minimumMs;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readEvmAssetBalance({
  asset,
  owner,
  readErc20BalanceImpl = readErc20Balance,
  readNativeBalanceImpl = readNativeBalance,
}) {
  if (asset?.isNative) {
    const result = await readNativeBalanceImpl(asset.chain, owner);
    return {
      proofSource: "native_balance_delta",
      rpcUrl: result.rpcUrl,
      balance: BigInt(result.balanceWei),
    };
  }
  const result = await readErc20BalanceImpl(asset.chain, asset.token, owner);
  return {
    proofSource: "erc20_balance_delta",
    rpcUrl: result.rpcUrl,
    balance: BigInt(result.balance),
  };
}

export async function waitForEvmAssetDelta({
  asset,
  owner,
  initialBalance,
  requiredDelta,
  readErc20BalanceImpl = readErc20Balance,
  readNativeBalanceImpl = readNativeBalance,
  timeoutMs,
  pollIntervalMs = 10_000,
  sleepImpl = sleep,
}) {
  const neededDelta = BigInt(requiredDelta || 0);
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(0, Number(timeoutMs) || 0);
  let attempts = 0;

  while (true) {
    attempts += 1;
    const observedAt = new Date().toISOString();
    const current = await readEvmAssetBalance({
      asset,
      owner,
      readErc20BalanceImpl,
      readNativeBalanceImpl,
    });
    const observedDelta = current.balance - initialBalance.balance;
    if (observedDelta >= neededDelta) {
      return {
        status: "delivered",
        proofSource: current.proofSource,
        initialBalance: initialBalance.balance.toString(),
        settledBalance: current.balance.toString(),
        observedDelta: observedDelta.toString(),
        requiredDelta: neededDelta.toString(),
        observedAt,
        rpcUrl: current.rpcUrl,
        attempts,
      };
    }
    if (Date.now() >= deadline) {
      return {
        status: "unproven_timeout",
        proofSource: current.proofSource,
        initialBalance: initialBalance.balance.toString(),
        settledBalance: current.balance.toString(),
        observedDelta: observedDelta.toString(),
        requiredDelta: neededDelta.toString(),
        observedAt,
        rpcUrl: current.rpcUrl,
        attempts,
      };
    }
    await sleepImpl(Math.max(0, Number(pollIntervalMs) || 0));
  }
}

export async function readBitcoinAddressBalance({
  address,
  client = new MempoolClient(),
}) {
  const result = await client.getAddressBalance(address);
  const txHistory = typeof client.getAddressTransactions === "function"
    ? await client.getAddressTransactions(address)
    : null;
  return {
    proofSource: "bitcoin_address_balance_delta",
    source: result.source,
    balance: BigInt(result.balanceSats),
    confirmedBalance: BigInt(result.confirmedBalanceSats),
    mempoolBalance: BigInt(result.mempoolBalanceSats),
    transactions: Array.isArray(txHistory?.transactions) ? txHistory.transactions : [],
  };
}

function bitcoinTxidFromTransaction(transaction) {
  if (typeof transaction === "string") return transaction.trim() || null;
  if (!transaction || typeof transaction !== "object") return null;
  return transaction.txid || transaction.hash || transaction.id || null;
}

export function identifyNewBitcoinTxids({ before = [], after = [] } = {}) {
  const beforeTxids = new Set(
    (Array.isArray(before) ? before : [])
      .map(bitcoinTxidFromTransaction)
      .filter(Boolean),
  );
  return (Array.isArray(after) ? after : [])
    .map(bitcoinTxidFromTransaction)
    .filter((txid) => txid && !beforeTxids.has(txid));
}

export async function waitForBitcoinBalanceDelta({
  address,
  initialBalance,
  requiredDelta,
  readBitcoinBalanceImpl = readBitcoinAddressBalance,
  timeoutMs,
  pollIntervalMs = 10_000,
  sleepImpl = sleep,
}) {
  const neededDelta = BigInt(requiredDelta || 0);
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  let attempts = 0;

  while (true) {
    attempts += 1;
    const observedAt = new Date().toISOString();
    const current = await readBitcoinBalanceImpl({ address });
    const observedDelta = current.balance - initialBalance.balance;
    const newlyObservedTxids = identifyNewBitcoinTxids({
      before: initialBalance.transactions,
      after: current.transactions,
    });
    const bitcoinTxid = newlyObservedTxids[0] || null;
    if (observedDelta >= neededDelta && bitcoinTxid) {
      return {
        status: "delivered",
        proofSource: current.proofSource,
        initialBalance: initialBalance.balance.toString(),
        settledBalance: current.balance.toString(),
        observedDelta: observedDelta.toString(),
        requiredDelta: neededDelta.toString(),
        observedAt,
        source: current.source,
        txid: bitcoinTxid,
        bitcoinTxid,
        newlyObservedTxids,
        attempts,
      };
    }
    if (Date.now() >= deadline) {
      return {
        status: "unproven_timeout",
        proofSource: current.proofSource,
        initialBalance: initialBalance.balance.toString(),
        settledBalance: current.balance.toString(),
        observedDelta: observedDelta.toString(),
        requiredDelta: neededDelta.toString(),
        observedAt,
        source: current.source,
        txid: bitcoinTxid,
        bitcoinTxid,
        newlyObservedTxids,
        attempts,
      };
    }
    await sleepImpl(Math.max(0, Number(pollIntervalMs) || 0));
  }
}
