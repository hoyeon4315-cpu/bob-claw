#!/usr/bin/env node

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { readJsonIfExists } from "../estimator/load-canary-state.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import {
  buildRouteRemediationAutopilot,
  summarizeRouteRemediationAutopilot,
} from "../strategy/route-remediation-autopilot.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const entries = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...rest] = arg.slice(2).split("=");
        return [key, rest.join("=")];
      }),
  );
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    input: entries.input ? resolve(entries.input) : null,
  };
}

function uniqueById(candidates = []) {
  const byId = new Map();
  for (const candidate of candidates) {
    const id =
      candidate.id ||
      candidate.strategyId ||
      (
        candidate.opportunityId
          ? `campaign:${candidate.chain || "unknown"}:${candidate.protocol || "unknown"}:${candidate.opportunityId}`
          : null
      ) ||
      candidate.label ||
      "unknown_candidate";
    if (!byId.has(id)) byId.set(id, { ...candidate, id });
  }
  return [...byId.values()];
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function percentile(values = [], pct = 0.9) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * pct) - 1));
  return sorted[index];
}

function costVarianceBps(values = []) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length < 2) return finiteValues.length === 1 ? 0 : null;
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const avg = finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
  if (!(avg > 0)) return 0;
  return ((max - min) / avg) * 10_000;
}

function campaignWindowId(candidate = {}) {
  if (candidate.windowId || candidate.campaignWindowId || candidate.periodId) {
    return candidate.windowId || candidate.campaignWindowId || candidate.periodId;
  }
  const remaining = finite(candidate.hoursRemaining);
  const age = finite(candidate.campaignAgeHours);
  if (remaining !== null || age !== null) {
    return `${Math.round(age ?? 0)}h:${Math.round(remaining ?? 0)}h`;
  }
  return candidate.opportunityId || candidate.id || null;
}

function campaignEvidence(candidate = {}) {
  return {
    sampleCount: candidate.campaignAgeHours !== null && candidate.campaignAgeHours >= 48 ? 2 : 1,
    distinctOpportunityCount: candidate.opportunityId ? 1 : 0,
    evidenceSourceCount: 2,
    estimatedGasClaimSwapBridgeCostUsd: candidate.estimatedGasClaimSwapBridgeCostUsd ?? null,
    displayedAprOnly: false,
    expectedNetProfitUsd:
      candidate.operatorExpectedNetProfitUsd ??
      candidate.expectedRealizedNetPnlUsd ??
      candidate.expectedNetProfitUsd ??
      null,
  };
}

function campaignEvidenceSample(candidate = {}) {
  return {
    opportunityId: candidate.opportunityId || candidate.id || null,
    chain: candidate.chain || null,
    protocol: candidate.protocol || null,
    source: "merkl",
    windowId: campaignWindowId(candidate),
    expectedNetProfitUsd:
      candidate.operatorExpectedNetProfitUsd ??
      candidate.expectedRealizedNetPnlUsd ??
      candidate.expectedNetProfitUsd ??
      null,
    costUsd: candidate.estimatedGasClaimSwapBridgeCostUsd ?? null,
  };
}

const CAMPAIGN_REMEDIATION_BLOCKERS = new Set([
  "protocol_not_bound",
  "protocol_adapter_not_built",
  "executor_missing",
  "executor_not_bound",
  "gateway_route_missing",
  "route_missing",
  "no_route",
  "lifi_quote_rejected",
  "destination_dex_missing",
  "bridge_pair_unsupported",
  "missing_unwind_plan",
  "unwind_missing",
  "exit_liquidity_unproven",
  "reward_exit_unproven",
]);

function remediableCampaignBlockers(candidate = {}) {
  return unique((candidate.blockers || []).filter((blocker) => CAMPAIGN_REMEDIATION_BLOCKERS.has(blocker)));
}

function campaignFamilyId(blocker) {
  if (blocker === "protocol_not_bound" || blocker.includes("protocol")) return "campaign:protocol-binding-gaps";
  if (blocker.includes("executor")) return "campaign:executor-binding-gaps";
  if (blocker.includes("unwind") || blocker.includes("exit") || blocker.includes("claim")) return "campaign:exit-unwind-gaps";
  return "campaign:route-adapter-gaps";
}

