import { createHash } from "node:crypto";
import { Interface } from "ethers";
import { registerBinding, resolveExitExecutor } from "../../../../executor/protocol-binding-registry.mjs";
import { tokenAsset } from "../../../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../../../config/chains.mjs";
import { assertStrategyCaps } from "../../../../config/strategy-caps.mjs";
import { stableSerialize } from "../../../../execution/journal.mjs";
import { estimateGas } from "../../../../gas/rpc-gas.mjs";
import { sendSignerCommand } from "../../../../executor/signer/client.mjs";
import { readErc20Allowance } from "../../../../evm/account-state.mjs";
import {
  applyGasBuffer,
  DEFAULT_GATEWAY_GAS_BUFFER_BPS,
} from "../../../../executor/helpers/gateway-btc-consolidation.mjs";
import {
  defaultSettlementTimeoutMs,
  readEvmAssetBalance,
  sleep,
  waitForEvmAssetDelta,
} from "../../../../executor/helpers/settlement-proof.mjs";
import { OdosClient, normalizeOdosQuote, attachOdosAssembly, odosRoutingConfig } from "../../../../dex/odos.mjs";
import { evGate } from "../../../../executor/policy/ev-gate.mjs";

const ERC20_INTERFACE = new Interface(["function approve(address spender,uint256 amount) returns (bool)"]);

const DEFAULT_SWAP_GAS_UNITS = 650_000;
const DEFAULT_APPROVE_GAS_UNITS = 80_000;
const PENDLE_YT_ENTRY_INTENT_TYPE = "pendle_yt_entry";
const PENDLE_YT_EXIT_INTENT_TYPE = "pendle_yt_exit";
const PENDLE_API_BASE = "https://api-v2.pendle.finance/core";

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

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeAddress(value) {
  const lower = String(value || "")
    .trim()
    .toLowerCase();
  return lower.startsWith("0x") && lower.length === 42 ? lower : null;
}

function sameAddress(left, right) {
  const l = normalizeAddress(left);
  const r = normalizeAddress(right);
  return Boolean(l && r && l === r);
}

function gasLimitWithFallback(gas, fallbackUnits, gasBufferBps = DEFAULT_GATEWAY_GAS_BUFFER_BPS) {
  const units = Number(gas?.gasUnits);
  const baseUnits = Number.isFinite(units) && units > 0 ? Math.ceil(units) : fallbackUnits;
  return String(applyGasBuffer(baseUnits, gasBufferBps));
}

