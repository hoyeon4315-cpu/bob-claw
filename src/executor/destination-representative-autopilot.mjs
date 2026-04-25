import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config/env.mjs";
import {
  DESTINATION_REPRESENTATIVE_BINDINGS,
  representativeBindingForTemplate,
} from "../config/destination-representative-bindings.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { JsonlStore } from "../lib/jsonl-store.mjs";
import { readJsonl } from "../lib/jsonl-read.mjs";
import { safeJsonStringify } from "../lib/json-safe.mjs";
import { DIVERSIFICATION_POLICY, canAcceptNewAllocation, computeHhi } from "../config/diversification.mjs";
import { latestTreasuryInventoryForAddress } from "../strategy/merkl-canary-execution-readiness.mjs";
import { preflightLiveCanarySweep } from "./live-canary-sweep.mjs";
import {
  buildCompoundV2SupplyCanaryPlan,
  executeCompoundV2SupplyCanaryPlan,
} from "./helpers/compound-v2-supply-canary.mjs";
import {
  buildAaveV3SupplyCanaryPlan,
  executeAaveV3SupplyCanaryPlan,
} from "./helpers/aave-v3-supply-canary.mjs";
import {
  buildCompoundV3SupplyCanaryPlan,
  executeCompoundV3SupplyCanaryPlan,
} from "./helpers/compound-v3-supply-canary.mjs";
import {
  buildMoonwellMTokenCanaryPlan,
  executeMoonwellMTokenCanaryPlan,
} from "./helpers/moonwell-mtoken-canary.mjs";
import {
  buildErc4626VaultSupplyCanaryPlan,
  executeErc4626VaultSupplyCanaryPlan,
} from "./helpers/erc4626-vault-supply-canary.mjs";

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function positiveUnits(raw) {
  try {
    return BigInt(raw || 0) > 0n;
  } catch {
    return false;
  }
}

function matchingToken(binding = {}, inventorySnapshot = null) {
  return (inventorySnapshot?.tokens || []).find((token) => {
    return token.chain === binding.chain &&
      normalized(token.token) === normalized(binding.assetAddress) &&
      positiveUnits(token.actual);
  }) || null;
}

function matchingNative(binding = {}, inventorySnapshot = null) {
  return (inventorySnapshot?.native || []).find((native) => {
    return native.chain === binding.chain && positiveUnits(native.actual);
  }) || null;
}

