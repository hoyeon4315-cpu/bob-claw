import { buildSwapIntent } from "../helpers/swap-intent-builder.mjs";

export function featureEnabled(profile = {}) {
  return profile.autoConvert !== false;
}

export async function buildConvertIntent(
  {
    fromToken,
    toToken,
    amount,
    chain,
    slippageBps = 50,
    strategyId = "harvest-convert",
    senderAddress = null,
    providers = null,
    now = new Date().toISOString(),
  } = {},
  { profile = {} } = {},
) {
  if (!featureEnabled(profile)) return null;

  const amountUsd = Number(amount);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;

  const expectedNetUsd = amountUsd * (1 - slippageBps / 10_000);
  if (expectedNetUsd <= 0) return null;

  let swapPlan = null;
  if (providers) {
    try {
      swapPlan = await buildSwapIntent({
        strategyId,
        chain,
        amountUsd,
        inputToken: fromToken,
        outputToken: toToken,
        inputDecimals: 18,
        slippageBps,
        senderAddress,
        providers,
        now,
      });
    } catch {
      // Fall through to synthetic intent
    }
  }

  if (swapPlan) {
    return {
      ...swapPlan,
      intentType: "convert",
      expectedNetUsd,
    };
  }

  return {
    intentType: "convert",
    strategyId,
    chain,
    fromToken,
    toToken,
    amountUsd,
    slippageBps,
    expectedNetUsd,
    observedAt: now,
  };
}
