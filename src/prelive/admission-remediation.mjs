import {
  DEFAULT_ALLOWED_QUEUE_SCRIPTS,
  defaultRunCommand,
  parseWhitelistedRefreshCommand,
  runParsedRefreshSteps,
} from "../session/shadow-refresh-runner.mjs";
import { defaultDexQuoteProvider, noSupportedRouterReason } from "../dex/odos.mjs";
import { shellQuote } from "../lib/shell-quote.mjs";

export const DEFAULT_ADMISSION_REMEDIATION_ALLOWED_SCRIPTS = new Set([
  ...DEFAULT_ALLOWED_QUEUE_SCRIPTS,
  "bitcoin:fees",
  "build:prelive-review-package",
  "gas:snapshot",
  "run:shadow-refresh-batch",
  "write:session-handoff",
]);

export const DEFAULT_ADMISSION_REMEDIATION_FOLLOW_UP_COMMANDS = [
  "npm run report:prelive-readiness -- --write",
  "npm run build:prelive-review-package -- --write",
  "npm run status:dashboard",
  "npm run write:session-handoff",
];

export const DEFAULT_ADMISSION_REMEDIATION_RUNNER_COMMAND =
  "npm run run:admission-remediation -- --execute --continue-on-failure --limit=3";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function primaryCandidate(reviewPackage = null) {
  return reviewPackage?.primaryLiveCandidate || reviewPackage?.policyReviewCandidate || null;
}

function routeCandidate(reviewPackage = null) {
  const candidate = primaryCandidate(reviewPackage);
  if (candidate?.candidateType !== "strategy") return candidate;
  if (reviewPackage?.policyReviewCandidate?.candidateType === "strategy") return null;
  return reviewPackage?.policyReviewCandidate || null;
}

function strategyPrimaryReadyForPolicyReview(reviewPackage = null) {
  return reviewPackage?.readyForPolicyReview === true && primaryCandidate(reviewPackage)?.candidateType === "strategy";
}

function humanizeCode(code = null) {
  return code ? code.replace(/_/g, " ") : null;
}

function isWalletReadinessReason(reason = null) {
  const normalized = String(reason || "").toLowerCase();
  return (
    normalized === "token" ||
    normalized === "native" ||
    normalized === "allowance" ||
    normalized === "wallet_not_checked" ||
    normalized.includes("token_balance") ||
    normalized.includes("native_balance") ||
    normalized.includes("allowance_insufficient")
  );
}

function compareItems(left, right) {
  if ((left.priority ?? 0) !== (right.priority ?? 0)) {
    return (right.priority ?? 0) - (left.priority ?? 0);
  }
  return `${left.code || ""}:${left.command || ""}`.localeCompare(`${right.code || ""}:${right.command || ""}`);
}