function amountFromInventory(token = {}, binding = {}) {
  const actual = BigInt(token.actual || 0);
  if (actual <= 0n) return null;
  const estimatedUsd = Number(token.estimatedUsd);
  const maxCanaryUsd = Number(binding.maxCanaryUsd);
  const reservePct = Math.max(0, Math.min(0.9, Number(binding.reserveSourceInventoryPct ?? 0.2)));
  let amount = (actual * BigInt(Math.round((1 - reservePct) * 10_000))) / 10_000n;
  if (Number.isFinite(estimatedUsd) && estimatedUsd > 0 && Number.isFinite(maxCanaryUsd) && maxCanaryUsd > 0) {
    const capBps = Math.min(10_000, Math.floor((maxCanaryUsd / estimatedUsd) * 10_000));
    amount = (actual * BigInt(Math.max(1, capBps))) / 10_000n;
  }
  return amount > 0n ? amount.toString() : null;
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positionUsd(position = {}) {
  return finite(position.amountUsd) ?? finite(position.targetUsd) ?? finite(position.plan?.amountUsd) ?? 0;
}

export function activeAllocationSharesFromPositions(positions = [], denominatorUsdOverride = null) {
  const openPositions = (positions || []).filter((position) => {
    if (position.status === "closed" || position.event === "position_exit_confirmed") return false;
    return position.status === "open" || position.event === "position_opened";
  });
  const totalUsd = openPositions.reduce((sum, position) => sum + positionUsd(position), 0);
  const denominatorUsd = denominatorUsdOverride == null ? totalUsd : finite(denominatorUsdOverride);
  const add = (out, key, usd) => {
    if (!key || !(usd > 0) || !(denominatorUsd > 0)) return;
    out[key] = (out[key] || 0) + (usd / denominatorUsd);
  };
  const allocations = {
    perStrategy: {},
    perChain: {},
    perProtocol: {},
    bobL2DirectShare: 0,
  };
  for (const position of openPositions) {
    const usd = positionUsd(position);
    add(allocations.perStrategy, position.strategyId || position.opportunityId || position.positionId, usd);
    add(allocations.perChain, position.chain, usd);
    add(allocations.perProtocol, position.protocolId, usd);
  }
  return { totalUsd, allocations };
}

function diversificationCandidate(candidate = {}, activeTotalUsd = 0) {
  const canaryUsd = finite(candidate.maxCanaryUsd) ?? finite(candidate.amountUsd) ?? 0;
  const denominator = activeTotalUsd + canaryUsd;
  const addShare = denominator > 0 ? canaryUsd / denominator : 0;
  return {
    strategyId: candidate.templateId || candidate.strategyId,
    chainId: candidate.chain,
    protocolIds: [candidate.protocolId].filter(Boolean),
    directHolding: false,
    addShare,
  };
}

export function representativeDiversificationVerdict({ candidate, positionRecords = [] } = {}) {
  const canaryUsd = finite(candidate?.maxCanaryUsd) ?? finite(candidate?.amountUsd) ?? 0;
  const activeTotalUsd = activeAllocationSharesFromPositions(positionRecords).totalUsd;
  const denominatorUsd = activeTotalUsd + canaryUsd;
  const active = activeAllocationSharesFromPositions(positionRecords, denominatorUsd);
  const verdict = canAcceptNewAllocation(
    active.allocations,
    diversificationCandidate(candidate, active.totalUsd),
  );
  const candidateStrategyId = candidate?.templateId || candidate?.strategyId;
  const candidateChainId = candidate?.chain;
  const candidateProtocolIds = new Set([candidate?.protocolId].filter(Boolean));
  const candidateSpecificViolations = (verdict.verdict?.violations || []).filter((violation) => {
    if (violation.kind === "per_strategy_share_exceeded") return violation.id === candidateStrategyId;
    if (violation.kind === "per_chain_share_exceeded") return violation.id === candidateChainId;
    if (violation.kind === "per_protocol_share_exceeded") return candidateProtocolIds.has(violation.id);
    if (violation.kind === "chain_not_gateway_official") return violation.id === candidateChainId;
    return false;
  });
  const beforeHhi = computeHhi(activeAllocationSharesFromPositions(positionRecords).allocations.perStrategy);
  const hhiWorsened =
    (verdict.verdict?.hhi ?? 0) > DIVERSIFICATION_POLICY.hhiMax &&
    (verdict.verdict?.hhi ?? 0) > beforeHhi;
  const accepted = verdict.accepted || (candidateSpecificViolations.length === 0 && !hhiWorsened);
  return {
    ...verdict,
    accepted,
    bypassed: denominatorUsd < 10,
    activeUsd: active.totalUsd,
    candidateUsd: canaryUsd,
  };
}

function merklQueuedChains(merklQueue = null) {
  return new Set(Object.keys(merklQueue?.summary?.byChain || {}));
}

function protocolKey(value) {
  return normalized(value).replaceAll("-", "_");
}

function queuedRepresentativeKeys(merklQueue = null) {
  const queue = merklQueue?.queue || merklQueue?.items || [];
  return new Set((queue || [])
    .map((item) => `${item.chain}:${protocolKey(item.protocolId)}`)
    .filter((key) => !key.endsWith(":")));
}

function queuedCoversBinding(queuedKeys, binding = {}) {
  return queuedKeys.has(`${binding.chain}:${protocolKey(binding.protocolId)}`);
}

function deliveredRepresentativeTemplates(records = []) {
  const delivered = new Set();
  for (const record of records || []) {
    if (record?.status !== "delivered" && record?.summary?.proofStatus !== "delivered") continue;
    const templateId = record?.summary?.selected?.templateId || record?.plan?.templateId;
    if (templateId) delivered.add(templateId);
  }
  return delivered;
}

function bindingBackedAllocatorItems(allocatorItems = []) {
  const byTemplate = new Map();
  for (const item of allocatorItems || []) {
    if (!item?.id) continue;
    byTemplate.set(item.id, item);
  }
  for (const binding of Object.values(DESTINATION_REPRESENTATIVE_BINDINGS)) {
    if (byTemplate.has(binding.templateId)) continue;
    byTemplate.set(binding.templateId, {
      id: binding.templateId,
      label: binding.label || binding.templateId,
      chain: binding.chain,
      protocols: [binding.protocolId].filter(Boolean),
      assetFamily: "stables",
      planningEligibility: "allocation_ready",
      source: "representative_binding_registry",
    });
  }
  return [...byTemplate.values()];
}

export function buildDestinationRepresentativeCandidates({
  allocator = null,
  merklQueue = null,
  inventorySnapshot = null,
  deliveredTemplates = new Set(),
  positionRecords = [],
} = {}) {
  const queuedChains = merklQueuedChains(merklQueue);
  const queuedKeys = queuedRepresentativeKeys(merklQueue);
  const allocatorItems = bindingBackedAllocatorItems(allocator?.diversifiedPortfolioDraft?.activeDraft || []);
  return allocatorItems
    .filter((item) => item?.planningEligibility === "allocation_ready")
    .map((item) => {
      if (deliveredTemplates.has(item.id)) {
        return {
          templateId: item.id,
          chain: item.chain,
          protocols: item.protocols || [],
          status: "covered",
          blockers: [],
        };
      }
      const binding = representativeBindingForTemplate(item.id);
      if (!binding) {
        return {
          templateId: item.id,
          chain: item.chain,
          protocols: item.protocols || [],
          status: "blocked",
          blockers: ["representative_binding_missing"],
        };
      }
      if (queuedChains.has(item.chain) && queuedCoversBinding(queuedKeys, binding)) {
        return {
          ...binding,
          label: item.label || item.id,
          protocols: item.protocols || [binding.protocolId].filter(Boolean),
          status: "queued",
          blockers: [],
        };
      }
      if (binding.enabled === false || binding.evidence?.lastVerifiedAt == null) {
        return {
          ...binding,
          label: item.label || item.id,
          protocols: item.protocols || [],
          status: "blocked",
          blockers: ["representative_binding_not_verified"],
        };
      }
      const token = matchingToken(binding, inventorySnapshot);
      const native = matchingNative(binding, inventorySnapshot);
      const amount = token ? amountFromInventory(token, binding) : null;
      const blockers = [];
      if (!token) blockers.push("entry_asset_unavailable");
      if (!native || Number(native.estimatedUsd ?? 0) < Number(binding.minNativeGasUsd ?? 0)) blockers.push("native_gas_unavailable");
      if (!amount) blockers.push("amount_unavailable_after_inventory_reserve");
      const diversification = representativeDiversificationVerdict({ candidate: binding, positionRecords });
      if (!diversification.accepted && !diversification.bypassed) blockers.push("diversification_policy_rejected");
      return {
        ...binding,
        label: item.label || item.id,
        protocols: item.protocols || [],
        status: blockers.length ? "blocked" : "ready",
        blockers,
        diversification: {
          accepted: diversification.accepted,
          bypassed: diversification.bypassed,
          activeUsd: diversification.activeUsd,
          candidateUsd: diversification.candidateUsd,
          violations: diversification.verdict?.violations || [],
        },
        amount,
        matchedToken: token
          ? {
              ticker: token.ticker || null,
              token: token.token || null,
              actual: token.actual || "0",
              actualDecimal: token.actualDecimal ?? null,
              estimatedUsd: token.estimatedUsd ?? null,
            }
          : null,
        matchedNative: native
          ? {
              asset: native.asset || null,
              actual: native.actual || "0",
              actualDecimal: native.actualDecimal ?? null,
              estimatedUsd: native.estimatedUsd ?? null,
            }
          : null,
      };
    });
}

function compactCandidate(candidate = null) {
  if (!candidate) return null;
  return {
    templateId: candidate.templateId,
    chain: candidate.chain,
    protocolId: candidate.protocolId,
    bindingKind: candidate.bindingKind || null,
    status: candidate.status,
    blockers: candidate.blockers || [],
    amount: candidate.amount || null,
    matchedToken: candidate.matchedToken || null,
    matchedNative: candidate.matchedNative || null,
    diversification: candidate.diversification || null,
  };
}

export function selectDestinationRepresentativeCandidate(candidates = []) {
  return [...(candidates || [])]
    .filter((item) => item.status === "ready")
    .sort((left, right) => {
      const leftUsd = finite(left.matchedToken?.estimatedUsd) ?? finite(left.amountUsd) ?? 0;
      const rightUsd = finite(right.matchedToken?.estimatedUsd) ?? finite(right.amountUsd) ?? 0;
      if (leftUsd !== rightUsd) return rightUsd - leftUsd;
      const leftNativeUsd = finite(left.matchedNative?.estimatedUsd) ?? 0;
      const rightNativeUsd = finite(right.matchedNative?.estimatedUsd) ?? 0;
      if (leftNativeUsd !== rightNativeUsd) return rightNativeUsd - leftNativeUsd;
      return String(left.templateId || "").localeCompare(String(right.templateId || ""));
    })[0] || null;
}

function helperForBindingKind(bindingKind) {
  if (bindingKind === "compound_v2_ctoken_mint_redeem") {
    return {
      buildPlan: buildCompoundV2SupplyCanaryPlan,
      executePlan: executeCompoundV2SupplyCanaryPlan,
    };
  }
  if (bindingKind === "moonwell_mtoken_mint_redeem") {
    return {
      buildPlan: buildMoonwellMTokenCanaryPlan,
      executePlan: executeMoonwellMTokenCanaryPlan,
    };
  }
  if (bindingKind === "aave_v3_pool_supply_withdraw") {
    return {
      buildPlan: buildAaveV3SupplyCanaryPlan,
      executePlan: executeAaveV3SupplyCanaryPlan,
    };
  }
  if (bindingKind === "compound_v3_comet_supply_withdraw") {
    return {
      buildPlan: buildCompoundV3SupplyCanaryPlan,
      executePlan: executeCompoundV3SupplyCanaryPlan,
    };
  }
  if (bindingKind === "erc4626_vault_supply_withdraw" || bindingKind === "euler_evault_deposit_withdraw") {
    return {
      buildPlan: buildErc4626VaultSupplyCanaryPlan,
      executePlan: executeErc4626VaultSupplyCanaryPlan,
    };
  }
  return null;
}

async function writeReport(report) {
  await writeTextIfChanged(join(config.dataDir, "destination-representative-autopilot-latest.json"), `${safeJsonStringify(report, 2)}\n`);
  await new JsonlStore(config.dataDir).append("destination-representative-autopilot-runs", JSON.parse(safeJsonStringify(report)));
}

export async function runDestinationRepresentativeAutopilot({
  execute = false,
  write = false,
  allocatorPath = join(config.dataDir, "allocator-core.json"),
  merklQueuePath = join(config.dataDir, "merkl-canary-queue.json"),
  socketPath,
  timeoutMs,
} = {}) {
  const observedAt = new Date().toISOString();
  const preflight = await preflightLiveCanarySweep({
    socketPath,
    timeoutMs,
    requireLiveBaseline: false,
  });
  if (preflight.status !== "ready") {
    const report = {
      schemaVersion: 1,
      observedAt,
      mode: execute ? "execute" : "preview",
      status: "blocked",
      blockedReason: preflight.blockedReason || "live_canary_preflight_not_ready",
      preflight,
    };
    if (write) await writeReport(report);
    return report;
  }

  const [allocator, merklQueue, inventoryRecords, representativeRuns, positionRecords] = await Promise.all([
    readJson(allocatorPath),
    readJson(merklQueuePath),
    readJsonl(config.dataDir, "treasury-inventory"),
    readJsonl(config.dataDir, "destination-representative-autopilot-runs"),
    readJsonl(config.dataDir, "merkl-portfolio-positions").catch(() => []),
  ]);
  const inventorySnapshot = latestTreasuryInventoryForAddress(inventoryRecords, preflight.senderAddress);
  const deliveredTemplates = deliveredRepresentativeTemplates(representativeRuns);
  const candidates = buildDestinationRepresentativeCandidates({
    allocator,
    merklQueue,
    inventorySnapshot,
    deliveredTemplates,
    positionRecords,
  });
  const selected = selectDestinationRepresentativeCandidate(candidates);

  if (!selected) {
    const coveredCount = candidates.filter((item) => item.status === "covered").length;
    const report = {
      schemaVersion: 1,
      observedAt,
      mode: execute ? "execute" : "preview",
      status: coveredCount > 0 ? "covered" : "blocked",
      blockedReason: coveredCount > 0 ? null : candidates[0]?.blockers?.[0] || "no_destination_representative_candidate_ready",
      preflight: {
        status: preflight.status,
        senderAddress: preflight.senderAddress,
        killSwitchPath: preflight.killSwitchPath,
      },
      summary: {
        candidateCount: candidates.length,
        readyCount: 0,
        coveredCount,
        topCandidate: compactCandidate(candidates[0]),
      },
      candidates: candidates.map(compactCandidate),
    };
    if (write) await writeReport(report);
    return report;
  }

  const helper = helperForBindingKind(selected.bindingKind);
  if (!helper) {
    const report = {
      schemaVersion: 1,
      observedAt,
      mode: execute ? "execute" : "preview",
      status: "blocked",
      blockedReason: "unsupported_representative_binding_kind",
      summary: {
        candidateCount: candidates.length,
        readyCount: candidates.filter((item) => item.status === "ready").length,
        coveredCount: candidates.filter((item) => item.status === "covered").length,
        selected: compactCandidate(selected),
      },
      candidates: candidates.map(compactCandidate),
    };
    if (write) await writeReport(report);
    return report;
  }

  const plan = await helper.buildPlan({
    candidate: selected,
    senderAddress: preflight.senderAddress,
    amount: selected.amount,
  });
  let execution = null;
  let executionError = null;
  if (execute) {
    try {
      execution = await helper.executePlan({
        plan,
        socketPath,
        timeoutMs,
      });
    } catch (error) {
      executionError = {
        name: error?.name || "DestinationRepresentativeExecutionError",
        message: error?.message || String(error),
      };
    }
  }

  const report = {
    schemaVersion: 1,
    observedAt,
    mode: execute ? "execute" : "preview",
    status: executionError ? "blocked" : execution?.settlementStatus || "preview_ready",
    blockedReason: executionError ? "destination_representative_execution_error" : null,
    preflight: {
      status: preflight.status,
      senderAddress: preflight.senderAddress,
      killSwitchPath: preflight.killSwitchPath,
    },
    summary: {
      candidateCount: candidates.length,
      readyCount: candidates.filter((item) => item.status === "ready").length,
      coveredCount: candidates.filter((item) => item.status === "covered").length,
      selected: compactCandidate(selected),
      proofStatus: execution?.destinationProof?.status || null,
      txHashes: (execution?.stepResults || [])
        .map((step) => step.signerResult?.broadcast?.txHash)
        .filter(Boolean),
    },
    candidates: candidates.map(compactCandidate),
    plan,
    execution,
    executionError,
  };
  if (write) await writeReport(report);
  return report;
}
