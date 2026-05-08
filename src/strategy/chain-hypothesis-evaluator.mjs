import { CHAIN_HYPOTHESIS_CONFIG } from "../config/chain-hypothesis.mjs";
import { canonicalGatewayChain } from "../config/gateway-destinations.mjs";

const DAY_MS = 86_400_000;

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function roundDays(value) {
  return Math.round(value * 1000) / 1000;
}

function hypothesisStatus({ expiresAt = null, nowMs = Date.now(), expiresSoonDays = 3 } = {}) {
  const expiresMs = timestampMs(expiresAt);
  if (expiresMs === null) {
    return { status: "unknown_expiry", daysUntilExpiry: null };
  }
  const daysUntilExpiry = (expiresMs - nowMs) / DAY_MS;
  if (daysUntilExpiry < 0) return { status: "expired", daysUntilExpiry: roundDays(daysUntilExpiry) };
  if (daysUntilExpiry <= expiresSoonDays) {
    return { status: "expires_soon", daysUntilExpiry: roundDays(daysUntilExpiry) };
  }
  return { status: "fresh", daysUntilExpiry: roundDays(daysUntilExpiry) };
}

function evaluateStrategyHypothesis(item = {}, { nowMs, expiresSoonDays }) {
  const chain = canonicalGatewayChain(item.chain) || item.chain || null;
  const status = hypothesisStatus({ expiresAt: item.expiresAt, nowMs, expiresSoonDays });
  return {
    chain,
    role: item.role || "strategy_primary_reference",
    assertedAt: item.assertedAt || null,
    expiresAt: item.expiresAt || null,
    status: status.status,
    daysUntilExpiry: status.daysUntilExpiry,
    autoRenewCandidate: ["expired", "expires_soon"].includes(status.status),
    committedDiffRequired: true,
    evidenceSource: item.evidenceSource || null,
    renewalRequires: item.renewalRequires || "committed evidence-profile diff",
  };
}

function evaluatePaybackReserveProof(item = {}) {
  const chain = canonicalGatewayChain(item.chain) || item.chain || null;
  return {
    chain,
    status: item.status || "unknown",
    proofPath: item.proofPath || null,
    assertedAt: item.assertedAt || null,
    committedDiffRequired: item.committedDiffRequired !== false,
    strategyPrimaryHypothesis: false,
  };
}

export function buildChainHypothesisReport({
  config = CHAIN_HYPOTHESIS_CONFIG,
  now = new Date().toISOString(),
} = {}) {
  const nowMs = timestampMs(now) ?? Date.now();
  const expiresSoonDays = Number(config.expiresSoonDays ?? 3);
  const strategyPrimaryHypotheses = (config.strategyPrimaryHypotheses || [])
    .map((item) => evaluateStrategyHypothesis(item, { nowMs, expiresSoonDays }));
  const paybackReserveProofs = (config.paybackReserveProofs || []).map(evaluatePaybackReserveProof);
  const activeStrategyPrimaryChains = strategyPrimaryHypotheses
    .filter((item) => item.status !== "expired")
    .map((item) => item.chain)
    .filter(Boolean);
  const expiredStrategyPrimaryChains = strategyPrimaryHypotheses
    .filter((item) => item.status === "expired")
    .map((item) => item.chain)
    .filter(Boolean);
  const reserveProofGaps = paybackReserveProofs
    .filter((item) => item.status !== "proven")
    .map((item) => ({ chain: item.chain, status: item.status }));

  return {
    schemaVersion: 1,
    generatedAt: now,
    strategyPrimaryHypotheses,
    paybackReserveProofs,
    summary: {
      activeStrategyPrimaryChains,
      expiredStrategyPrimaryChains,
      expiredStrategyPrimaryCount: expiredStrategyPrimaryChains.length,
      autoRenewCandidateCount: strategyPrimaryHypotheses.filter((item) => item.autoRenewCandidate).length,
      reserveProofGapCount: reserveProofGaps.length,
      reserveProofGaps,
      committedDiffRequired: strategyPrimaryHypotheses.some((item) => item.autoRenewCandidate)
        || reserveProofGaps.length > 0,
    },
  };
}

export function strategyPrimaryHypothesisByChain(report = null) {
  const entries = report?.strategyPrimaryHypotheses || [];
  return new Map(entries.map((item) => [item.chain, item]));
}

export function pruneExpiredStrategyPrimaryOverrides(diversificationPolicy = null, chainHypothesis = null) {
  if (!diversificationPolicy || !chainHypothesis) return diversificationPolicy;
  const expired = new Set(chainHypothesis.summary?.expiredStrategyPrimaryChains || []);
  if (expired.size === 0) return diversificationPolicy;
  const nextOverrides = { ...(diversificationPolicy.perChainMaxShareByChain || {}) };
  for (const chain of expired) delete nextOverrides[chain];
  return {
    ...diversificationPolicy,
    perChainMaxShareByChain: nextOverrides,
  };
}
