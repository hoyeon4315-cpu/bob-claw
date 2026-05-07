import { defaultDexQuoteProvider, noSupportedRouterReason } from "../dex/odos.mjs";

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function parseRouteChains(routeKey = null) {
  const [src = "", dst = ""] = String(routeKey || "").split("->");
  return {
    srcChain: src.split(":")[0] || null,
    dstChain: dst.split(":")[0] || null,
  };
}

function parseRouteSource(routeKey = null) {
  const [src = ""] = String(routeKey || "").split("->");
  const [chain = "", token = ""] = src.split(":");
  return {
    chain: chain || null,
    token: token || null,
  };
}

function isZeroAddress(value = null) {
  return /^0x0{40}$/iu.test(String(value || ""));
}

function observedAtMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function ageMinutes(observedAt = null, now = null) {
  const observed = observedAtMs(observedAt);
  const current = observedAtMs(now || new Date().toISOString());
  if (observed === null || current === null) return null;
  return (current - observed) / 60_000;
}

function latestWholeWalletInventory(records = []) {
  let latest = null;
  let latestMs = null;
  for (const record of records || []) {
    const recordMs = observedAtMs(record?.observedAt);
    if (recordMs === null) continue;
    if (latestMs === null || recordMs > latestMs) {
      latest = record;
      latestMs = recordMs;
    }
  }
  return latest;
}

function parseUnits(value = null) {
  try {
    if (value === null || value === undefined || value === "") return null;
    return BigInt(String(value));
  } catch {
    return null;
  }
}

function sourceBalanceFromInventory(inventory = null, route = null) {
  if (!inventory || !route?.routeKey) return null;
  const source = parseRouteSource(route.routeKey);
  if (!source.chain || !source.token) return null;
  const sourceIsNative = isZeroAddress(source.token);
  const rows = sourceIsNative ? inventory.native || [] : inventory.tokenBalances || [];
  const match = rows.find(
    (item) =>
      String(item?.chain || "").toLowerCase() === source.chain.toLowerCase() &&
      String(item?.token || "").toLowerCase() === source.token.toLowerCase(),
  );
  if (!match) {
    const matchingScanError = (inventory.scanErrors || []).find(
      (item) =>
        String(item?.chain || "").toLowerCase() === source.chain.toLowerCase() &&
        (sourceIsNative || String(item?.token || "").toLowerCase() === source.token.toLowerCase()),
    );
    if (matchingScanError) return null;
    return {
      chain: source.chain,
      token: source.token,
      balance: 0n,
      observedAt: inventory.observedAt || null,
      ticker: null,
    };
  }
  const balance = parseUnits(match.balance);
  if (balance === null) return null;
  return {
    chain: source.chain,
    token: source.token,
    balance,
    observedAt: inventory.observedAt || null,
    ticker: match.ticker || null,
  };
}

function sourceInventoryProblem({ route = null, wholeWalletRecords = [], now = null } = {}) {
  const required = parseUnits(route?.amount);
  if (required === null) return null;
  const inventory = latestWholeWalletInventory(wholeWalletRecords);
  const sourceBalance = sourceBalanceFromInventory(inventory, route);
  if (!sourceBalance || sourceBalance.balance >= required) return null;
  return {
    field: "sourceInventory",
    key: "source_inventory",
    label: "source inventory",
    state: "blocked",
    observedAt: sourceBalance.observedAt,
    ageMinutes: ageMinutes(sourceBalance.observedAt, now),
    failureReason: `insufficient_source_inventory:${sourceBalance.balance.toString()}<${required.toString()}`,
    actualBalance: sourceBalance.balance.toString(),
    requiredAmount: required.toString(),
    chain: sourceBalance.chain,
    token: sourceBalance.token,
    ticker: sourceBalance.ticker,
  };
}

