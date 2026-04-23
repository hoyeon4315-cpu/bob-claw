// Across bridge signer-intent builder.
//
// Mirrors the gateway-btc-consolidation pattern: fetch quote, validate,
// build the SpokePool.deposit() calldata, compute gasLimit with buffer,
// and return a typed intent for the Policy engine. This module does
// NOT sign — it only prepares. Signing happens in the signer daemon
// after Policy approval, per AGENTS.md LLM permissions matrix.
//
// Until a live receipt-backed proof is shipped this helper is exported
// as "scaffold" — the planner must not yet prefer it. The gating lives
// in `bridge-providers.mjs` via the `status` field so flipping to
// production is a single committed diff alongside a passing live test.

import { ACROSS_DEFAULT_POLICY } from "../../config/across.mjs";
import { AcrossClient } from "../../bridge/across/client.mjs";
import { buildAcrossQuoteRequest, normalizeAcrossQuote } from "../../bridge/across/quote.mjs";

export const ACROSS_BRIDGE_STRATEGY_ID = "across-bridge";

export async function planAcrossBridge({
  srcChain,
  dstChain,
  ticker,
  amount,
  recipient,
  signerAddress,
  policy = ACROSS_DEFAULT_POLICY,
  clientFactory = null,
  now = Math.floor(Date.now() / 1000),
} = {}) {
  const request = buildAcrossQuoteRequest({ srcChain, dstChain, ticker, amount, recipient });
  const client = clientFactory
    ? clientFactory()
    : new AcrossClient({ baseUrl: policy.apiBase, timeoutMs: policy.quoteTimeoutMs });
  const { body, latencyMs, url } = await client.suggestedFees({
    inputToken: request.inputToken,
    outputToken: request.outputToken,
    originChainId: request.originChainId,
    destinationChainId: request.destinationChainId,
    amount: request.amount,
    recipient: request.recipient,
  });
  const normalized = normalizeAcrossQuote({ request, responseBody: body, now, policy });
  return {
    strategyId: ACROSS_BRIDGE_STRATEGY_ID,
    observedAt: new Date(now * 1000).toISOString(),
    quote: normalized.quote,
    quoteLatencyMs: latencyMs,
    quoteUrl: url,
    signerAddress,
    intent: {
      type: "across_bridge_deposit",
      method: "cross_chain_bridge_across",
      chain: srcChain,
      destinationChain: dstChain,
      ticker,
      amount: request.amount,
      outputAmount: normalized.quote.outputAmount,
      recipient: recipient || signerAddress,
      spokePool: normalized.quote.spokePoolOrigin,
      quoteTimestamp: normalized.quote.quoteTimestamp,
      fillDeadline: normalized.quote.fillDeadline,
      relayFeePct: normalized.quote.relayFeePct,
      exclusiveRelayer: normalized.quote.exclusiveRelayer,
    },
    settlementRequirements: [
      "across_destination_output_amount_delta_proof_required",
      "across_deposit_id_recorded",
    ],
  };
}
