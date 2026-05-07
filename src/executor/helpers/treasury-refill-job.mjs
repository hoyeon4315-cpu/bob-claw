import { WBTC_OFT_TOKEN, ZERO_TOKEN, gatewayBtcSettlementTokenForChain, isBtcLikeAsset, tokenAsset } from "../../assets/tokens.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { readNativeBalance } from "../../evm/account-state.mjs";
import {
  buildGatewayBtcConsolidationPlan,
  executeGatewayBtcConsolidationPlan,
} from "./gateway-btc-consolidation.mjs";
import {
  buildGasZipNativeRefuelPlan,
  executeGasZipNativeRefuelPlan,
} from "./gas-zip-refuel.mjs";
import { buildGatewayBtcOnrampPlan, executeGatewayBtcOnrampPlan } from "./gateway-btc-onramp.mjs";
import { buildNativeDexExperimentPlan, executeNativeDexExperimentPlan } from "./native-dex-experiment.mjs";
import {
  TOKEN_DEX_EXPERIMENT_STRATEGY_ID,
  buildTokenDexExperimentPlan,
  executeTokenDexExperimentPlan,
} from "./token-dex-experiment.mjs";
import { buildAcrossBridgePlan, executeAcrossBridgePlan } from "./across-bridge.mjs";
import { acrossTickerForToken } from "../../config/across.mjs";
import { buildLifiBridgePlan, executeLifiBridgePlan } from "./lifi-bridge.mjs";
import { evaluateBridgeMovementCostGuard, isStrategyRealizedPnlMovement } from "../../treasury/discretionary-budget-guard.mjs";

