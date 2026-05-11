import { createHash } from "node:crypto";
import {
  computeTinyCanaryMinProfitablePositionUsd,
  resolveTinyCanaryExpectedHoldDays,
} from "../../config/sizing.mjs";
import { splitCandidateBlockers } from "../../executor/policy/blocker-codes.mjs";
import { matchOperatorApproval } from "../../config/operator-approval-registry.mjs";
import { appendRadarJsonl, readRadarJsonl } from "./jsonl.mjs";

const OBSERVATION_EXECUTION_PATH = "gateway_destination";
const BASE_NATIVE_CHAINS = new Set(["base"]);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stableHash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function opportunityId(item = {}) {
  return String(item.opportunityId || item.queueId || "").trim();
}

function itemObservedAt(queue = {}, item = {}) {
  return item.observedAt || queue.generatedAt || new Date().toISOString();
}

function itemAmountUsd(item = {}) {
  return finiteNumber(
    item.executionReadiness?.matchedToken?.estimatedUsd ??
    item.executionReadiness?.matchedNative?.estimatedUsd ??
    item.estimatedUsd ??
    item.amountUsd,
  );
}

function expectedHoldDays(item = {}) {
  return resolveTinyCanaryExpectedHoldDays({
    expectedHoldDays: item.expectedHoldDays,
    campaignRemainingHours: item.campaignRemainingHours,
    campaignEndsAt: item.campaignEndsAt,
    now: item.observedAt,
  });
}

function exitPathReady(item = {}) {
  const actions = item.protocolBindingPlan?.canaryActions || [];
  const bindingKind = String(item.protocolBindingPlan?.bindingKind || "");
  return /withdraw|redeem|unwind/i.test(bindingKind) ||
    actions.some((action) => /withdraw|redeem|unwind/i.test(String(action || "")));
}

function familyKeyForMerkl(item = {}) {
  if (item.family === "wrapped_btc_lending" || item.executionSurface === "lending") {
    return "wrapped_btc_direct_lending";
  }
  if (item.family === "stable_treasury_carry" || item.executionSurface === "stableCarry") {
    return "same_chain_stable_carry";
  }
  return null;
}

function gatewayDestinationCandidate(item = {}, familyKey = familyKeyForMerkl(item)) {
  const chain = String(item.chain || "").toLowerCase();
  const ticker = String(item.executionReadiness?.matchedToken?.ticker || "").toUpperCase();
  return (
    chain === "base" &&
    familyKey === "wrapped_btc_direct_lending" &&
    /WBTC|CBBTC|LBTC|SOLVBTC/u.test(ticker)
  );
}

function candidateExecutionPath(item = {}, familyKey = familyKeyForMerkl(item)) {
  const chain = String(item.chain || "").toLowerCase();
  if (gatewayDestinationCandidate(item, familyKey)) return "gateway_destination";
  return BASE_NATIVE_CHAINS.has(chain) ? "base_native_evm" : "gateway_to_evm_bridged";
}

function minProfitBlocker(item = {}) {
  const amountUsd = itemAmountUsd(item);
  if (amountUsd === null) return "candidate_amount_missing";
  const aprPct = finiteNumber(item.aprPct) ?? 0;
  const holdDays = expectedHoldDays(item);
  const minUsd = computeTinyCanaryMinProfitablePositionUsd({
    chain: item.chain,
    aprPct,
    expectedHoldDays: holdDays,
    estimatedGasCostUsd: item.estimatedGasCostUsd,
  });
  if (minUsd !== null && amountUsd < minUsd) {
    return `same_chain_unprofitable:need_$${Math.ceil(minUsd)}_on_${item.chain || "unknown"}`;
  }
  return null;
}

function candidateStateHash(candidate = {}) {
  return stableHash({
    candidateId: candidate.candidateId || null,
    gateStatus: candidate.gateStatus || null,
    blockers: candidate.blockers || [],
    amountUsd: finiteNumber(candidate.amountUsd),
    executionPath: candidate.executionPath || null,
    familyKey: candidate.familyKey || null,
    chain: candidate.chain || null,
    protocolId: candidate.protocolId || null,
    opportunityId: candidate.opportunityId || null,
    autoExecute: candidate.metadata?.autoExecute === true,
    queueReadinessDiagnosis: candidate.metadata?.queueReadinessDiagnosis || null,
  });
}

function rewardTokenSymbol(item = {}) {
  const symbol = String(
    item.rewardToken ||
    item.rewardTokenSymbol ||
    item.rewardTokens?.[0]?.symbol ||
    item.rewards?.[0]?.token?.symbol ||
    item.rewards?.[0]?.symbol ||
    "",
  ).toUpperCase();
  return symbol || null;
}

