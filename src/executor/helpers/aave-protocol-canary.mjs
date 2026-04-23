import { Interface } from "ethers";
import { tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { estimateGas } from "../../gas/rpc-gas.mjs";
import { simulateTransactionCall } from "../../evm/transaction-read.mjs";
import { appendExecutionReceiptReconciliation } from "../ingestor/execution-receipt-ingest.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { applyMerklCanaryExecutionReadiness } from "../../strategy/merkl-canary-execution-readiness.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";
import { defaultSettlementTimeoutMs, readEvmAssetBalance, sleep, waitForEvmAssetDelta } from "./settlement-proof.mjs";

export const AAVE_PROTOCOL_CANARY_STRATEGY_ID = "gateway_native_asset_conversion_sleeve";

const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount)",
]);

const AAVE_POOL_INTERFACE = new Interface([
  "function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)",
  "function withdraw(address asset,uint256 amount,address to) returns (uint256)",
]);

const AAVE_PROVIDER_INTERFACE = new Interface([
  "function getPool() view returns (address)",
]);

const DEFAULT_SUPPLY_GAS_UNITS = 360_000;
const DEFAULT_WITHDRAW_GAS_UNITS = 280_000;

function assertAddress(value, label) {
  const normalized = String(value || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/u.test(normalized)) throw new Error(`${label} must be an EVM address`);
  return normalized;
}

function toPositiveIntegerString(value, label) {
  if (typeof value === "bigint") {
    if (value <= 0n) throw new Error(`${label} must be a positive integer`);
    return value.toString();
  }
  const normalized = String(value ?? "").trim();
  if (!/^[0-9]+$/u.test(normalized) || normalized === "0") throw new Error(`${label} must be a positive integer`);
  return normalized;
}

function amountUsdFromUnits(amount, decimals) {
  const parsedDecimals = Number(decimals);
  if (!Number.isInteger(parsedDecimals) || parsedDecimals < 0 || parsedDecimals > 36) return null;
  return Number(amount) / (10 ** parsedDecimals);
}

function minimumRedeemDelta(amount, minimumReturnBps) {
  const bps = BigInt(Math.max(1, Math.min(10_000, Number(minimumReturnBps) || 9_500)));
  return ((BigInt(amount) * bps) / 10_000n).toString();
}

function gasLimitWithFallback(gas, fallbackUnits, gasBufferBps) {
  const units = Number(gas?.gasUnits);
  const baseUnits = Number.isFinite(units) && units > 0 ? Math.ceil(units) : fallbackUnits;
  return String(applyGasBuffer(baseUnits, gasBufferBps));
}

function buildIntent({ strategyId, chain, amountUsd, now, ttlMs, intentType, tx, approval = null, metadata = {} }) {
  return {
    strategyId,
    chain,
    family: "evm",
    intentType,
    amountUsd,
    mode: "live",
    observedAt: now,
    executionReason: "strategy_execution",
    approval,
    tx,
    strategyConfig: {
      intentTtlMs: ttlMs,
    },
    metadata: {
      skipAutoIngest: true,
      ...metadata,
    },
  };
}

export function selectAaveQueueItem(
  queue = {},
  {
    opportunityId = null,
    chain = null,
    inventorySnapshot = null,
    canaryExecutions = [],
    now = new Date().toISOString(),
  } = {},
) {
  const items = queue?.queue || [];
  const filtered = items
    .filter((item) => {
      if (opportunityId && String(item.opportunityId) !== String(opportunityId)) return false;
      if (chain && item.chain !== chain) return false;
      return item.protocolBindingPlan?.bindingKind === "aave_v3_pool_supply_withdraw" &&
        item.protocolBindingPlan?.status === "binding_ready";
    })
    .map((item) => item.executionReadiness
      ? item
      : applyMerklCanaryExecutionReadiness(item, {
          inventorySnapshot,
          canaryExecutions,
          now,
        }));

  if (opportunityId || chain) return filtered[0] || null;

  const executable = filtered.filter((item) => item.executionReadiness?.status === "inventory_ready");
  return executable[0] || null;
}