const INPUT_BUFFER_MULTIPLIER = 1.1;
const GAS_ZIP_INPUT_BUFFER_MULTIPLIER = 1.04;
const GATEWAY_BTC_ONRAMP_MIN_SATS = 5000n;
const PARTIAL_REFILL_MIN_COVERAGE_BPS = 8500n;
const NATIVE_GAS_REFILL_STRATEGY_ID = "native-gas-refill";
const PREFERRED_STABLE_TOKEN_BY_CHAIN = Object.freeze({
  avalanche: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  bsc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  sonic: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
  unichain: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
});

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function positiveBigInt(value) {
  try {
    const parsed = BigInt(value ?? 0);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function normalizedToken(value) {
  return String(value || "").toLowerCase();
}

function preferredStableTokenForChain(chain) {
  return PREFERRED_STABLE_TOKEN_BY_CHAIN[String(chain || "").toLowerCase()] || null;
}

function ceilUnitsFromDecimalAmount(amountDecimal, decimals) {
  if (!isFiniteNumber(amountDecimal) || !(amountDecimal > 0) || !Number.isInteger(decimals) || decimals < 0) {
    return null;
  }
  const scaled = Math.ceil(amountDecimal * 10 ** decimals);
  return scaled > 0 ? String(scaled) : null;
}

function floorUnitsFromDecimalAmount(amountDecimal, decimals) {
  if (!isFiniteNumber(amountDecimal) || !(amountDecimal >= 0) || !Number.isInteger(decimals) || decimals < 0) {
    return null;
  }
  const scaled = Math.floor(amountDecimal * 10 ** decimals);
  return scaled >= 0 ? String(scaled) : null;
}

function clampAmountToSourceBalance(amount, source = null) {
  const estimatedAmount = positiveBigInt(amount);
  const sourceAmount = positiveBigInt(source?.actual ?? source?.balance);
  if (!estimatedAmount) return null;
  if (!sourceAmount || estimatedAmount <= sourceAmount) return estimatedAmount.toString();
  return sourceAmount.toString();
}

function inferDecimalsFromObservedBalance(source = null) {
  const raw = positiveBigInt(source?.actual ?? source?.balance);
  const decimal = Number(source?.actualDecimal);
  if (!raw || !isFiniteNumber(decimal) || !(decimal > 0)) return null;
  const ratio = Number(raw.toString()) / decimal;
  if (!isFiniteNumber(ratio) || !(ratio > 0)) return null;
  const decimals = Math.round(Math.log10(ratio));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
  const expectedRatio = 10 ** decimals;
  return Math.abs(ratio / expectedRatio - 1) <= 1e-6 ? decimals : null;
}

function sourceAssetDecimals(source = null) {
  const sourceAsset = tokenAsset(source?.chain, source?.token || ZERO_TOKEN);
  return Number.isInteger(sourceAsset.decimals)
    ? sourceAsset.decimals
    : inferDecimalsFromObservedBalance(source);
}

function estimateInputAmountFromSource({ job, source, inputBufferMultiplier = INPUT_BUFFER_MULTIPLIER }) {
  const targetUsd = job?.estimatedAssetValueUsd;
  const sourceUsd = source?.estimatedUsd;
  const sourceDecimal = source?.actualDecimal;
  if (!isFiniteNumber(targetUsd) || !(targetUsd > 0) || !isFiniteNumber(sourceUsd) || !(sourceUsd > 0)) {
    return null;
  }
  if (!isFiniteNumber(sourceDecimal) || !(sourceDecimal > 0)) {
    return null;
  }
  const decimals = sourceAssetDecimals(source);
  const sourceUnitUsd = sourceUsd / sourceDecimal;
  const buffer = Number.isFinite(inputBufferMultiplier) && inputBufferMultiplier > 0
    ? inputBufferMultiplier
    : INPUT_BUFFER_MULTIPLIER;
  const inputDecimal = Math.min(sourceDecimal, (targetUsd * buffer) / sourceUnitUsd);
  return clampAmountToSourceBalance(ceilUnitsFromDecimalAmount(inputDecimal, decimals), source);
}

function gatewayOnrampAmountSats({ job, source }) {
  const sourceAmount = positiveBigInt(source?.actual);
  if (!sourceAmount) return { amount: null, belowMinimum: false };
  if (sourceAmount < GATEWAY_BTC_ONRAMP_MIN_SATS) {
    return {
      amount: sourceAmount.toString(),
      belowMinimum: true,
    };
  }
  const estimated = positiveBigInt(estimateInputAmountFromSource({ job, source }));
  const clamped = estimated && estimated > GATEWAY_BTC_ONRAMP_MIN_SATS ? estimated : GATEWAY_BTC_ONRAMP_MIN_SATS;
  return {
    amount: clamped.toString(),
    belowMinimum: false,
  };
}

function outputAmountForCoverage(plan, executor) {
  if (!plan) return null;
  if (executor === "gas_zip_native_refuel") {
    return plan.quote?.expectedOutputWei || plan.quote?.outputAmount || null;
  }
  if (executor === "gateway_btc_onramp") {
    return plan.gasRefill || plan.quote?.gasRefill || plan.quote?.outputAmount?.amount || null;
  }
  if (executor === "gateway_btc_consolidation") {
    return plan.gasRefill || plan.quote?.gasRefill || plan.quote?.outputAmount?.amount || null;
  }
  if (executor === "lifi_bridge") {
    return plan.minimumOutputAmount || plan.expectedOutputAmount || null;
  }
  return plan.minimumOutputAmount || plan.quote?.outputAmount || null;
}

function crossChainStepExecutor(step = {}) {
  if (step?.executor) return step.executor;
  if (step?.type === "gateway_consolidation") return "gateway_btc_consolidation";
  if (step?.type === "across_bridge") return "across_bridge";
  if (step?.type === "lifi_bridge") return "lifi_bridge";
  return null;
}

function coverageForPlan({ plan, job, executor }) {
  const outputAmount = positiveBigInt(outputAmountForCoverage(plan, executor));
  const targetAmount = positiveBigInt(job?.targetAmount);
  const coversTarget = outputAmount != null && targetAmount != null ? outputAmount >= targetAmount : null;
  const coverageBps = outputAmount != null && targetAmount != null && targetAmount > 0n
    ? (outputAmount * 10_000n) / targetAmount
    : null;
  return {
    targetAmount: targetAmount?.toString() || job?.targetAmount || null,
    minimumOutputAmount: outputAmount?.toString() || outputAmountForCoverage(plan, executor),
    coversTarget,
    coverageBps: coverageBps?.toString() || null,
    partialRefill: coversTarget === false && coverageBps != null && coverageBps >= PARTIAL_REFILL_MIN_COVERAGE_BPS,
    partialRefillMinCoverageBps: PARTIAL_REFILL_MIN_COVERAGE_BPS.toString(),
  };
}

function refillCoverageAcceptable(coverage = {}) {
  return coverage.coversTarget !== false || coverage.partialRefill === true;
}

function applyBps(value, bps) {
  if (!Number.isFinite(bps) || bps <= 10_000) return value;
  return (value * BigInt(Math.floor(bps))) / 10_000n;
}

function maxBigInt(...values) {
  return values
    .filter((value) => value !== null && value !== undefined)
    .reduce((left, right) => (left > right ? left : right), 0n);
}

function toBigIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return typeof value === "bigint" ? value : BigInt(value);
  } catch {
    return null;
  }
}

function lifiNativeSourceRequirementBlocked({ plan, source }) {
  if (!plan?.srcAsset?.isNative || !plan.nativeSourceRequirementWei) return null;
  const required = toBigIntOrNull(plan.nativeSourceRequirementWei);
  const actual = toBigIntOrNull(source?.actual ?? source?.balance);
  if (required === null || actual === null || actual >= required) return null;
  return {
    requiredWei: required.toString(),
    actualWei: actual.toString(),
  };
}