function rewardTokenType(item = {}) {
  const symbol = rewardTokenSymbol(item);
  if (!symbol) return null;
  return ["USDC", "USDT", "DAI", "RLUSD", "USDS"].includes(symbol) ? "stable" : "defaultRewardToken";
}

export function diagnoseMerklQueueReadiness(item = {}) {
  const queueStatus = item.queueStatus || null;
  if (queueStatus === "ready_for_tiny_live_canary") return null;

  // If operator has explicitly approved this scope, downgrade review requirement
  if (matchOperatorApproval({
    scopeType: "merkl_protocol",
    scopeId: `${item.protocolId || item.protocolName || "unknown"}:${item.chain || "unknown"}`,
    chain: item.chain || null,
    protocolId: item.protocolId || item.protocolName || null,
    family: item.family || null,
  })) {
    return null;
  }

  const autoEntryBlockers = Array.isArray(item.autoEntry?.blockers) ? item.autoEntry.blockers : [];
  const bindingPlan = item.protocolBindingPlan || {};
  const readiness = item.executionReadiness || {};
  const reasons = [
    queueStatus ? `queue_status:${queueStatus}` : "queue_status:missing",
    readiness.status ? `inventory:${readiness.status}` : null,
    bindingPlan.status ? `binding:${bindingPlan.status}` : null,
    bindingPlan.bindingKind ? `binding_kind:${bindingPlan.bindingKind}` : null,
    ...autoEntryBlockers.map((blocker) => `auto_entry:${blocker}`),
  ].filter(Boolean);
  return {
    code: "manual_operator_review_required",
    originalBlocker: "merkl_queue_not_ready_for_tiny_live_canary",
    queueStatus,
    executionReadiness: readiness.status || null,
    bindingStatus: bindingPlan.status || null,
    bindingKind: bindingPlan.bindingKind || null,
    autoEntryBlockers,
    diagnosis: reasons.join("; "),
  };
}

export function merklQueueItemToRadarObservation(queue = {}, item = {}) {
  const id = opportunityId(item);
  if (!id) return null;
  return {
    obsId: `merkl:${id}`,
    observedAt: itemObservedAt(queue, item),
    sourceList: ["merkl_canary_queue"],
    sourceFreshness: {
      merkl_canary_queue: {
        generatedAt: queue.generatedAt || null,
        queueId: item.queueId || null,
      },
    },
    walletClusterId: `merkl:${item.chain || "unknown"}:${item.protocolId || "unknown"}`,
    clusterMethod: "merkl_campaign_surface",
    clusterConfidence: item.queueStatus === "ready_for_tiny_live_canary" ? 0.75 : 0.65,
    chain: item.chain || null,
    protocolId: item.protocolId || item.protocolName || null,
    poolOrMarket: item.poolOrMarket || item.protocolBindingPlan?.resolvedBinding?.vaultAddress || item.name || null,
    sourceTxs: [],
    rawEventPayloadHash: stableHash({
      opportunityId: id,
      chain: item.chain || null,
      protocolId: item.protocolId || null,
      queueStatus: item.queueStatus || null,
      generatedAt: queue.generatedAt || null,
    }),
    executionPath: OBSERVATION_EXECUTION_PATH,
    discoveryClaimType: "behavior_observed",
  };
}

