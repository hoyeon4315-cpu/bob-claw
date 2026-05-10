import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPreDepositReadiness } from "../src/cli/check-pre-deposit-readiness.mjs";
import { PRIMARY_OPERATOR_BTC_ADDRESS } from "../src/config/operator-btc-addresses.mjs";

test("pre-deposit readiness confirms approved funded BTC address", async () => {
  const report = await buildPreDepositReadiness({
    address: PRIMARY_OPERATOR_BTC_ADDRESS,
    btcUsd: 80_000,
    bitcoinClient: {
      baseUrl: "https://mempool.test/api",
      getAddressBalance: async () => ({
        balanceSats: 625_000,
        confirmedBalanceSats: 625_000,
        mempoolBalanceSats: 0,
        source: "https://mempool.test/api",
      }),
      getAddressTransactions: async () => ({
        transactions: [{ txid: "btc-tx-1", status: { confirmed: true } }],
        source: "https://mempool.test/api",
      }),
    },
  });

  assert.equal(report.status, "DEPOSIT_CONFIRMED");
  assert.equal(report.approvedAddress, true);
  assert.equal(report.deposit.detected, true);
  assert.equal(report.deposit.confirmations, "confirmed");
  assert.equal(report.operatingCapital.classified, true);
  assert.equal(report.operatingCapital.estimatedUsd, 500);
});

test("pre-deposit readiness does not hide a confirmed balance when tx history fails", async () => {
  const report = await buildPreDepositReadiness({
    address: PRIMARY_OPERATOR_BTC_ADDRESS,
    btcUsd: 80_000,
    bitcoinClient: {
      baseUrl: "https://mempool.test/api",
      getAddressBalance: async () => ({
        balanceSats: 625_000,
        confirmedBalanceSats: 625_000,
        mempoolBalanceSats: 0,
        source: "https://mempool.test/api",
      }),
      getAddressTransactions: async () => {
        throw new Error("fetch failed");
      },
    },
  });

  assert.equal(report.status, "DEPOSIT_CONFIRMED");
  assert.equal(report.deposit.detected, true);
  assert.equal(report.deposit.txCount, null);
  assert.equal(report.deposit.txHistoryError, "fetch failed");
  assert.equal(report.operatingCapital.classified, true);
});

test("pre-deposit readiness reports armed gate when approved address has no funds", async () => {
  const report = await buildPreDepositReadiness({
    address: PRIMARY_OPERATOR_BTC_ADDRESS,
    bitcoinClient: {
      baseUrl: "https://mempool.test/api",
      getAddressBalance: async () => ({
        balanceSats: 0,
        confirmedBalanceSats: 0,
        mempoolBalanceSats: 0,
        source: "https://mempool.test/api",
      }),
      getAddressTransactions: async () => ({ transactions: [], source: "https://mempool.test/api" }),
    },
  });

  assert.equal(report.status, "ARMED_DEPOSIT_GATE");
  assert.equal(report.deposit.detected, false);
  assert.equal(report.remainingChecks.includes("await_confirmed_btc_deposit"), true);
});
