import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { JsonRpcProvider } from "ethers";
import { resolveAggressionProfile } from "../../config/aggression-profile.mjs";
import { getChainRpcUrls } from "../../config/env.mjs";

export function featureEnabled(profile) {
  return profile?.preBroadcastSimulationEnabled === true;
}

async function appendAuditRecord(record, auditPath) {
  const resolvedPath = resolve(auditPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await appendFile(resolvedPath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function evaluatePreBroadcastSimulation({
  intent = {},
  profile = null,
  provider = null,
  now = new Date().toISOString(),
  auditPath = "logs/pre-broadcast-simulation-audit.jsonl",
} = {}) {
  const resolvedProfile = typeof profile === "string" ? resolveAggressionProfile(profile) : profile;
  if (!featureEnabled(resolvedProfile)) {
    return {
      policy: "pre_broadcast_simulation",
      observedAt: now,
      decision: "ALLOW",
      blockers: [],
      metrics: {
        simulated: false,
        enabled: false,
      },
    };
  }

  const chain = intent.chain;
  const to = intent.to;
  const data = intent.data || "0x";
  const value = intent.value ?? 0;
  const from = intent.from;

  let simProvider = provider;
  if (!simProvider) {
    const rpcUrls = getChainRpcUrls(chain, []);
    const rpcUrl = Array.isArray(rpcUrls) && rpcUrls.length > 0 ? rpcUrls[0] : null;
    if (rpcUrl) {
      simProvider = new JsonRpcProvider(rpcUrl);
    }
  }

  if (!simProvider) {
    const record = {
      ts: now,
      strategyId: intent.strategyId || null,
      chain: chain || null,
      decision: "BLOCK",
      blocker: "pre_broadcast_simulation_unavailable",
    };
    await appendAuditRecord(record, auditPath);
    return {
      policy: "pre_broadcast_simulation",
      observedAt: now,
      decision: "BLOCK",
      blockers: ["pre_broadcast_simulation_unavailable"],
      metrics: {
        simulated: false,
        providerAvailable: false,
      },
    };
  }

  try {
    await simProvider.call({
      to,
      data,
      value,
      from,
    });
    return {
      policy: "pre_broadcast_simulation",
      observedAt: now,
      decision: "ALLOW",
      blockers: [],
      metrics: {
        simulated: true,
        reverted: false,
      },
    };
  } catch (error) {
    const record = {
      ts: now,
      strategyId: intent.strategyId || null,
      chain: chain || null,
      decision: "BLOCK",
      blocker: "pre_broadcast_simulation_revert",
      errorCode: error.code || null,
      errorMessage: error.message || null,
    };
    await appendAuditRecord(record, auditPath);
    return {
      policy: "pre_broadcast_simulation",
      observedAt: now,
      decision: "BLOCK",
      blockers: ["pre_broadcast_simulation_revert"],
      metrics: {
        simulated: true,
        reverted: true,
        errorCode: error.code || null,
      },
    };
  }
}