export function merklQueueItemToRadarCandidate(queue = {}, item = {}) {
  const id = opportunityId(item);
  const familyKey = familyKeyForMerkl(item);
  if (!id || !familyKey) {
    return {
      candidate: null,
      skipped: id ? { opportunityId: id, reason: "radar_family_binding_unsupported" } : null,
    };
  }
  const queueReadinessDiagnosis = diagnoseMerklQueueReadiness(item);
  const rawBlockers = [
    queueReadinessDiagnosis ? "manual_operator_review_required" : null,
    exitPathReady(item) ? null : "exit_path_unproven",
    minProfitBlocker(item),
  ].filter(Boolean);
  const split = splitCandidateBlockers(rawBlockers, { candidateScopedInventory: true });
  const gateStatus = split.blockers.length === 0
    ? split.filters.length === 0 ? "executable" : "review_only"
    : "blocked";
  const executionPath = candidateExecutionPath(item, familyKey);
  const amountUsd = itemAmountUsd(item);
  const candidate = {
    candidateId: `merkl:${id}`,
    packetId: `merkl:${id}`,
    observedAt: itemObservedAt(queue, item),
    familyKey,
    chain: item.chain || null,
    protocol: item.protocolId || item.protocolName || null,
    protocolId: item.protocolId || item.protocolName || null,
    opportunityId: id,
    displayedAprPct: finiteNumber(item.aprPct),
    effectiveAprPct: finiteNumber(item.aprPct),
    rewardTokenType: rewardTokenType(item),
    rewardToken: rewardTokenSymbol(item),
    expectedHoldDays: expectedHoldDays(item),
    amountUsd,
    proposedSizeBtc: "0.0003",
    committedCapBtc: "0.0003",
    executionPath,
    protocolAuditStatus: item.protocolBindingPlan?.status === "binding_ready" ? "binding_ready" : "unknown",
    protocolAuditFirms: [],
    auditReportHash: [],
    protocolAgeDays: null,
    protocolDeployTxHash: null,
    protocolTvlNow: finiteNumber(item.tvlUsd),
    protocolTvlPeak: finiteNumber(item.tvlUsd),
    protocolTvlDrawdown30d: null,
    protocolExploitHistory: [],
    reentrancyStaticAnalysisScore: null,
    governanceTokenSupply: null,
    governanceQuorum: null,
    governanceTimelockSeconds: null,
    governanceMultisigThreshold: null,
    mevExposureScore: 10,
    privateRpcUsed: false,
    bundleSubmissionVenue: null,
    sanctionsFlag: "clean",
    taxJurisdictionFlag: "unknown",
    bridgeRouteSanctionsCheck: "clean",
    relayerJurisdiction: null,
    custodianEntity: null,
    gatewayQuoteId: null,
    gatewayFeeSats: null,
    gatewayLatencyObserved: null,
    relayerLivenessProof: null,
    lpEscrowAddress: null,
    policyHashAtEvaluation: "radar_merkl_queue_sync_v1",
    killSwitchState: "running",
    capUtilizationAtEvaluationBps: null,
    blockers: split.blockers,
    filters: split.filters,
    gateStatus,
    metadata: {
      source: "merkl_canary_queue",
      queueId: item.queueId || null,
      autoExecute: item.autoEntry?.autoExecute === true,
      syncedAt: queue.generatedAt || null,
      queueReadinessDiagnosis,
    },
  };
  candidate.metadata.stateHash = candidateStateHash(candidate);
  return { candidate, skipped: null };
}

async function appendMissing({ dataDir, name, records, idField }) {
  const existing = await readRadarJsonl(dataDir, name);
  const seen = new Set(existing.map((record) => record?.[idField]).filter(Boolean));
  let written = 0;
  for (const record of records) {
    const id = record?.[idField];
    if (!id || seen.has(id)) continue;
    await appendRadarJsonl(dataDir, name, record);
    seen.add(id);
    written += 1;
  }
  return written;
}

async function appendChanged({ dataDir, name, records, idField, hashFn }) {
  const existing = await readRadarJsonl(dataDir, name);
  const latestById = new Map();
  for (const record of existing) {
    const id = record?.[idField];
    if (!id) continue;
    latestById.set(id, record);
  }
  let written = 0;
  for (const record of records) {
    const id = record?.[idField];
    if (!id) continue;
    const existingRecord = latestById.get(id);
    const recordHash = record?.metadata?.stateHash || hashFn(record);
    const existingHash = existingRecord?.metadata?.stateHash || (existingRecord ? hashFn(existingRecord) : null);
    if (existingRecord && recordHash === existingHash) continue;
    await appendRadarJsonl(dataDir, name, record);
    latestById.set(id, record);
    written += 1;
  }
  return written;
}

export async function syncMerklQueueToRadar({ dataDir, merklQueue } = {}) {
  const queueItems = Array.isArray(merklQueue?.queue) ? merklQueue.queue : [];
  const observations = queueItems
    .map((item) => merklQueueItemToRadarObservation(merklQueue, item))
    .filter(Boolean);
  const candidateResults = queueItems.map((item) => merklQueueItemToRadarCandidate(merklQueue, item));
  const candidates = candidateResults.map((result) => result.candidate).filter(Boolean);
  const skippedCandidates = candidateResults.map((result) => result.skipped).filter(Boolean);
  const observationsWritten = await appendMissing({
    dataDir,
    name: "opportunity-observations",
    records: observations,
    idField: "obsId",
  });
  const candidatesWritten = await appendChanged({
    dataDir,
    name: "executable-candidates",
    records: candidates,
    idField: "candidateId",
    hashFn: candidateStateHash,
  });
  return {
    status: "completed",
    source: "merkl_canary_queue",
    observedCount: observations.length,
    candidateCount: candidates.length,
    observationsWritten,
    candidatesWritten,
    skippedCandidates,
  };
}