export async function resolveAavePoolAddress({
  chain,
  binding = {},
  simulateTransactionCallImpl = simulateTransactionCall,
} = {}) {
  if (!chain) throw new Error("chain is required");
  if (!getEvmChainConfig(chain)) throw new Error(`Unsupported EVM chain: ${chain}`);
  if (binding.poolAddress) return assertAddress(binding.poolAddress, "poolAddress");

  const poolAddressProviderAddress = assertAddress(binding.poolAddressProviderAddress, "poolAddressProviderAddress");
  const call = await simulateTransactionCallImpl(chain, {
    to: poolAddressProviderAddress,
    data: AAVE_PROVIDER_INTERFACE.encodeFunctionData("getPool", []),
    value: "0",
  });
  const [poolAddress] = AAVE_PROVIDER_INTERFACE.decodeFunctionResult("getPool", call.returnData || "0x");
  return assertAddress(poolAddress, "poolAddress");
}

export async function buildAaveProtocolCanaryPlan({
  queueItem,
  senderAddress,
  amount,
  strategyId = queueItem?.mappedStrategyId || AAVE_PROTOCOL_CANARY_STRATEGY_ID,
  estimateGasImpl = estimateGas,
  simulateTransactionCallImpl = simulateTransactionCall,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  minimumReturnBps = 9_500,
  now = new Date().toISOString(),
} = {}) {
  if (!queueItem) throw new Error("queueItem is required");
  if (!senderAddress) throw new Error("senderAddress is required");
  if (!getEvmChainConfig(queueItem.chain)) throw new Error(`Unsupported EVM chain: ${queueItem.chain}`);

  const strategyCaps = assertStrategyCaps(strategyId);
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || {};
  const chain = queueItem.chain;
  const poolAddress = await resolveAavePoolAddress({
    chain,
    binding,
    simulateTransactionCallImpl,
  });
  const assetAddress = assertAddress(binding.assetAddress, "assetAddress");
  const aTokenAddress = assertAddress(binding.aTokenAddress, "aTokenAddress");
  const normalizedAmount = toPositiveIntegerString(amount, "amount");
  const assetMetadata = tokenAsset(chain, assetAddress, {
    ticker: binding.assetSymbol || tokenAsset(chain, assetAddress).ticker,
    decimals: Number.isInteger(binding.assetDecimals) ? binding.assetDecimals : tokenAsset(chain, assetAddress).decimals,
  });
  const assetDecimals = assetMetadata.decimals;
  const amountUsd = amountUsdFromUnits(normalizedAmount, assetDecimals) ?? 0;
  const buffer = Math.max(10_000, Number(gasBufferBps) || DEFAULT_GATEWAY_GAS_BUFFER_BPS);
  const referralCode = Number.isInteger(Number(binding.referralCode)) ? Number(binding.referralCode) : 0;

  let approveGas = null;
  try {
    approveGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: assetAddress,
        data: ERC20_INTERFACE.encodeFunctionData("approve", [poolAddress, normalizedAmount]),
        valueWei: "0",
      },
      getEvmChainConfig(chain),
    );
  } catch {
    approveGas = { gasUnits: 80_000 };
  }

  const supplyData = AAVE_POOL_INTERFACE.encodeFunctionData("supply", [
    assetAddress,
    normalizedAmount,
    senderAddress,
    referralCode,
  ]);
  const steps = [
    {
      id: "approve_asset_to_pool",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "approve_exact",
        approval: {
          token: assetAddress,
          spender: poolAddress,
          amount: normalizedAmount,
          mode: "per_tx",
        },
        tx: {
          to: assetAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [poolAddress, normalizedAmount]),
          value: "0",
          gasLimit: gasLimitWithFallback(approveGas, 80_000, buffer),
        },
        metadata: {
          capCheckAmountUsd: 0,
          opportunityId: queueItem.opportunityId,
          protocol: queueItem.protocolId,
          marketName: binding.marketName || null,
          poolAddress,
          assetAddress,
          shareTokenAddress: aTokenAddress,
        },
      }),
    },
    {
      id: "supply_asset_to_pool",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "aave_supply",
        tx: {
          to: poolAddress,
          data: supplyData,
          value: "0",
          gasLimit: String(applyGasBuffer(DEFAULT_SUPPLY_GAS_UNITS, buffer)),
        },
        metadata: {
          capCheckAmountUsd: amountUsd,
          opportunityId: queueItem.opportunityId,
          protocol: queueItem.protocolId,
          marketName: binding.marketName || null,
          poolAddress,
          assetAddress,
          shareTokenAddress: aTokenAddress,
        },
      }),
    },
  ];

  return {
    schemaVersion: 1,
    observedAt: now,
    strategyId,
    planStatus: "ready",
    chain,
    senderAddress,
    opportunityId: queueItem.opportunityId,
    protocolId: queueItem.protocolId,
    bindingKind: queueItem.protocolBindingPlan?.bindingKind || null,
    name: queueItem.name,
    poolAddress,
    poolAddressProviderAddress: binding.poolAddressProviderAddress || null,
    marketName: binding.marketName || null,
    assetAddress,
    shareTokenAddress: aTokenAddress,
    amount: normalizedAmount,
    amountUsd,
    minimumReturnBps,
    minimumRedeemAssetDelta: minimumRedeemDelta(normalizedAmount, minimumReturnBps),
    asset: tokenAsset(chain, assetAddress, {
      ticker: binding.assetSymbol || assetMetadata.ticker,
      family: assetMetadata.family || "stablecoin",
      decimals: assetDecimals,
      priceKey: assetMetadata.priceKey || null,
    }),
    shareAsset: tokenAsset(chain, aTokenAddress, {
      ticker: binding.aTokenSymbol || "aToken",
      family: "protocol_share",
      decimals: assetDecimals,
      priceKey: null,
    }),
    steps,
  };
}