async function buildLifiBridgePlanWithNativeGasReserve({
  job,
  source,
  amount,
  senderAddress,
  buildLifiBridgePlanImpl,
}) {
  const buildPlan = (nextAmount) => buildLifiBridgePlanImpl({
    srcChain: source.chain,
    dstChain: job.chain,
    srcToken: source.token,
    dstToken: job.type === "refill_native" ? ZERO_TOKEN : job.token,
    amount: nextAmount,
    senderAddress,
    recipient: senderAddress,
  });

  const plan = await buildPlan(amount);
  const nativeRequirement = lifiNativeSourceRequirementBlocked({ plan, source });
  if (!nativeRequirement || plan?.planStatus !== "ready") return { plan, blockedReason: null };

  const required = toBigIntOrNull(nativeRequirement.requiredWei);
  const actual = toBigIntOrNull(nativeRequirement.actualWei);
  const initialAmount = toBigIntOrNull(plan.amount ?? amount);
  if (required === null || actual === null || initialAmount === null) {
    return { plan, blockedReason: "insufficient_native_balance_for_lifi_gas" };
  }

  const gasReserve = required - initialAmount;
  if (gasReserve <= 0n) return { plan, blockedReason: "insufficient_native_balance_for_lifi_gas" };
  if (gasReserve >= actual) return { plan, blockedReason: "source_input_amount_unavailable" };

  const adjustedAmount = actual - gasReserve;
  if (adjustedAmount <= 0n) return { plan, blockedReason: "source_input_amount_unavailable" };
  if (adjustedAmount >= initialAmount) return { plan, blockedReason: "insufficient_native_balance_for_lifi_gas" };

  const adjustedPlan = await buildPlan(adjustedAmount.toString());
  const adjustedRequirement = lifiNativeSourceRequirementBlocked({ plan: adjustedPlan, source });
  if (adjustedRequirement) {
    return {
      plan: adjustedPlan,
      blockedReason: "insufficient_native_balance_for_lifi_gas",
      adjustedAmount: adjustedAmount.toString(),
    };
  }
  return {
    plan: adjustedPlan,
    blockedReason: null,
    adjustedAmount: adjustedAmount.toString(),
  };
}

function nativeGasBudgetForPlan(plan = {}) {
  const chainConfig = getEvmChainConfig(plan.chain || "");
  if (!chainConfig) return null;
  const totalGasUnits = Array.isArray(plan.steps)
    ? plan.steps.reduce((sum, step) => sum + (toBigIntOrNull(step?.intent?.tx?.gasLimit) ?? BigInt(chainConfig.fallbackGasUnits)), 0n)
    : 0n;
  if (totalGasUnits <= 0n) return null;
  if (chainConfig.legacyTxType === true) {
    const gasPriceWei = toBigIntOrNull(plan?.gasSnapshot?.gasPriceWei);
    if (gasPriceWei === null) return null;
    return totalGasUnits * applyBps(gasPriceWei, chainConfig.gasPriceBufferBps);
  }
  const gasPriceWei = toBigIntOrNull(plan?.gasSnapshot?.gasPriceWei);
  const baseFeeWei = toBigIntOrNull(plan?.gasSnapshot?.baseFeeWei);
  const priorityFeeWei = toBigIntOrNull(plan?.gasSnapshot?.priorityFeeWei);
  const minPriorityFeeWei = toBigIntOrNull(chainConfig.minPriorityFeePerGasWei) ?? 0n;
  const effectivePriorityFeeWei = maxBigInt(priorityFeeWei, minPriorityFeeWei);
  const eip1559BudgetWei = baseFeeWei !== null
    ? (baseFeeWei * 2n) + effectivePriorityFeeWei
    : effectivePriorityFeeWei;
  const maxFeePerGasWei = applyBps(
    maxBigInt(gasPriceWei, eip1559BudgetWei, effectivePriorityFeeWei),
    chainConfig.maxFeePerGasBufferBps,
  );
  if (maxFeePerGasWei <= 0n) return null;
  return totalGasUnits * maxFeePerGasWei;
}

function nativeBalanceWei({ chain, nativeDecimal }) {
  const nativeAsset = tokenAsset(chain, ZERO_TOKEN);
  const units = floorUnitsFromDecimalAmount(nativeDecimal, nativeAsset.decimals);
  return toBigIntOrNull(units);
}

async function resolveNativeBalanceWei({
  chain,
  owner,
  nativeDecimal = null,
  readNativeBalanceImpl = readNativeBalance,
}) {
  const fromDecimal = nativeBalanceWei({ chain, nativeDecimal });
  if (fromDecimal !== null) return fromDecimal;
  if (!owner || typeof readNativeBalanceImpl !== "function") return null;
  try {
    const balance = await readNativeBalanceImpl(chain, owner, { chainConfig: getEvmChainConfig(chain) });
    return toBigIntOrNull(balance?.balanceWei);
  } catch {
    return null;
  }
}

function isNoRoutePlan(plan = null) {
  return plan?.planStatus === "blocked" && plan?.blockedReason === "no_route";
}

function blockedPreparation({ job, executor = null, blockedReason, plan = null, coverage = null, discretionaryBudget = null }) {
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    status: "blocked",
    jobId: job?.jobId || null,
    executionMethod: job?.executionMethod || null,
    executor,
    blockedReason,
    plan,
    coverage,
    discretionaryBudget,
  };
}

function readyPreparation({ job, executor, plan, coverage, discretionaryBudget = null }) {
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    status: "ready",
    jobId: job.jobId,
    executionMethod: job.executionMethod,
    executor,
    plan,
    coverage,
    discretionaryBudget,
  };
}

