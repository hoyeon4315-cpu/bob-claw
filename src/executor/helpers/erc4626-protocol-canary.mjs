import { createHash } from "node:crypto";
import { Interface } from "ethers";
import { tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { config } from "../../config/env.mjs";
import { assertStrategyCaps } from "../../config/strategy-caps.mjs";
import {
  resolveTinyCanaryExpectedHoldDays,
  tinyCanarySameChainRoundTripCostUsd,
} from "../../config/sizing.mjs";
import { stableSerialize } from "../../execution/journal.mjs";
import { estimateGas } from "../../gas/rpc-gas.mjs";
import { readErc20Allowance } from "../../evm/account-state.mjs";
import { appendExecutionReceiptReconciliation } from "../ingestor/execution-receipt-ingest.mjs";
import { evGate } from "../policy/ev-gate.mjs";
import { sendSignerCommand } from "../signer/client.mjs";
import { applyMerklCanaryExecutionReadiness } from "../../strategy/merkl-canary-execution-readiness.mjs";
import { applyGasBuffer, DEFAULT_GATEWAY_GAS_BUFFER_BPS } from "./gateway-btc-consolidation.mjs";
import { defaultSettlementTimeoutMs, readEvmAssetBalance, sleep, waitForEvmAssetDelta } from "./settlement-proof.mjs";

export const ERC4626_PROTOCOL_CANARY_STRATEGY_ID = "gateway_native_asset_conversion_sleeve";
const ERC4626_LIKE_BINDING_KINDS = new Set(["erc4626_vault_supply_withdraw", "euler_evault_deposit_withdraw"]);

const ERC20_INTERFACE = new Interface([
  "function approve(address spender,uint256 amount)",
]);

const ERC4626_INTERFACE = new Interface([
  "function deposit(uint256 assets,address receiver) returns (uint256 shares)",
  "function redeem(uint256 shares,address receiver,address owner) returns (uint256 assets)",
]);

const DEFAULT_DEPOSIT_GAS_UNITS = 420_000;
const DEFAULT_REDEEM_GAS_UNITS = 260_000;

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

function signerFailureError(result, fallbackMessage) {
  if (result?.status === "rejected") {
    return {
      name: "SignerRejected",
      message: (result?.policy?.blockers || []).join(",") || fallbackMessage,
      policy: result?.policy || null,
      notification: result?.notification || null,
      requiresUnwind: result?.requiresUnwind || false,
      emergencyUnwindPath: result?.emergencyUnwindPath || null,
    };
  }
  return result?.error || {
    name: "SignerExecutionFailed",
    message: fallbackMessage,
  };
}

function signerFailureExecution({
  plan,
  step,
  result,
  stepResults,
  assetBalanceBefore,
  shareBalanceBefore,
  fallbackMessage,
}) {
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    settlementStatus: result?.status === "rejected" ? "signer_rejected" : "failed",
    plan,
    signerResult: result,
    stepResults: [...stepResults, { id: step.id, signerResult: result }],
    assetBalanceBefore,
    shareBalanceBefore,
    error: signerFailureError(result, fallbackMessage),
  };
}

