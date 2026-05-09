#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { STRATEGY_CAPS, listStrategyCaps } from "../config/strategy-caps.mjs";
import { resolveProfileCapMatrix } from "../config/sleeve-profile.mjs";
import { listFamilyBindings } from "../strategy/radar/family-binding-registry.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function finitePositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function rawCaps(config = null) {
  return config?.caps || {};
}

function resolvedCapValues(config = null) {
  if (!config) {
    return { perTxUsd: null, perDayUsd: null, perChainUsd: null, maxDailyLossUsd: null, tinyLivePerTxUsd: null };
  }
  const matrix = resolveProfileCapMatrix(config, { includeRadarCaps: true });
  return {
    perTxUsd: matrix?.perTxUsd ?? null,
    perDayUsd: matrix?.perDayUsd ?? null,
    perChainUsd: matrix?.perChainUsd || null,
    maxDailyLossUsd: config.caps?.maxDailyLossUsd ?? null,
    tinyLivePerTxUsd: matrix?.tinyLivePerTxUsd ?? null,
  };
}

function capValues(config = null) {
  const caps = rawCaps(config);
  return {
    perTxUsd: caps.perTxUsd ?? null,
    perDayUsd: caps.perDayUsd ?? null,
    perChainUsd: caps.perChainUsd || null,
    maxDailyLossUsd: caps.maxDailyLossUsd ?? null,
    tinyLivePerTxUsd: caps.tinyLivePerTxUsd ?? null,
  };
}

function perChainHasPositive(perChainUsd = null) {
  return perChainUsd && typeof perChainUsd === "object" && Object.values(perChainUsd).some(finitePositive);
}

function requiredCapsPositive(values = {}) {
  return finitePositive(values.perTxUsd) &&
    finitePositive(values.perDayUsd) &&
    finitePositive(values.maxDailyLossUsd) &&
    perChainHasPositive(values.perChainUsd);
}

function rootCauseFor({ rawConfig, resolvedConfig, surfacedCapless, radarEligible }) {
  if (!rawConfig) return "cap_module_missing";
  const raw = capValues(rawConfig);
  const resolved = resolvedCapValues(resolvedConfig || rawConfig);
  const rawOk = requiredCapsPositive(raw);
  const resolvedOk = requiredCapsPositive(resolved);
  if (!rawOk) {
    if (rawConfig.autoExecute === false || raw.deprecated === true) return "intentional_zero_for_deprecation";
    return "cap_value_zero_or_falsy";
  }
  if (!resolvedOk) return "scale_band_clamp_to_zero";
  if (radarEligible && !finitePositive(resolved.tinyLivePerTxUsd)) return "tiny_live_per_tx_undeclared";
  if (surfacedCapless) return "registry_lookup_mismatch";
  return "registry_lookup_mismatch";
}

function recommendedAction(rootCause) {
  if (rootCause === "registry_lookup_mismatch" || rootCause === "scale_band_clamp_to_zero") return "fix_policy_lookup_path";
  if (rootCause === "tiny_live_per_tx_undeclared") return "declare_tiny_live_per_tx_usd";
  if (rootCause === "intentional_zero_for_deprecation") return "deprecate_strategy";
  if (rootCause === "cap_module_missing") return "declare_cap_in_committed_diff";
  return "declare_cap_in_committed_diff";
}

function suggestedValuesFor(rawConfig = null, resolved = {}) {
  if (!rawConfig) {
    return {
      perTxUsd: 5,
      perDayUsd: 25,
      perChainUsd: { base: 25 },
      maxDailyLossUsd: 25,
    };
  }
  return {
    perTxUsd: resolved.perTxUsd,
    perDayUsd: resolved.perDayUsd,
    perChainUsd: resolved.perChainUsd,
    maxDailyLossUsd: resolved.maxDailyLossUsd,
    tinyLivePerTxUsd: resolved.tinyLivePerTxUsd,
  };
}

function rationaleFor(rootCause) {
  if (rootCause === "registry_lookup_mismatch") {
    return "Committed caps resolve to positive values, so the capless hard-stop is a reporting or policy lookup mismatch rather than a missing cap declaration.";
  }
  if (rootCause === "tiny_live_per_tx_undeclared") {
    return "Base strategy caps exist, but radar tiny canary execution requires an explicit tinyLivePerTxUsd cap.";
  }
  if (rootCause === "scale_band_clamp_to_zero") {
    return "Raw caps are positive but the resolved policy cap matrix clamps at least one required cap to zero or null.";
  }
  if (rootCause === "cap_module_missing") return "No committed strategy-cap module entry was found for this strategy id.";
  if (rootCause === "intentional_zero_for_deprecation") return "The strategy appears intentionally disabled with zero/falsy caps and should be deprecated if no evidence remains.";
  return "One or more committed cap values are zero, null, missing, or otherwise falsy.";
}

