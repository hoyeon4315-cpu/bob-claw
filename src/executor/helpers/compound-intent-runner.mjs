// Compound Intent Runner
// Prevents the #4 bug: manual multi-step sequences (approve → quote → assemble → swap → deposit)
// failing mid-way, quote expiring, or approve forgotten
//
// Critical facts learned:
// - Odos quote pathId expires in 60s
// - Approve tx must be confirmed before swap tx
// - WETH needs wrapping before swaps
// - Each step needs different intentType and strategyId
//
// This module:
// 1. Accepts a recipe of intents
// 2. Executes sequentially, stopping on first failure
// 3. Auto-refreshes quotes if they expire during execution
// 4. Returns full trace of what succeeded/failed

import { Interface } from "ethers";
import { sendSignerCommand, signerClientTimeoutMs, signerSocketPath } from "../signer/client.mjs";

const DEFAULT_STEP_TIMEOUT_MS = 180_000;
const QUOTE_MAX_AGE_MS = 30_000;
const ERC20_INTERFACE = new Interface(["function approve(address,uint256)"]);
const ERC4626_INTERFACE = new Interface(["function deposit(uint256,address)"]);

export async function runCompoundIntent({
  steps = [],
  socketPath = signerSocketPath(),
  timeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  onStepStart = null,
  onStepComplete = null,
} = {}) {
  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepStart = Date.now();

    if (onStepStart) {
      await onStepStart({ stepIndex: i, step, elapsedMs: stepStart - startTime });
    }

    // Refresh quote if stale
    let intent = step.intent;
    if (step.refreshQuote && isQuoteStale(intent)) {
      try {
        intent = await step.refreshQuote(intent);
      } catch (e) {
        const result = {
          stepIndex: i,
          status: "error",
          phase: "quote_refresh",
          error: e.message,
          elapsedMs: Date.now() - stepStart,
        };
        results.push(result);
        if (onStepComplete) await onStepComplete(result);
        break;
      }
    }

    // Execute via signer daemon
    let result;
    try {
      const signerResult = await sendSignerCommand({
        message: {
          command: step.command || "sign_and_broadcast",
          intent,
          awaitConfirmation: step.awaitConfirmation !== false,
          confirmations: step.confirmations ?? 1,
          timeoutMs: step.timeoutMs ?? 120_000,
        },
        socketPath,
        timeoutMs: signerClientTimeoutMs(),
      });

      result = {
        stepIndex: i,
        status: signerResult.status === "ok" ? "ok" : "failed",
        intentId: intent.intentId || intent.strategyId,
        txHash: signerResult.broadcast?.txHash || null,
        receipt: signerResult.receipt || null,
        policy: signerResult.policy || null,
        error: signerResult.error || null,
        elapsedMs: Date.now() - stepStart,
      };
    } catch (e) {
      result = {
        stepIndex: i,
        status: "error",
        error: e.message,
        elapsedMs: Date.now() - stepStart,
      };
    }

    results.push(result);
    if (onStepComplete) await onStepComplete(result);

    // Stop on failure unless configured to continue
    if (result.status !== "ok" && !step.continueOnFailure) {
      break;
    }
  }

  const allOk = results.every((r) => r.status === "ok");

  return {
    ok: allOk,
    stepsExecuted: results.length,
    stepsTotal: steps.length,
    results,
    totalElapsedMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

function isQuoteStale(intent) {
  if (!intent?.quote?.observedAt) return true;
  const age = Date.now() - new Date(intent.quote.observedAt).getTime();
  return age > QUOTE_MAX_AGE_MS;
}

// Pre-built recipes for common operations
export const COMPOUND_RECIPES = {
  // Recipe: swap token A → token B via Odos
  async buildOdosSwapRecipe({
    fromToken, toToken, amount, amountUsd,
    chainId = 8453,
    strategyId = "token-dex-experiment",
    signerAddress,
    slippage = 0.5,
  }) {
    const ODOS_API = "https://api.odos.xyz";
    const ODOS_ROUTER = "0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05";

    // Quote
    const quoteBody = {
      chainId,
      inputTokens: [{ tokenAddress: fromToken.address, amount: String(amount) }],
      outputTokens: [{ tokenAddress: toToken.address, proportion: 1 }],
      userAddr: signerAddress,
      slippageLimitPercent: slippage,
      disableRFQs: true,
      compact: true,
    };

    const quoteR = await fetch(`${ODOS_API}/sor/quote/v3`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(quoteBody),
      signal: AbortSignal.timeout(15000),
    });
    const quote = await quoteR.json();

    const steps = [];

    // 1. Approve
    const approveData = ERC20_INTERFACE.encodeFunctionData("approve", [ODOS_ROUTER, String(amount)]);

    steps.push({
      name: `approve_${fromToken.symbol}`,
      intent: {
        schemaVersion: 1,
        intentType: "approve_exact",
        strategyId,
        chain: "base",
        amountUsd: 0,
        mode: "live",
        observedAt: new Date().toISOString(),
        approval: {
          token: fromToken.address,
          spender: ODOS_ROUTER,
          amount: String(amount),
          mode: "per_tx",
        },
        tx: {
          to: fromToken.address,
          data: approveData,
          value: "0",
          gasLimit: "72914",
          chainId,
        },
        metadata: { skipAutoIngest: true, capCheckAmountUsd: 0 },
      },
    });

    // 2. Swap with refresh capability
    steps.push({
      name: `swap_${fromToken.symbol}_to_${toToken.symbol}`,
      intent: {
        schemaVersion: 1,
        intentType: "dex_swap",
        strategyId,
        chain: "base",
        amountUsd,
        mode: "live",
        observedAt: new Date().toISOString(),
        quote: {
          observedAt: new Date().toISOString(),
          pathId: quote.pathId,
          outputAmount: quote.outAmounts?.[0],
          txTo: ODOS_ROUTER,
        },
        tx: {
          to: ODOS_ROUTER,
          data: "placeholder", // assembled at execution time
          value: "0",
          gasLimit: "400000",
          chainId,
        },
        metadata: { provider: "odos", skipAutoIngest: true, expectedTxTo: ODOS_ROUTER },
      },
      refreshQuote: async (oldIntent) => {
        const freshQuoteR = await fetch(`${ODOS_API}/sor/quote/v3`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(quoteBody),
          signal: AbortSignal.timeout(15000),
        });
        const freshQuote = await freshQuoteR.json();
        const asmR = await fetch(`${ODOS_API}/sor/assemble`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userAddr: signerAddress, pathId: freshQuote.pathId, simulate: false }),
          signal: AbortSignal.timeout(15000),
        });
        const asm = await asmR.json();

        return {
          ...oldIntent,
          observedAt: new Date().toISOString(),
          quote: {
            observedAt: new Date().toISOString(),
            pathId: freshQuote.pathId,
            outputAmount: freshQuote.outAmounts?.[0],
            txTo: asm.transaction.to,
          },
          tx: {
            ...oldIntent.tx,
            to: asm.transaction.to,
            data: asm.transaction.data,
            value: asm.transaction.value || "0",
            gasLimit: String(Math.ceil(Number(asm.transaction.gas) * 1.2)),
          },
          metadata: {
            ...(oldIntent.metadata || {}),
            expectedTxTo: asm.transaction.to,
          },
        };
      },
    });

    return { steps, quote };
  },

  // Recipe: ERC4626 deposit
  buildDepositRecipe({
    vaultAddress,
    assetAddress,
    amount,
    amountUsd,
    chainId = 8453,
    strategyId = "token-dex-experiment",
    signerAddress,
  }) {
    const approveData = ERC20_INTERFACE.encodeFunctionData("approve", [vaultAddress, String(amount)]);
    const depositData = ERC4626_INTERFACE.encodeFunctionData("deposit", [String(amount), signerAddress]);

    return {
      steps: [
        {
          name: "approve_vault",
          intent: {
            schemaVersion: 1,
            intentType: "approve_exact",
            strategyId,
            chain: "base",
            amountUsd: 0,
            mode: "live",
            observedAt: new Date().toISOString(),
            approval: {
              token: assetAddress,
              spender: vaultAddress,
              amount: String(amount),
              mode: "per_tx",
            },
            tx: {
              to: assetAddress,
              data: approveData,
              value: "0",
              gasLimit: "72914",
              chainId,
            },
            metadata: { skipAutoIngest: true, capCheckAmountUsd: 0 },
          },
        },
        {
          name: "vault_deposit",
          intent: {
            schemaVersion: 1,
            intentType: "erc4626_deposit",
            strategyId,
            chain: "base",
            amountUsd,
            mode: "live",
            observedAt: new Date().toISOString(),
            tx: {
              to: vaultAddress,
              data: depositData,
              value: "0",
              gasLimit: "200000",
              chainId,
            },
            metadata: { skipAutoIngest: true, expectedTxTo: vaultAddress },
          },
        },
      ],
    };
  },
};
