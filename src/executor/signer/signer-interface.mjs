import { createHash } from "node:crypto";
import { stableSerialize } from "../../execution/journal.mjs";
import { getChainConfig, isBitcoinChain, isEvmChain } from "../../config/chains.mjs";

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

export function hashIntent(intent) {
  return createHash("sha256").update(stableSerialize(intent)).digest("hex");
}

export function inferIntentFamily(intent = {}) {
  if (intent.family) return intent.family;
  if (isEvmChain(intent.chain)) return "evm";
  if (isBitcoinChain(intent.chain)) return "btc";
  return null;
}

export function normalizeExecutionIntent(raw = {}) {
  const family = inferIntentFamily(raw);
  if (!raw.strategyId) throw new Error("Execution intent requires strategyId");
  if (!raw.chain || !getChainConfig(raw.chain)) throw new Error(`Unsupported chain: ${raw.chain}`);
  if (!family) throw new Error(`Unable to infer signer family for chain ${raw.chain}`);
  if (!raw.intentType) throw new Error("Execution intent requires intentType");
  if (!isFiniteNumber(Number(raw.amountUsd))) throw new Error("Execution intent requires amountUsd");

  const normalized = {
    schemaVersion: 1,
    intentId: raw.intentId || `${raw.strategyId}:${raw.chain}:${hashIntent(raw).slice(0, 16)}`,
    strategyId: raw.strategyId,
    chain: raw.chain,
    family,
    mode: raw.mode || "live",
    intentType: raw.intentType,
    amountUsd: Number(raw.amountUsd),
    expectedNetUsd: raw.expectedNetUsd,
    expectedNetProfitUsd: raw.expectedNetProfitUsd,
    estimatedNetPnlUsd: raw.estimatedNetPnlUsd,
    systemEconomics: raw.systemEconomics || null,
    routeContext: raw.routeContext || null,
    quote: raw.quote || null,
    approval: raw.approval || null,
    tx: raw.tx || null,
    btc: raw.btc || null,
    strategyConfig: raw.strategyConfig || null,
    positionState: raw.positionState || null,
    observedAt: raw.observedAt || new Date().toISOString(),
    executionReason: raw.executionReason || null,
    metadata: raw.metadata || {},
  };
  return normalized;
}

export function createSignedTransactionEnvelope({
  intent,
  signedTx,
  txHash,
  chain,
  signerFamily,
  broadcast = null,
  metadata = {},
} = {}) {
  return {
    schemaVersion: 1,
    intentId: intent.intentId,
    strategyId: intent.strategyId,
    chain: chain || intent.chain,
    signerFamily,
    txHash,
    signedTx,
    broadcast,
    metadata,
    signedAt: new Date().toISOString(),
  };
}

export class SignerInterface {
  async getAddress() {
    throw new Error("getAddress() must be implemented");
  }

  async signIntent(_intent) {
    throw new Error("signIntent() must be implemented");
  }

  async broadcastSignedIntent(_signedEnvelope) {
    throw new Error("broadcastSignedIntent() must be implemented");
  }
}
