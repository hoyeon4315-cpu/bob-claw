import { shellQuote } from "../../lib/shell-quote.mjs";
import { buildTokenDexExperimentPlan, executeTokenDexExperimentPlan } from "./token-dex-experiment.mjs";

export const WRAPPED_BTC_LOOP_HANDOFF_STRATEGY_ID = "wrapped-btc-loop-deposit-handoff";
export const WRAPPED_BTC_LOOP_HANDOFF_CHAIN = "base";
export const WRAPPED_BTC_LOOP_HANDOFF_INPUT_TOKEN = "wbtc.oft";
export const WRAPPED_BTC_LOOP_HANDOFF_OUTPUT_TOKEN = "cbbtc";
export const WRAPPED_BTC_LOOP_HANDOFF_INPUT_ASSET = "wBTC.OFT";
export const WRAPPED_BTC_LOOP_HANDOFF_TARGET_ASSET = "cbBTC";

function toPositiveIntegerString(value, label) {
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

function normalizeAssetSymbol(value = null) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function handoffCommand({ amountSats, senderAddress = null, execute = false } = {}) {
  const normalizedAmountSats = toPositiveIntegerString(amountSats, "amountSats");
  const parts = [
    "npm run executor:wrapped-btc-loop-handoff --",
    `--amount-sats=${shellQuote(normalizedAmountSats)}`,
    senderAddress ? `--sender=${shellQuote(senderAddress)}` : null,
    execute ? "--execute" : null,
    "--json",
  ].filter(Boolean);
  return parts.join(" ");
}

export function isWrappedBtcLoopDepositHandoffCandidate({
  chain = null,
  landedAsset = null,
  targetAsset = null,
} = {}) {
  return (
    String(chain || "").toLowerCase() === WRAPPED_BTC_LOOP_HANDOFF_CHAIN &&
    normalizeAssetSymbol(landedAsset) === normalizeAssetSymbol(WRAPPED_BTC_LOOP_HANDOFF_INPUT_ASSET) &&
    normalizeAssetSymbol(targetAsset) === normalizeAssetSymbol(WRAPPED_BTC_LOOP_HANDOFF_TARGET_ASSET)
  );
}

export function buildWrappedBtcLoopHandoffCommands({ amountSats, senderAddress = null } = {}) {
  const normalizedAmountSats = toPositiveIntegerString(amountSats, "amountSats");
  return {
    previewHandoff: handoffCommand({
      amountSats: normalizedAmountSats,
      senderAddress,
      execute: false,
    }),
    executeHandoff: handoffCommand({
      amountSats: normalizedAmountSats,
      senderAddress,
      execute: true,
    }),
    loopIntentPreview: "npm run executor:wrapped-btc-loop -- --command=sign_only --json",
    loopDryRun: "npm run run:wrapped-btc-loop-dry-run -- --json",
    loopReport: "npm run report:wrapped-btc-loop -- --json",
  };
}

export async function buildWrappedBtcLoopDepositHandoffPlan({
  amountSats,
  senderAddress,
  now = new Date().toISOString(),
  ...tokenDexOptions
} = {}) {
  if (!senderAddress) throw new Error("EVM sender address is required");
  const normalizedAmountSats = toPositiveIntegerString(amountSats, "amountSats");
  const conversionPlan = await buildTokenDexExperimentPlan({
    ...tokenDexOptions,
    chain: WRAPPED_BTC_LOOP_HANDOFF_CHAIN,
    amount: normalizedAmountSats,
    senderAddress,
    inputToken: WRAPPED_BTC_LOOP_HANDOFF_INPUT_TOKEN,
    outputToken: WRAPPED_BTC_LOOP_HANDOFF_OUTPUT_TOKEN,
    now,
  });
  const commands = buildWrappedBtcLoopHandoffCommands({
    amountSats: normalizedAmountSats,
    senderAddress,
  });
  return {
    schemaVersion: 1,
    generatedAt: now,
    strategyId: WRAPPED_BTC_LOOP_HANDOFF_STRATEGY_ID,
    chain: WRAPPED_BTC_LOOP_HANDOFF_CHAIN,
    amountSats: normalizedAmountSats,
    sourceAsset: WRAPPED_BTC_LOOP_HANDOFF_INPUT_ASSET,
    targetAsset: WRAPPED_BTC_LOOP_HANDOFF_TARGET_ASSET,
    handoffStatus: conversionPlan.planStatus === "ready" ? "conversion_ready" : "blocked",
    blockedReason: conversionPlan.blockedReason || null,
    commands,
    nextCommands: [
      commands.loopIntentPreview,
      commands.loopDryRun,
      commands.loopReport,
    ],
    conversionPlan,
    notes: [
      "This handoff uses the existing token DEX experiment executor to convert Base wBTC.OFT into Base cbBTC before the wrapped-BTC loop tries to use cbBTC as collateral.",
      "The helper stays deterministic by reusing the repo's token swap planning and signer settlement-proof surfaces instead of building a second swap stack.",
    ],
  };
}

export async function executeWrappedBtcLoopDepositHandoffPlan({
  handoffPlan,
  ...options
} = {}) {
  const conversionPlan = handoffPlan?.conversionPlan || null;
  if (!conversionPlan) {
    throw new Error("Wrapped BTC loop handoff plan is required");
  }
  const conversionExecution = await executeTokenDexExperimentPlan({
    plan: conversionPlan,
    ...options,
  });
  return {
    schemaVersion: 1,
    executedAt: new Date().toISOString(),
    strategyId: handoffPlan.strategyId || WRAPPED_BTC_LOOP_HANDOFF_STRATEGY_ID,
    handoffStatus: conversionExecution.settlementStatus === "delivered" ? "converted" : conversionExecution.settlementStatus,
    blockedReason: conversionExecution.blockedReason || null,
    nextCommands: handoffPlan.nextCommands || [],
    conversionExecution,
  };
}
