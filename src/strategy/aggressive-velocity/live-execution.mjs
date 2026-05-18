import { createHash } from "node:crypto";
import { resolvePlanBuilder } from "../../executor/protocol-binding-registry.mjs";
import { AGGRESSIVE_VELOCITY_STRATEGY_ID } from "../../config/aggressive-velocity/config.mjs";
import {
  AGGRESSIVE_VELOCITY_BTC_PRICE_USD,
  AGGRESSIVE_VELOCITY_STRATEGY_CAPS,
} from "../../config/aggressive-velocity/config.mjs";
import { resolveTinyCanaryExpectedHoldDays } from "../../config/sizing.mjs";
import { resolveOperationalAddress } from "../../config/operational-address.mjs";
import { getTokensForChain } from "../../config/token-registry.mjs";
import { getEvmChainConfig } from "../../config/chains.mjs";
import { stableSerialize } from "../../execution/journal.mjs";
import { evGate } from "../../executor/policy/ev-gate.mjs";
import { calculateExpectedNetBtcProfit } from "../../ledger/aggressive-sleeve-accounting.mjs";
import { selectHighYieldOpportunities } from "./aggressive-yield-strategist.mjs";
import { Contract, JsonRpcProvider } from "ethers";
import { buildSwapIntent } from "../../executor/helpers/swap-intent-builder.mjs";

const STABLE_SYMBOL_RE = /^(USDC|USDT|DAI|USDS|RLUSD|EURC)$/iu;
const BTC_SYMBOL_RE = /(BTC|WBTC|CBBTC|LBTC|SOLVBTC|TBTC|FBTC|WBTC\.OFT)/iu;
const ERC20_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"];
const DEFAULT_FUNDING_PROBE_USD =
  AGGRESSIVE_VELOCITY_STRATEGY_CAPS.caps?.tinyLivePerTxUsd ?? AGGRESSIVE_VELOCITY_STRATEGY_CAPS.caps?.perTxUsd ?? 25;
const DEFAULT_POLICY_PREVIEW_INTENT_TYPE_BY_BINDING = Object.freeze({
  aave_v3_pool_supply_withdraw: "aave_supply",
  erc4626_vault_supply_withdraw: "erc4626_deposit",
  euler_evault_deposit_withdraw: "euler_evault_deposit",
  pendle_pt_vault_deposit_withdraw: "pendle_pt_vault_deposit",
});

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function stableHash(value = {}) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function candidateBinding(candidate = {}) {
  return candidate.protocolBinding || candidate.protocolBindingPlan?.resolvedBinding || {};
}

function amountUnitsFromUsd(amountUsd, assetPriceUsd, assetDecimals) {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("amountUsd must be a positive finite number");
  }
  if (!Number.isFinite(assetPriceUsd) || assetPriceUsd <= 0) {
    throw new Error("assetPriceUsd must be a positive finite number");
  }
  if (!Number.isInteger(assetDecimals) || assetDecimals < 0) {
    throw new Error("assetDecimals must be a non-negative integer");
  }
  const units = Math.floor((amountUsd / assetPriceUsd) * 10 ** assetDecimals);
  if (units <= 0) {
    throw new Error("amount_units_round_to_zero");
  }
  return String(units);
}

export function resolveAggressiveVelocityBindingKind(candidate = {}) {
  const protocolId = String(candidate.protocolId || candidate.protocol || "").toLowerCase();
  const binding = candidateBinding(candidate);

  if (binding.poolAddressProviderAddress || binding.poolAddress || binding.aTokenAddress) {
    return "aave_v3_pool_supply_withdraw";
  }
  if (protocolId === "euler" && binding.vaultAddress && binding.assetAddress) {
    return "euler_evault_deposit_withdraw";
  }
  if (protocolId === "pendle" && binding.vaultAddress && binding.assetAddress) {
    return "pendle_pt_vault_deposit_withdraw";
  }
  if (binding.vaultAddress && binding.assetAddress) {
    return "erc4626_vault_supply_withdraw";
  }
  return null;
}

export function resolveAggressiveVelocityAssetPriceUsd(candidate = {}, { btcPriceUsd } = {}) {
  const binding = candidateBinding(candidate);
  const symbol = normalizeSymbol(
    binding.assetSymbol || candidate.assetSymbol || candidate.entryTokenSymbols?.[0] || candidate.tokenSymbols?.[0],
  );
  if (STABLE_SYMBOL_RE.test(symbol)) return 1;
  if (BTC_SYMBOL_RE.test(symbol)) return btcPriceUsd;
  return null;
}

