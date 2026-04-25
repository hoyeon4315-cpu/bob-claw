import { Interface } from "ethers";
import { tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { estimateGas } from "../../gas/rpc-gas.mjs";
import { appendExecutionReceiptReconciliation } from "../ingestor/execution-receipt-ingest.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";
import { defaultSettlementTimeoutMs, readEvmAssetBalance, sleep, waitForEvmAssetDelta } from "./settlement-proof.mjs";

const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount)",
]);

const COMET_INTERFACE = new Interface([
  "function supply(address asset,uint256 amount)",
  "function withdraw(address asset,uint256 amount)",
]);

const DEFAULT_APPROVE_GAS_UNITS = 80_000;
const DEFAULT_SUPPLY_GAS_UNITS = 320_000;
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

function assetSpentProof({ before, after, amount }) {
  const initial = BigInt(before?.balance ?? 0);
  const settled = BigInt(after?.balance ?? 0);
  const observedDelta = initial - settled;
  const requiredDelta = BigInt(amount || 0);
  return {
    status: observedDelta >= requiredDelta ? "delivered" : "unproven",
    proofSource: after?.proofSource || before?.proofSource || "erc20_balance_delta",
    initialBalance: initial.toString(),
    settledBalance: settled.toString(),
    observedDelta: observedDelta.toString(),
    requiredDelta: requiredDelta.toString(),
    observedAt: new Date().toISOString(),
    rpcUrl: after?.rpcUrl || before?.rpcUrl || null,
  };
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
    strategyConfig: { intentTtlMs: ttlMs },
    metadata: {
      skipAutoIngest: true,
      ...metadata,
    },
  };
}

