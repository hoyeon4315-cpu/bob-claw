#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { config } from "../config/env.mjs";
import {
  PRIMARY_OPERATOR_BTC_ADDRESS,
  isApprovedOperatorBtcAddress,
  resolveOperatorBtcAddress,
} from "../config/operator-btc-addresses.mjs";
import { MempoolClient } from "../bitcoin/fees.mjs";
import { readLatestJsonlRecord } from "../lib/jsonl-read.mjs";

function parseArgs(argv = []) {
  const entries = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(2, index), item.slice(index + 1)];
      }),
  );
  const flags = new Set(argv);
  return {
    json: flags.has("--json"),
    address: entries.address || PRIMARY_OPERATOR_BTC_ADDRESS,
  };
}

async function latestBtcUsd(dataDir = config.dataDir) {
  const latest = await readLatestJsonlRecord(dataDir, "market-price-snapshots").catch(() => null);
  return Number.isFinite(Number(latest?.btcUsd)) ? Number(latest.btcUsd) : null;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function buildPreDepositReadiness({
  address = PRIMARY_OPERATOR_BTC_ADDRESS,
  btcUsd = null,
  bitcoinClient = new MempoolClient(),
  dataDir = config.dataDir,
  now = new Date().toISOString(),
} = {}) {
  const approvedEntry = resolveOperatorBtcAddress(address);
  const approvedAddress = isApprovedOperatorBtcAddress(address, { purpose: "operating_capital_ingress" });
  const explicitBtcUsd = finiteNumberOrNull(btcUsd);
  const price = explicitBtcUsd ?? await latestBtcUsd(dataDir);
  const remainingChecks = [];

  if (!approvedAddress) {
    return {
      schemaVersion: 1,
      checkedAt: now,
      status: "BLOCKED_UNSAFE",
      expectedBtcAddress: PRIMARY_OPERATOR_BTC_ADDRESS,
      watchedBtcAddress: address,
      approvedAddress: false,
      approval: approvedEntry,
      deposit: {
        detected: false,
        confirmations: null,
        error: "btc_address_not_approved_for_operating_capital_ingress",
      },
      operatingCapital: {
        classified: false,
        reason: "address_not_approved",
      },
      remainingChecks: ["commit_operator_btc_address_policy"],
    };
  }

  let balance;
  let txHistory = null;
  let txHistoryError = null;
  try {
    balance = await bitcoinClient.getAddressBalance(address);
  } catch (error) {
    return {
      schemaVersion: 1,
      checkedAt: now,
      status: "BLOCKED_EXTERNAL",
      expectedBtcAddress: PRIMARY_OPERATOR_BTC_ADDRESS,
      watchedBtcAddress: address,
      approvedAddress: true,
      approval: approvedEntry,
      deposit: {
        detected: false,
        confirmations: null,
        error: error.message,
        source: bitcoinClient.baseUrl,
      },
      operatingCapital: {
        classified: false,
        reason: "bitcoin_balance_provider_unavailable",
      },
      remainingChecks: ["restore_bitcoin_balance_provider", "rerun_pre_deposit_readiness"],
    };
  }

  try {
    txHistory = await bitcoinClient.getAddressTransactions(address);
  } catch (error) {
    txHistoryError = error.message;
  }

  try {
    const confirmedBalanceSats = Number(balance.confirmedBalanceSats || 0);
    const mempoolBalanceSats = Number(balance.mempoolBalanceSats || 0);
    const balanceSats = Number(balance.balanceSats || confirmedBalanceSats + mempoolBalanceSats);
    const detected = balanceSats > 0;
    const confirmed = confirmedBalanceSats > 0;
    if (!detected) remainingChecks.push("await_confirmed_btc_deposit");
    if (detected && !confirmed) remainingChecks.push("await_confirmations");
    if (confirmed) remainingChecks.push("run_bootstrap_refill_and_money_loop");

    return {
      schemaVersion: 1,
      checkedAt: now,
      status: confirmed ? "DEPOSIT_CONFIRMED" : "ARMED_DEPOSIT_GATE",
      expectedBtcAddress: PRIMARY_OPERATOR_BTC_ADDRESS,
      watchedBtcAddress: address,
      approvedAddress: true,
      approval: approvedEntry,
      deposit: {
        detected,
        confirmations: confirmed ? "confirmed" : mempoolBalanceSats > 0 ? "mempool" : null,
        balanceSats,
        confirmedBalanceSats,
        mempoolBalanceSats,
        txCount: Array.isArray(txHistory?.transactions) ? txHistory.transactions.length : null,
        txHistoryError,
        source: balance.source || txHistory?.source || bitcoinClient.baseUrl,
      },
      operatingCapital: {
        classified: confirmed,
        classification: confirmed ? "operator_btc_operating_capital" : null,
        estimatedUsd: confirmed && price ? Math.round((confirmedBalanceSats / 100_000_000) * price * 100) / 100 : null,
        btcUsd: price,
        policy: "committed_operator_btc_address_only",
      },
      remainingChecks,
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      checkedAt: now,
      status: "BLOCKED_EXTERNAL",
      expectedBtcAddress: PRIMARY_OPERATOR_BTC_ADDRESS,
      watchedBtcAddress: address,
      approvedAddress: true,
      approval: approvedEntry,
      deposit: {
        detected: false,
        confirmations: null,
        error: error.message,
        source: bitcoinClient.baseUrl,
      },
      operatingCapital: {
        classified: false,
        reason: "bitcoin_deposit_classification_failed",
      },
      remainingChecks: ["restore_bitcoin_history_provider", "rerun_pre_deposit_readiness"],
    };
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = await buildPreDepositReadiness({ address: args.address });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`status=${report.status}`);
  console.log(`watchedBtcAddress=${report.watchedBtcAddress}`);
  console.log(`approvedAddress=${report.approvedAddress}`);
  console.log(`depositDetected=${report.deposit.detected}`);
  console.log(`confirmations=${report.deposit.confirmations || "none"}`);
  console.log(`operatingCapitalClassified=${report.operatingCapital.classified}`);
  console.log(`remainingChecks=${report.remainingChecks.join(",") || "none"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