export function buildAggressiveVelocityQueueItem(
  candidate = {},
  { bindingKind = null, estimatedGasCostUsd = null } = {},
) {
  const binding = candidateBinding(candidate);
  return {
    queueId: `aggressive:${candidate.opportunityId || candidate.chain || "unknown"}`,
    opportunityId: candidate.opportunityId || null,
    chain: candidate.chain || null,
    protocolId: candidate.protocolId || candidate.protocol || null,
    mappedStrategyId: AGGRESSIVE_VELOCITY_STRATEGY_ID,
    estimatedGasCostUsd: Number.isFinite(estimatedGasCostUsd) ? estimatedGasCostUsd : null,
    protocolBindingPlan: {
      status: "binding_ready",
      bindingKind,
      resolvedBinding: {
        ...binding,
      },
    },
  };
}

function aggressiveDisplayedAprPct(candidate = {}) {
  const values = [
    candidate.displayedAprPct,
    candidate.aprPct,
    candidate.apr,
    candidate.apy,
    candidate.totalApy,
    candidate.rewardApy,
  ];
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== null && parsed > 0) return parsed;
  }
  return null;
}

function aggressiveExpectedHoldDays(candidate = {}, now = new Date().toISOString()) {
  return resolveTinyCanaryExpectedHoldDays({
    expectedHoldDays: candidate.expectedHoldDays,
    campaignRemainingHours: candidate.campaignRemainingHours ?? candidate.remainingHours,
    campaignEndsAt: candidate.campaignEndsAt,
    now,
  });
}

export function estimateAggressiveVelocityExpectedNetUsd({
  candidate = {},
  amountUsd = 0,
  estimatedGasCostUsd = null,
  now = new Date().toISOString(),
} = {}) {
  const aprPct = aggressiveDisplayedAprPct(candidate);
  const holdDays = aggressiveExpectedHoldDays(candidate, now);
  const remainingHours = finiteNumber(candidate.remainingHours ?? candidate.campaignRemainingHours);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isFinite(remainingHours) || remainingHours <= 0) {
    return {
      expectedGrossYieldUsd: null,
      expectedNetUsd: null,
      aprPct,
      expectedHoldDays: holdDays,
      estimatedGasCostUsd: finiteNumber(estimatedGasCostUsd),
      expectedNetBtcProfit: null,
      totalRoundtripCostUsd: finiteNumber(estimatedGasCostUsd),
    };
  }
  const projection = calculateExpectedNetBtcProfit({
    incentiveUsdPerDay: candidate.incentiveUsdPerDay || 0,
    remainingHours,
    positionKey: `${candidate.chain || "unknown"}:${candidate.protocolId || candidate.protocol || "unknown"}`,
    currentBtcPriceUsd: AGGRESSIVE_VELOCITY_BTC_PRICE_USD,
    positionValueUsd: amountUsd,
    aprPct,
  });
  return {
    expectedGrossYieldUsd: finiteNumber(projection.grossYieldUsd),
    expectedNetUsd: projection.expectedNetUsd ?? null,
    aprPct,
    expectedHoldDays: holdDays,
    estimatedGasCostUsd: projection.totalRoundtripCostUsd ?? finiteNumber(estimatedGasCostUsd),
    expectedNetBtcProfit: projection.expectedNetBtcProfit ?? null,
    totalRoundtripCostUsd: projection.totalRoundtripCostUsd ?? finiteNumber(estimatedGasCostUsd),
  };
}

function aggressivePolicyPreviewIntentType(bindingKind = null) {
  return DEFAULT_POLICY_PREVIEW_INTENT_TYPE_BY_BINDING[bindingKind] || "erc4626_deposit";
}