function strategyIdsFromInputs({ auditRows = [], blockerFunnel = null, currentBlockerRows = [] } = {}) {
  const ids = new Set();
  for (const row of auditRows || []) {
    if (row?.strategyId) ids.add(row.strategyId);
  }
  for (const row of currentBlockerRows || []) {
    if (row?.code === "hard_safety_stop:capless_strategy" && row.strategyId) ids.add(row.strategyId);
  }
  for (const row of blockerFunnel?.strategies || []) {
    if (row?.code === "hard_safety_stop:capless_strategy" && row.strategyId) ids.add(row.strategyId);
  }
  for (const group of blockerFunnel?.rootCauseGroups || []) {
    if (group?.code !== "hard_safety_stop:capless_strategy") continue;
    if (group.params?.strategyId) ids.add(group.params.strategyId);
    for (const strategyId of group.affectedStrategies || []) ids.add(strategyId);
  }
  return [...ids].sort();
}

export function buildCaplessStrategyDiagnosis({
  auditRows = [],
  blockerFunnel = null,
  currentBlockerRows = [],
  rawCapsById = STRATEGY_CAPS,
  resolvedCapsById = Object.fromEntries(listStrategyCaps().map((item) => [item.strategyId, item])),
  radarEligibleStrategyIds = new Set(
    listFamilyBindings().map((item) => item.binding?.strategyId).filter(Boolean),
  ),
  now = new Date().toISOString(),
} = {}) {
  const ids = strategyIdsFromInputs({ auditRows, blockerFunnel, currentBlockerRows });
  const surfaced = new Set(ids);
  const rows = ids.map((strategyId) => {
    const rawConfig = rawCapsById[strategyId] || null;
    const resolvedConfig = resolvedCapsById[strategyId] || rawConfig;
    const rawValues = capValues(rawConfig);
    const resolvedValues = resolvedCapValues(resolvedConfig);
    const rootCause = rootCauseFor({
      rawConfig,
      resolvedConfig,
      surfacedCapless: surfaced.has(strategyId),
      radarEligible: radarEligibleStrategyIds.has(strategyId),
    });
    return {
      strategyId,
      rawCapValues: rawValues,
      resolvedCapValues: resolvedValues,
      registryPath: rawConfig ? "src/config/strategy-caps/registry.mjs" : null,
      lookupPath: "src/config/strategy-caps.mjs",
      rootCause,
      recommendedAction: recommendedAction(rootCause),
      suggestedValues: suggestedValuesFor(rawConfig, resolvedValues),
      rationale: rationaleFor(rootCause),
    };
  });
  const byAction = rows.reduce((accumulator, row) => {
    accumulator[row.recommendedAction] = (accumulator[row.recommendedAction] || 0) + 1;
    return accumulator;
  }, {});
  const byRootCause = rows.reduce((accumulator, row) => {
    accumulator[row.rootCause] = (accumulator[row.rootCause] || 0) + 1;
    return accumulator;
  }, {});
  return {
    schemaVersion: 1,
    generatedAt: now,
    rows,
    summary: {
      diagnosedCount: rows.length,
      byRootCause,
      byRecommendedAction: byAction,
    },
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function runCli(argv = process.argv.slice(2), { cwd = process.cwd(), now = new Date().toISOString() } = {}) {
  const json = hasFlag(argv, "--json");
  const dataDir = resolve(cwd, config.dataDir);
  const [audit, blockerFunnel] = await Promise.all([
    readJsonIfExists(join(dataDir, "capless-strategy-audit.json")),
    readJsonIfExists(join(cwd, "dashboard", "public", "blocker-funnel.json")),
  ]);
  const report = buildCaplessStrategyDiagnosis({
    auditRows: audit?.rows || [],
    blockerFunnel,
    now,
  });
  await writeTextIfChanged(join(dataDir, "capless-strategy-diagnosis.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (json) return { exitCode: 0, stdout: `${JSON.stringify(report, null, 2)}\n` };
  return {
    exitCode: 0,
    stdout: [
      `diagnosed=${report.summary.diagnosedCount}`,
      `rootCauses=${Object.entries(report.summary.byRootCause).map(([key, value]) => `${key}:${value}`).join(",") || "none"}`,
      `recommended=${Object.entries(report.summary.byRecommendedAction).map(([key, value]) => `${key}:${value}`).join(",") || "none"}`,
    ].join("\n") + "\n",
  };
}

export { runCli };

if (IS_MAIN) {
  runCli().then((result) => {
    process.stdout.write(result.stdout);
    process.exit(result.exitCode);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
