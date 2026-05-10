import { existsSync, readFileSync } from "node:fs";

const DEFAULT_CHAIN_HEALTH_PATH = "data/all-chain-autopilot-latest.json";

export function featureEnabled(profile = {}) {
  if (typeof profile === "string") return true;
  return profile.chainFailover !== false;
}

export function loadChainHealth(path = DEFAULT_CHAIN_HEALTH_PATH) {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.chainHealth || parsed;
  } catch {
    return {};
  }
}

export function evaluateChainFailover({ candidate = {}, chainHealth = {} }) {
  if (!featureEnabled(candidate.profile)) {
    return { allowed: true, blockers: [] };
  }
  const health = chainHealth[candidate.chain];
  if (!health) {
    return { allowed: true, blockers: [] };
  }
  const gatewaySuccessRate24h = Number(health.gatewaySuccessRate24h);
  const rpcErrorRate = Number(health.rpcErrorRate);
  const blockers = [];
  if (Number.isFinite(gatewaySuccessRate24h) && gatewaySuccessRate24h < 0.85) {
    blockers.push("chain_failover_unhealthy");
  }
  if (Number.isFinite(rpcErrorRate) && rpcErrorRate > 0.10) {
    blockers.push("chain_failover_unhealthy");
  }
  return {
    allowed: blockers.length === 0,
    blockers: [...new Set(blockers)],
  };
}