function campaignFamilyCandidates(report = null) {
  const groups = new Map();
  for (const candidate of report?.candidates || []) {
    for (const blocker of remediableCampaignBlockers(candidate)) {
      const id = campaignFamilyId(blocker);
      const group = groups.get(id) || { id, blockers: new Set(), candidates: [] };
      group.blockers.add(blocker);
      group.candidates.push(candidate);
      groups.set(id, group);
    }
  }

  return [...groups.values()].map((group) => {
    const samples = group.candidates.map(campaignEvidenceSample);
    const costs = samples.map((sample) => finite(sample.costUsd)).filter((value) => value !== null);
    const expectedNetProfitUsd = group.candidates.reduce((sum, candidate) => {
      const net = finite(
        candidate.operatorExpectedNetProfitUsd ??
          candidate.expectedRealizedNetPnlUsd ??
          candidate.expectedNetProfitUsd,
      );
      return sum + (net ?? 0);
    }, 0);
    const chainNet = new Map();
    for (const candidate of group.candidates) {
      const net = finite(candidate.operatorExpectedNetProfitUsd ?? candidate.expectedNetProfitUsd) ?? 0;
      chainNet.set(candidate.chain, (chainNet.get(candidate.chain) || 0) + net);
    }
    const chain = [...chainNet.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || group.candidates[0]?.chain || null;
    const protocols = unique(group.candidates.map((candidate) => candidate.protocol).filter(Boolean));
    return {
      id: group.id,
      label: `${protocols.slice(0, 4).join(", ") || "campaign"} remediation family`,
      chain,
      protocol: protocols.join(",") || null,
      blockers: [...group.blockers],
      expectedNetProfitUsd,
      evidence: {
        sourceKind: "campaign_remediation_family",
        evidenceSamples: samples,
        sampleCount: samples.length,
        distinctOpportunityCount: unique(samples.map((sample) => sample.opportunityId)).length,
        distinctChainCount: unique(samples.map((sample) => sample.chain)).length,
        distinctProtocolCount: protocols.length,
        distinctWindowCount: unique(samples.map((sample) => sample.windowId)).length,
        evidenceSourceCount: 2,
        measuredP90RoundTripCostUsd: percentile(costs, 0.9),
        estimatedGasClaimSwapBridgeCostUsd: percentile(costs, 0.9),
        costVarianceBps: costVarianceBps(costs),
        expectedNetProfitUsd,
      },
    };
  });
}

export function candidatesFromCampaignReport(report = null) {
  const raw = (report?.candidates || []).map((candidate) => ({
    ...candidate,
    id: `campaign:${candidate.chain || "unknown"}:${candidate.protocol || "unknown"}:${candidate.opportunityId || "unknown"}`,
    label: `${candidate.protocol || "campaign"} ${candidate.opportunityId || ""}`.trim(),
    blockers: candidate.blockers || [],
    evidence: {
      ...campaignEvidence(candidate),
      ...(candidate.evidence || {}),
    },
  }));
  return [...campaignFamilyCandidates(report), ...raw];
}

export function candidatesFromDeterministicReport(report = null) {
  return (report?.candidates || []).map((candidate) => ({
    ...candidate,
    blockers: [
      ...(candidate.blockers || []),
      ...(candidate.missingEvidence || []),
    ],
    evidence: {
      ...(candidate.evidence || {}),
      distinctChainCount:
        candidate.evidence?.distinctChainCount ??
        (Array.isArray(candidate.evidence?.protocolTrack?.chains) ? candidate.evidence.protocolTrack.chains.length : undefined),
      distinctProtocolCount:
        candidate.evidence?.distinctProtocolCount ??
        (Array.isArray(candidate.evidence?.protocolTrack?.protocols) ? candidate.evidence.protocolTrack.protocols.length : undefined),
      sampleCount:
        candidate.evidence?.sampleCount ??
        (candidate.dryRunReceiptRecorded === true ? 2 : candidate.readyForDryRun === true ? 1 : 0),
      distinctOpportunityCount: candidate.evidence?.distinctOpportunityCount ?? 1,
      evidenceSourceCount:
        candidate.evidence?.evidenceSourceCount ??
        (
          candidate.readyForDryRun === true || candidate.repoAutoBuildSupported === true
            ? 2
            : 1
        ),
      expectedNetProfitUsd: candidate.expectedNetProfitUsd ?? candidate.evidence?.expectedNetProfitUsd ?? null,
    },
  }));
}

async function loadCandidates(args) {
  if (args.input) {
    const input = await readJsonIfExists(args.input);
    if (Array.isArray(input)) return uniqueById(input);
    return uniqueById(input?.candidates || []);
  }

  const [deterministicReport, campaignReport] = await Promise.all([
    readJsonIfExists(join(config.dataDir, "deterministic-strategy-candidates.json")),
    readJsonIfExists(join(config.dataDir, "campaign-aware-opportunities.json")),
  ]);

  return uniqueById([
    ...candidatesFromDeterministicReport(deterministicReport),
    ...candidatesFromCampaignReport(campaignReport),
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const candidates = await loadCandidates(args);
  const report = buildRouteRemediationAutopilot({ candidates });
  const summary = summarizeRouteRemediationAutopilot(report);

  if (args.write) {
    await writeTextIfChanged(
      join(config.dataDir, "route-remediation-autopilot.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`status=${summary.status}`);
  console.log(`candidates=${summary.candidateCount}`);
  console.log(`workOrders=${summary.workOrderCount}`);
  console.log(`blockedCandidates=${summary.blockedCandidateCount}`);
  console.log(`actions=${Object.entries(summary.actionCounts).map(([key, value]) => `${key}:${value}`).join(",") || "none"}`);
  console.log(`overfitBlockers=${Object.entries(summary.overfitBlockerCounts).map(([key, value]) => `${key}:${value}`).join(",") || "none"}`);
  if (summary.topWorkOrder) {
    console.log(`top=${summary.topWorkOrder.candidateId} action=${summary.topWorkOrder.action} chain=${summary.topWorkOrder.chain} netAfterBuildUsd=${summary.topWorkOrder.estimatedNetAfterBuildUsd}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
