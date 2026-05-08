const ALTERNATIVE_ROUTE_PROVIDERS = Object.freeze([
  "LI.FI",
  "Across",
  "native_canonical",
  "Hop",
]);

function addMs(now, ms) {
  const base = new Date(now).getTime();
  return new Date((Number.isFinite(base) ? base : Date.now()) + ms).toISOString();
}

function normalizeString(value) {
  const normalized = String(value || "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBlocker(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("routing_exhausted") || raw.includes("no_route") || raw.includes("routing_unavailable")) {
    return "routing_exhausted";
  }
  if (raw.includes("insufficient_funds") || raw.includes("insufficient_fund")) {
    return "insufficient_funds";
  }
  if (raw.includes("budget") && (raw.includes("exhausted") || raw.includes("exceeded"))) {
    return "budget_exceeded";
  }
  return raw;
}

function sourceFor({ blocker, source } = {}) {
  const explicit = normalizeString(source);
  if (explicit) return explicit;
  if (blocker === "insufficient_funds") return "inventory";
  if (blocker === "budget_exceeded") return "budget";
  if (blocker === "routing_exhausted") return "ledger";
  return "diagnostic";
}

function routeFromDiagnostic(diagnostic = {}) {
  const route = diagnostic.route || diagnostic.gatewayRoute || diagnostic.routeContext || {};
  return {
    routeId: normalizeString(diagnostic.routeId || diagnostic.jobId || route.routeKey) || null,
    srcChain: normalizeString(route.srcChain || diagnostic.srcChain) || null,
    dstChain: normalizeString(route.dstChain || diagnostic.dstChain || diagnostic.chain) || null,
    srcAsset: normalizeString(route.srcAsset || route.srcToken || diagnostic.srcAsset || diagnostic.asset) || null,
    dstAsset: normalizeString(route.dstAsset || route.dstToken || diagnostic.dstAsset || diagnostic.asset) || null,
    targetAmountDecimal: diagnostic.targetAmountDecimal ?? route.targetAmountDecimal ?? null,
  };
}

function alternativeCandidatesForRoute(route = {}) {
  return ALTERNATIVE_ROUTE_PROVIDERS.map((provider) => ({
    provider,
    kind: "alternative_bridge_candidate",
    route: {
      srcChain: route.srcChain,
      dstChain: route.dstChain,
      srcAsset: route.srcAsset,
      dstAsset: route.dstAsset,
    },
    status: "candidate",
    blocker: null,
  }));
}

function routeProbeJobs({ route, alternatives } = {}) {
  return alternatives.map((candidate) => ({
    kind: "alternative_route_probe",
    provider: candidate.provider,
    route: candidate.route,
    source: "refill_prerequisite_resolver",
  }));
}

function idleInventoryJobs({ route, now } = {}) {
  return [
    {
      kind: "idle_inventory_consolidation",
      queue: "idle_inventory_dispatch",
      lifecycleStage: "idle_consolidation_planned",
      route,
      expectedReadyBy: addMs(now, 10 * 60 * 1000),
      source: "inventory",
    },
  ];
}

function budgetJobs({ route, now } = {}) {
  const expectedReadyBy = addMs(now, 24 * 60 * 60 * 1000);
  return [
    {
      kind: "split_refill",
      route,
      expectedReadyBy,
      source: "budget",
    },
    {
      kind: "wait_for_budget_reset",
      route,
      expectedReadyBy,
      source: "budget",
    },
  ];
}

function prerequisiteForDiagnostic({
  blocker,
  source,
  route,
  alternativeCandidates,
  now,
} = {}) {
  const expectedReadyBy = blocker === "budget_exceeded"
    ? addMs(now, 24 * 60 * 60 * 1000)
    : blocker === "insufficient_funds"
      ? addMs(now, 10 * 60 * 1000)
      : addMs(now, 60 * 60 * 1000);
  const jobs = blocker === "routing_exhausted"
    ? routeProbeJobs({ route, alternatives: alternativeCandidates })
    : blocker === "insufficient_funds"
      ? idleInventoryJobs({ route, now })
      : blocker === "budget_exceeded"
        ? budgetJobs({ route, now })
        : [];

  return {
    kind: "refill",
    status: "pending_prerequisite",
    blocker,
    source,
    route,
    expectedReadyBy,
    jobs,
  };
}

