import { Interface } from "ethers";
import { registerBinding, resolveExitExecutor } from "../../../../executor/protocol-binding-registry.mjs";
import { tokenAsset } from "../../../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../../../config/chains.mjs";
import { assertStrategyCaps } from "../../../../config/strategy-caps.mjs";
import { estimateGas } from "../../../../gas/rpc-gas.mjs";
import { sendSignerCommand } from "../../../../executor/signer/client.mjs";
import { readErc20Allowance } from "../../../../evm/account-state.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "../../../../executor/helpers/gateway-btc-consolidation.mjs";
import {
  defaultSettlementTimeoutMs,
  readEvmAssetBalance,
  sleep,
  waitForEvmAssetDelta,
} from "../../../../executor/helpers/settlement-proof.mjs";
import {
  OdosClient,
  normalizeOdosQuote,
  attachOdosAssembly,
  odosRoutingConfig,
} from "../../../../dex/odos.mjs";
import { evGate } from "../../../../executor/policy/ev-gate.mjs";

const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount) returns (bool)",
]);

const DEFAULT_SWAP_GAS_UNITS = 350_000;
const DEFAULT_APPROVE_GAS_UNITS = 80_000;
const PENDLE_YT_ENTRY_INTENT_TYPE = "pendle_yt_entry";
const PENDLE_YT_EXIT_INTENT_TYPE = "pendle_yt_exit";

function toPositiveIntegerString(value, name) {
  const normalized = String(value || "").replace(/[^0-9]/g, "");
  if (!normalized || BigInt(normalized) <= 0n) {
    throw new Error(`${name} must be a positive integer`);
  }
  return normalized;
}

function amountUsdFromUnits(units, decimals) {
  const dec = Number(decimals);
  if (!Number.isFinite(dec) || dec < 0) return null;
  const num = Number(units) / 10 ** dec;
  return Number.isFinite(num) ? num : null;
}

function gasLimitWithFallback(gas, fallbackUnits, gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS) {
  const units = Number(gas?.gasUnits);
  const baseUnits = Number.isFinite(units) && units > 0 ? Math.ceil(units) : fallbackUnits;
  return String(applyGasBuffer(baseUnits, gasBufferBps));
}

function buildIntent({ strategyId, chain, amountUsd, now, ttlMs, intentType, tx, approval = null, metadata = {}, executionReason = "strategy_execution" }) {
  return {
    strategyId,
    chain,
    family: "evm",
    intentType,
    amountUsd,
    mode: "live",
    observedAt: now,
    executionReason,
    approval,
    tx,
    strategyConfig: {
      intentTtlMs: ttlMs,
    },
    metadata: {
      skipAutoIngest: true,
      expectedTxTo: tx?.to || null,
      ...metadata,
    },
  };
}

function displayedAprPct(queueItem) {
  return queueItem?.nativeAprPct ?? queueItem?.aprPct ?? null;
}

function resolveTinyCanaryExpectedHoldDays({ expectedHoldDays, campaignRemainingHours, campaignEndsAt, now }) {
  if (Number.isFinite(expectedHoldDays) && expectedHoldDays > 0) return expectedHoldDays;
  if (Number.isFinite(campaignRemainingHours) && campaignRemainingHours > 0) return Math.max(1, campaignRemainingHours / 24);
  if (campaignEndsAt && now) {
    const hours = (new Date(campaignEndsAt).getTime() - new Date(now).getTime()) / (1000 * 60 * 60);
    if (Number.isFinite(hours) && hours > 0) return Math.max(1, hours / 24);
  }
  return 7;
}

function expectedGrossYieldUsd({ queueItem = {}, amountUsd = 0, now = new Date().toISOString() } = {}) {
  const aprPct = displayedAprPct(queueItem);
  const holdDays = resolveTinyCanaryExpectedHoldDays({
    expectedHoldDays: queueItem.expectedHoldDays,
    campaignRemainingHours: queueItem.campaignRemainingHours,
    campaignEndsAt: queueItem.campaignEndsAt,
    now,
  });
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || aprPct === null || !Number.isFinite(holdDays) || holdDays <= 0) {
    return null;
  }
  return amountUsd * (aprPct / 100) * (holdDays / 365);
}

