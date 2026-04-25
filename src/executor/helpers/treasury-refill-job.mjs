import { WBTC_OFT_TOKEN, ZERO_TOKEN, isBtcLikeAsset, tokenAsset } from "../../assets/tokens.mjs";
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
import { buildTokenDexExperimentPlan, executeTokenDexExperimentPlan } from "./token-dex-experiment.mjs";
import { buildAcrossBridgePlan, executeAcrossBridgePlan } from "./across-bridge.mjs";
import { acrossTickerForToken } from "../../config/across.mjs";
import { buildLifiBridgePlan, executeLifiBridgePlan } from "./lifi-bridge.mjs";

const INPUT_BUFFER_MULTIPLIER = 1.1;
const GAS_ZIP_INPUT_BUFFER_MULTIPLIER = 1.04;
const GATEWAY_BTC_ONRAMP_MIN_SATS = 5000n;

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

function ceilUnitsFromDecimalAmount(amountDecimal, decimals) {
  if (!isFiniteNumber(amountDecimal) || !(amountDecimal > 0) || !Number.isInteger(decimals) || decimals < 0) {
    return null;
  }
  const scaled = Math.ceil(amountDecimal * 10 ** decimals);
  return scaled > 0 ? String(scaled) : null;
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
  const sourceAsset = tokenAsset(source.chain, source.token || ZERO_TOKEN);
  const sourceUnitUsd = sourceUsd / sourceDecimal;
  const buffer = Number.isFinite(inputBufferMultiplier) && inputBufferMultiplier > 0
    ? inputBufferMultiplier
    : INPUT_BUFFER_MULTIPLIER;
  const inputDecimal = Math.min(sourceDecimal, (targetUsd * buffer) / sourceUnitUsd);
  return ceilUnitsFromDecimalAmount(inputDecimal, sourceAsset.decimals);
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
    return plan.gasRefill || plan.quote?.gasRefill || null;
  }
  if (executor === "gateway_btc_consolidation") {
    return plan.gasRefill || plan.quote?.gasRefill || plan.quote?.outputAmount?.amount || null;
  }
  if (executor === "lifi_bridge") {
    return plan.minimumOutputAmount || plan.expectedOutputAmount || null;
  }
  return plan.minimumOutputAmount || plan.quote?.outputAmount || null;
}

function coverageForPlan({ plan, job, executor }) {
  const outputAmount = positiveBigInt(outputAmountForCoverage(plan, executor));
  const targetAmount = positiveBigInt(job?.targetAmount);
  const coversTarget = outputAmount != null && targetAmount != null ? outputAmount >= targetAmount : null;
  return {
    targetAmount: targetAmount?.toString() || job?.targetAmount || null,
    minimumOutputAmount: outputAmount?.toString() || outputAmountForCoverage(plan, executor),
    coversTarget,
  };
}

function isNoRoutePlan(plan = null) {
  return plan?.planStatus === "blocked" && plan?.blockedReason === "no_route";
}

function blockedPreparation({ job, executor = null, blockedReason, plan = null, coverage = null }) {
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
  };
}

function readyPreparation({ job, executor, plan, coverage }) {
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    status: "ready",
    jobId: job.jobId,
    executionMethod: job.executionMethod,
    executor,
    plan,
    coverage,
  };
}