function routeContext({ dashboardStatus = null, reviewPackage = null, canaryInputs = null, nextStep = null } = {}) {
  const route = nextStep?.route || null;
  const candidate = reviewPackage?.policyReviewCandidate || null;
  const topRoute = dashboardStatus?.shadowCycle?.topRoute || null;
  const inferredRouteKey = route?.routeKey || candidate?.routeKey || topRoute?.routeKey || canaryInputs?.routeKey || null;
  const inferredChains = parseRouteChains(inferredRouteKey);
  return {
    routeKey: inferredRouteKey,
    routeLabel: route?.label || candidate?.routeLabel || topRoute?.label || canaryInputs?.routeLabel || null,
    amount: route?.amount || candidate?.amount || topRoute?.amount || canaryInputs?.amount || null,
    srcChain: route?.srcChain || candidate?.srcChain || topRoute?.srcChain || inferredChains.srcChain,
    dstChain: route?.dstChain || candidate?.dstChain || topRoute?.dstChain || inferredChains.dstChain,
    tradeReadiness:
      route?.tradeReadiness ||
      candidate?.tradeReadiness ||
      topRoute?.tradeReadiness ||
      canaryInputs?.scoreTradeReadiness ||
      null,
  };
}

const INPUT_FIELDS = [
  { field: "gatewayQuote", key: "gateway_quote", label: "gateway quote" },
  { field: "exactGas", key: "exact_gas", label: "exact gas" },
  { field: "srcGas", key: "src_gas", label: "source gas" },
  { field: "dexQuote", key: "dex_quote", label: "DEX quote" },
  { field: "bitcoinFee", key: "bitcoin_fee", label: "bitcoin fee" },
  { field: "marketSnapshot", key: "market", label: "market snapshot" },
];

function structuralDexFailureReason(route = null) {
  const chains = [route?.srcChain, route?.dstChain].filter(Boolean);
  for (const chain of chains) {
    if (!defaultDexQuoteProvider(chain)) {
      return noSupportedRouterReason(chain);
    }
  }
  return null;
}

function normalizeProblem(entry, canaryInputs = null, route = null) {
  const state = canaryInputs?.[entry.field]?.state || "unknown";
  const failureReason = canaryInputs?.[entry.field]?.failureReason || null;
  if (entry.key === "dex_quote" && (state === "stale" || state === "missing")) {
    const structuralReason = structuralDexFailureReason(route);
    if (structuralReason) {
      return {
        ...entry,
        state: "blocked",
        observedAt: canaryInputs?.[entry.field]?.observedAt || null,
        ageMinutes: Number.isFinite(canaryInputs?.[entry.field]?.ageMinutes) ? canaryInputs[entry.field].ageMinutes : null,
        failureReason: structuralReason,
      };
    }
  }
  return {
    ...entry,
    state,
    observedAt: canaryInputs?.[entry.field]?.observedAt || null,
    ageMinutes: Number.isFinite(canaryInputs?.[entry.field]?.ageMinutes) ? canaryInputs[entry.field].ageMinutes : null,
    failureReason,
  };
}

function inputProblems(canaryInputs = null, route = null) {
  if (!canaryInputs) return [];
  return INPUT_FIELDS
    .map((entry) => normalizeProblem(entry, canaryInputs, route))
    .filter((entry) => entry.state === "stale" || entry.state === "missing" || entry.state === "blocked");
}

function verifyGatewayCommand(route = null) {
  if (!route?.routeKey || !route?.amount) return null;
  return `npm run verify:gateway -- --route-key="${route.routeKey}" --amounts="${route.amount}"`;
}

function exactGasCommand(route = null, address = null) {
  if (!route?.routeKey || !route?.amount) return null;
  return address
    ? `npm run estimate:gateway-gas -- --from="${address}" --route-key="${route.routeKey}" --amount="${route.amount}"`
    : `npm run estimate:gateway-gas -- --route-key="${route.routeKey}" --amount="${route.amount}"`;
}

function dexQuoteCommand(route = null) {
  if (!route?.routeKey || !route?.amount) return null;
  return `npm run quote:dex -- --route-key="${route.routeKey}" --amount="${route.amount}" --include-stable-entry`;
}