async function buildOdosSwapStep({
  chain,
  inputToken,
  outputToken,
  amount,
  senderAddress,
  slippageLimitPercent = 0.5,
}) {
  const client = new OdosClient();
  const routing = odosRoutingConfig(chain);
  const quoted = await client.quote({
    chain,
    inputToken,
    outputToken,
    amount,
    userAddr: senderAddress,
    slippageLimitPercent,
    sourceWhitelist: routing.sourceWhitelist,
    sourceBlacklist: routing.sourceBlacklist,
  });
  const normalizedQuote = normalizeOdosQuote({
    chain,
    source: "pendle_yt_swap",
    amount,
    inputToken,
    outputToken,
    inputTicker: tokenAsset(chain, inputToken).ticker,
    inputDecimals: tokenAsset(chain, inputToken).decimals,
    outputTicker: tokenAsset(chain, outputToken).ticker,
    outputDecimals: tokenAsset(chain, outputToken).decimals,
    quoteType: "token_to_token",
    result: quoted,
    sourceWhitelist: routing.sourceWhitelist,
    sourceBlacklist: routing.sourceBlacklist,
  });
  const assembled = await client.assemble({
    pathId: normalizedQuote.pathId,
    userAddr: senderAddress,
  });
  return attachOdosAssembly(normalizedQuote, assembled);
}

