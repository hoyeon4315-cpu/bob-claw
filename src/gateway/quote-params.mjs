import { config } from "../config/env.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function normalizeGatewayAffiliateId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (!UUID_RE.test(normalized)) {
    throw new Error("BOB_GATEWAY_AFFILIATE_ID must be a valid UUID");
  }
  return normalized;
}

export function buildGatewayQuoteParams({
  route,
  srcChain = route?.srcChain,
  dstChain = route?.dstChain,
  srcToken = route?.srcToken,
  dstToken = route?.dstToken,
  amount,
  sender = null,
  recipient,
  slippage = config.slippageBps,
  strategyMessage = null,
  gasRefill = null,
  affiliateId = config.gatewayAffiliateId,
} = {}) {
  const params = {
    srcChain,
    dstChain,
    srcToken,
    dstToken,
    amount: String(amount),
    recipient,
    slippage: String(slippage),
  };

  if (sender) params.sender = sender;
  if (strategyMessage) params.strategyMessage = strategyMessage;
  if (gasRefill) params.gasRefill = gasRefill;
  const normalizedAffiliateId = normalizeGatewayAffiliateId(affiliateId);
  if (normalizedAffiliateId) params.affiliateId = normalizedAffiliateId;
  return params;
}
