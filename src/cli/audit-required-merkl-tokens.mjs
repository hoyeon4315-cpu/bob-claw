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
import { TOKEN_REGISTRY, findToken } from "../config/token-registry.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";

const DEFAULT_REPORT_PATH = "merkl-opportunities-report.json";
const DEFAULT_AUDIT_PATH = "merkl-required-tokens-audit.json";
const DEFAULT_PENDING_PATH = join("treasury", "pending-whitelist.jsonl");

const ALLOWED_BASE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "RLUSD",
  "SDAI",
  "USDS",
  "DAI",
  "WETH",
  "CBBTC",
  "WBTC",
  "WBTC.OFT",
  "TBTC",
]);

const EXPECTED_DECIMALS = Object.freeze({
  USDC: new Set([6, 18]),
  USDT: new Set([6, 18]),
  RLUSD: new Set([18]),
  SDAI: new Set([18]),
  USDS: new Set([18]),
  DAI: new Set([18]),
  WETH: new Set([18]),
  CBBTC: new Set([8]),
  WBTC: new Set([8]),
  "WBTC.OFT": new Set([8]),
  TBTC: new Set([18]),
});

const UNSAFE_SYMBOL_RE = /\b(point|points|gov|governance|vote|ve|airdrop|pre[-_ ]?tge)\b/i;
const SHARE_SYMBOL_RE = /^(a[A-Z]|e[A-Z]|mw[A-Z]|gt|bbq|steak|sen|skyMoney|alpha|LV)/u;

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
    writePending: !flags.has("--no-pending"),
    input: values.input || join(config.dataDir, DEFAULT_REPORT_PATH),
    out: values.out || join(config.dataDir, DEFAULT_AUDIT_PATH),
    pendingPath: values["pending-path"] || join(config.dataDir, DEFAULT_PENDING_PATH),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function normalizeAddress(address) {
  const text = String(address || "").trim();
  return /^0x[a-fA-F0-9]{40}$/u.test(text) ? text.toLowerCase() : null;
}

function canonicalSymbol(symbol) {
  const raw = String(symbol || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "WBTC.OFT" || upper === "WBTC OFT") return "WBTC.OFT";
  if (upper === "CBBTC") return "CBBTC";
  if (upper === "WETH" || upper === "WETH.E") return "WETH";
  if (upper === "WBTC" || upper === "WBTC.E" || upper === "WBTCB") return "WBTC";
  if (upper === "TBTC") return "TBTC";
  if (upper === "SDAI") return "SDAI";
  return upper;
}

function registryTokenByAddress(chain, address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  return (TOKEN_REGISTRY[chain] || []).find((token) => normalizeAddress(token.address) === normalized) || null;
}

function sameOpportunityTokens(opportunity = {}) {
  return Array.isArray(opportunity.tokenDetails) ? opportunity.tokenDetails : [];
}

function protocolBindingTokens(opportunity = {}) {
  const binding = opportunity.protocolBinding || opportunity.protocolBindingPlan?.resolvedBinding || {};
  const rows = [];
  if (binding.assetAddress) {
    rows.push({
      symbol: binding.assetSymbol || null,
      address: binding.assetAddress,
      decimals: Number.isFinite(binding.assetDecimals) ? binding.assetDecimals : null,
      verified: true,
      type: "TOKEN",
      role: "entry_asset",
      underlyingSymbol: binding.assetSymbol || null,
      underlyingAddress: binding.assetAddress || null,
    });
  }
  if (binding.shareTokenAddress && normalizeAddress(binding.shareTokenAddress) !== normalizeAddress(binding.assetAddress)) {
    rows.push({
      symbol: binding.shareTokenSymbol || null,
      address: binding.shareTokenAddress,
      decimals: 18,
      verified: false,
      type: "TOKEN",
      role: "position_share",
      underlyingSymbol: binding.assetSymbol || null,
      underlyingAddress: binding.assetAddress || null,
    });
  }
  return rows;
}

function requiredTokenRowsForOpportunity(opportunity = {}) {
  const entrySymbols = new Set((opportunity.entryTokenSymbols || opportunity.entryAssets || []).map(canonicalSymbol).filter(Boolean));
  const rewardSymbols = new Set((opportunity.rewardTokenSymbols || []).map(canonicalSymbol).filter(Boolean));
  const bindingRows = protocolBindingTokens(opportunity);
  const bindingAddresses = new Set(bindingRows.map((row) => normalizeAddress(row.address)).filter(Boolean));
  const tokenRows = sameOpportunityTokens(opportunity)
    .filter((token) => {
      const symbol = canonicalSymbol(token.symbol);
      const address = normalizeAddress(token.address);
      if (!address) return false;
      if (entrySymbols.size === 0 && rewardSymbols.size === 0 && bindingAddresses.size === 0) return true;
      return entrySymbols.has(symbol) || rewardSymbols.has(symbol) || bindingAddresses.has(address);
    })
    .map((token) => ({
      symbol: token.symbol || null,
      address: token.address || null,
      decimals: Number.isFinite(token.decimals) ? token.decimals : null,
      verified: token.verified === true,
      type: token.type || null,
      role: rewardSymbols.has(canonicalSymbol(token.symbol)) ? "reward_or_entry" : "entry_or_position",
      underlyingSymbol: null,
      underlyingAddress: null,
    }));
  return [...tokenRows, ...bindingRows];
}