export async function buildCompoundV3SupplyCanaryPlan({
  candidate,
  senderAddress,
  amount,
  strategyId = candidate?.strategyId || "gateway_native_asset_conversion_sleeve",
  estimateGasImpl = estimateGas,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  minimumReturnBps = 9_500,
  now = new Date().toISOString(),
} = {}) {
  if (!candidate) throw new Error("candidate is required");
  if (!senderAddress) throw new Error("senderAddress is required");
  if (!getEvmChainConfig(candidate.chain)) throw new Error(`Unsupported EVM chain: ${candidate.chain}`);

  const strategyCaps = assertStrategyCaps(strategyId);
  const chain = candidate.chain;
  const assetAddress = assertAddress(candidate.assetAddress, "assetAddress");
  const cometAddress = assertAddress(candidate.cometAddress || candidate.shareTokenAddress, "cometAddress");
  const normalizedAmount = toPositiveIntegerString(amount, "amount");
  const assetMetadata = tokenAsset(chain, assetAddress, {
    ticker: candidate.assetSymbol || tokenAsset(chain, assetAddress).ticker,
    family: "stablecoin",
    decimals: Number.isInteger(candidate.assetDecimals) ? candidate.assetDecimals : tokenAsset(chain, assetAddress).decimals,
    priceKey: "usd_stable",
  });
  const assetDecimals = assetMetadata.decimals;
  const amountUsd = amountUsdFromUnits(normalizedAmount, assetDecimals) ?? 0;
  const buffer = Math.max(10_000, Number(gasBufferBps) || DEFAULT_GATEWAY_GAS_BUFFER_BPS);

  let approveGas = null;
  try {
    approveGas = await estimateGasImpl(
      chain,
      {
        from: senderAddress,
        to: assetAddress,
        data: ERC20_INTERFACE.encodeFunctionData("approve", [cometAddress, normalizedAmount]),
        valueWei: "0",
      },
      getEvmChainConfig(chain),
    );
  } catch {
    approveGas = { gasUnits: DEFAULT_APPROVE_GAS_UNITS };
  }

  const supplyData = COMET_INTERFACE.encodeFunctionData("supply", [assetAddress, normalizedAmount]);
  let supplyGas = null;
  try {
    supplyGas = await estimateGasImpl(
      chain,
      { from: senderAddress, to: cometAddress, data: supplyData, valueWei: "0" },
      getEvmChainConfig(chain),
    );
  } catch {
    supplyGas = { gasUnits: DEFAULT_SUPPLY_GAS_UNITS };
  }

  const steps = [
    {
      id: "approve_asset_to_comet",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "approve_exact",
        approval: { token: assetAddress, spender: cometAddress, amount: normalizedAmount, mode: "per_tx" },
        tx: {
          to: assetAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [cometAddress, normalizedAmount]),
          value: "0",
          gasLimit: gasLimitWithFallback(approveGas, DEFAULT_APPROVE_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: 0,
          templateId: candidate.templateId,
          protocol: candidate.protocolId,
          assetAddress,
          cometAddress,
        },
      }),
    },
    {
      id: "supply_asset_to_comet",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "compound_v3_supply",
        tx: {
          to: cometAddress,
          data: supplyData,
          value: "0",
          gasLimit: gasLimitWithFallback(supplyGas, DEFAULT_SUPPLY_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: amountUsd,
          templateId: candidate.templateId,
          protocol: candidate.protocolId,
          assetAddress,
          cometAddress,
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
    templateId: candidate.templateId,
    protocolId: candidate.protocolId,
    bindingKind: candidate.bindingKind,
    assetAddress,
    cometAddress,
    shareTokenAddress: cometAddress,
    amount: normalizedAmount,
    amountUsd,
    minimumReturnBps,
    minimumRedeemAssetDelta: minimumRedeemDelta(normalizedAmount, minimumReturnBps),
    asset: assetMetadata,
    shareAsset: tokenAsset(chain, cometAddress, {
      ticker: candidate.cometSymbol || candidate.shareTokenSymbol || "cUSDCv3",
      family: "protocol_share",
      decimals: Number.isInteger(candidate.cometDecimals) ? candidate.cometDecimals : assetDecimals,
      priceKey: null,
    }),
    steps,
  };
}

export async function executeCompoundV3SupplyCanaryPlan({
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
    throw new Error("Compound v3 supply canary plan must have approve and supply steps");
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

  const stepResults = [];
  for (const step of plan.steps) {
    const result = await sendCommand({
      socketPath,
      timeoutMs,
      message: { command: "sign_and_broadcast", intent: step.intent, awaitConfirmation, confirmations, timeoutMs: confirmationTimeoutMs },
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
  const assetBalanceAfterSupply = await readEvmAssetBalance({
    asset: plan.asset,
    owner: plan.senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const supplyProof = assetSpentProof({ before: assetBalanceBefore, after: assetBalanceAfterSupply, amount: plan.amount });

  let withdrawGas = null;
  const withdrawData = COMET_INTERFACE.encodeFunctionData("withdraw", [plan.assetAddress, plan.amount]);
  try {
    withdrawGas = await estimateGasImpl(
      plan.chain,
      { from: plan.senderAddress, to: plan.cometAddress, data: withdrawData, valueWei: "0" },
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
    intentType: "compound_v3_withdraw",
    tx: {
      to: plan.cometAddress,
      data: withdrawData,
      value: "0",
      gasLimit: gasLimitWithFallback(withdrawGas, DEFAULT_WITHDRAW_GAS_UNITS, DEFAULT_GATEWAY_GAS_BUFFER_BPS),
    },
    metadata: {
      capCheckAmountUsd: 0,
      templateId: plan.templateId,
      protocol: plan.protocolId,
      assetAddress: plan.assetAddress,
      cometAddress: plan.cometAddress,
    },
  });

  const withdrawResult = await sendCommand({
    socketPath,
    timeoutMs,
    message: { command: "sign_and_broadcast", intent: withdrawIntent, awaitConfirmation, confirmations, timeoutMs: confirmationTimeoutMs },
  });
  if (withdrawResult?.status !== "ok" || !withdrawResult?.broadcast?.txHash) {
    const error = new Error(withdrawResult?.error?.message || "Signer did not complete compound_v3_withdraw");
    error.name = withdrawResult?.error?.name || "SignerExecutionFailed";
    throw error;
  }
  stepResults.push({ id: "withdraw_asset_from_comet", signerResult: withdrawResult });

  const redeemProof = await waitForEvmAssetDelta({
    asset: plan.asset,
    owner: plan.senderAddress,
    initialBalance: { ...assetBalanceBefore, balance: BigInt(assetBalanceBefore.balance ?? 0) - BigInt(plan.amount) },
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
    supplyProof,
    redeemProof,
    destinationProof: redeemProof.status === "delivered"
      ? { status: "delivered", proofSource: redeemProof.proofSource, observedDelta: redeemProof.observedDelta, requiredDelta: redeemProof.requiredDelta }
      : null,
  };
  if (typeof receiptIngest !== "function") return execution;
  return { ...execution, receiptIngest: await receiptIngest({ execution }) };
}