export async function executeAaveProtocolCanaryPlan({
  plan,
  sendCommand = sendSignerCommand,
  receiptIngest = appendExecutionReceiptReconciliation,
  readErc20BalanceImpl,
  readNativeBalanceImpl,
  estimateGasImpl = estimateGas,
  socketPath,
  timeoutMs,
  awaitConfirmation = true,
  confirmations = 1,
  confirmationTimeoutMs = 120_000,
  settlementTimeoutMs = defaultSettlementTimeoutMs(0, { minimumMs: 60_000, extraSeconds: 0 }),
  pollIntervalMs = 5_000,
  sleepImpl = sleep,
} = {}) {
  if (!Array.isArray(plan?.steps) || plan.steps.length !== 2) {
    throw new Error("Aave protocol canary plan must have approve and supply steps");
  }
  const assetBalanceBefore = await readEvmAssetBalance({
    asset: plan.asset,
    owner: plan.senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const shareBalanceBefore = await readEvmAssetBalance({
    asset: plan.shareAsset,
    owner: plan.senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  if (BigInt(assetBalanceBefore.balance ?? 0) < BigInt(plan.amount)) {
    throw new Error(`Insufficient asset balance: required ${plan.amount}, available ${assetBalanceBefore.balance}`);
  }

  const steps = plan.steps.map((step) => ({
    ...step,
    intent: {
      ...step.intent,
      tx: { ...step.intent.tx },
    },
  }));

  const stepResults = [];
  for (const step of steps) {
    if (step.id === "supply_asset_to_pool") {
      let supplyGas = null;
      try {
        supplyGas = await estimateGasImpl(
          plan.chain,
          {
            from: plan.senderAddress,
            to: plan.poolAddress,
            data: step.intent.tx.data,
            valueWei: "0",
          },
          getEvmChainConfig(plan.chain),
        );
      } catch {
        supplyGas = { gasUnits: DEFAULT_SUPPLY_GAS_UNITS };
      }
      step.intent.tx.gasLimit = gasLimitWithFallback(supplyGas, DEFAULT_SUPPLY_GAS_UNITS, DEFAULT_GATEWAY_GAS_BUFFER_BPS);
    }

    const result = await sendCommand({
      socketPath,
      timeoutMs,
      message: {
        command: "sign_and_broadcast",
        intent: step.intent,
        awaitConfirmation,
        confirmations,
        timeoutMs: confirmationTimeoutMs,
      },
    });
    if (result?.status !== "ok" || !result?.broadcast?.txHash) {
      const error = new Error(result?.error?.message || `Signer did not complete ${step.id}`);
      error.name = result?.error?.name || "SignerExecutionFailed";
      throw error;
    }
    stepResults.push({ id: step.id, signerResult: result });
  }

  const shareProof = await waitForEvmAssetDelta({
    asset: plan.shareAsset,
    owner: plan.senderAddress,
    initialBalance: shareBalanceBefore,
    requiredDelta: "1",
    readErc20BalanceImpl,
    readNativeBalanceImpl,
    timeoutMs: settlementTimeoutMs,
    pollIntervalMs,
    sleepImpl,
  });
  if (shareProof.status !== "delivered") {
    return {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      settlementStatus: "share_delta_timeout",
      plan,
      stepResults,
      assetBalanceBefore,
      shareBalanceBefore,
      shareProof,
    };
  }

  let withdrawGas = null;
  const withdrawData = AAVE_POOL_INTERFACE.encodeFunctionData("withdraw", [
    plan.assetAddress,
    plan.amount,
    plan.senderAddress,
  ]);
  try {
    withdrawGas = await estimateGasImpl(
      plan.chain,
      {
        from: plan.senderAddress,
        to: plan.poolAddress,
        data: withdrawData,
        valueWei: "0",
      },
      getEvmChainConfig(plan.chain),
    );
  } catch {
    withdrawGas = { gasUnits: DEFAULT_WITHDRAW_GAS_UNITS };
  }

  const withdrawIntent = buildIntent({
    strategyId: plan.strategyId,
    chain: plan.chain,
    amountUsd: 0,
    now: new Date().toISOString(),
    ttlMs: assertStrategyCaps(plan.strategyId).intentTtlMs,
    intentType: "aave_withdraw",
    tx: {
      to: plan.poolAddress,
      data: withdrawData,
      value: "0",
      gasLimit: gasLimitWithFallback(withdrawGas, DEFAULT_WITHDRAW_GAS_UNITS, DEFAULT_GATEWAY_GAS_BUFFER_BPS),
    },
    metadata: {
      capCheckAmountUsd: 0,
      opportunityId: plan.opportunityId,
      protocol: plan.protocolId,
      marketName: plan.marketName || null,
      poolAddress: plan.poolAddress,
      assetAddress: plan.assetAddress,
      shareTokenAddress: plan.shareTokenAddress,
    },
  });

  const withdrawResult = await sendCommand({
    socketPath,
    timeoutMs,
    message: {
      command: "sign_and_broadcast",
      intent: withdrawIntent,
      awaitConfirmation,
      confirmations,
      timeoutMs: confirmationTimeoutMs,
    },
  });
  if (withdrawResult?.status !== "ok" || !withdrawResult?.broadcast?.txHash) {
    const error = new Error(withdrawResult?.error?.message || "Signer did not complete aave_withdraw");
    error.name = withdrawResult?.error?.name || "SignerExecutionFailed";
    throw error;
  }
  stepResults.push({ id: "withdraw_asset_from_pool", signerResult: withdrawResult });

  const redeemProof = await waitForEvmAssetDelta({
    asset: plan.asset,
    owner: plan.senderAddress,
    initialBalance: {
      ...assetBalanceBefore,
      balance: BigInt(assetBalanceBefore.balance ?? 0) - BigInt(plan.amount),
    },
    requiredDelta: plan.minimumRedeemAssetDelta,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
    timeoutMs: settlementTimeoutMs,
    pollIntervalMs,
    sleepImpl,
  });
  const assetBalanceAfter = await readEvmAssetBalance({
    asset: plan.asset,
    owner: plan.senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const shareBalanceAfter = await readEvmAssetBalance({
    asset: plan.shareAsset,
    owner: plan.senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const execution = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: redeemProof.status === "delivered" ? "delivered" : "redeem_delta_timeout",
    plan,
    stepResults,
    assetBalanceBefore,
    assetBalanceAfter,
    shareBalanceBefore,
    shareBalanceAfter,
    shareProof,
    redeemProof,
    destinationProof: redeemProof.status === "delivered"
      ? {
          status: "delivered",
          proofSource: redeemProof.proofSource,
          observedDelta: redeemProof.observedDelta,
          requiredDelta: redeemProof.requiredDelta,
        }
      : null,
  };
  if (typeof receiptIngest !== "function") return execution;
  return {
    ...execution,
    receiptIngest: await receiptIngest({ execution }),
  };
}