function bridgeQuoteCostUsd(job = {}, plan = null) {
  const jobCost = Number.isFinite(job?.fundingSource?.expectedExecutionRefillCostUsd)
    ? job.fundingSource.expectedExecutionRefillCostUsd
    : null;
  if (jobCost != null) return jobCost;
  const planCost = [
    plan?.quote?.feeUsd,
    plan?.quote?.totalFeeUsd,
    plan?.quote?.fees?.totalUsd,
    plan?.quote?.fees?.usd,
    plan?.quote?.executionFees?.totalUsd,
    plan?.quote?.feeBreakdown?.totalUsd,
  ].find(Number.isFinite);
  return Number.isFinite(planCost) ? planCost : null;
}

export function refillExecutorForJob(job = {}) {
  if (job.executionMethod === "same_chain_token_to_native_swap") return "token_dex_experiment";
  if (job.executionMethod === "same_chain_token_to_token_swap") return "token_dex_experiment";
  if (job.executionMethod === "same_chain_native_to_token_swap") return "native_dex_experiment";
  if (job.executionMethod === "gas_refuel_bridge_gas_zip" && job.type === "refill_native") return "gas_zip_native_refuel";
  if (
    job.executionMethod === "cross_chain_bridge_or_swap" &&
    (job.type === "refill_native" || job.type === "refill_token") &&
    job.fundingSource?.source?.chain === "bitcoin"
  ) {
    return "gateway_btc_onramp";
  }
  if (
    job.executionMethod === "cross_chain_bridge_or_swap" &&
    job.type === "refill_native" &&
    job.fundingSource?.source?.chain &&
    job.fundingSource?.source?.token &&
    isBtcLikeAsset(tokenAsset(job.fundingSource.source.chain, job.fundingSource.source.token))
  ) {
    return "gateway_btc_consolidation";
  }
  if (job.executionMethod === "cross_chain_bridge_or_swap" && job.type === "refill_token") return "gateway_btc_consolidation";
  if (job.executionMethod === "cross_chain_swap_via_btc_intermediate") return "cross_chain_btc_intermediate";
  if (job.executionMethod === "cross_chain_bridge_across") return "across_bridge";
  if (job.executionMethod === "cross_chain_bridge_lifi") return "lifi_bridge";
  return null;
}

async function buildStableBridgeFallbackCompositePlan({
  job,
  source,
  dexAmount,
  senderAddress,
  buildTokenDexPlanImpl,
  buildAcrossBridgePlanImpl,
  buildLifiBridgePlanImpl,
}) {
  const sourceAsset = tokenAsset(source.chain, source.token || ZERO_TOKEN);
  const targetAsset = tokenAsset(job.chain, job.token);
  if (sourceAsset.family !== "native_or_wrapped" || !isBtcLikeAsset(targetAsset)) return null;
  const sourceStableToken = preferredStableTokenForChain(source.chain);
  const destinationStableToken = preferredStableTokenForChain(job.chain);
  if (!sourceStableToken || !destinationStableToken) return null;

  const step1Plan = await buildTokenDexPlanImpl({
    chain: source.chain,
    amount: dexAmount,
    senderAddress,
    inputToken: source.token,
    outputToken: sourceStableToken,
  });
  if (step1Plan.planStatus !== "ready") return null;

  const bridgeAmount = outputAmountForCoverage(step1Plan, "token_dex_experiment");
  if (!positiveBigInt(bridgeAmount)) return null;

  const acrossTicker = acrossTickerForToken(source.chain, sourceStableToken);
  let step2Plan = null;
  let step2Executor = null;
  if (acrossTicker && acrossTicker === acrossTickerForToken(job.chain, destinationStableToken)) {
    step2Plan = await buildAcrossBridgePlanImpl({
      srcChain: source.chain,
      dstChain: job.chain,
      ticker: acrossTicker,
      amount: bridgeAmount,
      senderAddress,
      recipient: senderAddress,
    });
    if (step2Plan.planStatus === "ready") step2Executor = "across_bridge";
  }
  if (!step2Plan || step2Plan.planStatus !== "ready") {
    step2Plan = await buildLifiBridgePlanImpl({
      srcChain: source.chain,
      dstChain: job.chain,
      srcToken: sourceStableToken,
      dstToken: destinationStableToken,
      amount: bridgeAmount,
      senderAddress,
      recipient: senderAddress,
    });
    if (step2Plan.planStatus !== "ready") return null;
    step2Executor = "lifi_bridge";
  }

  const destinationStableAmount = outputAmountForCoverage(step2Plan, step2Executor);
  if (!positiveBigInt(destinationStableAmount)) return null;

  const step3Plan = await buildTokenDexPlanImpl({
    chain: job.chain,
    amount: destinationStableAmount,
    senderAddress,
    inputToken: destinationStableToken,
    outputToken: job.token,
  });
  if (step3Plan.planStatus !== "ready") return null;

  return {
    planStatus: "ready",
    executor: "cross_chain_btc_intermediate",
    step1: { type: "source_native_to_stable_swap", plan: step1Plan },
    step2: { type: step2Executor, executor: step2Executor, plan: step2Plan },
    step3: { type: "destination_dex_swap", plan: step3Plan },
  };
}