export function buildAggressiveVelocityPolicyPreview({
  candidate = {},
  bindingKind = null,
  amountUsd = DEFAULT_FUNDING_PROBE_USD,
  chain = null,
  strategyId = AGGRESSIVE_VELOCITY_STRATEGY_ID,
  receiptRecords = [],
  auditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  const economics = estimateAggressiveVelocityExpectedNetUsd({
    candidate,
    amountUsd,
    estimatedGasCostUsd: candidate.estimatedRoundtripCostUsd ?? null,
    now,
  });
  const intent = {
    strategyId,
    chain: chain || candidate.chain || null,
    intentType: aggressivePolicyPreviewIntentType(bindingKind),
    observedAt: now,
    executionReason: "strategy_execution",
    metadata: {
      expectedNetUsd: economics.expectedNetUsd,
      estimatedGasCostUsd: economics.estimatedGasCostUsd,
    },
  };
  const verdict = evGate(intent, { receiptRecords, auditRecords }, { now });
  return {
    amountUsd,
    intentType: intent.intentType,
    expectedGrossYieldUsd: economics.expectedGrossYieldUsd,
    expectedNetUsd: economics.expectedNetUsd,
    aprPct: economics.aprPct,
    expectedHoldDays: economics.expectedHoldDays,
    estimatedGasCostUsd: economics.estimatedGasCostUsd,
    verdict,
  };
}

export function buildAggressiveVelocityParentEvMetadata({
  parentIntent = null,
  receiptRecords = [],
  auditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  if (!parentIntent) return {};
  const verdict = evGate(parentIntent, { receiptRecords, auditRecords }, { now });
  if (verdict.allow !== true) return {};
  const expectedNetUsd = finiteNumber(verdict.evidence?.expectedNetUsd);
  const requiredNetUsd = finiteNumber(verdict.evidence?.requiredNetUsd);
  if (expectedNetUsd === null || requiredNetUsd === null || expectedNetUsd <= requiredNetUsd) {
    return {};
  }
  const parentEvEvidence = {
    allow: true,
    expectedNetUsd,
    requiredNetUsd,
  };
  return {
    parentIntent,
    parentIntentHash: stableHash(parentIntent),
    parentEvEvidence,
    parentEvEvidenceHash: stableHash(parentEvEvidence),
  };
}

export function selectAggressiveVelocityExecutableCandidate(candidates = [], { btcPriceUsd } = {}) {
  for (const candidate of candidates || []) {
    const bindingKind = resolveAggressiveVelocityBindingKind(candidate);
    if (!bindingKind) continue;
    if (!resolvePlanBuilder(bindingKind)) continue;
    const binding = candidateBinding(candidate);
    const assetDecimals = Number.isInteger(binding.assetDecimals) ? binding.assetDecimals : null;
    if (assetDecimals === null) continue;
    const assetPriceUsd = resolveAggressiveVelocityAssetPriceUsd(candidate, { btcPriceUsd });
    if (!Number.isFinite(assetPriceUsd) || assetPriceUsd <= 0) continue;
    return {
      candidate,
      bindingKind,
      assetPriceUsd,
      assetDecimals,
    };
  }
  return null;
}

export async function readAggressiveVelocityAssetBalance({ chain, token, owner } = {}) {
  if (!chain || !token || !owner) {
    throw new Error("aggressive_inventory_probe_missing_inputs");
  }
  const cfg = getEvmChainConfig(chain);
  if (!cfg?.rpcUrl) {
    throw new Error("aggressive_inventory_probe_rpc_unconfigured");
  }
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const contract = new Contract(token, ERC20_BALANCE_ABI, provider);
  return contract.balanceOf(owner);
}

function stableUsdPrice(symbol = null) {
  return STABLE_SYMBOL_RE.test(normalizeSymbol(symbol)) ? 1 : null;
}

function normalizeFundingSourceToken(token = {}) {
  const symbol = normalizeSymbol(token.symbol);
  const address = token.address || null;
  const decimals = Number.isInteger(token.decimals) ? token.decimals : null;
  if (!symbol || !address || decimals === null) return null;
  if (!STABLE_SYMBOL_RE.test(symbol)) return null;
  const priceUsd = stableUsdPrice(symbol);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return {
    symbol,
    address,
    decimals,
    priceUsd,
  };
}

export async function resolveAggressiveVelocityInventoryReadiness({
  candidate,
  operatorAddress,
  assetAddress,
  assetSymbol,
  assetDecimals,
  chain,
  readAssetBalanceImpl = readAggressiveVelocityAssetBalance,
  getChainTokensImpl = getTokensForChain,
  buildSwapIntentImpl = buildSwapIntent,
  probeAmountUsd = DEFAULT_FUNDING_PROBE_USD,
} = {}) {
  if (!candidate || !operatorAddress || !assetAddress || !chain) {
    return {
      status: "inventory_unknown",
      reason: "aggressive_inventory_probe_missing_inputs",
      operatorAddress: operatorAddress || null,
      assetAddress: assetAddress || null,
      assetSymbol: assetSymbol || null,
      assetDecimals: Number.isInteger(assetDecimals) ? assetDecimals : null,
      chain: chain || null,
      balanceRaw: null,
      error: null,
    };
  }

  const normalizedAssetAddress = String(assetAddress).toLowerCase();
  try {
    const balance = await readAssetBalanceImpl({
      chain,
      token: assetAddress,
      owner: operatorAddress,
    });
    const balanceRaw = BigInt(balance).toString();
    if (BigInt(balance) > 0n) {
      return {
        status: "inventory_ready",
        reason: null,
        operatorAddress,
        assetAddress,
        assetSymbol: assetSymbol || null,
        assetDecimals: Number.isInteger(assetDecimals) ? assetDecimals : null,
        chain,
        balanceRaw,
        error: null,
      };
    }

    const chainTokens = (getChainTokensImpl(chain) || [])
      .map((token) => normalizeFundingSourceToken(token))
      .filter(Boolean)
      .filter((token) => token.address.toLowerCase() !== normalizedAssetAddress);

    let sawPositiveStableBalance = false;
    let sawSufficientStableBalance = false;
    let lastSwapError = null;

    for (const sourceToken of chainTokens) {
      const sourceBalance = await readAssetBalanceImpl({
        chain,
        token: sourceToken.address,
        owner: operatorAddress,
      });
      const sourceBalanceRaw = BigInt(sourceBalance).toString();
      if (BigInt(sourceBalance) <= 0n) continue;
      sawPositiveStableBalance = true;
      const sourceBalanceDecimal = Number(sourceBalance) / 10 ** sourceToken.decimals;
      const sourceBalanceUsd = sourceBalanceDecimal * sourceToken.priceUsd;
      if (!Number.isFinite(sourceBalanceUsd) || sourceBalanceUsd < probeAmountUsd) {
        continue;
      }
      sawSufficientStableBalance = true;
      try {
        const swapPlan = await buildSwapIntentImpl({
          strategyId: AGGRESSIVE_VELOCITY_STRATEGY_ID,
          capStrategyId: AGGRESSIVE_VELOCITY_STRATEGY_ID,
          chain,
          amountUsd: probeAmountUsd,
          inputToken: sourceToken.address,
          outputToken: assetAddress,
          inputDecimals: sourceToken.decimals,
          inputPriceUsd: sourceToken.priceUsd,
          senderAddress: operatorAddress,
        });
        return {
          status: "inventory_ready_via_same_chain_swap",
          reason: null,
          operatorAddress,
          assetAddress,
          assetSymbol: assetSymbol || null,
          assetDecimals: Number.isInteger(assetDecimals) ? assetDecimals : null,
          chain,
          balanceRaw,
          sourceToken: sourceToken.address,
          sourceSymbol: sourceToken.symbol,
          sourceDecimals: sourceToken.decimals,
          sourceBalanceRaw,
          sourceBalanceUsd,
          sourcePriceUsd: sourceToken.priceUsd,
          probeAmountUsd,
          swapProvider: swapPlan.provider || null,
          swapOutputAmount: swapPlan.outputAmount || null,
          error: null,
        };
      } catch (error) {
        lastSwapError = error;
      }
    }

    if (sawSufficientStableBalance) {
      return {
        status: "inventory_unknown",
        reason: "same_chain_stable_swap_quote_failed",
        operatorAddress,
        assetAddress,
        assetSymbol: assetSymbol || null,
        assetDecimals: Number.isInteger(assetDecimals) ? assetDecimals : null,
        chain,
        balanceRaw,
        error: lastSwapError?.message || String(lastSwapError || ""),
      };
    }
    return {
      status: "inventory_missing",
      reason: sawPositiveStableBalance ? "same_chain_stable_source_below_probe_minimum" : "entry_asset_balance_zero",
      operatorAddress,
      assetAddress,
      assetSymbol: assetSymbol || null,
      assetDecimals: Number.isInteger(assetDecimals) ? assetDecimals : null,
      chain,
      balanceRaw,
      error: null,
    };
  } catch (error) {
    return {
      status: "inventory_unknown",
      reason: "inventory_probe_failed",
      operatorAddress,
      assetAddress,
      assetSymbol: assetSymbol || null,
      assetDecimals: Number.isInteger(assetDecimals) ? assetDecimals : null,
      chain,
      balanceRaw: null,
      error: error?.message || String(error),
    };
  }
}

export async function buildAggressiveVelocityEntryPlan({
  candidate,
  senderAddress,
  amountUsd,
  btcPriceUsd,
  planBuilder = null,
  receiptRecords = [],
  auditRecords = [],
  now = new Date().toISOString(),
} = {}) {
  if (!candidate) throw new Error("candidate is required");
  if (!senderAddress) throw new Error("senderAddress is required");
  const bindingKind = resolveAggressiveVelocityBindingKind(candidate);
  if (!bindingKind) throw new Error("aggressive_binding_kind_unresolved");
  const builder = planBuilder || resolvePlanBuilder(bindingKind);
  if (typeof builder !== "function") throw new Error("aggressive_plan_builder_missing");

  const binding = candidateBinding(candidate);
  const assetDecimals = Number.isInteger(binding.assetDecimals) ? binding.assetDecimals : null;
  if (assetDecimals === null) throw new Error("aggressive_asset_decimals_missing");

  const assetPriceUsd = resolveAggressiveVelocityAssetPriceUsd(candidate, { btcPriceUsd });
  if (!Number.isFinite(assetPriceUsd) || assetPriceUsd <= 0) {
    throw new Error("aggressive_entry_asset_price_unresolved");
  }

  const amount = amountUnitsFromUsd(amountUsd, assetPriceUsd, assetDecimals);
  const queueItem = buildAggressiveVelocityQueueItem(candidate, {
    bindingKind,
    estimatedGasCostUsd: candidate.estimatedRoundtripCostUsd ?? null,
  });
  const plan = await builder({
    queueItem,
    senderAddress,
    amount,
    strategyId: AGGRESSIVE_VELOCITY_STRATEGY_ID,
    now,
  });
  const economics = estimateAggressiveVelocityExpectedNetUsd({
    candidate,
    amountUsd,
    estimatedGasCostUsd: candidate.estimatedRoundtripCostUsd ?? null,
    now,
  });
  const normalizedSteps = Array.isArray(plan?.steps)
    ? plan.steps.map((step) => ({ ...step, intent: { ...(step.intent || {}) } }))
    : [];
  const primaryStep =
    [...normalizedSteps].reverse().find((step) => step?.intent?.intentType !== "approve_exact") || null;
  if (primaryStep?.intent) {
    primaryStep.intent.metadata = {
      ...(primaryStep.intent.metadata || {}),
      ...(economics.expectedNetUsd !== null ? { expectedNetUsd: economics.expectedNetUsd } : {}),
      ...(economics.estimatedGasCostUsd !== null ? { estimatedGasCostUsd: economics.estimatedGasCostUsd } : {}),
      ...(economics.expectedGrossYieldUsd !== null ? { expectedGrossYieldUsd: economics.expectedGrossYieldUsd } : {}),
      ...(economics.aprPct !== null ? { displayedAprPct: economics.aprPct } : {}),
      ...(economics.expectedHoldDays !== null ? { expectedHoldDays: economics.expectedHoldDays } : {}),
    };
  }
  const parentApprovalMetadata = buildAggressiveVelocityParentEvMetadata({
    parentIntent: primaryStep?.intent || null,
    receiptRecords,
    auditRecords,
    now,
  });
  if (Object.keys(parentApprovalMetadata).length > 0) {
    for (const step of normalizedSteps) {
      if (step?.intent?.intentType !== "approve_exact") continue;
      step.intent.metadata = {
        ...(step.intent.metadata || {}),
        ...parentApprovalMetadata,
      };
    }
  }
  return {
    ...plan,
    steps: normalizedSteps,
    strategyId: AGGRESSIVE_VELOCITY_STRATEGY_ID,
    bindingKind,
    amount,
    assetPriceUsd,
    queueItem,
    policyPreview: {
      expectedGrossYieldUsd: economics.expectedGrossYieldUsd,
      expectedNetUsd: economics.expectedNetUsd,
      aprPct: economics.aprPct,
      expectedHoldDays: economics.expectedHoldDays,
      estimatedGasCostUsd: economics.estimatedGasCostUsd,
    },
  };
}

export async function buildAggressiveVelocityLiveState({
  strategistResult = null,
  btcPriceUsd = AGGRESSIVE_VELOCITY_BTC_PRICE_USD,
  resolveOperationalAddressImpl = resolveOperationalAddress,
  readAssetBalanceImpl = readAggressiveVelocityAssetBalance,
  getChainTokensImpl = getTokensForChain,
  buildSwapIntentImpl = buildSwapIntent,
  receiptRecords = [],
  auditRecords = [],
  fundingProbeUsd = DEFAULT_FUNDING_PROBE_USD,
} = {}) {
  const strategist = strategistResult || (await selectHighYieldOpportunities());
  const executable = selectAggressiveVelocityExecutableCandidate(strategist.candidates || [], {
    btcPriceUsd,
  });
  const executableCandidate = executable?.candidate || null;
  const bindingKind = executable?.bindingKind || null;
  const assetPriceUsd = executable?.assetPriceUsd || null;
  const projectedNetBtc = executableCandidate?.refinedNetBtcProfit ?? executableCandidate?.expectedNetBtcProfit ?? null;
  const sleeveProjectedNetUsd =
    Number.isFinite(projectedNetBtc) && Number.isFinite(btcPriceUsd)
      ? Number((projectedNetBtc * btcPriceUsd).toFixed(2))
      : null;
  const liveAdmissionBlockers = [];
  let inventoryReadiness = null;
  let policyPreview = null;
  if ((strategist.selectedCount || 0) <= 0) {
    liveAdmissionBlockers.push("no_high_yield_candidates_selected");
  } else if (!executableCandidate) {
    liveAdmissionBlockers.push("no_executable_candidate_binding");
  }
  if (executableCandidate) {
    const binding = candidateBinding(executableCandidate);
    const assetAddress = binding.assetAddress || null;
    const assetSymbol =
      binding.assetSymbol || executableCandidate.assetSymbol || executableCandidate.entryTokenSymbols?.[0] || null;
    const operationalAddress = await resolveOperationalAddressImpl();
    const operatorAddress = operationalAddress?.address || null;
    if (!assetAddress || !operatorAddress) {
      inventoryReadiness = {
        status: "inventory_unknown",
        reason: !assetAddress ? "asset_address_missing" : "operator_address_unresolved",
        operatorAddress,
        assetAddress,
        assetSymbol,
        assetDecimals: Number.isInteger(binding.assetDecimals) ? binding.assetDecimals : null,
        chain: executableCandidate.chain || null,
        balanceRaw: null,
        error: null,
      };
    } else {
      inventoryReadiness = await resolveAggressiveVelocityInventoryReadiness({
        candidate: executableCandidate,
        operatorAddress,
        assetAddress,
        assetSymbol,
        assetDecimals: Number.isInteger(binding.assetDecimals) ? binding.assetDecimals : null,
        chain: executableCandidate.chain || null,
        readAssetBalanceImpl,
        getChainTokensImpl,
        buildSwapIntentImpl,
        probeAmountUsd: fundingProbeUsd,
      });
      if (
        inventoryReadiness?.status === "inventory_ready" ||
        inventoryReadiness?.status === "inventory_ready_via_same_chain_swap"
      ) {
        policyPreview = buildAggressiveVelocityPolicyPreview({
          candidate: executableCandidate,
          bindingKind,
          amountUsd: fundingProbeUsd,
          chain: executableCandidate.chain || null,
          receiptRecords,
          auditRecords,
          now: strategist.generatedAt || new Date().toISOString(),
        });
      }
    }
  }
  if (inventoryReadiness?.status === "inventory_missing") {
    liveAdmissionBlockers.push("inventory_missing");
  } else if (inventoryReadiness?.status === "inventory_unknown") {
    liveAdmissionBlockers.push("inventory_unknown");
  }
  if (policyPreview?.verdict?.allow === false) {
    liveAdmissionBlockers.push(...(policyPreview.verdict.blockers || []));
  }

  return {
    strategist,
    executableCandidate,
    bindingKind,
    assetPriceUsd,
    projectedNetUsd: policyPreview?.expectedNetUsd ?? sleeveProjectedNetUsd,
    sleeveProjectedNetUsd,
    currentLiveEligible: Boolean(executableCandidate) && liveAdmissionBlockers.length === 0,
    liveAdmissionBlockers,
    inventoryReadiness,
    policyPreview,
    selectionDiagnostics: strategist.selectionDiagnostics || null,
    rejectionEvidence: strategist.rejectionEvidence || null,
  };
}