export async function buildPendleYtEntryPlan({
  queueItem,
  senderAddress,
  amount,
  strategyId = queueItem?.mappedStrategyId || "pendle-yt-canary",
  estimateGasImpl = estimateGas,
  readErc20AllowanceImpl = readErc20Allowance,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  now = new Date().toISOString(),
} = {}) {
  if (!queueItem) throw new Error("queueItem is required");
  if (!senderAddress) throw new Error("senderAddress is required");
  if (!getEvmChainConfig(queueItem.chain)) throw new Error(`Unsupported EVM chain: ${queueItem.chain}`);

  const strategyCaps = assertStrategyCaps(strategyId);
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || {};
  const chain = queueItem.chain;
  const ytTokenAddress = binding.ytTokenAddress || binding.shareTokenAddress || null;
  const assetAddress = binding.assetAddress || binding.underlyingAsset || null;

  if (!ytTokenAddress) throw new Error("ytTokenAddress is required in binding");
  if (!assetAddress) throw new Error("assetAddress is required in binding");

  const normalizedAmount = toPositiveIntegerString(amount, "amount");
  const assetDecimals = Number.isInteger(binding.assetDecimals) ? binding.assetDecimals : tokenAsset(chain, assetAddress).decimals;
  const amountUsd = amountUsdFromUnits(normalizedAmount, assetDecimals) ?? 0;
  const capAmountUsd = amountUsd;
  const buffer = Math.max(10_000, Number(gasBufferBps) || DEFAULT_GATEWAY_GAS_BUFFER_BPS);

  let odosSwap = null;
  try {
    odosSwap = await buildOdosSwapStep({
      chain,
      inputToken: assetAddress,
      outputToken: ytTokenAddress,
      amount: normalizedAmount,
      senderAddress,
    });
  } catch (error) {
    return {
      schemaVersion: 1,
      planStatus: "blocked",
      blockedReason: `odos_swap_unavailable: ${error?.message || String(error)}`,
      strategyId,
      chain,
      senderAddress,
      opportunityId: queueItem.opportunityId,
      protocolId: queueItem.protocolId,
      bindingKind: queueItem.protocolBindingPlan?.bindingKind || null,
      name: queueItem.name,
      amount: normalizedAmount,
      amountUsd,
    };
  }

  let allowanceBefore = null;
  try {
    allowanceBefore = await readErc20AllowanceImpl(chain, assetAddress, senderAddress, odosSwap.txTo, {
      chainConfig: getEvmChainConfig(chain),
    });
  } catch {
    allowanceBefore = null;
  }
  const allowanceAmount = BigInt(allowanceBefore?.allowance ?? 0);
  const allowanceCoversAmount = allowanceAmount >= BigInt(normalizedAmount);
  const allowanceNeedsZeroReset = !allowanceCoversAmount && allowanceAmount > 0n;

  const tinyLiveCanary = queueItem.validationMode === "tiny_live_canary_only" || queueItem.metadata?.tinyLiveCanary === true;
  const executionReason = tinyLiveCanary ? "merkl_canary_autopilot" : "strategy_execution";

  let approveGas = null;
  if (!allowanceCoversAmount) {
    try {
      approveGas = await estimateGasImpl(
        chain,
        {
          from: senderAddress,
          to: assetAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [odosSwap.txTo, normalizedAmount]),
          valueWei: "0",
        },
        getEvmChainConfig(chain),
      );
    } catch {
      approveGas = { gasUnits: DEFAULT_APPROVE_GAS_UNITS };
    }
  }

  const swapIntent = buildIntent({
    strategyId,
    chain,
    amountUsd,
    now,
    ttlMs: strategyCaps.intentTtlMs,
    intentType: PENDLE_YT_ENTRY_INTENT_TYPE,
    executionReason,
    tx: {
      to: odosSwap.txTo,
      data: odosSwap.txData,
      value: odosSwap.txValueWei || "0",
      gasLimit: String(applyGasBuffer(Number(odosSwap.txGasLimit) || DEFAULT_SWAP_GAS_UNITS, buffer)),
    },
    metadata: {
      capCheckAmountUsd: capAmountUsd,
      exposureAction: "open",
      opportunityId: queueItem.opportunityId,
      protocol: queueItem.protocolId,
      ytTokenAddress,
      assetAddress,
      marketAddress: binding.marketAddress || null,
      tinyLiveCanary,
      expectedNetUsd: expectedGrossYieldUsd({ queueItem, amountUsd, now }),
      odosPathId: odosSwap.pathId,
      odosQuoteType: odosSwap.quoteType,
      approval: {
        token: assetAddress,
        spender: odosSwap.txTo,
        amount: normalizedAmount,
      },
    },
  });

  const parentEvVerdict = evGate(swapIntent, null, { now });
  const parentEvEvidence = parentEvVerdict.allow === true
    ? {
        allow: true,
        expectedNetUsd: parentEvVerdict.evidence?.expectedNetUsd ?? null,
        requiredNetUsd: parentEvVerdict.evidence?.requiredNetUsd ?? null,
      }
    : null;
  const parentApprovalMetadata = parentEvEvidence
    ? {
        parentIntent: swapIntent,
        parentIntentHash: stableHash(swapIntent),
        parentEvEvidence,
        parentEvEvidenceHash: stableHash(parentEvEvidence),
      }
    : {};

  const steps = [
    ...(allowanceNeedsZeroReset ? [{
      id: "reset_asset_allowance",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "approve_exact",
        approval: {
          token: assetAddress,
          spender: odosSwap.txTo,
          amount: "0",
          mode: "per_tx",
        },
        tx: {
          to: assetAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [odosSwap.txTo, "0"]),
          value: "0",
          gasLimit: gasLimitWithFallback(approveGas, DEFAULT_APPROVE_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: 0,
          opportunityId: queueItem.opportunityId,
          protocol: queueItem.protocolId,
          ytTokenAddress,
          assetAddress,
          tinyLiveCanary,
          ...parentApprovalMetadata,
          approvalResetReason: "existing_allowance_below_required_amount",
        },
      }),
    }] : []),
    ...(!allowanceCoversAmount ? [{
      id: "approve_asset_to_odos",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "approve_exact",
        approval: {
          token: assetAddress,
          spender: odosSwap.txTo,
          amount: normalizedAmount,
          mode: "per_tx",
        },
        tx: {
          to: assetAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [odosSwap.txTo, normalizedAmount]),
          value: "0",
          gasLimit: gasLimitWithFallback(approveGas, DEFAULT_APPROVE_GAS_UNITS, buffer),
        },
        metadata: {
          capCheckAmountUsd: 0,
          opportunityId: queueItem.opportunityId,
          protocol: queueItem.protocolId,
          ytTokenAddress,
          assetAddress,
          tinyLiveCanary,
          ...parentApprovalMetadata,
        },
      }),
    }] : []),
    {
      id: "swap_asset_to_yt",
      intent: swapIntent,
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
    tinyLiveCanary,
    executionReason,
    ytTokenAddress,
    assetAddress,
    marketAddress: binding.marketAddress || null,
    amount: normalizedAmount,
    amountUsd,
    asset: tokenAsset(chain, assetAddress, {
      ticker: binding.assetSymbol || tokenAsset(chain, assetAddress).ticker,
      family: "stablecoin",
      decimals: assetDecimals,
      priceKey: "usd_stable",
    }),
    shareAsset: tokenAsset(chain, ytTokenAddress, {
      ticker: binding.ytTokenSymbol || "PendleYT",
      family: "protocol_share",
      decimals: 18,
      priceKey: null,
    }),
    steps,
    allowanceBefore: allowanceBefore
      ? {
          allowance: BigInt(allowanceBefore.allowance ?? 0).toString(),
          rpcUrl: allowanceBefore.rpcUrl || null,
          skippedApproval: allowanceCoversAmount,
          resetBeforeApproval: allowanceNeedsZeroReset,
        }
      : null,
  };
}