function scoreRouteCommand(route = null) {
  if (!route?.routeKey || !route?.amount) return null;
  return `npm run score:gateway -- --write --route-key="${route.routeKey}" --amount="${route.amount}"`;
}

function commandForProblem(problem = null, { route = null, address = null } = {}) {
  if (!problem) return null;
  if (problem.key === "gateway_quote") return verifyGatewayCommand(route);
  if (problem.key === "exact_gas") return exactGasCommand(route, address);
  if (problem.key === "src_gas") return "npm run gas:snapshot";
  if (problem.key === "dex_quote") return dexQuoteCommand(route);
  if (problem.key === "bitcoin_fee") return "npm run bitcoin:fees";
  if (problem.key === "market") return "npm run price:snapshot";
  return null;
}

function buildRefreshStep(problem = null, { route = null, address = null, index = 0 } = {}) {
  if (!problem) return null;
  return {
    id: `refresh_${problem.key}`,
    sequence: index + 1,
    type: "network_refresh",
    key: problem.key,
    label: `refresh ${problem.label}`,
    reason: `${problem.state}_${problem.key}`,
    state: problem.state,
    observedAt: problem.observedAt,
    ageMinutes: problem.ageMinutes,
    command: commandForProblem(problem, { route, address }),
  };
}

function buildBlockedInput(problem = null, { index = 0 } = {}) {
  if (!problem) return null;
  return {
    id: `hold_${problem.key}`,
    sequence: index + 1,
    type: "blocked_input",
    key: problem.key,
    label: `hold on blocked ${problem.label}`,
    reason: problem.failureReason ? `blocked_${problem.key}:${problem.failureReason}` : `blocked_${problem.key}`,
    state: problem.state,
    observedAt: problem.observedAt,
    ageMinutes: problem.ageMinutes,
    command: null,
  };
}

function buildReevaluationSteps(route = null) {
  const steps = [];
  if (route?.routeKey && route?.amount) {
    steps.push({
      id: "rescore_route",
      sequence: steps.length + 1,
      type: "reevaluate",
      label: "rescore refreshed route",
      command: scoreRouteCommand(route),
    });
  }
  steps.push({
    id: "advance_canary",
    sequence: steps.length + 1,
    type: "reevaluate",
    label: "advance canary review",
    command: "npm run advance:canary",
  });
  steps.push({
    id: "rebuild_review_package",
    sequence: steps.length + 1,
    type: "reevaluate",
    label: "rebuild review and handoff artifacts",
    command: "npm run build:prelive-review-package -- --write && npm run validate:prelive-readiness -- --write && npm run write:session-handoff",
  });
  return steps;
}

function joinCommands(steps = []) {
  const commands = (steps || []).map((step) => step?.command).filter(Boolean);
  return commands.length ? commands.join(" && ") : null;
}