export async function buildTreasuryRefillExecutionPlan({
  job,
  senderAddress,
  bitcoinSenderAddress = null,
  auditRecords = [],
  destinationBalanceStatus = null,
  destinationNativeDecimal = null,
  destinationMinBalanceDecimal = null,
  readNativeBalanceImpl = readNativeBalance,
  buildTokenDexPlanImpl = buildTokenDexExperimentPlan,
  buildNativeDexPlanImpl = buildNativeDexExperimentPlan,
  buildGatewayBtcPlanImpl = buildGatewayBtcConsolidationPlan,
  buildGatewayBtcOnrampPlanImpl = buildGatewayBtcOnrampPlan,
  buildGasZipPlanImpl = buildGasZipNativeRefuelPlan,
  buildAcrossBridgePlanImpl = buildAcrossBridgePlan,
  buildLifiBridgePlanImpl = buildLifiBridgePlan,
} = {}) {
  if (!job) throw new Error("Treasury refill job is required");
  if (!senderAddress) throw new Error("Treasury refill sender address is required");

  const executor = refillExecutorForJob(job);
  if (!executor) {
    return blockedPreparation({
      job,
      blockedReason: `unsupported_refill_execution_method:${job.executionMethod || "missing"}`,
    });
  }

  const source = job.fundingSource?.source || null;
  if (!source?.chain || !source?.token) {
    return blockedPreparation({ job, executor, blockedReason: "funding_source_missing" });
  }

  let plan = null;
  if (executor === "token_dex_experiment") {
    const amount = estimateInputAmountFromSource({ job, source });
    if (!amount) return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });
    const tokenToToken = job.executionMethod === "same_chain_token_to_token_swap";
    plan = await buildTokenDexPlanImpl({
      chain: job.chain,
      amount,
      senderAddress,
      inputToken: source.token,
      outputToken: tokenToToken ? job.token : "native",
      strategyId: tokenToToken ? TOKEN_DEX_EXPERIMENT_STRATEGY_ID : NATIVE_GAS_REFILL_STRATEGY_ID,
    });
    const requiredGasBudgetWei = nativeGasBudgetForPlan(plan);
    const currentNativeBalanceWei = await resolveNativeBalanceWei({
      chain: job.chain,
      owner: senderAddress,
      nativeDecimal: destinationNativeDecimal,
      readNativeBalanceImpl,
    });
    if (requiredGasBudgetWei !== null && currentNativeBalanceWei !== null && currentNativeBalanceWei < requiredGasBudgetWei) {
      return blockedPreparation({
        job,
        executor,
        blockedReason: "insufficient_native_gas_balance",
        plan,
      });
    }
  } else if (executor === "native_dex_experiment") {
    const amount = estimateInputAmountFromSource({ job, source });
    if (!amount) return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });
    plan = await buildNativeDexPlanImpl({
      chain: job.chain,
      amount,
      senderAddress,
      outputToken: job.token,
    });
  } else if (executor === "gateway_btc_consolidation") {
    const targetAmount = positiveBigInt(job.targetAmount);
    const targetAsset = job.type === "refill_token" ? tokenAsset(job.chain, job.token) : null;
    const stableTokenRefill = job.type === "refill_token" && !isBtcLikeAsset(targetAsset);
    const destinationBtcSettlementToken = gatewayBtcSettlementTokenForChain(job.chain);
    const amount = job.type === "refill_native"
      ? estimateInputAmountFromSource({ job, source })
      : stableTokenRefill
        ? estimateInputAmountFromSource({ job, source })
        : clampAmountToSourceBalance(targetAmount?.toString(), source);
    if (job.type === "refill_native" && !amount) {
      return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });
    }
    if (job.type !== "refill_native" && !targetAmount) return blockedPreparation({ job, executor, blockedReason: "target_amount_unavailable" });
    if (job.type !== "refill_native" && !amount) return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });
    let gatewayPlan = await buildGatewayBtcPlanImpl({
      srcChain: source.chain,
      dstChain: job.chain,
      srcToken: source.token,
      dstToken: job.type === "refill_native" ? WBTC_OFT_TOKEN : job.token,
      amount,
      senderAddress,
      recipient: senderAddress,
      gasRefill: job.type === "refill_native" ? job.targetAmount : null,
    });
    let destinationDexPlan = null;
    if (gatewayPlan.planStatus !== "ready" && isNoRoutePlan(gatewayPlan) && stableTokenRefill) {
      gatewayPlan = await buildGatewayBtcPlanImpl({
        srcChain: source.chain,
        dstChain: job.chain,
        srcToken: source.token,
        dstToken: destinationBtcSettlementToken,
        amount,
        senderAddress,
        recipient: senderAddress,
        gasRefill: null,
      });
      if (gatewayPlan.planStatus === "ready") {
        const destinationWrappedBtcAmount = gatewayPlan.quote?.outputAmount?.amount;
        if (!destinationWrappedBtcAmount) {
          return blockedPreparation({ job, executor, blockedReason: "gateway_output_amount_unavailable", plan: gatewayPlan });
        }
        destinationDexPlan = await buildTokenDexPlanImpl({
          chain: job.chain,
          amount: destinationWrappedBtcAmount,
          senderAddress,
          inputToken: destinationBtcSettlementToken,
          outputToken: job.token,
        });
        if (destinationDexPlan.planStatus !== "ready") {
          return blockedPreparation({
            job,
            executor,
            blockedReason: destinationDexPlan.blockedReason || "destination_dex_step_blocked",
            plan: destinationDexPlan,
          });
        }
      }
    }
    if (gatewayPlan.planStatus !== "ready") {
      return blockedPreparation({ job, executor, blockedReason: gatewayPlan.blockedReason || "gateway_step_blocked", plan: gatewayPlan });
    }
    plan = destinationDexPlan
      ? {
          planStatus: "ready",
          executor: "gateway_btc_consolidation",
          step1: { type: "gateway_consolidation", plan: gatewayPlan },
          step2: { type: "destination_dex_swap", plan: destinationDexPlan },
        }
      : gatewayPlan;
  } else if (executor === "gateway_btc_onramp") {
    const onrampAmount = gatewayOnrampAmountSats({ job, source });
    const amountSats = onrampAmount.amount;
    const gasRefill = positiveBigInt(job.targetAmount);
    const bitcoinSender = bitcoinSenderAddress || senderAddress;
    if (onrampAmount.belowMinimum) {
      return blockedPreparation({ job, executor, blockedReason: "source_inventory_below_gateway_minimum" });
    }
    if (!amountSats) return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });
    if (!bitcoinSender) return blockedPreparation({ job, executor, blockedReason: "bitcoin_sender_address_missing" });
    plan = await buildGatewayBtcOnrampPlanImpl({
      senderAddress: bitcoinSender,
      recipient: senderAddress,
      amountSats,
      dstChain: job.chain,
      dstToken: job.type === "refill_native" ? WBTC_OFT_TOKEN : job.token,
      gasRefill: job.type === "refill_native" ? gasRefill?.toString() || null : null,
      allowUnfundedPreview: true,
    });
  } else if (executor === "gas_zip_native_refuel") {
    const targetAmount = positiveBigInt(job.targetAmount);
    if (!targetAmount) return blockedPreparation({ job, executor, blockedReason: "target_amount_unavailable" });
    const amount = estimateInputAmountFromSource({
      job,
      source,
      inputBufferMultiplier: GAS_ZIP_INPUT_BUFFER_MULTIPLIER,
    });
    if (!amount) return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });
    plan = await buildGasZipPlanImpl({
      srcChain: source.chain,
      dstChain: job.chain,
      amountWei: amount,
      minimumDestinationWei: targetAmount.toString(),
      senderAddress,
      recipient: senderAddress,
      auditRecords,
      destinationBalanceStatus,
      destinationNativeDecimal,
      destinationMinBalanceDecimal,
      discretionaryBudgetBypass: isStrategyRealizedPnlMovement(job),
    });
  } else if (executor === "across_bridge") {
    const amount = job.type === "refill_native"
      ? estimateInputAmountFromSource({ job, source })
      : positiveBigInt(job.targetAmount)?.toString() || null;
    if (!amount) return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });
    const ticker = acrossTickerForToken(source.chain, source.token);
    if (!ticker) return blockedPreparation({ job, executor, blockedReason: "across_ticker_unsupported" });
    plan = await buildAcrossBridgePlanImpl({
      srcChain: source.chain,
      dstChain: job.chain,
      ticker,
      amount,
      senderAddress,
      recipient: senderAddress,
    });
  } else if (executor === "lifi_bridge") {
    const sameTokenRefill =
      job.type === "refill_token" &&
      normalizedToken(source.token) === normalizedToken(job.token);
    const amount = job.type === "refill_token" && sameTokenRefill
      ? positiveBigInt(job.targetAmount)?.toString() || null
      : estimateInputAmountFromSource({ job, source });
    if (!amount) return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });
    const lifiResult = await buildLifiBridgePlanWithNativeGasReserve({
      job,
      source,
      amount,
      senderAddress,
      buildLifiBridgePlanImpl,
    });
    plan = lifiResult.plan;
    if (lifiResult.blockedReason) {
      return blockedPreparation({
        job,
        executor,
        blockedReason: lifiResult.blockedReason,
        plan,
      });
    }
  } else if (executor === "cross_chain_btc_intermediate") {
    // Step 1: DEX swap source token → wBTC.OFT on source chain
    const dexAmount = estimateInputAmountFromSource({ job, source });
    if (!dexAmount) return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });

    let step1Plan = await buildTokenDexPlanImpl({
      chain: source.chain,
      amount: dexAmount,
      senderAddress,
      inputToken: source.token,
      outputToken: "wbtc.oft",
    });

    if (step1Plan.planStatus !== "ready") {
      const fallbackPlan = await buildStableBridgeFallbackCompositePlan({
        job,
        source,
        dexAmount,
        senderAddress,
        buildTokenDexPlanImpl,
        buildAcrossBridgePlanImpl,
        buildLifiBridgePlanImpl,
      });
      if (!fallbackPlan) {
        return blockedPreparation({ job, executor, blockedReason: step1Plan.blockedReason || "dex_step_blocked", plan: step1Plan });
      }
      plan = fallbackPlan;
    }

    if (plan?.planStatus === "ready") {
      // already resolved by the native->stable->bridge->destination swap fallback
    } else {
      // Step 2: Gateway consolidation wBTC.OFT from source chain → destination chain
      const gatewayAmount = step1Plan.minimumOutputAmount;
      const gasRefill = job.type === "refill_native" ? job.targetAmount : null;
      const destinationBtcSettlementToken = gatewayBtcSettlementTokenForChain(job.chain);

      let step2Plan = await buildGatewayBtcPlanImpl({
        srcChain: source.chain,
        dstChain: job.chain,
        srcToken: WBTC_OFT_TOKEN,
        dstToken: job.type === "refill_native" ? WBTC_OFT_TOKEN : job.token,
        amount: gatewayAmount,
        senderAddress,
        recipient: senderAddress,
        gasRefill,
      });

      let step3Plan = null;
      if (
        isNoRoutePlan(step2Plan) &&
        job.type === "refill_token" &&
        !isBtcLikeAsset(tokenAsset(job.chain, job.token))
      ) {
        step2Plan = await buildGatewayBtcPlanImpl({
          srcChain: source.chain,
          dstChain: job.chain,
          srcToken: WBTC_OFT_TOKEN,
          dstToken: destinationBtcSettlementToken,
          amount: gatewayAmount,
          senderAddress,
          recipient: senderAddress,
          gasRefill,
        });
        if (step2Plan.planStatus === "ready") {
          const destinationWrappedBtcAmount = step2Plan.quote?.outputAmount?.amount;
          if (!destinationWrappedBtcAmount) {
            return blockedPreparation({ job, executor, blockedReason: "gateway_output_amount_unavailable", plan: step2Plan });
          }
          step3Plan = await buildTokenDexPlanImpl({
            chain: job.chain,
            amount: destinationWrappedBtcAmount,
            senderAddress,
            inputToken: destinationBtcSettlementToken,
            outputToken: job.token,
          });
          if (step3Plan.planStatus !== "ready") {
            return blockedPreparation({ job, executor, blockedReason: step3Plan.blockedReason || "destination_dex_step_blocked", plan: step3Plan });
          }
        }
      }

      if (step2Plan.planStatus !== "ready" && isNoRoutePlan(step2Plan) && job.type === "refill_token") {
        const lifiAmount = estimateInputAmountFromSource({ job, source });
        if (lifiAmount) {
          const lifiResult = await buildLifiBridgePlanWithNativeGasReserve({
            job,
            source,
            amount: lifiAmount,
            senderAddress,
            buildLifiBridgePlanImpl,
          });
          const lifiPlan = lifiResult.plan;
          if (lifiResult.blockedReason) {
            return blockedPreparation({
              job,
              executor: "lifi_bridge",
              blockedReason: lifiResult.blockedReason,
              plan: lifiPlan,
            });
          }
          if (lifiPlan.planStatus === "ready") {
            const lifiCoverage = coverageForPlan({ plan: lifiPlan, job, executor: "lifi_bridge" });
            const lifiBridgeBudget = evaluateBridgeMovementCostGuard({
              method: "cross_chain_bridge_lifi",
              costUsd: bridgeQuoteCostUsd(job, lifiPlan),
              record: job,
            });
            if (!lifiBridgeBudget.accepted) {
              return blockedPreparation({
                job,
                executor: "lifi_bridge",
                blockedReason: lifiBridgeBudget.reason,
                plan: lifiPlan,
                coverage: lifiCoverage,
                discretionaryBudget: lifiBridgeBudget,
              });
            }
            if (refillCoverageAcceptable(lifiCoverage)) {
              return readyPreparation({
                job,
                executor: "lifi_bridge",
                plan: lifiPlan,
                coverage: lifiCoverage,
                discretionaryBudget: lifiBridgeBudget,
              });
            }
            return blockedPreparation({
              job,
              executor: "lifi_bridge",
              blockedReason: "executor_output_below_refill_target",
              plan: lifiPlan,
              coverage: lifiCoverage,
              discretionaryBudget: lifiBridgeBudget,
            });
          }
        }
      }

      if (step2Plan.planStatus !== "ready") {
        return blockedPreparation({ job, executor, blockedReason: step2Plan.blockedReason || "gateway_step_blocked", plan: step2Plan });
      }

      plan = {
        planStatus: "ready",
        executor: "cross_chain_btc_intermediate",
        step1: { type: "dex_swap", plan: step1Plan },
        step2: { type: "gateway_consolidation", plan: step2Plan },
        ...(step3Plan ? { step3: { type: "destination_dex_swap", plan: step3Plan } } : {}),
      };
    }
  }

  if (plan?.planStatus !== "ready") {
    return blockedPreparation({
      job,
      executor,
      blockedReason: plan?.blockedReason || "executor_plan_blocked",
      plan,
    });
  }

  const bridgeMovementBudget = evaluateBridgeMovementCostGuard({
    method: job.executionMethod,
    costUsd: bridgeQuoteCostUsd(job, plan),
    record: job,
  });
  if (!bridgeMovementBudget.accepted) {
    return blockedPreparation({
      job,
      executor,
      blockedReason: bridgeMovementBudget.reason,
      plan,
      discretionaryBudget: bridgeMovementBudget,
    });
  }

  const coverage = executor === "cross_chain_btc_intermediate"
    ? coverageForPlan({
        plan: plan.step3?.plan || plan.step2.plan,
        job,
        executor: plan.step3 ? "token_dex_experiment" : "gateway_btc_consolidation",
      })
    : executor === "gateway_btc_consolidation" && plan.step2?.plan
      ? coverageForPlan({
          plan: plan.step2.plan,
          job,
          executor: "token_dex_experiment",
        })
    : coverageForPlan({ plan, job, executor });
  if (!refillCoverageAcceptable(coverage)) {
    return blockedPreparation({
      job,
      executor,
      blockedReason: "executor_output_below_refill_target",
      plan,
      coverage,
      discretionaryBudget: bridgeMovementBudget,
    });
  }

  return readyPreparation({ job, executor, plan, coverage, discretionaryBudget: bridgeMovementBudget });
}