export function refillExecutorForJob(job = {}) {
  if (job.executionMethod === "same_chain_token_to_native_swap") return "token_dex_experiment";
  if (job.executionMethod === "same_chain_native_to_token_swap") return "native_dex_experiment";
  if (job.executionMethod === "gas_refuel_bridge_gas_zip" && job.type === "refill_native") return "gas_zip_native_refuel";
  if (
    job.executionMethod === "cross_chain_bridge_or_swap" &&
    job.type === "refill_native" &&
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

export async function buildTreasuryRefillExecutionPlan({
  job,
  senderAddress,
  bitcoinSenderAddress = null,
  auditRecords = [],
  destinationBalanceStatus = null,
  destinationNativeDecimal = null,
  destinationMinBalanceDecimal = null,
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
    plan = await buildTokenDexPlanImpl({
      chain: job.chain,
      amount,
      senderAddress,
      inputToken: source.token,
      outputToken: "native",
    });
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
    const sourceAmount = positiveBigInt(source.actual);
    const amount = job.type === "refill_native" ? estimateInputAmountFromSource({ job, source }) : targetAmount?.toString() || null;
    if (job.type === "refill_native" && !amount) {
      return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });
    }
    if (job.type !== "refill_native" && !targetAmount) return blockedPreparation({ job, executor, blockedReason: "target_amount_unavailable" });
    if (job.type !== "refill_native" && sourceAmount != null && sourceAmount < targetAmount) {
      return blockedPreparation({ job, executor, blockedReason: "source_inventory_below_target_amount" });
    }
    plan = await buildGatewayBtcPlanImpl({
      srcChain: source.chain,
      dstChain: job.chain,
      srcToken: source.token,
      dstToken: job.type === "refill_native" ? WBTC_OFT_TOKEN : job.token,
      amount,
      senderAddress,
      recipient: senderAddress,
      gasRefill: job.type === "refill_native" ? job.targetAmount : null,
    });
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
      dstToken: WBTC_OFT_TOKEN,
      gasRefill: gasRefill?.toString() || null,
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
    const amount = job.type === "refill_native"
      ? estimateInputAmountFromSource({ job, source })
      : positiveBigInt(job.targetAmount)?.toString() || null;
    if (!amount) return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });
    plan = await buildLifiBridgePlanImpl({
      srcChain: source.chain,
      dstChain: job.chain,
      srcToken: source.token,
      dstToken: job.type === "refill_native" ? ZERO_TOKEN : job.token,
      amount,
      senderAddress,
      recipient: senderAddress,
    });
  } else if (executor === "cross_chain_btc_intermediate") {
    // Step 1: DEX swap source token → wBTC.OFT on source chain
    const dexAmount = estimateInputAmountFromSource({ job, source });
    if (!dexAmount) return blockedPreparation({ job, executor, blockedReason: "source_input_amount_unavailable" });

    const step1Plan = await buildTokenDexPlanImpl({
      chain: source.chain,
      amount: dexAmount,
      senderAddress,
      inputToken: source.token,
      outputToken: "wbtc.oft",
    });

    if (step1Plan.planStatus !== "ready") {
      return blockedPreparation({ job, executor, blockedReason: step1Plan.blockedReason || "dex_step_blocked", plan: step1Plan });
    }

    // Step 2: Gateway consolidation wBTC.OFT from source chain → destination chain
    const gatewayAmount = step1Plan.minimumOutputAmount;
    const gasRefill = job.type === "refill_native" ? job.targetAmount : null;

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
        dstToken: WBTC_OFT_TOKEN,
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
          inputToken: WBTC_OFT_TOKEN,
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
        const lifiPlan = await buildLifiBridgePlanImpl({
          srcChain: source.chain,
          dstChain: job.chain,
          srcToken: source.token,
          dstToken: job.token,
          amount: lifiAmount,
          senderAddress,
          recipient: senderAddress,
        });
        if (lifiPlan.planStatus === "ready") {
          const lifiCoverage = coverageForPlan({ plan: lifiPlan, job, executor: "lifi_bridge" });
          if (lifiCoverage.coversTarget !== false) {
            return readyPreparation({ job, executor: "lifi_bridge", plan: lifiPlan, coverage: lifiCoverage });
          }
          return blockedPreparation({
            job,
            executor: "lifi_bridge",
            blockedReason: "executor_output_below_refill_target",
            plan: lifiPlan,
            coverage: lifiCoverage,
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

  if (plan?.planStatus !== "ready") {
    return blockedPreparation({
      job,
      executor,
      blockedReason: plan?.blockedReason || "executor_plan_blocked",
      plan,
    });
  }

  const coverage = executor === "cross_chain_btc_intermediate"
    ? coverageForPlan({
        plan: plan.step3?.plan || plan.step2.plan,
        job,
        executor: plan.step3 ? "token_dex_experiment" : "gateway_btc_consolidation",
      })
    : coverageForPlan({ plan, job, executor });
  if (coverage.coversTarget === false) {
    return blockedPreparation({
      job,
      executor,
      blockedReason: "executor_output_below_refill_target",
      plan,
      coverage,
    });
  }

  return readyPreparation({ job, executor, plan, coverage });
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
    const step2Result = await executeGatewayBtcPlanImpl({ plan: preparation.plan.step2.plan, ...executionOptions });
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