function stableHash(value = {}) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function displayedAprPct(queueItem = {}) {
  const value = queueItem.effectiveAprPct ?? queueItem.displayedAprPct ?? queueItem.aprPct ?? queueItem.apr ?? queueItem.apy;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

export function selectErc4626QueueItem(
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
    return ERC4626_LIKE_BINDING_KINDS.has(item.protocolBindingPlan?.bindingKind || "") &&
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

export async function buildErc4626ProtocolCanaryPlan({
  queueItem,
  senderAddress,
  amount,
  strategyId = queueItem?.mappedStrategyId || ERC4626_PROTOCOL_CANARY_STRATEGY_ID,
  estimateGasImpl = estimateGas,
  readErc20AllowanceImpl = readErc20Allowance,
  gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS,
  minimumReturnBps = 9_500,
  assetCoverage = null,
  now = new Date().toISOString(),
} = {}) {
  if (!queueItem) throw new Error("queueItem is required");
  if (!senderAddress) throw new Error("senderAddress is required");
  if (!getEvmChainConfig(queueItem.chain)) throw new Error(`Unsupported EVM chain: ${queueItem.chain}`);

  const strategyCaps = assertStrategyCaps(strategyId);
  const binding = queueItem.protocolBindingPlan?.resolvedBinding || {};
  const chain = queueItem.chain;
  const vaultAddress = assertAddress(binding.vaultAddress, "vaultAddress");
  const assetAddress = assertAddress(binding.assetAddress, "assetAddress");
  const shareTokenAddress = assertAddress(binding.shareTokenAddress || vaultAddress, "shareTokenAddress");
  const normalizedAmount = toPositiveIntegerString(amount, "amount");
  const assetDecimals = Number.isInteger(binding.assetDecimals) ? binding.assetDecimals : tokenAsset(chain, assetAddress).decimals;
  const amountUsd = amountUsdFromUnits(normalizedAmount, assetDecimals) ?? 0;
  const capAmountUsd = amountUsd;
  const buffer = Math.max(10_000, Number(gasBufferBps) || DEFAULT_GATEWAY_GAS_BUFFER_BPS);
  let allowanceBefore = null;
  try {
    allowanceBefore = await readErc20AllowanceImpl(chain, assetAddress, senderAddress, vaultAddress, {
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
  const estimatedGasCostUsd = tinyLiveCanary
    ? tinyCanarySameChainRoundTripCostUsd({ chain, estimatedGasCostUsd: queueItem.estimatedGasCostUsd })
    : queueItem.estimatedGasCostUsd ?? null;

  let approveGas = null;
  if (!allowanceCoversAmount) {
    try {
      approveGas = await estimateGasImpl(
        chain,
        {
          from: senderAddress,
          to: assetAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [vaultAddress, normalizedAmount]),
          valueWei: "0",
        },
        getEvmChainConfig(chain),
      );
    } catch {
      approveGas = { gasUnits: 80_000 };
    }
  }

  const depositData = ERC4626_INTERFACE.encodeFunctionData("deposit", [normalizedAmount, senderAddress]);
  const depositIntent = buildIntent({
    strategyId,
    chain,
    amountUsd,
    now,
    ttlMs: strategyCaps.intentTtlMs,
    intentType: "erc4626_deposit",
    executionReason,
    tx: {
      to: vaultAddress,
      data: depositData,
      value: "0",
      gasLimit: String(applyGasBuffer(DEFAULT_DEPOSIT_GAS_UNITS, buffer)),
    },
    metadata: {
      capCheckAmountUsd: capAmountUsd,
      exposureAction: "open",
      ...(assetCoverage ? { assetCoverage } : {}),
      opportunityId: queueItem.opportunityId,
      protocol: queueItem.protocolId,
      vaultAddress,
      assetAddress,
      shareTokenAddress,
      tinyLiveCanary,
      expectedNetUsd: expectedGrossYieldUsd({ queueItem, amountUsd, now }),
      estimatedGasCostUsd,
      approval: {
        token: assetAddress,
        spender: vaultAddress,
        amount: normalizedAmount,
      },
    },
  });
  const parentEvVerdict = evGate(depositIntent, null, { now });
  const parentEvEvidence = parentEvVerdict.allow === true
    ? {
        allow: true,
        expectedNetUsd: parentEvVerdict.evidence?.expectedNetUsd ?? null,
        requiredNetUsd: parentEvVerdict.evidence?.requiredNetUsd ?? null,
      }
    : null;
  const parentApprovalMetadata = parentEvEvidence
    ? {
        parentIntent: depositIntent,
        parentIntentHash: stableHash(depositIntent),
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
          spender: vaultAddress,
          amount: "0",
          mode: "per_tx",
        },
        tx: {
          to: assetAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [vaultAddress, "0"]),
          value: "0",
          gasLimit: gasLimitWithFallback(approveGas, 80_000, buffer),
        },
        metadata: {
          capCheckAmountUsd: 0,
          opportunityId: queueItem.opportunityId,
          protocol: queueItem.protocolId,
          vaultAddress,
          assetAddress,
          tinyLiveCanary,
          ...parentApprovalMetadata,
          approvalResetReason: "existing_allowance_below_required_amount",
        },
      }),
    }] : []),
    ...(!allowanceCoversAmount ? [{
      id: "approve_asset_to_vault",
      intent: buildIntent({
        strategyId,
        chain,
        amountUsd: 0,
        now,
        ttlMs: strategyCaps.intentTtlMs,
        intentType: "approve_exact",
        approval: {
          token: assetAddress,
          spender: vaultAddress,
          amount: normalizedAmount,
          mode: "per_tx",
        },
        tx: {
          to: assetAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [vaultAddress, normalizedAmount]),
          value: "0",
          gasLimit: gasLimitWithFallback(approveGas, 80_000, buffer),
        },
        metadata: {
          capCheckAmountUsd: 0,
          opportunityId: queueItem.opportunityId,
          protocol: queueItem.protocolId,
          vaultAddress,
          assetAddress,
          tinyLiveCanary,
          ...parentApprovalMetadata,
        },
      }),
    }] : []),
    {
      id: "deposit_asset_to_vault",
      intent: depositIntent,
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
    vaultAddress,
    assetAddress,
    shareTokenAddress,
    amount: normalizedAmount,
    amountUsd,
    minimumReturnBps,
    minimumRedeemAssetDelta: minimumRedeemDelta(normalizedAmount, minimumReturnBps),
    asset: tokenAsset(chain, assetAddress, {
      ticker: binding.assetSymbol || tokenAsset(chain, assetAddress).ticker,
      family: "stablecoin",
      decimals: assetDecimals,
      priceKey: "usd_stable",
    }),
    shareAsset: tokenAsset(chain, shareTokenAddress, {
      ticker: binding.shareTokenSymbol || "VaultShare",
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

export async function executeErc4626ProtocolCanaryPlan({
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
  exitAfterProof = true,
} = {}) {
  if (!Array.isArray(plan?.steps) || !plan.steps.some((step) => step.id === "deposit_asset_to_vault")) {
    throw new Error("ERC4626 protocol canary plan must have a deposit step");
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
    if (step.id === "deposit_asset_to_vault") {
      let depositGas = null;
      try {
        depositGas = await estimateGasImpl(
          plan.chain,
          {
            from: plan.senderAddress,
            to: plan.vaultAddress,
            data: step.intent.tx.data,
            valueWei: "0",
          },
          getEvmChainConfig(plan.chain),
        );
      } catch {
        depositGas = { gasUnits: DEFAULT_DEPOSIT_GAS_UNITS };
      }
      step.intent.tx.gasLimit = gasLimitWithFallback(depositGas, DEFAULT_DEPOSIT_GAS_UNITS, DEFAULT_GATEWAY_GAS_BUFFER_BPS);
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
      return signerFailureExecution({
        plan,
        step,
        result,
        stepResults,
        assetBalanceBefore,
        shareBalanceBefore,
        fallbackMessage: `Signer did not complete ${step.id}`,
      });
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

  if (!exitAfterProof) {
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
    const shareDelta = (BigInt(shareProof.settledBalance) - BigInt(shareBalanceBefore.balance ?? 0)).toString();
    return {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      settlementStatus: "position_opened",
      plan,
      stepResults,
      assetBalanceBefore,
      assetBalanceAfter,
      shareBalanceBefore,
      shareBalanceAfter,
      shareProof,
      positionProof: {
        status: "delivered",
        proofSource: shareProof.proofSource,
        observedDelta: shareDelta,
        requiredDelta: "1",
      },
      destinationProof: {
        status: "delivered",
        proofSource: shareProof.proofSource,
        observedDelta: shareDelta,
        requiredDelta: "1",
      },
    };
  }

  const shareDelta = (BigInt(shareProof.settledBalance) - BigInt(shareBalanceBefore.balance ?? 0)).toString();
  let redeemGas = null;
  try {
    redeemGas = await estimateGasImpl(
      plan.chain,
      {
        from: plan.senderAddress,
        to: plan.vaultAddress,
        data: ERC4626_INTERFACE.encodeFunctionData("redeem", [shareDelta, plan.senderAddress, plan.senderAddress]),
        valueWei: "0",
      },
      getEvmChainConfig(plan.chain),
    );
  } catch {
    redeemGas = { gasUnits: DEFAULT_REDEEM_GAS_UNITS };
  }

  const redeemIntent = buildIntent({
    strategyId: plan.strategyId,
    chain: plan.chain,
    amountUsd: 0,
    now: new Date().toISOString(),
    ttlMs: assertStrategyCaps(plan.strategyId).intentTtlMs,
    intentType: "erc4626_redeem",
    tx: {
      to: plan.vaultAddress,
      data: ERC4626_INTERFACE.encodeFunctionData("redeem", [shareDelta, plan.senderAddress, plan.senderAddress]),
      value: "0",
      gasLimit: gasLimitWithFallback(redeemGas, DEFAULT_REDEEM_GAS_UNITS, DEFAULT_GATEWAY_GAS_BUFFER_BPS),
    },
    metadata: {
      capCheckAmountUsd: 0,
      opportunityId: plan.opportunityId,
      protocol: plan.protocolId,
      vaultAddress: plan.vaultAddress,
      assetAddress: plan.assetAddress,
      shareTokenAddress: plan.shareTokenAddress,
      shareDelta,
    },
  });

  const redeemResult = await sendCommand({
    socketPath,
    timeoutMs,
    message: {
      command: "sign_and_broadcast",
      intent: redeemIntent,
      awaitConfirmation,
      confirmations,
      timeoutMs: confirmationTimeoutMs,
    },
  });
  if (redeemResult?.status !== "ok" || !redeemResult?.broadcast?.txHash) {
    return signerFailureExecution({
      plan,
      step: { id: "redeem_shares_from_vault" },
      result: redeemResult,
      stepResults,
      assetBalanceBefore,
      shareBalanceBefore,
      fallbackMessage: "Signer did not complete erc4626_redeem",
    });
  }
  stepResults.push({ id: "redeem_shares_from_vault", signerResult: redeemResult });

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
