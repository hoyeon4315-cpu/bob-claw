#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import { resolveAggressionProfile } from "../config/aggression-profile.mjs";
import { resolveOperationalAddress } from "../config/operational-address.mjs";
import { readErc20Allowance, readErc20Balance } from "../evm/account-state.mjs";
import {
  buildApprovalExposureSlice,
  extractApprovalWatchlist,
  runApprovalReaper,
} from "../executor/approval-reaper.mjs";
import { sendSignerCommand, signerClientTimeoutMs, signerSocketPath } from "../executor/signer/client.mjs";
import { writeTextIfChanged } from "../lib/file-write.mjs";
import { buildDefaultTreasuryPolicy, decimalToUnits } from "../treasury/policy.mjs";
import { tokenAsset } from "../assets/tokens.mjs";

const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

const JSON_ARTIFACTS = Object.freeze([
  "aave-protocol-canary-latest.json",
  "erc4626-protocol-canary-latest.json",
  "live-canary-sweep-latest.json",
  "merkl-canary-autopilot-latest.json",
  "wrapped-btc-loop-handoff-latest.json",
  "wrapped-btc-loop-live-success-latest.json",
]);
const JSONL_ARTIFACTS = Object.freeze([
  "treasury-refill-executions.jsonl",
  "token-dex-experiment-executions.jsonl",
  "native-dex-experiment-executions.jsonl",
  "live-canary-sweeps.jsonl",
  "merkl-canary-autopilot-runs.jsonl",
]);

function optionMap(argv) {
  return Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
}