function opportunitySet(report = {}) {
  const opportunities = Array.isArray(report.opportunities) ? report.opportunities : [];
  if (opportunities.length > 0) {
    return opportunities
      .filter((item) => item?.decision === "candidate" || item?.queueId || item?.mappedStrategyId)
      .filter((item) => isOfficialGatewayDestinationChain(item?.chain || item?.chainName));
  }
  return (Array.isArray(report.topCandidates) ? report.topCandidates : [])
    .filter((item) => isOfficialGatewayDestinationChain(item?.chain || item?.chainName));
}

function sourceKey(row) {
  return `${row.chain}:${normalizeAddress(row.address) || row.address}:${canonicalSymbol(row.symbol) || row.symbol}`;
}

export function collectRequiredMerklTokens(report = {}) {
  const byKey = new Map();
  for (const opportunity of opportunitySet(report)) {
    const chain = canonicalGatewayChain(opportunity.chain || opportunity.chainName || "");
    if (!chain) continue;
    for (const row of requiredTokenRowsForOpportunity(opportunity)) {
      const address = normalizeAddress(row.address);
      if (!address) continue;
      const key = `${chain}:${address}`;
      const current = byKey.get(key) || {
        chain,
        address: row.address,
        symbol: row.symbol || null,
        decimals: Number.isFinite(row.decimals) ? row.decimals : null,
        verified: row.verified === true,
        type: row.type || null,
        roles: [],
        underlyingSymbol: row.underlyingSymbol || null,
        underlyingAddress: row.underlyingAddress || null,
        sourceOpportunityIds: [],
      };
      if (!current.symbol && row.symbol) current.symbol = row.symbol;
      if (!Number.isFinite(current.decimals) && Number.isFinite(row.decimals)) current.decimals = row.decimals;
      current.verified = current.verified || row.verified === true;
      if (row.role && !current.roles.includes(row.role)) current.roles.push(row.role);
      if (!current.underlyingSymbol && row.underlyingSymbol) current.underlyingSymbol = row.underlyingSymbol;
      if (!current.underlyingAddress && row.underlyingAddress) current.underlyingAddress = row.underlyingAddress;
      const opportunityId = String(opportunity.opportunityId || opportunity.id || "").trim();
      if (opportunityId && !current.sourceOpportunityIds.includes(opportunityId)) {
        current.sourceOpportunityIds.push(opportunityId);
      }
      byKey.set(key, current);
    }
  }
  return [...byKey.values()].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
}

function isAllowedBaseSymbol(symbol) {
  return ALLOWED_BASE_SYMBOLS.has(canonicalSymbol(symbol));
}

function decimalsMatch(symbol, decimals) {
  const expected = EXPECTED_DECIMALS[canonicalSymbol(symbol)];
  return Boolean(expected && expected.has(Number(decimals)));
}

function knownUnderlyingAllowed(chain, token = {}) {
  const symbol = canonicalSymbol(token.underlyingSymbol);
  if (!symbol || !ALLOWED_BASE_SYMBOLS.has(symbol)) return false;
  const address = normalizeAddress(token.underlyingAddress);
  if (!address) return false;
  return Boolean(registryTokenByAddress(chain, address) || findToken(chain, address));
}