function dedupeItems(items = []) {
  const byIdentity = new Map();
  for (const item of items) {
    if (!item) continue;
    const key = item.command || `${item.status || "unknown"}:${item.code || ""}:${item.reason || ""}`;
    const existing = byIdentity.get(key);
    if (!existing || compareItems(item, existing) < 0) {
      byIdentity.set(key, item);
    }
  }
  return [...byIdentity.values()].sort(compareItems).map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

function item({
  priority,
  code,
  label,
  status = "ready",
  reason = null,
  command = null,
  blockers = [],
  resolves = [],
  routeKey = null,
  routeLabel = null,
  amount = null,
  source = null,
}) {
  return {
    priority,
    code,
    label,
    status,
    reason,
    command,
    blockers,
    resolves: unique(resolves),
    routeKey,
    routeLabel,
    amount,
    source,
  };
}

function verifyGatewayCommand(routeKey, amount) {
  if (!routeKey || !amount) return null;
  return `npm run verify:gateway -- --route-key=${shellQuote(routeKey)} --amounts=${shellQuote(amount)}`;
}

function exactGasCommand(routeKey, amount, address = null) {
  if (!routeKey || !amount) return null;
  const fromArg = address ? ` --from=${shellQuote(address)}` : "";
  return `npm run estimate:gateway-gas -- --route-key=${shellQuote(routeKey)} --amount=${shellQuote(amount)}${fromArg}`;
}

function dexRefreshCommand(routeKey, amount) {
  if (!routeKey || !amount) return null;
  return `npm run quote:dex -- --route-key=${shellQuote(routeKey)} --amount=${shellQuote(amount)} --include-stable-entry && npm run score:gateway -- --write --route-key=${shellQuote(routeKey)} --amount=${shellQuote(amount)}`;
}

function gasSnapshotCommand() {
  return "npm run gas:snapshot";
}

function marketSnapshotCommand() {
  return "npm run price:snapshot";
}

function bitcoinFeeCommand() {
  return "npm run bitcoin:fees";
}

function checkWalletReadinessCommand(routeKey = null, amount = null, address = null) {
  if (!routeKey || !amount) return null;
  const addressArg = address ? ` --address=${shellQuote(address)}` : "";
  return `npm run check:estimator-wallet -- --route-key=${shellQuote(routeKey)} --amount=${shellQuote(amount)}${addressArg}`;
}

function refreshStatusCommand() {
  return DEFAULT_ADMISSION_REMEDIATION_FOLLOW_UP_COMMANDS.join(" && ");
}

function parseRouteChains(routeKey = null) {
  const [src = "", dst = ""] = String(routeKey || "").split("->");
  return {
    srcChain: src.split(":")[0] || null,
    dstChain: dst.split(":")[0] || null,
  };
}

function structuralDexFailureReason(candidate = null) {
  const inferred = parseRouteChains(candidate?.routeKey);
  const chains = [candidate?.srcChain || inferred.srcChain, candidate?.dstChain || inferred.dstChain]
    .filter(Boolean);
  for (const chain of chains) {
    if (!defaultDexQuoteProvider(chain)) {
      return noSupportedRouterReason(chain);
    }
  }
  return null;
}

function inputItems(reviewPackage = null, address = null) {
  const candidate = routeCandidate(reviewPackage);
  const routeKey = candidate?.routeKey || null;
  const routeLabel = candidate?.routeLabel || null;
  const amount = candidate?.amount || null;
  const inputFreshness = candidate?.inputFreshness || null;
  const blockerReasons = unique(candidate?.blockerReasons || []);
  if (!inputFreshness || !routeKey || !amount) return [];
  const structuralDexReason = structuralDexFailureReason(candidate);
  const hasWalletBlocker = blockerReasons.some((reason) => isWalletReadinessReason(reason));

  const mapping = [
    {
      field: "gatewayQuote",
      stale: "stale_gateway_quote",
      missing: "missing_gateway_quote",
      priority: 96,
      code: "refresh_gateway_quote",
      label: "refresh gateway quote",
      command: verifyGatewayCommand(routeKey, amount),
    },
    {
      field: "exactGas",
      stale: "stale_exact_gas",
      missing: "missing_exact_gas",
      blocked: "blocked_exact_gas",
      priority: 95,
      code: "refresh_exact_gas",
      label: "refresh exact gas",
      command: exactGasCommand(routeKey, amount, address),
    },
    {
      field: "srcGas",
      stale: "stale_src_gas",
      missing: "missing_src_gas",
      priority: 94,
      code: "refresh_src_gas",
      label: "refresh source gas snapshot",
      command: gasSnapshotCommand(),
    },
    {
      field: "dexQuote",
      stale: "stale_dex_quote",
      missing: "missing_dex_quote",
      blocked: "blocked_dex_quote",
      priority: 93,
      code: "refresh_dex_quote",
      label: "refresh DEX quote and score",
      command: dexRefreshCommand(routeKey, amount),
    },
    {
      field: "bitcoinFee",
      stale: "stale_bitcoin_fee",
      missing: "missing_bitcoin_fee",
      priority: 92,
      code: "refresh_bitcoin_fee",
      label: "refresh bitcoin fee snapshot",
      command: bitcoinFeeCommand(),
    },
    {
      field: "marketSnapshot",
      stale: "stale_market",
      missing: "missing_market",
      priority: 91,
      code: "refresh_market_snapshot",
      label: "refresh market snapshot",
      command: marketSnapshotCommand(),
    },
  ];

  return mapping
    .flatMap((entry) => {
      let state = inputFreshness[entry.field]?.state || null;
      if (
        hasWalletBlocker &&
        (entry.field === "gatewayQuote" || entry.field === "exactGas" || entry.field === "dexQuote") &&
        (state === "stale" || state === "missing")
      ) {
        return [];
      }
      if (entry.field === "dexQuote" && (state === "stale" || state === "missing") && structuralDexReason) {
        state = "blocked";
      }
      if (state !== "stale" && state !== "missing" && state !== "blocked") return [];
      if (state === "blocked") {
        return [
          item({
            priority: entry.priority,
            code: `hold_${entry.field}`,
            label: `hold on blocked ${entry.label.toLowerCase()}`,
            status: "blocked",
            reason:
              entry.field === "dexQuote" && structuralDexReason
                ? `${entry.blocked || `blocked_${entry.field}`}:${structuralDexReason}`
                : entry.blocked || `blocked_${entry.field}`,
            command: null,
            resolves: [entry.blocked || `blocked_${entry.field}`],
            routeKey,
            routeLabel,
            amount,
            source: "candidate_inputs",
          }),
        ];
      }
      return [
        item({
          priority: entry.priority,
          code: entry.code,
          label: entry.label,
          status: "ready",
          reason: state === "stale" ? entry.stale : entry.missing,
          command: entry.command,
          resolves: [state === "stale" ? entry.stale : entry.missing],
          routeKey,
          routeLabel,
          amount,
          source: "candidate_inputs",
        }),
      ];
    });
}

function strategyCandidateItems(reviewPackage = null) {
  const candidate = primaryCandidate(reviewPackage);
  if (candidate?.candidateType !== "strategy" || reviewPackage?.readyForPolicyReview) return [];
  const blockers = unique([...(candidate?.blockerReasons || []), ...(candidate?.evidenceBlockers || [])]);
  if (candidate?.reviewReady === true && blockers.length === 0) return [];
  const nextAction = candidate?.nextAction || null;
  if (!nextAction?.code && blockers.length === 0) return [];
  return [
    item({
      priority: 110,
      code: nextAction?.code || "clear_strategy_candidate_blockers",
      label: nextAction?.label || humanizeCode(nextAction?.code) || candidate?.candidateLabel || "advance primary strategy candidate",
      status: nextAction?.command ? "ready" : "policy_review",
      reason: blockers[0] || candidate?.tradeReadiness || null,
      command: nextAction?.command || null,
      blockers,
      resolves: blockers,
      routeLabel: candidate?.candidateLabel || null,
      amount: candidate?.amount || null,
      source: "primary_strategy_candidate",
    }),
  ];
}

function measuredLeaderItem(reviewPackage = null) {
  const measuredLeader = reviewPackage?.measuredLeaderReview || null;
  const blockers = reviewPackage?.tinyCanaryAdmission?.blockers || [];
  if (!measuredLeader?.command || !blockers.includes("policy_review_stage_not_ready")) return [];
  return [
    item({
      priority: 89,
      code: measuredLeader.nextActionCode || "review_measured_route",
      label: measuredLeader.nextActionLabels?.[0] || measuredLeader.nextActionCode || "review measured leader",
      status: "ready",
      reason: blockers.includes("policy_review_stage_not_ready") ? "policy_review_stage_not_ready" : null,
      command: measuredLeader.command,
      resolves: ["policy_review_stage_not_ready"],
      routeKey: measuredLeader.routeKey || null,
      routeLabel: measuredLeader.routeLabel || null,
      amount: measuredLeader.amount || null,
      source: "measured_leader_review",
    }),
  ];
}

function queueFollowUpItems(reviewPackage = null) {
  return (reviewPackage?.queueFollowUps || [])
    .filter((entry) => entry?.command)
    .map((entry) =>
      item({
        priority:
          entry.scope === "active_canary" && isWalletReadinessReason(entry.reason)
            ? 98 - (entry.rank ?? 0)
            : entry.scope === "active_canary"
              ? 90 - (entry.rank ?? 0)
              : isWalletReadinessReason(entry.reason)
                ? 88 - (entry.rank ?? 0)
                : 84 - (entry.rank ?? 0),
        code: entry.reason || "queue_follow_up",
        label: entry.label || entry.scope || "queue follow-up",
        status: "ready",
        reason: entry.reason || null,
        command: entry.command,
        resolves: ["shadow_replay_not_ready"],
        routeLabel: entry.label || null,
        source: "shadow_queue",
      }),
    );
}

function retainSuppressedQueueItem(entry = null) {
  return isWalletReadinessReason(entry?.reason);
}

function retainSuppressedInputItem(entry = null) {
  return entry?.status === "blocked" || entry?.status === "policy_review";
}

function evidenceCampaignItems(evidenceCampaign = null) {
  return (evidenceCampaign?.actions || [])
    .filter((entry) => entry?.command)
    .filter((entry) => entry.status === "ready" || entry.status === "policy_review" || entry.status === "blocked")
    .map((entry, index) =>
      item({
        priority: (entry.status === "ready" ? 82 : entry.status === "policy_review" ? 78 : 60) - index,
        code: entry.code || null,
        label: entry.label || entry.code || "campaign action",
        status: entry.status || "ready",
        reason: entry.reason || null,
        command: entry.command,
        blockers: entry.blockers || [],
        resolves: entry.reason ? [entry.reason] : [],
        source: "prelive_evidence_campaign",
      }),
    );
}

function advanceCanaryWalletItems(advanceCanary = null, address = null) {
  const candidate = advanceCanary?.final || advanceCanary?.afterWalletCheck || advanceCanary?.initial || null;
  const reason = (candidate?.reasons || []).find((entry) => isWalletReadinessReason(entry)) || null;
  if (candidate?.decision !== "FUND_AND_APPROVE_WALLET" || !reason) return [];
  return [
    item({
      priority: 99,
      code: reason,
      label: candidate.routeLabel || "active canary wallet readiness",
      status: "ready",
      reason,
      command: checkWalletReadinessCommand(candidate.routeKey || null, candidate.amount || null, address),
      resolves: ["shadow_replay_not_ready"],
      routeKey: candidate.routeKey || null,
      routeLabel: candidate.routeLabel || null,
      amount: candidate.amount || null,
      source: "advance_canary",
    }),
  ];
}

export function buildAdmissionRemediationPlan({
  reviewPackage = null,
  evidenceCampaign = null,
  address = null,
  advanceCanary = null,
} = {}) {
  if (!reviewPackage) return null;
  const blockers = reviewPackage?.tinyCanaryAdmission?.blockers || [];
  const suppressRouteRefreshWork = strategyPrimaryReadyForPolicyReview(reviewPackage);
  const evidenceItems = evidenceCampaignItems(evidenceCampaign);
  const canaryWalletItems = advanceCanaryWalletItems(advanceCanary, address);
  const routeInputItems = inputItems(reviewPackage, address);
  const queueItems = queueFollowUpItems(reviewPackage);
  const retainedRouteInputItems = suppressRouteRefreshWork
    ? routeInputItems.filter(retainSuppressedInputItem)
    : routeInputItems;
  const retainedQueueItems = suppressRouteRefreshWork
    ? queueItems.filter(retainSuppressedQueueItem)
    : queueItems;
  const hasRefreshBatchRunner = evidenceItems.some((entry) => entry.code === "execute_refresh_batch");
  const eligibleQueueItems = hasRefreshBatchRunner
    ? retainedQueueItems.filter((entry) => (entry.priority ?? 0) >= 90)
    : retainedQueueItems;
  const items = dedupeItems([
    ...strategyCandidateItems(reviewPackage),
    ...canaryWalletItems,
    ...retainedRouteInputItems,
    ...(suppressRouteRefreshWork ? [] : measuredLeaderItem(reviewPackage)),
    ...eligibleQueueItems,
    ...evidenceItems,
  ]);

  if (items.length === 0) {
    return {
      schemaVersion: 1,
      blockerCount: blockers.length,
      readyCount: 0,
      policyReviewCount: 0,
      blockedCount: 0,
      overallStatus: blockers.length ? "blocked_without_command" : "clear",
      nextAction: null,
      items: [],
      runnerCommand: DEFAULT_ADMISSION_REMEDIATION_RUNNER_COMMAND,
      followUpCommand: refreshStatusCommand(),
    };
  }

  const readyCount = items.filter((entry) => entry.status === "ready").length;
  const policyReviewCount = items.filter((entry) => entry.status === "policy_review").length;
  const blockedCount = items.filter((entry) => entry.status === "blocked").length;
  const nextAction = items.find((entry) => entry.status === "ready" || entry.status === "policy_review") || items[0] || null;

  return {
    schemaVersion: 1,
    blockerCount: blockers.length,
    readyCount,
    policyReviewCount,
    blockedCount,
    overallStatus: readyCount > 0 ? "ready" : policyReviewCount > 0 ? "awaiting_policy_review" : "blocked",
    nextAction,
    items,
    runnerCommand: DEFAULT_ADMISSION_REMEDIATION_RUNNER_COMMAND,
    followUpCommand: refreshStatusCommand(),
  };
}

export function summarizeAdmissionRemediationPlan(plan = null) {
  if (!plan) return null;
  return {
    overallStatus: plan.overallStatus || null,
    blockerCount: plan.blockerCount ?? 0,
    readyCount: plan.readyCount ?? 0,
    policyReviewCount: plan.policyReviewCount ?? 0,
    blockedCount: plan.blockedCount ?? 0,
    nextAction: plan.nextAction
      ? {
          rank: plan.nextAction.rank ?? null,
          code: plan.nextAction.code || null,
          label: plan.nextAction.label || null,
          status: plan.nextAction.status || null,
          reason: plan.nextAction.reason || null,
          command: plan.nextAction.command || null,
        }
      : null,
    runnerCommand: plan.runnerCommand || null,
    items: (plan.items || []).slice(0, 5).map((entry) => ({
      rank: entry.rank ?? null,
      code: entry.code || null,
      label: entry.label || null,
      status: entry.status || null,
      reason: entry.reason || null,
      command: entry.command || null,
      resolves: entry.resolves || [],
    })),
    followUpCommand: plan.followUpCommand || null,
  };
}

function summarizeExecution(command, result, entry) {
  return {
    rank: entry.rank ?? null,
    code: entry.code || null,
    label: entry.label || null,
    status: entry.status || null,
    reason: entry.reason || null,
    command,
    resolves: entry.resolves || [],
    scripts: result.steps.map((step) => step.script),
    executionStatus: result.executionStatus,
    steps: result.steps,
  };
}

function latestPlanFromRecord(record) {
  return record?.finalPlan || record?.planSnapshot || null;
}

function statusForRecord(record) {
  return record?.finalStatus || record?.executionStatus || record?.mode || null;
}

export async function executeAdmissionRemediationPlan({
  plan,
  execute = false,
  limit = 1,
  stopOnFailure = true,
  cwd = process.cwd(),
  env = process.env,
  runCommand = defaultRunCommand,
  allowedScripts = DEFAULT_ADMISSION_REMEDIATION_ALLOWED_SCRIPTS,
  followUpCommands = DEFAULT_ADMISSION_REMEDIATION_FOLLOW_UP_COMMANDS,
  now = new Date().toISOString(),
} = {}) {
  const runId = `${new Date(now).toISOString()}-${Math.random().toString(16).slice(2, 10)}`;
  const selectedItems = (plan?.items || [])
    .filter((entry) => entry.status === "ready" && entry.command)
    .slice(0, Math.max(1, Number(limit) || 1));
  const policyReviewItems = (plan?.items || []).filter((entry) => entry.status === "policy_review" && entry.command);
  const record = {
    schemaVersion: 1,
    observedAt: now,
    runId,
    mode: execute ? "execute" : "preview",
    stopOnFailure,
    selectedCount: selectedItems.length,
    selectedItems: selectedItems.map((entry) => ({
      rank: entry.rank ?? null,
      code: entry.code || null,
      label: entry.label || null,
      status: entry.status || null,
      reason: entry.reason || null,
      command: entry.command || null,
    })),
    planSnapshot: plan || null,
    actionResults: [],
    followUps: [],
    executionStatus: execute ? "succeeded" : "preview",
    stopReason: null,
    finalStatus: execute ? plan?.overallStatus || "unknown" : "preview",
  };

  if (!execute) return record;

  if (!selectedItems.length) {
    record.executionStatus = policyReviewItems.length > 0 ? "awaiting_policy_review" : plan?.overallStatus || "blocked";
    record.finalStatus = record.executionStatus;
    record.stopReason = policyReviewItems.length > 0 ? policyReviewItems[0]?.reason || "policy_review_action_required" : plan?.nextAction?.reason || null;
    return record;
  }

  for (const entry of selectedItems) {
    const steps = parseWhitelistedRefreshCommand(entry.command, { allowedScripts });
    const result = await runParsedRefreshSteps(steps, { cwd, env, runCommand });
    record.actionResults.push(summarizeExecution(entry.command, result, entry));
    if (stopOnFailure && result.executionStatus !== "succeeded") {
      record.executionStatus = "failed";
      record.finalStatus = "failed";
      record.stopReason = `${entry.code || "remediation"}_failed`;
      return record;
    }
  }

  for (const command of followUpCommands) {
    const steps = parseWhitelistedRefreshCommand(command, { allowedScripts });
    const result = await runParsedRefreshSteps(steps, { cwd, env, runCommand });
    record.followUps.push({
      command,
      scripts: result.steps.map((step) => step.script),
      executionStatus: result.executionStatus,
      steps: result.steps,
    });
    if (stopOnFailure && result.executionStatus !== "succeeded") {
      record.executionStatus = "failed";
      record.finalStatus = "failed";
      record.stopReason = "remediation_follow_up_failed";
      return record;
    }
  }

  record.executionStatus = "succeeded";
  return record;
}

export function buildAdmissionRemediationExecutionSummary(records = [], now = new Date().toISOString()) {
  const sorted = [...records].sort((left, right) => new Date(right.observedAt) - new Date(left.observedAt));
  const latest = sorted[0] || null;
  const executeRecords = sorted.filter((item) => item.mode === "execute");
  const previewCount = sorted.filter((item) => item.mode === "preview").length;
  const successCount = executeRecords.filter((item) => statusForRecord(item) === "succeeded").length;
  const awaitingPolicyReviewCount = executeRecords.filter((item) => statusForRecord(item) === "awaiting_policy_review").length;
  const blockedCount = executeRecords.filter((item) => statusForRecord(item) === "blocked").length;
  const failureCount = executeRecords.filter((item) => statusForRecord(item) === "failed").length;
  return {
    schemaVersion: 1,
    generatedAt: now,
    runCount: executeRecords.length,
    previewCount,
    successCount,
    awaitingPolicyReviewCount,
    blockedCount,
    failureCount,
    latestObservedAt: latest?.observedAt || null,
    latestStatus: statusForRecord(latest),
    latestMode: latest?.mode || null,
    latestStopReason: latest?.stopReason || null,
    nextAction: latestPlanFromRecord(latest)?.nextAction || null,
    recentRuns: sorted.slice(0, 5).map((item) => ({
      observedAt: item.observedAt,
      runId: item.runId,
      mode: item.mode,
      finalStatus: statusForRecord(item),
      stopReason: item.stopReason,
      selectedCount: item.selectedCount ?? 0,
      actionResultCount: item.actionResults?.length || 0,
      followUpCount: item.followUps?.length || 0,
      nextActionCode: latestPlanFromRecord(item)?.nextAction?.code || null,
    })),
  };
}
