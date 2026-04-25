import { config } from "../config/env.mjs";
import { GatewayClient, classifyGatewayBlockedReason } from "./client.mjs";

function quoteParamsForStoredQuote(quote, senderAddress) {
  const params = {
    srcChain: quote.route.srcChain,
    dstChain: quote.route.dstChain,
    srcToken: quote.route.srcToken,
    dstToken: quote.route.dstToken,
    amount: quote.amount,
    recipient: quote.route.dstChain === "bitcoin" ? config.verifyBtcRecipient : config.verifyRecipient,
    slippage: config.slippageBps,
  };

  if (quote.route.srcChain !== "bitcoin") {
    params.sender = senderAddress || config.verifyRecipient;
  }

  return params;
}

export function isOfframpExecutionHydrationRequired(quote) {
  return quote?.quoteType === "offramp" && quote?.route?.dstChain === "bitcoin" && (!quote?.txTo || !quote?.txData);
}

export function normalizeExecutableQuoteFromGatewayBody(body) {
  const quoteType = body?.onramp ? "onramp" : body?.offramp ? "offramp" : body?.layerZero ? "layerZero" : "unknown";
  const quote = body?.onramp || body?.offramp || body?.layerZero || body || null;
  const txTo = quote?.tx?.to || quote?.txTo || null;
  const txData = quote?.tx?.data || null;
  const txValueWei = String(quote?.tx?.value || 0);
  const txChain = quote?.tx?.chain || null;
  const txDataBytes = txData ? Math.max(0, (txData.length - 2) / 2) : null;
  return {
    quoteType,
    txTo,
    txData,
    txValueWei,
    txChain,
    txDataBytes,
  };
}

export function normalizeExecutableQuote(quote, execution = {}) {
  const txTo = execution.txTo ?? quote.txTo ?? null;
  const txData = execution.txData ?? quote.txData ?? null;
  const txValueWei = execution.txValueWei ?? quote.txValueWei ?? "0";
  const txChain = execution.txChain ?? quote.txChain ?? null;
  const txDataBytes = txData ? Math.max(0, (txData.length - 2) / 2) : null;
  return {
    ...quote,
    txTo,
    txData,
    txValueWei: String(txValueWei || 0),
    txChain,
    txDataBytes,
    executionHydratedFromOrder: Boolean(execution.hydratedFromOrder),
    executionOrderId: execution.orderId || null,
  };
}

export async function hydrateStoredOfframpQuoteExecution(
  quote,
  {
    client = new GatewayClient({ baseUrl: config.gatewayApiBase }),
    senderAddress = null,
  } = {},
) {
  if (!isOfframpExecutionHydrationRequired(quote)) {
    return normalizeExecutableQuote(quote);
  }

  const quoteResult = await client.getQuote(quoteParamsForStoredQuote(quote, senderAddress));
  const refreshedQuote = quoteResult.body?.offramp || null;
  if (!refreshedQuote?.inputAmount?.amount || !refreshedQuote?.outputAmount?.amount) {
    throw new Error("Gateway offramp quote did not include required offramp data");
  }

  const orderResult = await client.createOrder(quoteResult.body);
  const offrampOrder = orderResult.body?.offramp || null;
  if (!offrampOrder?.tx?.to || !offrampOrder?.tx?.data) {
    throw new Error("Gateway create-order did not return an executable offramp tx");
  }

  return normalizeExecutableQuote(quote, {
    txTo: offrampOrder.tx.to || refreshedQuote.txTo || null,
    txData: offrampOrder.tx.data,
    txValueWei: String(offrampOrder.tx.value || 0),
    txChain: offrampOrder.tx.chain || null,
    hydratedFromOrder: true,
    orderId: offrampOrder.order_id || null,
  });
}

export async function hydrateOfframpExecutionFromGatewayBody(
  body,
  {
    client = new GatewayClient({ baseUrl: config.gatewayApiBase }),
  } = {},
) {
  const executable = normalizeExecutableQuoteFromGatewayBody(body);
  if (executable.quoteType !== "offramp" || (executable.txTo && executable.txData)) {
    return {
      ...executable,
      executionHydratedFromOrder: false,
      executionOrderId: null,
    };
  }

  const orderResult = await client.createOrder(body);
  const offrampOrder = orderResult.body?.offramp || null;
  if (!offrampOrder?.tx?.to || !offrampOrder?.tx?.data) {
    throw new Error("Gateway create-order did not return an executable offramp tx");
  }

  return {
    ...executable,
    txTo: offrampOrder.tx.to || executable.txTo || null,
    txData: offrampOrder.tx.data,
    txValueWei: String(offrampOrder.tx.value || 0),
    txChain: offrampOrder.tx.chain || executable.txChain || null,
    txDataBytes: Math.max(0, (offrampOrder.tx.data.length - 2) / 2),
    executionHydratedFromOrder: true,
    executionOrderId: offrampOrder.order_id || null,
  };
}

export function classifyExecutableQuoteHydrationError(error) {
  return classifyGatewayBlockedReason(error);
}