function stableHash(obj) {
  try {
    return JSON.stringify(obj, Object.keys(obj).sort());
  } catch {
    return String(obj);
  }
}

export async function executePendleYtEntryPlan({
  plan,
  sendCommand = sendSignerCommand,
  readErc20BalanceImpl,
  readNativeBalanceImpl,
  socketPath,
  timeoutMs,
  awaitConfirmation = true,
  confirmations = 1,
  confirmationTimeoutMs = 120_000,
  settlementTimeoutMs = defaultSettlementTimeoutMs(0, { minimumMs: 60_000, extraSeconds: 0 }),
  pollIntervalMs = 5_000,
  sleepImpl = sleep,
  exitAfterProof = true,
} = {}) {
  if (!Array.isArray(plan?.steps) || !plan.steps.some((step) => step.id === "swap_asset_to_yt")) {
    throw new Error("Pendle YT entry plan must have a swap step");
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
    throw new Error(`Insufficient asset balance: required ${plan.amount}, got ${assetBalanceBefore.balance}`);
  }

  const txResults = [];
  for (const step of plan.steps) {
    const signerResult = await sendCommand({
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
    txResults.push({
      stepId: step.id,
      intentHash: stableHash(step.intent),
      ...signerResult,
    });
  }

  const swapResult = txResults.find((r) => r.stepId === "swap_asset_to_yt") || null;
  if (!swapResult || swapResult.error) {
    throw new Error(`Pendle YT swap failed: ${swapResult?.error?.message || "unknown"}`);
  }

  let shareProof = null;
  if (exitAfterProof) {
    shareProof = await waitForEvmAssetDelta({
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
  }

  return {
    status: "executed",
    planStatus: plan.planStatus,
    chain: plan.chain,
    strategyId: plan.strategyId,
    opportunityId: plan.opportunityId,
    txResults,
    swapTxHash: swapResult.txHash || null,
    positionProof: shareProof,
    assetBalanceBefore: assetBalanceBefore.balance.toString(),
    shareBalanceBefore: shareBalanceBefore.balance.toString(),
  };
}

export async function executePendleYtExit({
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
  if (position.bindingKind !== "pendle_yt_buy_sell_redeem") {
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
    ticker: "PendleYT",
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
    const error = new Error("No YT shares available to exit");
    error.name = "NoPositionShares";
    error.zeroShareProof = {
      status: "reconciled_zero_share_balance",
      proofSource: "erc20_balance_zero",
      shareBalance: shareBalanceBefore.balance || "0",
      assetBalance: assetBalanceBefore.balance || null,
      rpcUrl: shareBalanceBefore.rpcUrl || null,
      positionId: position.positionId,
    };
    throw error;
  }

  let odosSwap = null;
  try {
    odosSwap = await buildOdosSwapStep({
      chain: position.chain,
      inputToken: position.shareTokenAddress,
      outputToken: position.assetAddress,
      amount: shareAmount,
      senderAddress,
    });
  } catch (error) {
    throw new Error(`Odos swap unavailable for YT exit: ${error?.message || String(error)}`);
  }

  let allowanceBefore = null;
  try {
    allowanceBefore = await readErc20Allowance(position.chain, position.shareTokenAddress, senderAddress, odosSwap.txTo, {
      chainConfig: getEvmChainConfig(position.chain),
    });
  } catch {
    allowanceBefore = null;
  }
  const allowanceAmount = BigInt(allowanceBefore?.allowance ?? 0);
  const allowanceCoversAmount = allowanceAmount >= BigInt(shareAmount);
  const allowanceNeedsZeroReset = !allowanceCoversAmount && allowanceAmount > 0n;

  let approveGas = null;
  if (!allowanceCoversAmount) {
    try {
      approveGas = await estimateGasImpl(
        position.chain,
        {
          from: senderAddress,
          to: position.shareTokenAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [odosSwap.txTo, shareAmount]),
          valueWei: "0",
        },
        getEvmChainConfig(position.chain),
      );
    } catch {
      approveGas = { gasUnits: DEFAULT_APPROVE_GAS_UNITS };
    }
  }

  const strategyCaps = assertStrategyCaps(position.strategyId);
  const steps = [];

  if (allowanceNeedsZeroReset) {
    steps.push({
      id: "reset_yt_allowance",
      intent: buildIntent({
        strategyId: position.strategyId,
        chain: position.chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "approve_exact",
        executionReason: "risk_unwind",
        approval: {
          token: position.shareTokenAddress,
          spender: odosSwap.txTo,
          amount: "0",
          mode: "per_tx",
        },
        tx: {
          to: position.shareTokenAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [odosSwap.txTo, "0"]),
          value: "0",
          gasLimit: gasLimitWithFallback(approveGas, DEFAULT_APPROVE_GAS_UNITS),
        },
        metadata: {
          capCheckAmountUsd: 0,
          opportunityId: position.opportunityId,
          protocol: position.protocolId,
          positionId: position.positionId,
          approvalResetReason: "existing_allowance_below_required_amount",
        },
      }),
    });
  }

  if (!allowanceCoversAmount) {
    steps.push({
      id: "approve_yt_to_odos",
      intent: buildIntent({
        strategyId: position.strategyId,
        chain: position.chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "approve_exact",
        executionReason: "risk_unwind",
        approval: {
          token: position.shareTokenAddress,
          spender: odosSwap.txTo,
          amount: shareAmount,
          mode: "per_tx",
        },
        tx: {
          to: position.shareTokenAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [odosSwap.txTo, shareAmount]),
          value: "0",
          gasLimit: gasLimitWithFallback(approveGas, DEFAULT_APPROVE_GAS_UNITS),
        },
        metadata: {
          capCheckAmountUsd: 0,
          opportunityId: position.opportunityId,
          protocol: position.protocolId,
          positionId: position.positionId,
        },
      }),
    });
  }

  const swapIntent = buildIntent({
    strategyId: position.strategyId,
    chain: position.chain,
    amountUsd: 0,
    now,
    ttlMs: strategyCaps.intentTtlMs,
    intentType: PENDLE_YT_EXIT_INTENT_TYPE,
    executionReason: "risk_unwind",
    tx: {
      to: odosSwap.txTo,
      data: odosSwap.txData,
      value: odosSwap.txValueWei || "0",
      gasLimit: String(applyGasBuffer(Number(odosSwap.txGasLimit) || DEFAULT_SWAP_GAS_UNITS, DEFAULT_GATEWAY_GAS_BUFFER_BPS)),
    },
    metadata: {
      capCheckAmountUsd: 0,
      opportunityId: position.opportunityId,
      protocol: position.protocolId,
      positionId: position.positionId,
      ytTokenAddress: position.shareTokenAddress,
      assetAddress: position.assetAddress,
      shareDelta: shareAmount,
      odosPathId: odosSwap.pathId,
    },
  });

  try {
    const gas = await estimateGasImpl(
      position.chain,
      {
        from: senderAddress,
        to: odosSwap.txTo,
        data: odosSwap.txData,
        valueWei: odosSwap.txValueWei || "0",
      },
      getEvmChainConfig(position.chain),
    );
    swapIntent.tx.gasLimit = gasLimitWithFallback(gas, DEFAULT_SWAP_GAS_UNITS);
  } catch {
    swapIntent.tx.gasLimit = gasLimitWithFallback(null, DEFAULT_SWAP_GAS_UNITS);
  }

  steps.push({
    id: "swap_yt_to_asset",
    intent: swapIntent,
  });

  const txResults = [];
  for (const step of steps) {
    const signerResult = await sendCommand({
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
    txResults.push({
      stepId: step.id,
      intentHash: stableHash(step.intent),
      ...signerResult,
    });
  }

  const swapResult = txResults.find((r) => r.stepId === "swap_yt_to_asset") || null;
  if (!swapResult || swapResult.error) {
    throw new Error(`Pendle YT exit swap failed: ${swapResult?.error?.message || "unknown"}`);
  }

  const assetProof = await waitForEvmAssetDelta({
    asset,
    owner: senderAddress,
    initialBalance: assetBalanceBefore,
    requiredDelta: "1",
    readErc20BalanceImpl,
    readNativeBalanceImpl,
    timeoutMs: settlementTimeoutMs,
    pollIntervalMs,
    sleepImpl,
  });

  return {
    status: "executed",
    txHash: swapResult.txHash || null,
    txResults,
    assetProof,
    shareAmount,
    assetBalanceBefore: assetBalanceBefore.balance.toString(),
    shareBalanceBefore: shareBalanceBefore.balance.toString(),
  };
}

export function registerPendleBinding() {
  registerBinding({
    bindingKind: "pendle_yt_buy_sell_redeem",
    planBuilder: buildPendleYtEntryPlan,
    planExecutor: executePendleYtEntryPlan,
    exitExecutor: executePendleYtExit,
    intentType: "pendle_yt_entry",
    family: "pendle_yt",
  });
}