export function classifyRequiredMerklToken(token = {}) {
  const chain = canonicalGatewayChain(token.chain);
  const registryEntry = registryTokenByAddress(chain, token.address);
  const symbol = canonicalSymbol(token.symbol);
  const registrySymbol = canonicalSymbol(registryEntry?.symbol);
  const effectiveSymbol = registrySymbol || symbol;
  const registryKnown = Boolean(registryEntry);
  const gatewayChain = isOfficialGatewayDestinationChain(chain);
  const expectedDecimalsOk = registryKnown
    ? Number(registryEntry.decimals) === Number(token.decimals)
    : decimalsMatch(effectiveSymbol, token.decimals);
  const unsafeSymbol = UNSAFE_SYMBOL_RE.test(String(token.symbol || "")) || String(token.type || "").toUpperCase() === "POINT";
  const positionShare = Array.isArray(token.roles) && token.roles.includes("position_share");
  const shareLike = SHARE_SYMBOL_RE.test(String(token.symbol || "")) || positionShare;
  const shareUnderlyingAllowed = shareLike && knownUnderlyingAllowed(chain, token);

  if (!gatewayChain) {
    return {
      ...token,
      chain,
      classification: "unsafe_chain_not_gateway_destination",
      allowlistEligible: false,
      rationale: `chain ${chain || "unknown"} is not in official Gateway destinations`,
    };
  }
  if (unsafeSymbol) {
    return {
      ...token,
      chain,
      classification: "unsafe_governance_or_points",
      allowlistEligible: false,
      rationale: "governance, point, or pre-TGE-like token symbol/type requires manual review",
    };
  }
  if (registryKnown && expectedDecimalsOk && (isAllowedBaseSymbol(registryEntry.symbol) || shareUnderlyingAllowed || shareLike)) {
    return {
      ...token,
      chain,
      symbol: registryEntry.symbol,
      decimals: registryEntry.decimals,
      classification: shareLike ? "existing_protocol_share_allowed_underlying" : "registry_known_allowed",
      allowlistEligible: true,
      rationale: "contract address already exists in committed token registry seed",
    };
  }
  if (shareUnderlyingAllowed) {
    return {
      ...token,
      chain,
      classification: "pending_protocol_share_manual_review",
      allowlistEligible: false,
      rationale: "protocol share is not already committed even though its underlying is allowlisted",
    };
  }
  if (!isAllowedBaseSymbol(effectiveSymbol) && !shareUnderlyingAllowed) {
    return {
      ...token,
      chain,
      classification: "unsafe_unapproved_symbol",
      allowlistEligible: false,
      rationale: `symbol ${token.symbol || "unknown"} is outside the strict Merkl allowlist`,
    };
  }
  if (!expectedDecimalsOk) {
    return {
      ...token,
      chain,
      classification: "pending_decimal_mismatch",
      allowlistEligible: false,
      rationale: `decimals ${token.decimals ?? "unknown"} do not match committed expectation for ${effectiveSymbol}`,
    };
  }
  if (token.verified !== true) {
    return {
      ...token,
      chain,
      classification: "pending_merkl_unverified",
      allowlistEligible: false,
      rationale: "Merkl token detail is not verified and address is not already committed",
    };
  }
  return {
    ...token,
    chain,
    classification: "pending_new_address_manual_review",
    allowlistEligible: false,
    rationale: "new token address is not seeded by committed registry for this chain",
  };
}

export function buildRequiredMerklTokensAudit(report = {}, { generatedAt = new Date().toISOString() } = {}) {
  const required = collectRequiredMerklTokens(report).map(classifyRequiredMerklToken);
  const pending = required.filter((item) => !item.allowlistEligible && String(item.classification || "").startsWith("pending_"));
  const unsafe = required.filter((item) => !item.allowlistEligible && !String(item.classification || "").startsWith("pending_"));
  return {
    schemaVersion: 1,
    generatedAt,
    source: {
      kind: "merkl_opportunity_set",
      officialGatewayDestinationChains: OFFICIAL_GATEWAY_DESTINATION_CHAINS,
    },
    summary: {
      requiredCount: required.length,
      allowlistEligibleCount: required.filter((item) => item.allowlistEligible).length,
      pendingCount: pending.length,
      unsafeCount: unsafe.length,
    },
    required,
    pending,
    unsafe,
  };
}

function pendingWhitelistRecord(item = {}) {
  return {
    schemaVersion: 1,
    source: "merkl_required_tokens_audit",
    observedAt: item.observedAt || null,
    chain: item.chain,
    address: item.address,
    symbol: item.symbol,
    decimals: item.decimals,
    classification: item.classification,
    rationale: item.rationale,
    sourceOpportunityIds: item.sourceOpportunityIds || [],
    requestedAction: "manual_whitelist_review",
  };
}

async function mergePendingWhitelist(path, rows = []) {
  let existingText = "";
  try {
    existingText = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const records = existingText
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const byKey = new Map(records
    .filter((record) => record.source !== "merkl_required_tokens_audit")
    .map((record) => [
      `${record.source || "unknown"}:${canonicalGatewayChain(record.chain)}:${normalizeAddress(record.address) || record.address}`,
      record,
    ]));
  for (const item of rows) {
    const record = pendingWhitelistRecord(item);
    const key = `${record.source}:${canonicalGatewayChain(record.chain)}:${normalizeAddress(record.address) || record.address}`;
    byKey.set(key, record);
  }
  const next = [...byKey.values()]
    .map((record) => JSON.stringify(record))
    .join("\n");
  return writeTextIfChanged(path, next ? `${next}\n` : "");
}

export async function runAuditRequiredMerklTokens(args = parseArgs()) {
  const report = await readJson(args.input);
  const audit = buildRequiredMerklTokensAudit(report);
  if (args.write) {
    await writeTextIfChanged(args.out, `${JSON.stringify(audit, null, 2)}\n`);
    if (args.writePending) {
      await mergePendingWhitelist(args.pendingPath, [...audit.pending, ...audit.unsafe]);
    }
  }
  return audit;
}

async function main() {
  const args = parseArgs();
  const audit = await runAuditRequiredMerklTokens(args);
  if (args.json) {
    console.log(JSON.stringify(audit, null, 2));
    return;
  }
  console.log(`required=${audit.summary.requiredCount}`);
  console.log(`allowlistEligible=${audit.summary.allowlistEligibleCount}`);
  console.log(`pending=${audit.summary.pendingCount}`);
  console.log(`unsafe=${audit.summary.unsafeCount}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