export function parseArgs(argv = []) {
  const flags = new Set(argv);
  const options = optionMap(argv);
  return {
    json: flags.has("--json"),
    write: flags.has("--write"),
    execute: flags.has("--execute"),
    dataDir: options["data-dir"] || config.dataDir,
    outputPath: options.output || null,
    dashboardOutputPath: options["dashboard-output"] || null,
    idleTtlMs: options["idle-ttl-ms"] ? Number(options["idle-ttl-ms"]) : null,
    socketPath: options["socket-path"] || signerSocketPath(),
    timeoutMs: options["timeout-ms"] ? Number(options["timeout-ms"]) : signerClientTimeoutMs(),
  };
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readJsonlIfExists(path, maxLines = 500) {
  try {
    const text = await readFile(path, "utf8");
    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-maxLines)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function extractApprovalsFromSignerAudit(auditPath, maxLines = 2000) {
  const lines = await readJsonlIfExists(auditPath, maxLines);
  const byKey = new Map();
  for (const record of lines) {
    if (record?.intent?.intentType !== "approve_exact") continue;
    const intent = record.intent;
    const metadata = intent.metadata || {};
    let token = null;
    let spender = null;
    if (intent.approval?.token && intent.approval?.spender) {
      token = intent.approval.token;
      spender = intent.approval.spender;
    } else if (metadata.assetAddress && metadata.vaultAddress) {
      token = metadata.assetAddress;
      spender = metadata.vaultAddress;
    } else if (metadata.expectedTxTo && metadata.revokedSpender) {
      token = metadata.expectedTxTo;
      spender = metadata.revokedSpender;
    }
    if (!token || !spender) continue;
    const chain = String(record.chain || intent.chain || "").toLowerCase();
    if (!chain) continue;
    const key = `${chain}:${token.toLowerCase()}:${spender.toLowerCase()}`;
    const observedAt = record.timestamp || intent.observedAt || null;
    const existing = byKey.get(key);
    const existingTime = existing?.lastActiveAt ? new Date(existing.lastActiveAt).getTime() : 0;
    const newTime = observedAt ? new Date(observedAt).getTime() : 0;
    if (!existing || newTime >= existingTime) {
      byKey.set(key, {
        strategyId: record.strategyId,
        chain,
        token: token.toLowerCase(),
        spender: spender.toLowerCase(),
        lastApprovedAmountRaw: intent.approval?.amount || metadata.lastApprovedAmountRaw || null,
        lastActiveAt: observedAt,
        source: "signer_audit",
      });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const aKey = `${a.chain}:${a.token}:${a.spender}`;
    const bKey = `${b.chain}:${b.token}:${b.spender}`;
    return aKey.localeCompare(bKey);
  });
}

function treasuryAllowanceWatchlist() {
  const policy = buildDefaultTreasuryPolicy();
  return (policy.allowanceCaps || []).map((item) => {
    const asset = tokenAsset(item.chain, item.token);
    return {
      chain: item.chain,
      token: item.token,
      spender: item.spender,
      symbol: asset.symbol || item.token,
      decimals: asset.decimals,
      maxApprovalRaw: decimalToUnits(item.maxApproval, asset.decimals).toString(),
      source: "treasury_policy_allowance_cap",
    };
  });
}

async function loadApprovalArtifacts(dataDir) {
  const jsonRecords = await Promise.all(JSON_ARTIFACTS.map((name) => readJsonIfExists(join(dataDir, name))));
  const jsonlRecords = (await Promise.all(JSONL_ARTIFACTS.map((name) => readJsonlIfExists(join(dataDir, name))))).flat();
  return [...jsonRecords.filter(Boolean), ...jsonlRecords];
}

async function buildWatchlist(dataDir) {
  const artifacts = await loadApprovalArtifacts(dataDir);
  const signerAuditPath = join(dataDir, "..", "logs", "signer-audit.jsonl");
  const signerAuditWatchlist = await extractApprovalsFromSignerAudit(signerAuditPath);
  return [
    ...treasuryAllowanceWatchlist(),
    ...extractApprovalWatchlist(artifacts),
    ...signerAuditWatchlist,
  ];
}

async function collectReport(args) {
  const { address } = await resolveOperationalAddress({ dataDir: args.dataDir });
  const watchlist = await buildWatchlist(args.dataDir);
  return runApprovalReaper({
    owner: address,
    execute: args.execute,
    idleTtlMs: args.idleTtlMs,
    watchlist,
    readAllowance: async (item) => {
      const result = await readErc20Allowance(item.chain, item.token, address, item.spender);
      return { allowanceRaw: result.allowance.toString(), rpcUrl: result.rpcUrl || null };
    },
    readBalance: async (item) => {
      const result = await readErc20Balance(item.chain, item.token, address);
      return { balanceRaw: result.balance.toString() };
    },
    sendSignerCommandImpl: ({ message }) => sendSignerCommand({
      message,
      socketPath: args.socketPath,
      timeoutMs: args.timeoutMs,
    }),
  });
}

function printSummary(report) {
  const summary = report.summary || {};
  console.log(`observedAt=${report.observedAt}`);
  console.log(`mode=${report.execution?.mode || "dry_run"}`);
  console.log(`watchlistCount=${summary.watchlistCount ?? 0}`);
  console.log(`nonzeroCount=${summary.nonzeroCount ?? 0}`);
  console.log(`staleNonzeroCount=${summary.staleNonzeroCount ?? 0}`);
  console.log(`overCapCount=${summary.overCapCount ?? 0}`);
  console.log(`unknownSourceCount=${summary.unknownSourceCount ?? 0}`);
  console.log(`revocableCount=${summary.revocableCount ?? 0}`);
  console.log(`attemptedCount=${report.execution?.attemptedCount ?? 0}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.idleTtlMs == null) {
    const profile = resolveAggressionProfile();
    args.idleTtlMs = (profile.approvalMaxIdleHours || 1) * 3_600_000;
  }
  const report = await collectReport(args);
  if (args.write || args.outputPath) {
    const outputPath = args.outputPath || join(args.dataDir, "approval-reaper-latest.json");
    await writeTextIfChanged(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    const dashboardOutputPath = args.dashboardOutputPath || join(args.dataDir, "..", "dashboard", "public", "approval-exposure.json");
    await writeTextIfChanged(dashboardOutputPath, `${JSON.stringify(buildApprovalExposureSlice(report), null, 2)}\n`);
  }
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printSummary(report);
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
