import { setTimeout as delay } from "node:timers/promises";
import { WBTC_OFT_TOKEN } from "../../assets/tokens.mjs";
import { getEnv } from "../../config/env.mjs";
import { PAYBACK_CONFIG } from "../../config/payback.mjs";
import { buildTokenDexExperimentPlan, executeTokenDexExperimentPlan } from "../helpers/token-dex-experiment.mjs";
import {
  buildGatewayBtcConsolidationPlan,
  executeGatewayBtcConsolidationPlan,
  GATEWAY_BTC_CONSOLIDATION_STRATEGY_ID,
} from "../helpers/gateway-btc-consolidation.mjs";
import {
  buildGatewayBtcOfframpPlan,
  executeGatewayBtcOfframpPlan,
  GATEWAY_BTC_OFFRAMP_STRATEGY_ID,
} from "../helpers/gateway-btc-offramp.mjs";
import snapshotPaybackAccumulator from "./accumulator.mjs";
import { checkKillSwitch } from "../policy/kill-switch.mjs";
import { readSignerHealth } from "../signer/client.mjs";

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const BTC_SATS = 100_000_000;

function finiteNumber(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function finiteNonNegative(value) {
  const numeric = finiteNumber(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function positiveIntegerString(value, label) {
  if (typeof value === "bigint") {
    if (value <= 0n) throw new Error(`${label} must be a positive integer`);
    return value.toString();
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!/^[0-9]+$/.test(normalized) || normalized === "0") {
      throw new Error(`${label} must be a positive integer`);
    }
    return normalized;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return String(value);
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizeRecord(item) {
  if (!item) return null;
  if (typeof item === "string") {
    try {
      const parsed = JSON.parse(item);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof item === "object" ? item : null;
}

function normalizeRecordList(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeRecord).filter(Boolean);
}

function latestRecord(items = []) {
  let winner = null;
  let winnerMs = -1;
  for (const item of items) {
    const observedAtMs = normalizeTimestamp(
      item?.observedAt ||
        item?.timestamp ||
        item?.settledAt ||
        item?.generatedAt,
    );
    if (observedAtMs != null && observedAtMs >= winnerMs) {
      winner = item;
      winnerMs = observedAtMs;
    }
  }
  return winner;
}

function roundSats(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function usdToSats(usdValue, btcUsd) {
  if (!Number.isFinite(usdValue) || !Number.isFinite(btcUsd) || btcUsd <= 0) return null;
  return roundSats((usdValue / btcUsd) * BTC_SATS);
}

function normalizeCronField(field, min, max, aliases = {}) {
  const normalized = String(field || "").trim().toLowerCase();
  if (!normalized) throw new Error("Cron field is required");
  if (normalized === "*") {
    return {
      matches: () => true,
    };
  }

  const allowedValues = new Set();
  for (const part of normalized.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron step: ${part}`);
    }
    let rangeStart = min;
    let rangeEnd = max;
    if (rangePart && rangePart !== "*") {
      const [left, right] = rangePart.split("-");
      const start = cronValue(left, aliases, min, max);
      const end = right ? cronValue(right, aliases, min, max) : start;
      rangeStart = Math.min(start, end);
      rangeEnd = Math.max(start, end);
    }
    for (let value = rangeStart; value <= rangeEnd; value += step) {
      allowedValues.add(value);
    }
  }
  return {
    matches: (value) => allowedValues.has(value),
  };
}

function cronValue(token, aliases, min, max) {
  const normalized = String(token || "").trim().toLowerCase();
  const alias = Object.prototype.hasOwnProperty.call(aliases, normalized) ? aliases[normalized] : Number(normalized);
  if (!Number.isInteger(alias)) {
    throw new Error(`Invalid cron value: ${token}`);
  }
  if (alias < min || alias > max) {
    throw new Error(`Cron value out of range: ${token}`);
  }
  return alias;
}

export function matchesCronExpression(cronExpression, now = new Date()) {
  const fields = String(cronExpression || "").trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Unsupported cron expression: ${cronExpression}`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const weekdayAliases = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
    "7": 0,
  };
  const date = now instanceof Date ? now : new Date(now);
  return (
    normalizeCronField(minute, 0, 59).matches(date.getUTCMinutes()) &&
    normalizeCronField(hour, 0, 23).matches(date.getUTCHours()) &&
    normalizeCronField(dayOfMonth, 1, 31).matches(date.getUTCDate()) &&
    normalizeCronField(month, 1, 12).matches(date.getUTCMonth() + 1) &&
    normalizeCronField(dayOfWeek, 0, 6, weekdayAliases).matches(date.getUTCDay())
  );
}

function sameCronMinute(left, right) {
  const leftDate = new Date(left || 0);
  const rightDate = new Date(right || 0);
  return (
    leftDate.getUTCFullYear() === rightDate.getUTCFullYear() &&
    leftDate.getUTCMonth() === rightDate.getUTCMonth() &&
    leftDate.getUTCDate() === rightDate.getUTCDate() &&
    leftDate.getUTCHours() === rightDate.getUTCHours() &&
    leftDate.getUTCMinutes() === rightDate.getUTCMinutes()
  );
}

export function loadPaybackPolicyConfig(paybackConfig = PAYBACK_CONFIG) {
  return Object.freeze({
    baseRatio: finiteNumber(paybackConfig.baseRatio),
    minPaybackSats: finiteNonNegative(paybackConfig.minPaybackSats) ?? 0,
    maxOfframpCostPctOfPayback: finiteNumber(paybackConfig.maxOfframpCostPctOfPayback),
    perPeriodMaxSats: finiteNonNegative(paybackConfig.perPeriodMaxSats),
    annualMaxPaybackSats: finiteNonNegative(paybackConfig.annualMaxPaybackSats),
    regimeMultipliers: {
      bear: finiteNumber(paybackConfig.regimeMultipliers?.bear) ?? 1.2,
      neutral: finiteNumber(paybackConfig.regimeMultipliers?.neutral) ?? 1.0,
      bullPeak: finiteNumber(paybackConfig.regimeMultipliers?.bullPeak) ?? 0.7,
    },
    volMultiplier: {
      cap: finiteNumber(paybackConfig.volMultiplier?.cap) ?? 1.0,
      thresholdAnnualized: finiteNumber(paybackConfig.volMultiplier?.thresholdAnnualized) ?? 0.5,
    },
    emergencyPause: {
      offrampSlippageBpsMax: finiteNonNegative(paybackConfig.emergencyPause?.offrampSlippageBpsMax),
      operatingDrawdownPctMax: finiteNonNegative(paybackConfig.emergencyPause?.operatingDrawdownPctMax),
      protocolExploitList: Array.isArray(paybackConfig.emergencyPause?.protocolExploitList)
        ? [...paybackConfig.emergencyPause.protocolExploitList]
        : [],
    },
    cronExpression: String(paybackConfig.cronExpression),
    destinationPath: {
      profitReserveChain: paybackConfig.destinationPath?.profitReserveChain || "base",
      swapVenueOrdered: Array.isArray(paybackConfig.destinationPath?.swapVenueOrdered)
        ? [...paybackConfig.destinationPath.swapVenueOrdered]
        : [],
      composerRoute: paybackConfig.destinationPath?.composerRoute || "layerzero",
      gatewayOfframpStage: paybackConfig.destinationPath?.gatewayOfframpStage || "BOB_L2",
      bitcoinDestAddressEnv: paybackConfig.destinationPath?.bitcoinDestAddressEnv || null,
    },
  });
}

function normalizeRegime(regime) {
  if (!regime) return "neutral";
  const normalized = String(regime).trim();
  if (["bear", "neutral", "bullPeak"].includes(normalized)) return normalized;
  throw new Error(`Unsupported payback regime: ${regime}`);
}

function resolveRegimeMultiplier(policy, regime) {
  const normalizedRegime = normalizeRegime(regime);
  return {
    regime: normalizedRegime,
    multiplier: policy.regimeMultipliers[normalizedRegime] ?? 1,
  };
}

function resolveVolMultiplier(policy, realizedVolAnnualized) {
  const threshold = policy.volMultiplier.thresholdAnnualized;
  const cap = policy.volMultiplier.cap;
  if (!Number.isFinite(realizedVolAnnualized) || realizedVolAnnualized <= 0) {
    return {
      annualized: realizedVolAnnualized ?? null,
      multiplier: cap,
      source: "cap_default",
    };
  }
  return {
    annualized: realizedVolAnnualized,
    multiplier: Math.min(cap, threshold / realizedVolAnnualized),
    source: "realized_vol_annualized",
  };
}

function resolvePaybackRecipient(policy, { getEnvImpl = getEnv, recipientOverride = null } = {}) {
  const envName = policy.destinationPath.bitcoinDestAddressEnv;
  if (!envName) {
    return { ok: false, reason: "payback_btc_destination_env_missing", recipient: null, envName: null };
  }
  if (typeof recipientOverride === "string" && recipientOverride.trim() !== "") {
    return { ok: true, reason: null, recipient: recipientOverride.trim(), envName };
  }
  const recipient = getEnvImpl(envName, null);
  if (!recipient) {
    return { ok: false, reason: "payback_btc_destination_missing", recipient: null, envName };
  }
  return { ok: true, reason: null, recipient, envName };
}

function inferReserveStateFromReceiptStore(receiptStore, policy) {
  const inventorySnapshots = normalizeRecordList([
    ...(Array.isArray(receiptStore?.treasuryInventory) ? receiptStore.treasuryInventory : []),
    ...(Array.isArray(receiptStore?.inventorySnapshots) ? receiptStore.inventorySnapshots : []),
  ]);
  const latestInventory = latestRecord(inventorySnapshots);
  if (!latestInventory) return null;
  const candidates = (latestInventory.tokens || [])
    .filter((item) =>
      item?.chain === policy.destinationPath.profitReserveChain &&
      String(item?.token || "").toLowerCase() === WBTC_OFT_TOKEN.toLowerCase() &&
      finiteNonNegative(item.actual) > 0,
    );
  if (candidates.length !== 1) return null;
  return {
    chain: candidates[0].chain,
    inputToken: candidates[0].token,
    amount: candidates[0].actual,
    routeSideToken: candidates[0].token,
    source: "latest_treasury_inventory_unique_wbtc_oft",
  };
}

function normalizeReserveState(reserveState, policy, receiptStore) {
  const inferred = reserveState || inferReserveStateFromReceiptStore(receiptStore, policy);
  if (!inferred) {
    return {
      ok: false,
      reason: "reserve_asset_missing",
      reserveState: null,
    };
  }
  return {
    ok: true,
    reason: null,
    reserveState: {
      chain: inferred.chain || policy.destinationPath.profitReserveChain,
      inputToken: inferred.inputToken || inferred.token || null,
      amount: positiveIntegerString(inferred.amount, "reserve amount"),
      routeSideToken: inferred.routeSideToken || WBTC_OFT_TOKEN,
      source: inferred.source || "explicit",
    },
  };
}

function supportedSwapVenue(paybackPolicy) {
  const supported = new Set(["cowswap", "uniswap_v3"]);
  const configured = paybackPolicy.destinationPath.swapVenueOrdered || [];
  const selected = configured.find((item) => supported.has(String(item).trim().toLowerCase())) || null;
  return {
    selected,
    configured,
    supported: [...supported],
  };
}

function estimateCompositeCostSats({ swapPlan, bridgePlan, offrampPlan, btcUsd }) {
  let total = 0;

  if (swapPlan?.quote) {
    const inputUsd = finiteNumber(swapPlan.quote.inputValueUsd);
    const outputUsd = finiteNumber(swapPlan.quote.outputValueUsd);
    const swapCostUsd = Number.isFinite(inputUsd) && Number.isFinite(outputUsd) ? Math.max(0, inputUsd - outputUsd) : 0;
    total += usdToSats(swapCostUsd, btcUsd) ?? 0;
  }

  const bridgeFees = [
    bridgePlan?.quote?.fees?.amount,
    bridgePlan?.quote?.executionFees?.amount,
  ]
    .map(finiteNonNegative)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  total += bridgeFees;

  total += finiteNonNegative(offrampPlan?.quote?.fees?.amount) ?? 0;
  return total;
}

function buildEmergencyPauseEvaluation(policy, context = {}) {
  const explicitProtocols = Array.isArray(context.activeProtocolAlerts)
    ? context.activeProtocolAlerts
    : Array.isArray(context.protocolAlerts)
      ? context.protocolAlerts
      : [];
  const activeProtocols = new Set(explicitProtocols.map((item) => String(item).trim().toLowerCase()).filter(Boolean));
  const blockedProtocols = (policy.emergencyPause.protocolExploitList || [])
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean)
    .filter((item) => activeProtocols.has(item));
  const offrampSlippageBps = finiteNonNegative(context.offrampSlippageBps);
  const operatingDrawdownPct = finiteNonNegative(context.operatingDrawdownPct);
  const reasons = [];
  if (
    Number.isFinite(policy.emergencyPause.offrampSlippageBpsMax) &&
    Number.isFinite(offrampSlippageBps) &&
    offrampSlippageBps > policy.emergencyPause.offrampSlippageBpsMax
  ) {
    reasons.push("offramp_slippage_bps_limit_exceeded");
  }
  if (
    Number.isFinite(policy.emergencyPause.operatingDrawdownPctMax) &&
    Number.isFinite(operatingDrawdownPct) &&
    operatingDrawdownPct > policy.emergencyPause.operatingDrawdownPctMax
  ) {
    reasons.push("operating_drawdown_limit_exceeded");
  }
  if (blockedProtocols.length > 0) {
    reasons.push("protocol_exploit_pause");
  }
  return {
    paused: reasons.length > 0,
    reasons,
    inputs: {
      offrampSlippageBps: Number.isFinite(offrampSlippageBps) ? offrampSlippageBps : null,
      operatingDrawdownPct: Number.isFinite(operatingDrawdownPct) ? operatingDrawdownPct : null,
      blockedProtocols,
    },
  };
}

function buildAccumulatorConfig(policy, runtime = {}) {
  return {
    ...runtime.accumulatorConfig,
    periodId: runtime.periodId || "scheduler_period",
    periodStartAt: runtime.periodStartAt || null,
    periodEndAt: runtime.periodEndAt || runtime.now,
    paybackStrategyIds: [GATEWAY_BTC_OFFRAMP_STRATEGY_ID],
    paybackIntentTypes: ["gateway_btc_offramp"],
    btcUsd: finiteNumber(runtime.btcUsd) ?? null,
  };
}

export async function buildPaybackDecision({
  auditLogLines = [],
  receiptStore = {},
  reserveState = null,
  paybackConfig = PAYBACK_CONFIG,
  now = new Date().toISOString(),
  marketState = {},
  riskState = {},
  accumulatorSnapshot = snapshotPaybackAccumulator,
  getEnvImpl = getEnv,
  recipientOverride = null,
} = {}) {
  const policy = loadPaybackPolicyConfig(paybackConfig);
  const accumulatorConfig = buildAccumulatorConfig(policy, {
    now,
    periodId: marketState.periodId || riskState.periodId || null,
    periodStartAt: marketState.periodStartAt || riskState.periodStartAt || null,
    periodEndAt: marketState.periodEndAt || riskState.periodEndAt || now,
    btcUsd: marketState.btcUsd || riskState.btcUsd || null,
  });
  const snapshot = accumulatorSnapshot(auditLogLines, receiptStore, accumulatorConfig);
  const recipient = resolvePaybackRecipient(policy, {
    getEnvImpl,
    recipientOverride,
  });
  if (!recipient.ok) {
    const reason = "missing_destination_config";
    return {
      schemaVersion: 1,
      observedAt: now,
      policy,
      snapshot,
      status: "blocked",
      reason,
      decisionLog: {
        observedAt: now,
        reason,
        inputs: {
          bitcoinDestAddressEnv: recipient.envName,
          underlyingReason: recipient.reason,
        },
      },
    };
  }

  const reserve = normalizeReserveState(reserveState, policy, receiptStore);

  const emergencyPause = buildEmergencyPauseEvaluation(policy, {
    ...marketState,
    ...riskState,
  });
  if (emergencyPause.paused) {
    return {
      schemaVersion: 1,
      observedAt: now,
      policy,
      snapshot,
      reserveState: reserve.reserveState,
      status: "paused",
      reason: emergencyPause.reasons.join(","),
      decisionLog: {
        observedAt: now,
        reason: "emergency_pause",
        emergencyPause,
      },
    };
  }

  const { regime, multiplier: regimeMultiplier } = resolveRegimeMultiplier(policy, marketState.regime || riskState.regime || "neutral");
  const vol = resolveVolMultiplier(policy, finiteNumber(marketState.realizedVolAnnualized) ?? finiteNumber(riskState.realizedVolAnnualized));
  const grossProfitSatsPeriod = finiteNonNegative(snapshot.grossProfitSats_period) ?? 0;
  const grossTargetBeforeCostsSats = roundSats(grossProfitSatsPeriod * policy.baseRatio * regimeMultiplier * vol.multiplier);
  const rollingPaidBackSats =
    finiteNonNegative(marketState.paidBackSatsRolling12m) ??
    finiteNonNegative(riskState.paidBackSatsRolling12m) ??
    finiteNonNegative(snapshot.paidBackSats_lifetime) ??
    0;

  if (grossTargetBeforeCostsSats <= 0) {
    return {
      schemaVersion: 1,
      observedAt: now,
      policy,
      snapshot,
      reserveState: reserve.reserveState,
      status: "carry",
      reason: "non_positive_payback_target",
      decisionLog: {
        observedAt: now,
        reason: "non_positive_payback_target",
        inputs: {
          grossProfitSatsPeriod,
          baseRatio: policy.baseRatio,
          regime,
          regimeMultiplier,
          volAnnualized: vol.annualized,
          volMultiplier: vol.multiplier,
          grossTargetBeforeCostsSats,
        },
      },
    };
  }

  if (grossTargetBeforeCostsSats < policy.minPaybackSats) {
    return {
      schemaVersion: 1,
      observedAt: now,
      policy,
      snapshot,
      reserveState: reserve.reserveState,
      status: "carry",
      reason: "planned_payback_below_minimum",
      decisionLog: {
        observedAt: now,
        reason: "planned_payback_below_minimum",
        inputs: {
          grossProfitSatsPeriod,
          baseRatio: policy.baseRatio,
          regime,
          regimeMultiplier,
          volAnnualized: vol.annualized,
          volMultiplier: vol.multiplier,
          grossTargetBeforeCostsSats,
          minPaybackSats: policy.minPaybackSats,
          pendingDeferredSats: snapshot.pendingDeferredSats,
        },
      },
    };
  }

  if (!reserve.ok) {
    return {
      schemaVersion: 1,
      observedAt: now,
      policy,
      snapshot,
      status: "defer",
      reason: reserve.reason,
      decisionLog: {
        observedAt: now,
        reason: reserve.reason,
        inputs: {
          profitReserveChain: policy.destinationPath.profitReserveChain,
        },
      },
    };
  }

  if (grossTargetBeforeCostsSats > policy.perPeriodMaxSats) {
    return {
      schemaVersion: 1,
      observedAt: now,
      policy,
      snapshot,
      reserveState: reserve.reserveState,
      status: "defer",
      reason: "per_period_cap_exceeded",
      decisionLog: {
        observedAt: now,
        reason: "per_period_cap_exceeded",
        inputs: {
          grossTargetBeforeCostsSats,
          perPeriodMaxSats: policy.perPeriodMaxSats,
        },
      },
    };
  }

  if (rollingPaidBackSats + grossTargetBeforeCostsSats > policy.annualMaxPaybackSats) {
    return {
      schemaVersion: 1,
      observedAt: now,
      policy,
      snapshot,
      reserveState: reserve.reserveState,
      status: "defer",
      reason: "annual_payback_cap_exceeded",
      decisionLog: {
        observedAt: now,
        reason: "annual_payback_cap_exceeded",
        inputs: {
          rollingPaidBackSats,
          annualMaxPaybackSats: policy.annualMaxPaybackSats,
          grossTargetBeforeCostsSats,
          rollingPaidBackSource:
            finiteNonNegative(marketState.paidBackSatsRolling12m) != null ||
            finiteNonNegative(riskState.paidBackSatsRolling12m) != null
              ? "explicit_rolling_12m"
              : "lifetime_fallback",
        },
      },
    };
  }

  return {
    schemaVersion: 1,
    observedAt: now,
    policy,
    snapshot,
    recipient: recipient.recipient,
    reserveState: reserve.reserveState,
    status: "plan",
    reason: "planning_required",
    decisionLog: {
      observedAt: now,
      periodId: accumulatorConfig.periodId || null,
      inputs: {
        periodId: accumulatorConfig.periodId || null,
        periodStartAt: accumulatorConfig.periodStartAt || null,
        periodEndAt: accumulatorConfig.periodEndAt || null,
        grossProfitSatsPeriod,
        paidBackSatsRolling12m: rollingPaidBackSats,
        pendingDeferredSats: snapshot.pendingDeferredSats,
      },
      applied: {
        baseRatio: policy.baseRatio,
        regime,
        regimeMultiplier,
        volAnnualized: vol.annualized,
        volMultiplier: vol.multiplier,
        grossTargetBeforeCostsSats,
      },
      result: {
        status: "plan",
      },
    },
  };
}

export async function buildCompositePaybackPlan({
  decision,
  paybackConfig = PAYBACK_CONFIG,
  signerHealthReader = readSignerHealth,
  tokenDexPlanBuilder = buildTokenDexExperimentPlan,
  consolidationPlanBuilder = buildGatewayBtcConsolidationPlan,
  offrampPlanBuilder = buildGatewayBtcOfframpPlan,
  now = new Date().toISOString(),
} = {}) {
  if (decision?.status !== "plan") {
    return {
      schemaVersion: 1,
      observedAt: now,
      status: decision?.status || "blocked",
      reason: decision?.reason || "decision_not_plannable",
      decision,
      compositePlan: null,
    };
  }

  const policy = loadPaybackPolicyConfig(paybackConfig);
  const health = await signerHealthReader();
  const senderAddress = decision.reserveState?.senderAddress || health?.addresses?.base || null;
  const recipient = decision.recipient || getEnv(policy.destinationPath.bitcoinDestAddressEnv, null);
  if (!senderAddress) {
    return {
      schemaVersion: 1,
      observedAt: now,
      status: "blocked",
      reason: "signer_base_address_missing",
      decision,
      compositePlan: null,
    };
  }
  if (!recipient) {
    return {
      schemaVersion: 1,
      observedAt: now,
      status: "blocked",
      reason: "payback_btc_destination_missing",
      decision,
      compositePlan: null,
    };
  }

  const reserve = decision.reserveState;
  const routeSideToken = reserve.routeSideToken || WBTC_OFT_TOKEN;
  const reserveToken = reserve.inputToken;
  let swapPlan = null;
  let bridgeInputAmount = reserve.amount;
  let swapSkipped = false;
  if (String(reserveToken || "").toLowerCase() === String(routeSideToken).toLowerCase()) {
    swapSkipped = true;
  } else {
    const swapSupport = supportedSwapVenue(policy);
    if (!swapSupport.selected) {
      return {
        schemaVersion: 1,
        observedAt: now,
        status: "defer",
        reason: `swap_venue_not_supported:${swapSupport.configured.join(",") || "none"}`,
        decision,
        compositePlan: null,
      };
    }
    swapPlan = await tokenDexPlanBuilder({
      chain: reserve.chain,
      amount: reserve.amount,
      senderAddress,
      inputToken: reserveToken,
      outputToken: routeSideToken,
      now,
    });
    if (swapPlan.planStatus !== "ready") {
      return {
        schemaVersion: 1,
        observedAt: now,
        status: "defer",
        reason: `swap_plan_blocked:${swapPlan.blockedReason || "unknown"}`,
        decision,
        compositePlan: null,
      };
    }
    bridgeInputAmount = positiveIntegerString(
      swapPlan.minimumOutputAmount || swapPlan.quote?.outputAmount || reserve.amount,
      "bridgeInputAmount",
    );
  }

  let bridgePlan = null;
  let bridgeSkipped = false;
  let offrampInputAmount = bridgeInputAmount;
  if (reserve.chain === "bob" && String(routeSideToken).toLowerCase() === String(WBTC_OFT_TOKEN).toLowerCase()) {
    bridgeSkipped = true;
  } else {
    bridgePlan = await consolidationPlanBuilder({
      srcChain: reserve.chain,
      dstChain: "bob",
      srcToken: routeSideToken,
      dstToken: WBTC_OFT_TOKEN,
      amount: bridgeInputAmount,
      senderAddress,
      recipient: senderAddress,
      now,
    });
    if (bridgePlan.planStatus !== "ready" || !bridgePlan.intent) {
      return {
        schemaVersion: 1,
        observedAt: now,
        status: "defer",
        reason: `composer_bridge_blocked:${bridgePlan.blockedReason || "unknown"}`,
        decision,
        compositePlan: null,
      };
    }
    offrampInputAmount = positiveIntegerString(bridgePlan.quote?.outputAmount?.amount || bridgeInputAmount, "offrampInputAmount");
  }

  const offrampPlan = await offrampPlanBuilder({
    srcChain: bridgeSkipped ? reserve.chain : "bob",
    srcToken: WBTC_OFT_TOKEN,
    amount: offrampInputAmount,
    senderAddress,
    recipient,
    now,
  });
  if (offrampPlan.planStatus !== "ready" || !offrampPlan.intent) {
    return {
      schemaVersion: 1,
      observedAt: now,
      status: "defer",
      reason: `gateway_offramp_blocked:${offrampPlan.blockedReason || "unknown"}`,
      decision,
      compositePlan: null,
    };
  }

  const btcUsd =
    finiteNumber(decision.decisionLog?.inputs?.btcUsd) ??
    finiteNumber(decision.snapshot?.kpi?.btcUsd) ??
    finiteNumber(decision.policy?.btcUsd) ??
    null;
  const estimatedOfframpCostSats = estimateCompositeCostSats({
    swapPlan,
    bridgePlan,
    offrampPlan,
    btcUsd: finiteNumber(decision.snapshot?.btcUsd) ?? finiteNumber(btcUsd) ?? null,
  });
  const grossTargetBeforeCostsSats = finiteNonNegative(decision.decisionLog?.applied?.grossTargetBeforeCostsSats) ?? 0;
  const plannedPaybackSats = Math.max(0, grossTargetBeforeCostsSats - estimatedOfframpCostSats);
  if (plannedPaybackSats < policy.minPaybackSats) {
    return {
      schemaVersion: 1,
      observedAt: now,
      status: "carry",
      reason: "net_payback_below_minimum",
      decision: {
        ...decision,
        decisionLog: {
          ...decision.decisionLog,
          result: {
            status: "carry",
            reason: "net_payback_below_minimum",
            estimatedOfframpCostSats,
            plannedPaybackSats,
          },
        },
      },
      compositePlan: null,
    };
  }
  if (estimatedOfframpCostSats > plannedPaybackSats * policy.maxOfframpCostPctOfPayback) {
    return {
      schemaVersion: 1,
      observedAt: now,
      status: "defer",
      reason: "estimated_offramp_cost_too_high",
      decision: {
        ...decision,
        decisionLog: {
          ...decision.decisionLog,
          result: {
            status: "defer",
            reason: "estimated_offramp_cost_too_high",
            estimatedOfframpCostSats,
          },
        },
      },
      compositePlan: null,
    };
  }

  const compositePlan = {
    schemaVersion: 1,
    observedAt: now,
    strategyId: "payback-scheduler",
    recipient,
    senderAddress,
    plannedPaybackSats,
    estimatedOfframpCostSats,
    reserveState: reserve,
    decisionLog: {
      ...decision.decisionLog,
      result: {
        status: "emit_intents",
        plannedPaybackSats,
        estimatedOfframpCostSats,
        grossTargetBeforeCostsSats,
      },
    },
    route: {
      reserveChain: reserve.chain,
      reserveToken,
      routeSideToken,
      composerRoute: policy.destinationPath.composerRoute,
      offrampStage: policy.destinationPath.gatewayOfframpStage,
      bitcoinDestAddressEnv: policy.destinationPath.bitcoinDestAddressEnv,
    },
    steps: [
      ...(swapSkipped
        ? []
        : [{
            id: "destination_reserve_to_wrapped_btc_swap",
            kind: "token_dex_swap",
            plan: swapPlan,
          }]),
      ...(bridgeSkipped
        ? []
        : [{
            id: "layerzero_composer_to_bob",
            kind: "gateway_btc_consolidation",
            plan: bridgePlan,
          }]),
      {
        id: "gateway_offramp_to_bitcoin",
        kind: "gateway_btc_offramp",
        plan: offrampPlan,
      },
    ],
  };

  return {
    schemaVersion: 1,
    observedAt: now,
    status: "ready",
    reason: "emit_intents",
    decision: {
      ...decision,
      decisionLog: compositePlan.decisionLog,
    },
    compositePlan,
  };
}

function sumBigIntishSats(values) {
  let total = 0;
  for (const value of values) {
    const parsed = finiteNonNegative(value);
    if (Number.isFinite(parsed)) total += parsed;
  }
  return total;
}

function firstPresent(target, paths = []) {
  for (const path of paths) {
    const value = path.split(".").reduce(
      (acc, segment) => (acc == null ? undefined : acc[segment]),
      target,
    );
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function buildPaybackDisbursementRecord({ compositePlan, stepResults = [], now = new Date().toISOString() } = {}) {
  if (!compositePlan) {
    throw new Error("Payback disbursement record requires a composite plan");
  }
  const offrampStep = stepResults.find((step) => step?.kind === "gateway_btc_offramp") || null;
  const consolidationStep = stepResults.find((step) => step?.kind === "gateway_btc_consolidation") || null;
  const swapStep = stepResults.find((step) => step?.kind === "token_dex_swap") || null;

  const offrampExecution = offrampStep?.execution || null;
  const settledBalanceDeltaSats = finiteNumber(firstPresent(offrampExecution, [
    "destinationProof.observedDelta",
    "destinationProof.deltaSats",
    "destinationProof.balanceDelta",
  ]));
  const bitcoinTxid = firstPresent(offrampExecution, [
    "destinationProof.txid",
    "destinationProof.bitcoinTxid",
  ]);
  const gatewayOrderId = firstPresent(offrampExecution, [
    "plan.order.orderId",
    "plan.intent.metadata.gatewayOrderId",
  ]) || firstPresent(compositePlan, ["steps.2.plan.order.orderId"]);
  const sourceTxHash = firstPresent(offrampExecution, [
    "signerResult.broadcast.txHash",
  ]);
  const settlementStatus = firstPresent(offrampExecution, ["settlementStatus"]) || "source_confirmed_only";

  const realizedRoundTripCostSats = sumBigIntishSats([
    firstPresent(swapStep, ["execution.realized.realizedNetCostSats"]),
    firstPresent(swapStep, ["execution.realized.realizedGasCostSats"]),
    firstPresent(consolidationStep, ["execution.realized.realizedNetCostSats"]),
    firstPresent(consolidationStep, ["execution.realized.realizedGasCostSats"]),
    firstPresent(offrampExecution, ["realized.realizedNetCostSats"]),
    firstPresent(offrampExecution, ["realized.realizedGasCostSats"]),
    firstPresent(offrampExecution, ["plan.quote.fees.amount"]),
  ]);

  const applied = compositePlan.decisionLog?.applied || {};
  const inputs = compositePlan.decisionLog?.inputs || {};
  const periodId =
    compositePlan.decisionLog?.periodId ||
    inputs.periodId ||
    compositePlan.reserveState?.periodId ||
    `payback:${sourceTxHash || bitcoinTxid || gatewayOrderId || "unknown"}`;

  const plannedPaybackSats =
    finiteNonNegative(compositePlan.plannedPaybackSats) ??
    finiteNonNegative(compositePlan.decisionLog?.result?.plannedPaybackSats) ??
    null;
  const estimatedRoundTripCostSats =
    finiteNonNegative(compositePlan.estimatedOfframpCostSats) ??
    finiteNonNegative(compositePlan.decisionLog?.result?.estimatedOfframpCostSats) ??
    null;

  return {
    schemaVersion: 1,
    observedAt: now,
    kind: "payback_disbursement",
    strategyId: GATEWAY_BTC_OFFRAMP_STRATEGY_ID,
    periodId,
    chain: compositePlan.route?.reserveChain || compositePlan.reserveState?.chain || null,
    harvestWindow: {
      startAt: inputs.periodStartAt || null,
      endAt: inputs.periodEndAt || null,
    },
    grossProfitSats: finiteNonNegative(inputs.grossProfitSatsPeriod) ?? null,
    grossTargetBeforeCostsSats: finiteNonNegative(applied.grossTargetBeforeCostsSats) ?? null,
    appliedRatios: {
      baseRatio: finiteNumber(applied.baseRatio) ?? null,
      regime: applied.regime || null,
      regimeMultiplier: finiteNumber(applied.regimeMultiplier) ?? null,
      volAnnualized: finiteNumber(applied.volAnnualized) ?? null,
      volMultiplier: finiteNumber(applied.volMultiplier) ?? null,
    },
    plannedPaybackSats,
    estimatedRoundTripCostSats,
    realizedRoundTripCostSats,
    gatewayOrderId,
    bitcoinTxid,
    sourceTxHash,
    settlementStatus,
    settledBalanceDeltaSats: Number.isFinite(settledBalanceDeltaSats) ? settledBalanceDeltaSats : null,
    destinationProof: offrampExecution?.destinationProof || null,
    receipt: {
      sourceTxHash,
      gatewayOrderId,
      bitcoinTxid,
    },
    recipient: compositePlan.recipient || null,
    senderAddress: compositePlan.senderAddress || null,
  };
}

export async function submitCompositePaybackPlan({
  compositePlan,
  tokenDexExecutor = executeTokenDexExperimentPlan,
  consolidationExecutor = executeGatewayBtcConsolidationPlan,
  offrampExecutor = executeGatewayBtcOfframpPlan,
  disbursementRecordBuilder = buildPaybackDisbursementRecord,
  executionOptions = {},
  now = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(compositePlan?.steps) || compositePlan.steps.length === 0) {
    throw new Error("Composite payback plan has no executable steps");
  }
  const stepResults = [];
  for (const step of compositePlan.steps) {
    if (step.kind === "token_dex_swap") {
      stepResults.push({
        id: step.id,
        kind: step.kind,
        execution: await tokenDexExecutor({ plan: step.plan, ...executionOptions }),
      });
      continue;
    }
    if (step.kind === "gateway_btc_consolidation") {
      stepResults.push({
        id: step.id,
        kind: step.kind,
        execution: await consolidationExecutor({ plan: step.plan, ...executionOptions }),
      });
      continue;
    }
    if (step.kind === "gateway_btc_offramp") {
      const offrampExecutionOptions = {
        ...executionOptions,
        awaitBitcoinSettlement:
          executionOptions.awaitBitcoinSettlement ?? executionOptions.awaitDestinationSettlement,
        bitcoinSettlementTimeoutMs:
          executionOptions.bitcoinSettlementTimeoutMs ?? executionOptions.destinationSettlementTimeoutMs,
        bitcoinPollIntervalMs:
          executionOptions.bitcoinPollIntervalMs ?? executionOptions.destinationPollIntervalMs,
      };
      stepResults.push({
        id: step.id,
        kind: step.kind,
        execution: await offrampExecutor({ plan: step.plan, ...offrampExecutionOptions }),
      });
      continue;
    }
    throw new Error(`Unsupported payback composite step: ${step.kind}`);
  }
  const disbursementRecord =
    typeof disbursementRecordBuilder === "function"
      ? disbursementRecordBuilder({ compositePlan, stepResults, now })
      : null;
  return {
    schemaVersion: 1,
    observedAt: now,
    status: "submitted",
    compositePlan,
    stepResults,
    disbursementRecord,
  };
}

export async function runPaybackSchedulerTick({
  auditLogLines = [],
  receiptStore = {},
  reserveState = null,
  paybackConfig = PAYBACK_CONFIG,
  marketState = {},
  riskState = {},
  now = new Date().toISOString(),
  execute = false,
  accumulatorSnapshot = snapshotPaybackAccumulator,
  signerHealthReader = readSignerHealth,
  tokenDexPlanBuilder = buildTokenDexExperimentPlan,
  consolidationPlanBuilder = buildGatewayBtcConsolidationPlan,
  offrampPlanBuilder = buildGatewayBtcOfframpPlan,
  tokenDexExecutor = executeTokenDexExperimentPlan,
  consolidationExecutor = executeGatewayBtcConsolidationPlan,
  offrampExecutor = executeGatewayBtcOfframpPlan,
  executionOptions = {},
  killSwitchPath = process.env.KILL_SWITCH_PATH || null,
  killSwitchChecker = checkKillSwitch,
} = {}) {
  const killSwitch = await killSwitchChecker({ killSwitchPath, now });
  if (killSwitch.decision === "BLOCK") {
    return {
      schemaVersion: 1,
      observedAt: now,
      status: "halted",
      reason: "kill_switch_present",
      decision: {
        schemaVersion: 1,
        observedAt: now,
        status: "halted",
        reason: "kill_switch_present",
        decisionLog: {
          observedAt: now,
          reason: "kill_switch_present",
          killSwitch,
        },
      },
      compositePlan: null,
      execution: null,
    };
  }

  const decision = await buildPaybackDecision({
    auditLogLines,
    receiptStore,
    reserveState,
    paybackConfig,
    now,
    marketState,
    riskState,
    accumulatorSnapshot,
  });
  if (decision.status !== "plan") {
    return {
      schemaVersion: 1,
      observedAt: now,
      status: decision.status,
      reason: decision.reason,
      decision,
      compositePlan: null,
      execution: null,
    };
  }
  const planning = await buildCompositePaybackPlan({
    decision,
    paybackConfig,
    signerHealthReader,
    tokenDexPlanBuilder,
    consolidationPlanBuilder,
    offrampPlanBuilder,
    now,
  });
  if (planning.status !== "ready" || !planning.compositePlan) {
    return {
      schemaVersion: 1,
      observedAt: now,
      status: planning.status,
      reason: planning.reason,
      decision: planning.decision,
      compositePlan: null,
      execution: null,
    };
  }
  const execution = execute
    ? await submitCompositePaybackPlan({
        compositePlan: planning.compositePlan,
        tokenDexExecutor,
        consolidationExecutor,
        offrampExecutor,
        executionOptions,
      })
    : null;
  return {
    schemaVersion: 1,
    observedAt: now,
    status: execute ? execution?.status || "submitted" : "ready",
    reason: execute ? "submitted" : "emit_intents",
    decision: planning.decision,
    compositePlan: planning.compositePlan,
    execution,
  };
}

export async function runPaybackSchedulerLoop({
  paybackConfig = PAYBACK_CONFIG,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  nowFactory = () => new Date().toISOString(),
  onIteration = async () => {},
  tickImpl = runPaybackSchedulerTick,
  delayImpl = delay,
  once = false,
  tickOptions = {},
} = {}) {
  const policy = loadPaybackPolicyConfig(paybackConfig);
  let lastTriggeredAt = null;
  while (true) {
    const now = nowFactory();
    const cronMatched = matchesCronExpression(policy.cronExpression, new Date(now));
    let result = {
      schemaVersion: 1,
      observedAt: now,
      status: "idle",
      reason: "cron_not_matched",
      cronExpression: policy.cronExpression,
      cronMatched,
      lastTriggeredAt,
    };
    if (cronMatched && !sameCronMinute(lastTriggeredAt, now)) {
      result = await tickImpl({
        ...tickOptions,
        paybackConfig,
        now,
        marketState: {
          ...(tickOptions.marketState || {}),
          periodStartAt: tickOptions.marketState?.periodStartAt || lastTriggeredAt || null,
          periodEndAt: now,
        },
      });
      lastTriggeredAt = now;
    }
    await onIteration({
      ...result,
      cronExpression: policy.cronExpression,
      cronMatched,
      lastTriggeredAt,
      nextCheckInMs: once ? 0 : pollIntervalMs,
    });
    if (once) return result;
    await delayImpl(pollIntervalMs);
  }
}