export async function executeTreasuryRefillExecutionPlan({
  preparation,
  executeTokenDexPlanImpl = executeTokenDexExperimentPlan,
  executeNativeDexPlanImpl = executeNativeDexExperimentPlan,
  executeGatewayBtcPlanImpl = executeGatewayBtcConsolidationPlan,
  executeGatewayBtcOnrampPlanImpl = executeGatewayBtcOnrampPlan,
  executeGasZipPlanImpl = executeGasZipNativeRefuelPlan,
  executeAcrossBridgePlanImpl = executeAcrossBridgePlan,
  executeLifiBridgePlanImpl = executeLifiBridgePlan,
  ...executionOptions
} = {}) {
  if (preparation?.status !== "ready" || !preparation?.plan) {
    throw new Error(`Treasury refill execution plan is not ready: ${preparation?.blockedReason || "missing_plan"}`);
  }
  if (preparation.executor === "token_dex_experiment") {
    return executeTokenDexPlanImpl({ plan: preparation.plan, ...executionOptions });
  }
  if (preparation.executor === "native_dex_experiment") {
    return executeNativeDexPlanImpl({ plan: preparation.plan, ...executionOptions });
  }
  if (preparation.executor === "gateway_btc_consolidation") {
    if (preparation.plan.step1?.plan && preparation.plan.step2?.plan) {
      const step1Result = await executeGatewayBtcPlanImpl({ plan: preparation.plan.step1.plan, ...executionOptions });
      const step2Result = await executeTokenDexPlanImpl({ plan: preparation.plan.step2.plan, ...executionOptions });
      return {
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        settlementStatus: step2Result?.settlementStatus || step1Result.settlementStatus || "source_confirmed_only",
        executor: "gateway_btc_consolidation",
        step1Result,
        step2Result,
      };
    }
    return executeGatewayBtcPlanImpl({ plan: preparation.plan, ...executionOptions });
  }
  if (preparation.executor === "gateway_btc_onramp") {
    return executeGatewayBtcOnrampPlanImpl({ plan: preparation.plan, ...executionOptions });
  }
  if (preparation.executor === "gas_zip_native_refuel") {
    return executeGasZipPlanImpl({ plan: preparation.plan, ...executionOptions });
  }
  if (preparation.executor === "across_bridge") {
    return executeAcrossBridgePlanImpl({ plan: preparation.plan, ...executionOptions });
  }
  if (preparation.executor === "lifi_bridge") {
    return executeLifiBridgePlanImpl({ plan: preparation.plan, ...executionOptions });
  }
  if (preparation.executor === "cross_chain_btc_intermediate") {
    const step1Result = await executeTokenDexPlanImpl({ plan: preparation.plan.step1.plan, ...executionOptions });
    const step2Executor = crossChainStepExecutor(preparation.plan.step2);
    let step2Result = null;
    if (step2Executor === "gateway_btc_consolidation") {
      step2Result = await executeGatewayBtcPlanImpl({ plan: preparation.plan.step2.plan, ...executionOptions });
    } else if (step2Executor === "across_bridge") {
      step2Result = await executeAcrossBridgePlanImpl({ plan: preparation.plan.step2.plan, ...executionOptions });
    } else if (step2Executor === "lifi_bridge") {
      step2Result = await executeLifiBridgePlanImpl({ plan: preparation.plan.step2.plan, ...executionOptions });
    } else {
      throw new Error(`Unsupported cross-chain intermediate step2 executor: ${step2Executor || "missing"}`);
    }
    const step3Result = preparation.plan.step3
      ? await executeTokenDexPlanImpl({ plan: preparation.plan.step3.plan, ...executionOptions })
      : null;
    return {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      settlementStatus: step3Result?.settlementStatus || step2Result.settlementStatus || "source_confirmed_only",
      executor: "cross_chain_btc_intermediate",
      step1Result,
      step2Result,
      ...(step3Result ? { step3Result } : {}),
    };
  }
  throw new Error(`Unsupported treasury refill executor: ${preparation.executor || "missing"}`);
}
