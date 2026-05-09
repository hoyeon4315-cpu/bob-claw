#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import {
  OFFICIAL_GATEWAY_DESTINATION_CHAINS,
  canonicalGatewayChain,
  isOfficialGatewayDestinationChain,
} from "../config/gateway-destinations.mjs";
import { buildProtocolCanaryBindingPlan } from "../defi/protocol-canary-bindings.mjs";
import {
  isSupportedBindingKind,
  supportedBindingKinds,
} from "../executor/protocol-binding-registry.mjs";
import { simulateTransactionCall } from "../evm/transaction-read.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

const DEFAULT_REPORT_PATH = "merkl-opportunities-report.json";
const DEFAULT_AUDIT_PATH = "protocol-bindings-audit.json";
const ONE_ETHER_HEX = "0000000000000000000000000000000000000000000000000de0b6b3a7640000";
const ERC4626_VIEW_CALLS = Object.freeze([
  { name: "name", data: "0x06fdde03" },
  { name: "symbol", data: "0x95d89b41" },
  { name: "decimals", data: "0x313ce567" },
  { name: "asset", data: "0x38d52e0f" },
  { name: "convertToAssets", data: `0x07a2d13a${ONE_ETHER_HEX}` },
]);

function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--") && !arg.includes("=")));
  const values = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const index = arg.indexOf("=");
        return [arg.slice(2, index), arg.slice(index + 1)];
      }),
  );
  return {
    json: flags.has("--json"),
    write: !flags.has("--no-write"),
    probeRpc: flags.has("--probe-rpc"),
    input: values.input || join(config.dataDir, DEFAULT_REPORT_PATH),
    out: values.out || join(config.dataDir, DEFAULT_AUDIT_PATH),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function normalizeAddress(address) {
  const text = String(address || "").trim();
  return /^0x[a-fA-F0-9]{40}$/u.test(text) ? text : null;
}

function opportunitySet(report = {}) {
  const opportunities = Array.isArray(report.opportunities) ? report.opportunities : [];
  const rows = opportunities.length > 0 ? opportunities : (Array.isArray(report.topCandidates) ? report.topCandidates : []);
  return rows
    .filter((item) => item?.decision === "candidate" || item?.queueId || item?.mappedStrategyId)
    .filter((item) => isOfficialGatewayDestinationChain(item?.chain || item?.chainName));
}

function planForOpportunity(opportunity = {}) {
  if (opportunity.protocolBindingPlan && typeof opportunity.protocolBindingPlan === "object") {
    return opportunity.protocolBindingPlan;
  }
  return buildProtocolCanaryBindingPlan({
    opportunity,
    binding: opportunity.protocolBinding || null,
  });
}

function bindingKey(row = {}) {
  return [
    row.protocolId || "unknown",
    canonicalGatewayChain(row.chain) || "unknown",
    row.bindingKind || "none",
    row.underlyingAsset?.address || row.underlyingAsset?.symbol || "unknown",
  ].join(":").toLowerCase();
}

function looksErc4626FromPlan(plan = {}) {
  const kind = String(plan.bindingKind || "").toLowerCase();
  const binding = plan.resolvedBinding || {};
  const actions = new Set(plan.canaryActions || []);
  if (kind.includes("erc4626") || kind.includes("evault") || kind.includes("vault_supply_withdraw")) return true;
  return Boolean(
    binding.vaultAddress &&
    binding.assetAddress &&
    actions.has("deposit_asset_for_shares") &&
    actions.has("withdraw_or_redeem_shares"),
  );
}

async function probeErc4626Compatibility({ chain, vaultAddress, call = simulateTransactionCall } = {}) {
  if (!chain || !vaultAddress) {
    return { status: "not_checked", ok: false, reason: "missing_chain_or_vault" };
  }
  const checks = [];
  for (const item of ERC4626_VIEW_CALLS) {
    try {
      const result = await call(chain, { to: vaultAddress, data: item.data });
      const ok = typeof result.returnData === "string" && result.returnData !== "0x";
      checks.push({ name: item.name, ok, returnBytes: ok ? Math.max(0, (result.returnData.length - 2) / 2) : 0 });
    } catch (error) {
      checks.push({ name: item.name, ok: false, error: error.message });
    }
  }
  const ok = checks.every((item) => item.ok);
  return {
    status: ok ? "verified" : "failed",
    ok,
    checks,
    requiredWritableSelectors: ["deposit(uint256,address)", "withdraw(uint256,address,address)"],
    writableSelectorVerification: "assumed_from_verified_erc4626_view_surface",
  };
}

function proofFromPlan(plan = {}, { probe = null } = {}) {
  if (probe) return probe;
  if (plan.erc4626Proof?.status === "verified") return plan.erc4626Proof;
  if (looksErc4626FromPlan(plan)) {
    return {
      status: "static_candidate",
      ok: false,
      reason: "erc4626-like binding plan present but RPC view-method proof was not run",
    };
  }
  return { status: "not_erc4626", ok: false, reason: "binding plan is not ERC4626-like" };
}

function classifyBinding(row = {}) {
  const existingKind = row.bindingKind ? isSupportedBindingKind(row.bindingKind) : false;
  const isErc4626Compatible = row.erc4626Proof?.status === "verified" || (existingKind && row.staticErc4626Like);
  if (!row.bindingKind) {
    return {
      ...row,
      isErc4626Compatible: false,
      autoAddable: false,
      classification: "manual_operator_review_required",
      rationale: "protocol has no bindingKind; custom helper or protocol template required",
    };
  }
  if (!row.staticErc4626Like) {
    return {
      ...row,
      isErc4626Compatible: false,
      autoAddable: false,
      classification: "manual_operator_review_required",
      rationale: "binding kind is not ERC4626-compatible; custom helper required",
    };
  }
  if (row.missingBindingFields?.length > 0) {
    return {
      ...row,
      isErc4626Compatible,
      autoAddable: false,
      classification: "binding_fields_required",
      rationale: `missing binding fields: ${row.missingBindingFields.join(", ")}`,
    };
  }
  if (existingKind) {
    return {
      ...row,
      isErc4626Compatible: true,
      autoAddable: false,
      classification: "binding_kind_already_supported",
      rationale: "bindingKind is already registered in committed executor registry",
    };
  }
  if (row.erc4626Proof?.status !== "verified") {
    return {
      ...row,
      isErc4626Compatible: false,
      autoAddable: false,
      classification: "manual_operator_review_required",
      rationale: "ERC4626 compatibility is not RPC-verified; leaving unbound",
    };
  }
  return {
    ...row,
    isErc4626Compatible: true,
    autoAddable: true,
    classification: "auto_addable_erc4626_binding",
    rationale: "ERC4626 view surface verified and bindingKind is not yet registered",
  };
}

export async function collectRequiredProtocolBindings(report = {}, { probeRpc = false, call = simulateTransactionCall } = {}) {
  const rowsByKey = new Map();
  for (const opportunity of opportunitySet(report)) {
    const chain = canonicalGatewayChain(opportunity.chain || opportunity.chainName);
    const plan = planForOpportunity(opportunity);
    const binding = plan.resolvedBinding || {};
    const vaultAddress = normalizeAddress(binding.vaultAddress || binding.shareTokenAddress);
    const staticErc4626Like = looksErc4626FromPlan(plan);
    const probe = probeRpc && staticErc4626Like
      ? await probeErc4626Compatibility({ chain, vaultAddress, call })
      : null;
    const row = {
      protocolId: plan.protocolId || opportunity.protocolId || null,
      chain,
      bindingKind: plan.bindingKind || null,
      status: plan.status || null,
      isErc4626Compatible: false,
      staticErc4626Like,
      erc4626Proof: proofFromPlan(plan, { probe }),
      underlyingAsset: {
        symbol: binding.assetSymbol || null,
        address: binding.assetAddress || null,
        decimals: Number.isFinite(binding.assetDecimals) ? binding.assetDecimals : null,
      },
      vaultAddress: binding.vaultAddress || null,
      shareTokenAddress: binding.shareTokenAddress || null,
      sourceOpportunityIds: [String(opportunity.opportunityId || opportunity.id || "")].filter(Boolean),
      missingBindingFields: plan.missingBindingFields || [],
      autoAddable: false,
      rationale: null,
    };
    const classified = classifyBinding(row);
    const key = bindingKey(classified);
    const current = rowsByKey.get(key);
    if (!current) {
      rowsByKey.set(key, classified);
      continue;
    }
    current.sourceOpportunityIds = [...new Set([
      ...current.sourceOpportunityIds,
      ...classified.sourceOpportunityIds,
    ])].sort();
    if (classified.autoAddable) current.autoAddable = true;
  }
  return [...rowsByKey.values()].sort((a, b) => bindingKey(a).localeCompare(bindingKey(b)));
}

export async function buildRequiredProtocolBindingsAudit(report = {}, options = {}) {
  const required = await collectRequiredProtocolBindings(report, options);
  const manualOnly = required.filter((item) =>
    item.classification === "manual_operator_review_required" ||
    item.isErc4626Compatible !== true ||
    item.autoAddable !== true && item.classification !== "binding_kind_already_supported"
  );
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    source: {
      kind: "merkl_opportunity_set",
      officialGatewayDestinationChains: OFFICIAL_GATEWAY_DESTINATION_CHAINS,
      supportedBindingKinds: [...supportedBindingKinds()].sort(),
    },
    summary: {
      requiredCount: required.length,
      autoAddableCount: required.filter((item) => item.autoAddable).length,
      alreadySupportedCount: required.filter((item) => item.classification === "binding_kind_already_supported").length,
      manualOnlyCount: manualOnly.length,
    },
    required,
    manualOnly,
  };
}

export async function runAuditRequiredProtocolBindings(args = parseArgs()) {
  const report = await readJson(args.input);
  const audit = await buildRequiredProtocolBindingsAudit(report, {
    probeRpc: args.probeRpc,
  });
  if (args.write) {
    await writeTextIfChanged(args.out, `${JSON.stringify(audit, null, 2)}\n`);
  }
  return audit;
}

async function main() {
  const args = parseArgs();
  const audit = await runAuditRequiredProtocolBindings(args);
  if (args.json) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }
  console.log(`required=${audit.summary.requiredCount}`);
  console.log(`autoAddable=${audit.summary.autoAddableCount}`);
  console.log(`alreadySupported=${audit.summary.alreadySupportedCount}`);
  console.log(`manualOnly=${audit.summary.manualOnlyCount}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