export function resolveRefillPrerequisiteDiagnostic(diagnostic = {}, { now = new Date().toISOString() } = {}) {
  const blocker = normalizeBlocker(
    diagnostic.blockedReason ||
      diagnostic.previewBlockedReason ||
      diagnostic.executionBlockedReason ||
      diagnostic.reason ||
      diagnostic.blocker,
  );
  if (!blocker) return null;
  const source = sourceFor({ blocker, source: diagnostic.source });
  const route = routeFromDiagnostic(diagnostic);
  const alternativeCandidates = blocker === "routing_exhausted"
    ? alternativeCandidatesForRoute(route)
    : [];
  const explicitBlocker = alternativeCandidates.length > 0 ? null : blocker;
  const prerequisite = prerequisiteForDiagnostic({
    blocker,
    source,
    route,
    alternativeCandidates,
    now,
  });

  return {
    routeId: route.routeId,
    blocker,
    explicitBlocker,
    source,
    route,
    alternativeCandidates,
    prerequisite,
    rawBlockedReason: diagnostic.blockedReason ||
      diagnostic.previewBlockedReason ||
      diagnostic.executionBlockedReason ||
      diagnostic.reason ||
      diagnostic.blocker ||
      null,
  };
}

function countBy(items = [], key) {
  return items.reduce((accumulator, item) => {
    const value = item?.[key] || "unknown";
    accumulator[value] = (accumulator[value] || 0) + 1;
    return accumulator;
  }, {});
}

export function resolveRefillPrerequisites({
  diagnostics = [],
  now = new Date().toISOString(),
} = {}) {
  const perRouteDiagnostic = diagnostics
    .map((diagnostic) => resolveRefillPrerequisiteDiagnostic(diagnostic, { now }))
    .filter(Boolean);
  const prerequisites = perRouteDiagnostic.map((item) => item.prerequisite);
  return {
    schemaVersion: 1,
    observedAt: now,
    status: prerequisites.length > 0 ? "pending_prerequisite" : "ready",
    prerequisites,
    perRouteDiagnostic,
    summary: {
      diagnosticCount: diagnostics.length,
      perRouteDiagnosticCount: perRouteDiagnostic.length,
      prerequisiteCount: prerequisites.length,
      byBlocker: countBy(perRouteDiagnostic, "blocker"),
      bySource: countBy(perRouteDiagnostic, "source"),
    },
  };
}

export function diagnosticsFromRefillExecutions(refillExecutions = []) {
  return (refillExecutions || [])
    .map((item) => {
      const blockedReason = item.previewBlockedReason || item.executionBlockedReason || item.blockedReason || null;
      if (!blockedReason) return null;
      const route = item.route || item.plan?.route || item.routeContext || {};
      return {
        routeId: item.jobId || item.routeKey || item.plan?.routeKey || null,
        blockedReason,
        source: item.previewBlockedReason || item.executionBlockedReason ? null : item.source,
        route: {
          srcChain: route.srcChain || item.srcChain || null,
          dstChain: route.dstChain || item.dstChain || item.chain || null,
          srcAsset: route.srcAsset || route.srcToken || null,
          dstAsset: route.dstAsset || route.dstToken || item.asset || null,
          targetAmountDecimal: item.targetAmountDecimal ?? item.plan?.targetAmountDecimal ?? null,
        },
        routeAttemptReasons: item.routeAttemptReasons || [],
      };
    })
    .filter(Boolean);
}

export function refillDiagnosticsFromCandidate(candidate = {}) {
  if (Array.isArray(candidate.refillDiagnostics)) return candidate.refillDiagnostics;
  if (Array.isArray(candidate.refillPrerequisites)) return candidate.refillPrerequisites;
  if (Array.isArray(candidate.refillBlockers)) {
    return candidate.refillBlockers.map((blocker) =>
      typeof blocker === "string"
        ? { blockedReason: blocker, route: candidate.refillRoute || null }
        : blocker
    );
  }
  const status = candidate.refillStatus || candidate.refill || null;
  if (status?.blockedReason || status?.previewBlockedReason || status?.executionBlockedReason) {
    return [
      {
        ...status,
        route: status.route || candidate.refillRoute || null,
      },
    ];
  }
  return [];
}

export function resolveCandidateRefillPrerequisites(candidate = {}, { now = new Date().toISOString() } = {}) {
  return resolveRefillPrerequisites({
    diagnostics: refillDiagnosticsFromCandidate(candidate),
    now,
  });
}