export function buildConnectedRefreshPackage({
  dashboardStatus = null,
  canaryInputs = null,
  reviewPackage = null,
  nextStep = null,
  address = null,
  wholeWalletRecords = [],
  now = null,
} = {}) {
  const generatedAt = now || dashboardStatus?.generatedAt || new Date().toISOString();
  const route = routeContext({ dashboardStatus, reviewPackage, canaryInputs, nextStep });
  const inventoryProblem = sourceInventoryProblem({ route, wholeWalletRecords, now: generatedAt });
  const canaryProblems = inputProblems(canaryInputs, route);
  const problems = inventoryProblem
    ? [inventoryProblem, ...canaryProblems.filter((problem) => problem.state === "blocked")]
    : canaryProblems;
  const refreshableProblems = problems.filter((problem) => problem.state === "stale" || problem.state === "missing");
  const blockedProblems = problems.filter((problem) => problem.state === "blocked");
  const refreshSteps = refreshableProblems.map((problem, index) => buildRefreshStep(problem, { route, address, index })).filter(Boolean);
  const blockedInputs = blockedProblems.map((problem, index) => buildBlockedInput(problem, { index })).filter(Boolean);
  const reevaluationSteps = buildReevaluationSteps(route);
  const nextAction = refreshSteps[0]
    ? {
        code: refreshSteps[0].id,
        label: refreshSteps[0].label,
        command: refreshSteps[0].command,
      }
    : blockedInputs[0]
      ? {
          code: blockedInputs[0].id,
          label: blockedInputs[0].label,
          command: null,
        }
    : reevaluationSteps[0]
      ? {
          code: reevaluationSteps[0].id,
          label: reevaluationSteps[0].label,
          command: reevaluationSteps[0].command,
        }
      : null;
  const status =
    refreshSteps.length > 0
      ? "network_refresh_required"
      : blockedInputs.length > 0
        ? "blocked_nonrefreshable_input"
        : route?.routeKey && route?.amount
          ? "reevaluation_ready"
          : "awaiting_route_context";

  return {
    schemaVersion: 1,
    generatedAt,
    status,
    networkRequired: refreshSteps.length > 0,
    runner: {
      preview: "npm run run:connected-refresh-package",
      execute: "npm run run:connected-refresh-package -- --execute",
    },
    currentRoute: route,
    staleInputs: refreshableProblems,
    blockingInputs: problems,
    blockedInputs,
    requiredRefreshes: refreshSteps,
    reevaluationSteps,
    summary: {
      requiredRefreshCount: refreshSteps.length,
      blockedInputCount: blockedInputs.length,
      staleInputCount: refreshableProblems.filter((problem) => problem.state === "stale").length,
      missingInputCount: refreshableProblems.filter((problem) => problem.state === "missing").length,
      reevaluationStepCount: reevaluationSteps.length,
      nextActionCode: nextAction?.code || null,
      nextActionCommand: nextAction?.command || null,
      refreshCommandChain: joinCommands(refreshSteps),
      fullCommandChain: joinCommands([...refreshSteps, ...reevaluationSteps]),
      runnerPreviewCommand: "npm run run:connected-refresh-package",
      runnerExecuteCommand: "npm run run:connected-refresh-package -- --execute",
    },
    nextAction,
    notes: [
      "This package stages the network-connected refresh order only; it does not claim that the route becomes profitable after refresh.",
      "Run the refresh commands in a network-enabled environment, then rebuild the review and handoff artifacts from the refreshed inputs.",
      "Keep liveTrading BLOCKED while this package is executed; refresh is evidence collection, not execution approval.",
      blockedInputs.length > 0
        ? "If a required input is blocked rather than stale, stop retrying it as if a simple refresh will fix the route."
        : null,
    ],
  };
}

export function summarizeConnectedRefreshPackage(refreshPackage = null) {
  if (!refreshPackage) return null;
  return {
    generatedAt: refreshPackage.generatedAt || null,
    status: refreshPackage.status || null,
    routeLabel: refreshPackage.currentRoute?.routeLabel || null,
    routeKey: refreshPackage.currentRoute?.routeKey || null,
    amount: refreshPackage.currentRoute?.amount || null,
    requiredRefreshCount: refreshPackage.summary?.requiredRefreshCount ?? refreshPackage.requiredRefreshes?.length ?? 0,
    blockedInputCount: refreshPackage.summary?.blockedInputCount ?? refreshPackage.blockedInputs?.length ?? 0,
    staleInputCount: refreshPackage.summary?.staleInputCount ?? 0,
    missingInputCount: refreshPackage.summary?.missingInputCount ?? 0,
    nextActionCode: refreshPackage.summary?.nextActionCode || refreshPackage.nextAction?.code || null,
    nextActionCommand: refreshPackage.summary?.nextActionCommand || refreshPackage.nextAction?.command || null,
    runnerPreviewCommand: refreshPackage.summary?.runnerPreviewCommand || refreshPackage.runner?.preview || null,
    runnerExecuteCommand: refreshPackage.summary?.runnerExecuteCommand || refreshPackage.runner?.execute || null,
    fullCommandChain: refreshPackage.summary?.fullCommandChain || null,
  };
}