function buildIntent({
  strategyId,
  chain,
  amountUsd,
  now,
  ttlMs,
  intentType,
  tx,
  approval = null,
  metadata = {},
  executionReason = "strategy_execution",
}) {
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
  if (Number.isFinite(campaignRemainingHours) && campaignRemainingHours > 0)
    return Math.max(1, campaignRemainingHours / 24);
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

function firstPendleRoute(convert = {}) {
  return Array.isArray(convert.routes) ? convert.routes.find((route) => route?.tx?.to && route?.tx?.data) : null;
}

function pendleApprovalForToken(convert = {}, token) {
  const approvals = [
    ...(Array.isArray(convert.requiredApprovals) ? convert.requiredApprovals : []),
    ...(Array.isArray(convert.tokenApprovals) ? convert.tokenApprovals : []),
  ];
  return approvals.find((approval) => sameAddress(approval?.token, token)) || null;
}

export async function fetchPendleConvert({
  chain,
  marketAddress,
  inputToken,
  outputToken,
  amount,
  receiver,
  slippage = 0.005,
  fetchImpl = globalThis.fetch,
} = {}) {
  const chainConfig = getEvmChainConfig(chain);
  if (!chainConfig?.chainId) throw new Error(`Unsupported Pendle SDK chain: ${chain}`);
  if (!marketAddress) throw new Error("marketAddress is required for Pendle SDK convert");
  if (!inputToken) throw new Error("inputToken is required for Pendle SDK convert");
  if (!outputToken) throw new Error("outputToken is required for Pendle SDK convert");
  if (!amount) throw new Error("amount is required for Pendle SDK convert");
  if (!receiver) throw new Error("receiver is required for Pendle SDK convert");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is unavailable");

  const body = {
    receiver,
    slippage,
    enableAggregator: !sameAddress(inputToken, outputToken),
    inputs: [{ token: inputToken, amount: String(amount) }],
    outputs: [outputToken],
    additionalData: "impliedApy,effectiveApy",
    useLimitOrder: true,
  };
  const response = await fetchImpl(`${PENDLE_API_BASE}/v3/sdk/${chainConfig.chainId}/convert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response?.ok) {
    let message = response?.status ? `status=${response.status}` : "request_failed";
    try {
      const text = await response.text();
      if (text) message = `${message} ${text.slice(0, 500)}`;
    } catch {
      // keep status-only message
    }
    throw new Error(message);
  }
  const result = await response.json();
  const route = firstPendleRoute(result);
  if (!route) throw new Error("Pendle SDK convert returned no transaction route");
  return {
    ...result,
    selectedRoute: route,
    request: {
      chain,
      chainId: chainConfig.chainId,
      marketAddress,
      inputToken,
      outputToken,
      amount: String(amount),
      receiver,
      slippage,
    },
  };
}

export async function buildPendleYtEntryPlan({
  queueItem,
  senderAddress,
  amount,
  strategyId = queueItem?.mappedStrategyId || "pendle-yt-canary",
  estimateGasImpl = estimateGas,
  readErc20AllowanceImpl = readErc20Allowance,
  fetchPendleConvertImpl = fetchPendleConvert,
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
  const inputTokenAddress = queueItem.executionReadiness?.matchedToken?.token || assetAddress;

  if (!ytTokenAddress) throw new Error("ytTokenAddress is required in binding");
  if (!assetAddress) throw new Error("assetAddress is required in binding");
  if (!inputTokenAddress) throw new Error("inputTokenAddress is required for Pendle entry");

  const normalizedAmount = toPositiveIntegerString(amount, "amount");
  const assetDecimals = Number.isInteger(binding.assetDecimals)
    ? binding.assetDecimals
    : tokenAsset(chain, assetAddress).decimals;
  const inputAssetMeta = tokenAsset(chain, inputTokenAddress);
  const inputDecimals = Number.isInteger(inputAssetMeta.decimals) ? inputAssetMeta.decimals : assetDecimals;
  const amountUsd =
    finite(queueItem.executionReadiness?.matchedToken?.estimatedUsd) != null
      ? (amountUsdFromUnits(normalizedAmount, inputDecimals) ?? 0)
      : (amountUsdFromUnits(normalizedAmount, inputDecimals) ?? 0);
  const capAmountUsd = amountUsd;
  const buffer = Math.max(10_000, Number(gasBufferBps) || DEFAULT_GATEWAY_GAS_BUFFER_BPS);

  let pendleConvert = null;
  let route = null;
  try {
    pendleConvert = await fetchPendleConvertImpl({
      chain,
      marketAddress: binding.marketAddress,
      inputToken: inputTokenAddress,
      outputToken: ytTokenAddress,
      amount: normalizedAmount,
      receiver: senderAddress,
    });
    route = pendleConvert.selectedRoute || firstPendleRoute(pendleConvert);
  } catch (error) {
    return {
      schemaVersion: 1,
      planStatus: "blocked",
      blockedReason: `pendle_sdk_convert_unavailable: ${error?.message || String(error)}`,
      strategyId,
      chain,
      senderAddress,
      opportunityId: queueItem.opportunityId,
      protocolId: queueItem.protocolId,
      bindingKind: queueItem.protocolBindingPlan?.bindingKind || null,
      name: queueItem.name,
      amount: normalizedAmount,
      amountUsd,
      assetAddress,
      inputTokenAddress,
    };
  }
  if (!route?.tx?.to || !route?.tx?.data) {
    return {
      schemaVersion: 1,
      planStatus: "blocked",
      blockedReason: "pendle_sdk_convert_missing_tx",
      strategyId,
      chain,
      senderAddress,
      opportunityId: queueItem.opportunityId,
      protocolId: queueItem.protocolId,
      bindingKind: queueItem.protocolBindingPlan?.bindingKind || null,
      name: queueItem.name,
      amount: normalizedAmount,
      amountUsd,
      assetAddress,
      inputTokenAddress,
    };
  }
  const tx = route.tx;
  const spender = tx.to;
  const requiredApproval = pendleApprovalForToken(pendleConvert, inputTokenAddress);
  const approvalAmount = toPositiveIntegerString(requiredApproval?.amount || normalizedAmount, "approvalAmount");

  let allowanceBefore = null;
  try {
    allowanceBefore = await readErc20AllowanceImpl(chain, inputTokenAddress, senderAddress, spender, {
      chainConfig: getEvmChainConfig(chain),
    });
  } catch {
    allowanceBefore = null;
  }
  const allowanceAmount = BigInt(allowanceBefore?.allowance ?? 0);
  const allowanceCoversAmount = allowanceAmount >= BigInt(approvalAmount);
  const allowanceNeedsZeroReset = !allowanceCoversAmount && allowanceAmount > 0n;

  const tinyLiveCanary =
    queueItem.validationMode === "tiny_live_canary_only" || queueItem.metadata?.tinyLiveCanary === true;
  const executionReason = tinyLiveCanary ? "merkl_canary_autopilot" : "strategy_execution";

  let approveGas = null;
  if (!allowanceCoversAmount) {
    try {
      approveGas = await estimateGasImpl(
        chain,
        {
          from: senderAddress,
          to: inputTokenAddress,
          data: ERC20_INTERFACE.encodeFunctionData("approve", [spender, approvalAmount]),
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
      to: tx.to,
      data: tx.data,
      value: tx.value || "0",
      gasLimit: String(applyGasBuffer(Number(tx.gas || tx.gasLimit) || DEFAULT_SWAP_GAS_UNITS, buffer)),
    },
    metadata: {
      capCheckAmountUsd: capAmountUsd,
      exposureAction: "open",
      opportunityId: queueItem.opportunityId,
      protocol: queueItem.protocolId,
      pendleMarketAddress: binding.marketAddress || null,
      ytTokenAddress,
      assetAddress,
      inputTokenAddress,
      marketAddress: binding.marketAddress || null,
      tinyLiveCanary,
      expectedNetUsd: expectedGrossYieldUsd({ queueItem, amountUsd, now }),
      pendleSdkAction: pendleConvert.action || null,
      pendleSdkRouteCount: Array.isArray(pendleConvert.routes) ? pendleConvert.routes.length : null,
      approval: {
        token: inputTokenAddress,
        spender,
        amount: approvalAmount,
      },
    },
  });

  const parentEvVerdict = evGate(swapIntent, null, { now });
  const parentEvEvidence =
    parentEvVerdict.allow === true
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
    ...(allowanceNeedsZeroReset
      ? [
          {
            id: "reset_asset_allowance",
            intent: buildIntent({
              strategyId,
              chain,
              amountUsd: 0,
              now,
              ttlMs: strategyCaps.intentTtlMs,
              intentType: "approve_exact",
              approval: {
                token: inputTokenAddress,
                spender,
                amount: "0",
                mode: "per_tx",
              },
              tx: {
                to: inputTokenAddress,
                data: ERC20_INTERFACE.encodeFunctionData("approve", [spender, "0"]),
                value: "0",
                gasLimit: gasLimitWithFallback(approveGas, DEFAULT_APPROVE_GAS_UNITS, buffer),
              },
              metadata: {
                capCheckAmountUsd: 0,
                opportunityId: queueItem.opportunityId,
                protocol: queueItem.protocolId,
                pendleMarketAddress: binding.marketAddress || null,
                ytTokenAddress,
                assetAddress,
                inputTokenAddress,
                tinyLiveCanary,
                ...parentApprovalMetadata,
                approvalResetReason: "existing_allowance_below_required_amount",
              },
            }),
          },
        ]
      : []),
    ...(!allowanceCoversAmount
      ? [
          {
            id: "approve_asset_to_pendle_router",
            intent: buildIntent({
              strategyId,
              chain,
              amountUsd: 0,
              now,
              ttlMs: strategyCaps.intentTtlMs,
              intentType: "approve_exact",
              approval: {
                token: inputTokenAddress,
                spender,
                amount: approvalAmount,
                mode: "per_tx",
              },
              tx: {
                to: inputTokenAddress,
                data: ERC20_INTERFACE.encodeFunctionData("approve", [spender, approvalAmount]),
                value: "0",
                gasLimit: gasLimitWithFallback(approveGas, DEFAULT_APPROVE_GAS_UNITS, buffer),
              },
              metadata: {
                capCheckAmountUsd: 0,
                opportunityId: queueItem.opportunityId,
                protocol: queueItem.protocolId,
                pendleMarketAddress: binding.marketAddress || null,
                ytTokenAddress,
                assetAddress,
                inputTokenAddress,
                tinyLiveCanary,
                ...parentApprovalMetadata,
              },
            }),
          },
        ]
      : []),
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
    entryPlanner: "pendle_hosted_sdk_convert_v3",
    tinyLiveCanary,
    executionReason,
    ytTokenAddress,
    assetAddress,
    inputTokenAddress,
    marketAddress: binding.marketAddress || null,
    amount: normalizedAmount,
    amountUsd,
    asset: tokenAsset(chain, inputTokenAddress, {
      ticker: queueItem.executionReadiness?.matchedToken?.ticker || inputAssetMeta.ticker,
      family: inputAssetMeta.family || "stablecoin",
      decimals: inputDecimals,
      priceKey: inputAssetMeta.priceKey || (inputAssetMeta.family === "stablecoin" ? "usd_stable" : null),
    }),
    underlyingAsset: tokenAsset(chain, assetAddress, {
      ticker: binding.assetSymbol || tokenAsset(chain, assetAddress).ticker,
      family: tokenAsset(chain, assetAddress).family || "stablecoin",
      decimals: assetDecimals,
      priceKey:
        tokenAsset(chain, assetAddress).priceKey ||
        (tokenAsset(chain, assetAddress).family === "stablecoin" ? "usd_stable" : null),
    }),
    shareAsset: tokenAsset(chain, ytTokenAddress, {
      ticker: binding.ytTokenSymbol || "PendleYT",
      family: "protocol_share",
      decimals: Number.isInteger(binding.assetDecimals)
        ? binding.assetDecimals
        : tokenAsset(chain, ytTokenAddress).decimals,
      priceKey: null,
    }),
    steps,
    allowanceBefore: allowanceBefore
      ? {
          allowance: BigInt(allowanceBefore.allowance ?? 0).toString(),
          rpcUrl: allowanceBefore.rpcUrl || null,
          skippedApproval: allowanceCoversAmount,
          resetBeforeApproval: allowanceNeedsZeroReset,
          spender,
        }
      : null,
    pendleConvert: {
      action: pendleConvert.action || null,
      output: route.outputs?.[0] || null,
      priceImpact: finite(route.data?.priceImpact),
      effectiveApy: finite(route.data?.effectiveApy),
      impliedApy: route.data?.impliedApy ?? null,
    },
  };
}

function stableHash(obj) {
  return createHash("sha256").update(stableSerialize(obj)).digest("hex");
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
    if (signerResult?.status !== "ok" || signerResult?.error || !signerResult?.broadcast?.txHash) {
      const error = new Error(
        `${step.id} failed: ${signerResult?.error?.message || signerResult?.status || "signer did not broadcast"}`,
      );
      error.name = signerResult?.error?.name || "SignerExecutionFailed";
      error.stepId = step.id;
      error.signerResult = signerResult;
      error.stepResults = txResults;
      throw error;
    }
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
    settlementStatus: shareProof?.status === "delivered" ? "delivered" : "share_delta_timeout",
    planStatus: plan.planStatus,
    chain: plan.chain,
    strategyId: plan.strategyId,
    opportunityId: plan.opportunityId,
    txResults,
    swapTxHash: swapResult.txHash || swapResult.broadcast?.txHash || null,
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
  const exitAssetDecimals = Number.isInteger(position.assetDecimals)
    ? position.assetDecimals
    : tokenAsset(position.chain, position.assetAddress).decimals;
  const exitAssetTicker = position.assetSymbol || tokenAsset(position.chain, position.assetAddress).ticker || "USDC";
  const exitAssetFamily =
    position.assetFamily || tokenAsset(position.chain, position.assetAddress).family || "stablecoin";
  const asset = tokenAsset(position.chain, position.assetAddress, {
    ticker: exitAssetTicker,
    family: exitAssetFamily,
    decimals: exitAssetDecimals,
    priceKey: exitAssetFamily === "stablecoin" ? "usd_stable" : null,
  });
  const shareDecimals = Number.isInteger(position.shareDecimals) ? position.shareDecimals : exitAssetDecimals;
  const shareAsset = tokenAsset(position.chain, position.shareTokenAddress, {
    ticker: position.shareTokenSymbol || "PendleYT",
    family: "protocol_share",
    decimals: shareDecimals,
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
  const shareAmount = (
    recordedShares > 0n && recordedShares < currentShares ? recordedShares : currentShares
  ).toString();

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
    allowanceBefore = await readErc20Allowance(
      position.chain,
      position.shareTokenAddress,
      senderAddress,
      odosSwap.txTo,
      {
        chainConfig: getEvmChainConfig(position.chain),
      },
    );
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

  const exitAmountUsd = finite(position.amountUsd) ?? finite(position.entryAmountUsd) ?? 0;
  const swapIntent = buildIntent({
    strategyId: position.strategyId,
    chain: position.chain,
    amountUsd: exitAmountUsd,
    now,
    ttlMs: strategyCaps.intentTtlMs,
    intentType: PENDLE_YT_EXIT_INTENT_TYPE,
    executionReason: "risk_unwind",
    tx: {
      to: odosSwap.txTo,
      data: odosSwap.txData,
      value: odosSwap.txValueWei || "0",
      gasLimit: String(
        applyGasBuffer(Number(odosSwap.txGasLimit) || DEFAULT_SWAP_GAS_UNITS, DEFAULT_GATEWAY_GAS_BUFFER_BPS),
      ),
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
