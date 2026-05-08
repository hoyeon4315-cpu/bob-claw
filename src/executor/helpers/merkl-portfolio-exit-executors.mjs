import { Interface } from "ethers";
import { tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import { estimateGas } from "../../gas/rpc-gas.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";
import { defaultSettlementTimeoutMs, readEvmAssetBalance, sleep, waitForEvmAssetDelta } from "./settlement-proof.mjs";
import { resolveAavePoolAddress } from "./aave-protocol-canary.mjs";

const ERC4626_INTERFACE = new Interface([
  "function redeem(uint256 shares,address receiver,address owner) returns (uint256 assets)",
]);

const AAVE_POOL_INTERFACE = new Interface([
  "function withdraw(address asset,uint256 amount,address to) returns (uint256)",
]);

const DEFAULT_REDEEM_GAS_UNITS = 260_000;
const DEFAULT_AAVE_WITHDRAW_GAS_UNITS = 280_000;

function minimumRedeemDelta(amount, minimumReturnBps = 9_500) {
  const bps = BigInt(Math.max(1, Math.min(10_000, Number(minimumReturnBps) || 9_500)));
  return ((BigInt(amount || 0) * bps) / 10_000n).toString();
}

function gasLimitWithFallback(gas, fallbackUnits, gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS) {
  const units = Number(gas?.gasUnits);
  const baseUnits = Number.isFinite(units) && units > 0 ? Math.ceil(units) : fallbackUnits;
  return String(applyGasBuffer(baseUnits, gasBufferBps));
}

function noPositionSharesError(message, { position, shareBalanceBefore, assetBalanceBefore } = {}) {
  const error = new Error(message);
  error.name = "NoPositionShares";
  error.zeroShareProof = {
    status: "reconciled_zero_share_balance",
    proofSource: "erc20_balance_zero",
    shareBalance: shareBalanceBefore?.balance || "0",
    assetBalance: assetBalanceBefore?.balance || null,
    rpcUrl: shareBalanceBefore?.rpcUrl || null,
    positionId: position?.positionId || null,
  };
  return error;
}

function buildExitIntent({ position, senderAddress, shareAmount, now }) {
  const strategyCaps = assertStrategyCaps(position.strategyId);
  const vaultAddress = position.vaultAddress || position.shareTokenAddress;
  return {
    strategyId: position.strategyId,
    chain: position.chain,
    family: "evm",
    intentType: "erc4626_redeem",
    amountUsd: 0,
    mode: "live",
    observedAt: now,
    executionReason: "risk_unwind",
    tx: {
      to: vaultAddress,
      data: ERC4626_INTERFACE.encodeFunctionData("redeem", [shareAmount, senderAddress, senderAddress]),
      value: "0",
      gasLimit: String(applyGasBuffer(DEFAULT_REDEEM_GAS_UNITS, DEFAULT_GATEWAY_GAS_BUFFER_BPS)),
    },
    strategyConfig: {
      intentTtlMs: strategyCaps.intentTtlMs,
    },
    metadata: {
      skipAutoIngest: true,
      capCheckAmountUsd: 0,
      opportunityId: position.opportunityId,
      protocol: position.protocolId,
      expectedTxTo: vaultAddress,
      vaultAddress,
      assetAddress: position.assetAddress,
      shareTokenAddress: position.shareTokenAddress,
      shareDelta: shareAmount,
      positionId: position.positionId,
    },
  };
}

function buildAaveWithdrawIntent({ position, senderAddress, poolAddress, withdrawAmount, now }) {
  const strategyCaps = assertStrategyCaps(position.strategyId);
  return {
    strategyId: position.strategyId,
    chain: position.chain,
    family: "evm",
    intentType: "aave_withdraw",
    amountUsd: 0,
    mode: "live",
    observedAt: now,
    executionReason: "risk_unwind",
    tx: {
      to: poolAddress,
      data: AAVE_POOL_INTERFACE.encodeFunctionData("withdraw", [position.assetAddress, withdrawAmount, senderAddress]),
      value: "0",
      gasLimit: String(applyGasBuffer(DEFAULT_AAVE_WITHDRAW_GAS_UNITS, DEFAULT_GATEWAY_GAS_BUFFER_BPS)),
    },
    strategyConfig: {
      intentTtlMs: strategyCaps.intentTtlMs,
    },
    metadata: {
      skipAutoIngest: true,
      capCheckAmountUsd: 0,
      opportunityId: position.opportunityId,
      protocol: position.protocolId,
      marketName: position.marketName || null,
      expectedTxTo: poolAddress,
      poolAddress,
      assetAddress: position.assetAddress,
      shareTokenAddress: position.shareTokenAddress,
      shareDelta: withdrawAmount,
      positionId: position.positionId,
    },
  };
}

export async function executeErc4626PortfolioExit({
  position,
  senderAddress,
  sendCommand = sendSignerCommand,
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
  if (!position) throw new Error("position is required");
  if (position.bindingKind !== "erc4626_vault_supply_withdraw" && position.bindingKind !== "euler_evault_deposit_withdraw") {
    throw new Error(`Unsupported position binding for exit: ${position.bindingKind}`);
  }
  if (!getEvmChainConfig(position.chain)) throw new Error(`Unsupported EVM chain: ${position.chain}`);
  const now = new Date().toISOString();
  const asset = tokenAsset(position.chain, position.assetAddress, {
    ticker: "USDC",
    family: "stablecoin",
    decimals: 6,
    priceKey: "usd_stable",
  });
  const shareAsset = tokenAsset(position.chain, position.shareTokenAddress, {
    ticker: "VaultShare",
    family: "protocol_share",
    decimals: 18,
    priceKey: null,
  });
  const assetBalanceBefore = await readEvmAssetBalance({
    asset,
    owner: senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const shareBalanceBefore = await readEvmAssetBalance({
    asset: shareAsset,
    owner: senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const currentShares = BigInt(shareBalanceBefore.balance || 0);
  const recordedShares = BigInt(position.shareDelta || 0);
  const shareAmount = (recordedShares > 0n && recordedShares < currentShares ? recordedShares : currentShares).toString();
  if (BigInt(shareAmount) <= 0n) {
    throw noPositionSharesError("No shares available to redeem", { position, shareBalanceBefore, assetBalanceBefore });
  }

  const intent = buildExitIntent({ position, senderAddress, shareAmount, now });
  try {
    const gas = await estimateGasImpl(
      position.chain,
      {
        from: senderAddress,
        to: position.vaultAddress || position.shareTokenAddress,
        data: intent.tx.data,
        valueWei: "0",
      },
      getEvmChainConfig(position.chain),
    );
    intent.tx.gasLimit = gasLimitWithFallback(gas, DEFAULT_REDEEM_GAS_UNITS);
  } catch {
    intent.tx.gasLimit = gasLimitWithFallback(null, DEFAULT_REDEEM_GAS_UNITS);
  }

  const signerResult = await sendCommand({
    socketPath,
    timeoutMs,
    message: {
      command: "sign_and_broadcast",
      intent,
      awaitConfirmation,
      confirmations,
      timeoutMs: confirmationTimeoutMs,
    },
  });
  if (signerResult?.status !== "ok" || !signerResult?.broadcast?.txHash) {
    const error = new Error(signerResult?.error?.message || "Signer did not complete erc4626 portfolio exit");
    error.name = signerResult?.error?.name || "SignerExecutionFailed";
    throw error;
  }

  const redeemProof = await waitForEvmAssetDelta({
    asset,
    owner: senderAddress,
    initialBalance: assetBalanceBefore,
    requiredDelta: minimumRedeemDelta(position.amount),
    readErc20BalanceImpl,
    readNativeBalanceImpl,
    timeoutMs: settlementTimeoutMs,
    pollIntervalMs,
    sleepImpl,
  });
  const shareBalanceAfter = await readEvmAssetBalance({
    asset: shareAsset,
    owner: senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: redeemProof.status === "delivered" ? "position_closed" : "redeem_delta_timeout",
    position,
    signerResult,
    assetBalanceBefore,
    shareBalanceBefore,
    shareBalanceAfter,
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
}

export async function executeAavePortfolioExit({
  position,
  senderAddress,
  sendCommand = sendSignerCommand,
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
  if (!position) throw new Error("position is required");
  if (position.bindingKind !== "aave_v3_pool_supply_withdraw") {
    throw new Error(`Unsupported position binding for Aave exit: ${position.bindingKind}`);
  }
  if (!getEvmChainConfig(position.chain)) throw new Error(`Unsupported EVM chain: ${position.chain}`);
  const now = new Date().toISOString();
  const asset = tokenAsset(position.chain, position.assetAddress, {
    ticker: "USDC",
    family: "stablecoin",
    decimals: 6,
    priceKey: "usd_stable",
  });
  const shareAsset = tokenAsset(position.chain, position.shareTokenAddress, {
    ticker: "aToken",
    family: "protocol_share",
    decimals: asset.decimals,
    priceKey: null,
  });
  const poolAddress = await resolveAavePoolAddress({
    chain: position.chain,
    binding: {
      poolAddress: position.poolAddress,
      poolAddressProviderAddress: position.poolAddressProviderAddress,
    },
  });
  const assetBalanceBefore = await readEvmAssetBalance({
    asset,
    owner: senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const shareBalanceBefore = await readEvmAssetBalance({
    asset: shareAsset,
    owner: senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  const currentShares = BigInt(shareBalanceBefore.balance || 0);
  const recordedShares = BigInt(position.shareDelta || position.amount || 0);
  const withdrawAmount = (recordedShares > 0n && recordedShares < currentShares ? recordedShares : currentShares).toString();
  if (BigInt(withdrawAmount) <= 0n) {
    throw noPositionSharesError("No Aave aToken balance available to withdraw", { position, shareBalanceBefore, assetBalanceBefore });
  }

  const intent = buildAaveWithdrawIntent({ position, senderAddress, poolAddress, withdrawAmount, now });
  try {
    const gas = await estimateGasImpl(
      position.chain,
      {
        from: senderAddress,
        to: poolAddress,
        data: intent.tx.data,
        valueWei: "0",
      },
      getEvmChainConfig(position.chain),
    );
    intent.tx.gasLimit = gasLimitWithFallback(gas, DEFAULT_AAVE_WITHDRAW_GAS_UNITS);
  } catch {
    intent.tx.gasLimit = gasLimitWithFallback(null, DEFAULT_AAVE_WITHDRAW_GAS_UNITS);
  }

  const signerResult = await sendCommand({
    socketPath,
    timeoutMs,
    message: {
      command: "sign_and_broadcast",
      intent,
      awaitConfirmation,
      confirmations,
      timeoutMs: confirmationTimeoutMs,
    },
  });
  if (signerResult?.status !== "ok" || !signerResult?.broadcast?.txHash) {
    const error = new Error(signerResult?.error?.message || "Signer did not complete Aave portfolio exit");
    error.name = signerResult?.error?.name || "SignerExecutionFailed";
    throw error;
  }

  const redeemProof = await waitForEvmAssetDelta({
    asset,
    owner: senderAddress,
    initialBalance: assetBalanceBefore,
    requiredDelta: minimumRedeemDelta(withdrawAmount),
    readErc20BalanceImpl,
    readNativeBalanceImpl,
    timeoutMs: settlementTimeoutMs,
    pollIntervalMs,
    sleepImpl,
  });
  const shareBalanceAfter = await readEvmAssetBalance({
    asset: shareAsset,
    owner: senderAddress,
    readErc20BalanceImpl,
    readNativeBalanceImpl,
  });
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: redeemProof.status === "delivered" ? "position_closed" : "withdraw_delta_timeout",
    position: { ...position, poolAddress },
    signerResult,
    assetBalanceBefore,
    shareBalanceBefore,
    shareBalanceAfter,
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
}
