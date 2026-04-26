import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConnectedRefreshPackage, summarizeConnectedRefreshPackage } from "../src/prelive/connected-refresh-package.mjs";

test("connected refresh package orders stale network inputs before reevaluation", () => {
  const report = buildConnectedRefreshPackage({
    dashboardStatus: {
      shadowCycle: {
        topRoute: {
          routeKey: "bob:0x0555->base:0x0555",
          label: "bob->base wBTC.OFT->wBTC.OFT",
          amount: "10000",
          srcChain: "bob",
          dstChain: "base",
        },
      },
    },
    canaryInputs: {
      routeKey: "bob:0x0555->base:0x0555",
      routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
      amount: "10000",
      gatewayQuote: { state: "stale", ageMinutes: 61 },
      exactGas: { state: "fresh", ageMinutes: 2 },
      srcGas: { state: "stale", ageMinutes: 70 },
      dexQuote: { state: "stale", ageMinutes: 80 },
      bitcoinFee: { state: "not_required", ageMinutes: null },
      marketSnapshot: { state: "missing", ageMinutes: null },
    },
  });

  assert.equal(report.status, "network_refresh_required");
  assert.equal(report.requiredRefreshes.length, 3);
  assert.equal(report.blockedInputs.length, 1);
  assert.equal(report.blockedInputs[0].reason, "blocked_dex_quote:no_supported_router_for_chain:60808");
  assert.equal(report.requiredRefreshes[0].id, "refresh_gateway_quote");
  assert.equal(report.requiredRefreshes[0].command, 'npm run verify:gateway -- --route-key="bob:0x0555->base:0x0555" --amounts="10000"');
  assert.match(report.summary.fullCommandChain, /npm run price:snapshot/);
  assert.match(report.summary.fullCommandChain, /npm run write:session-handoff/);

  const summary = summarizeConnectedRefreshPackage(report);
  assert.equal(summary.requiredRefreshCount, 3);
  assert.equal(summary.nextActionCode, "refresh_gateway_quote");
  assert.equal(summary.runnerExecuteCommand, "npm run run:connected-refresh-package -- --execute");
});

test("connected refresh package stops on blocked DEX coverage instead of scheduling endless refresh", () => {
  const report = buildConnectedRefreshPackage({
    dashboardStatus: {
      shadowCycle: {
        topRoute: {
          routeKey: "avalanche:0x0555->bera:0x0555",
          label: "avalanche->bera wBTC.OFT->wBTC.OFT",
          amount: "10000",
          srcChain: "avalanche",
          dstChain: "bera",
        },
      },
    },
    canaryInputs: {
      routeKey: "avalanche:0x0555->bera:0x0555",
      routeLabel: "avalanche->bera wBTC.OFT->wBTC.OFT",
      amount: "10000",
      gatewayQuote: { state: "fresh", ageMinutes: 2 },
      exactGas: { state: "fresh", ageMinutes: 2 },
      srcGas: { state: "fresh", ageMinutes: 2 },
      dexQuote: { state: "blocked", ageMinutes: 1, failureReason: "odos_chain_not_supported" },
      bitcoinFee: { state: "not_needed", ageMinutes: null },
      marketSnapshot: { state: "fresh", ageMinutes: 2 },
    },
  });

  assert.equal(report.status, "blocked_nonrefreshable_input");
  assert.equal(report.requiredRefreshes.length, 0);
  assert.equal(report.blockedInputs.length, 1);
  assert.equal(report.blockedInputs[0].key, "dex_quote");
  assert.equal(report.nextAction.code, "hold_dex_quote");

  const summary = summarizeConnectedRefreshPackage(report);
  assert.equal(summary.blockedInputCount, 1);
  assert.equal(summary.nextActionCommand, null);
});

test("connected refresh package infers unsupported dex routes as blocked before retrying refresh", () => {
  const report = buildConnectedRefreshPackage({
    dashboardStatus: {
      shadowCycle: {
        topRoute: {
          routeKey: "sonic:0x0555->bob:0x0555",
          label: "sonic->bob wBTC.OFT->wBTC.OFT",
          amount: "50000",
        },
      },
    },
    canaryInputs: {
      routeKey: "sonic:0x0555->bob:0x0555",
      routeLabel: "sonic->bob wBTC.OFT->wBTC.OFT",
      amount: "50000",
      gatewayQuote: { state: "fresh", ageMinutes: 2 },
      exactGas: { state: "fresh", ageMinutes: 2 },
      srcGas: { state: "fresh", ageMinutes: 2 },
      dexQuote: { state: "missing", ageMinutes: null },
      bitcoinFee: { state: "not_needed", ageMinutes: null },
      marketSnapshot: { state: "fresh", ageMinutes: 2 },
    },
  });

  assert.equal(report.status, "blocked_nonrefreshable_input");
  assert.equal(report.requiredRefreshes.length, 0);
  assert.equal(report.blockedInputs[0].reason, "blocked_dex_quote:no_supported_router_for_chain:60808");
  assert.equal(report.nextAction.code, "hold_dex_quote");
});

test("connected refresh package blocks inventory-short routes before retrying exact gas", () => {
  const report = buildConnectedRefreshPackage({
    dashboardStatus: {
      shadowCycle: {
        topRoute: {
          routeKey: "unichain:0x0555->bob:0x0555",
          label: "unichain->bob wBTC.OFT->wBTC.OFT",
          amount: "10000",
          srcChain: "unichain",
          dstChain: "bob",
        },
      },
    },
    canaryInputs: {
      routeKey: "unichain:0x0555->bob:0x0555",
      routeLabel: "unichain->bob wBTC.OFT->wBTC.OFT",
      amount: "10000",
      gatewayQuote: { state: "stale", ageMinutes: 61 },
      exactGas: { state: "missing", ageMinutes: null },
      srcGas: { state: "fresh", ageMinutes: 2 },
      dexQuote: { state: "blocked", ageMinutes: null, failureReason: "no_supported_router_for_chain:60808" },
      bitcoinFee: { state: "not_needed", ageMinutes: null },
      marketSnapshot: { state: "fresh", ageMinutes: 2 },
    },
    wholeWalletRecords: [
      {
        observedAt: "2026-04-26T11:58:50.000Z",
        tokenBalances: [
          {
            chain: "unichain",
            token: "0x0555",
            ticker: "wBTC.OFT",
            balance: "1000",
          },
        ],
      },
    ],
    now: "2026-04-26T12:00:00.000Z",
  });

  assert.equal(report.status, "blocked_nonrefreshable_input");
  assert.equal(report.requiredRefreshes.length, 0);
  assert.equal(report.blockedInputs[0].key, "source_inventory");
  assert.equal(report.blockedInputs[0].reason, "blocked_source_inventory:insufficient_source_inventory:1000<10000");
  assert.equal(report.nextAction.code, "hold_source_inventory");
});

test("connected refresh package treats scanned-but-absent source token as zero inventory", () => {
  const report = buildConnectedRefreshPackage({
    dashboardStatus: {
      shadowCycle: {
        topRoute: {
          routeKey: "bera:0x0555->bob:0x0555",
          label: "bera->bob wBTC.OFT->wBTC.OFT",
          amount: "50000",
        },
      },
    },
    canaryInputs: {
      routeKey: "bera:0x0555->bob:0x0555",
      routeLabel: "bera->bob wBTC.OFT->wBTC.OFT",
      amount: "50000",
      gatewayQuote: { state: "stale", ageMinutes: 61 },
      exactGas: { state: "missing", ageMinutes: null },
      srcGas: { state: "fresh", ageMinutes: 2 },
      dexQuote: { state: "blocked", ageMinutes: null, failureReason: "no_supported_router_for_chain:80094" },
      bitcoinFee: { state: "not_needed", ageMinutes: null },
      marketSnapshot: { state: "fresh", ageMinutes: 2 },
    },
    wholeWalletRecords: [
      {
        observedAt: "2026-04-26T12:00:00.000Z",
        native: [{ chain: "bera", token: "0x0000000000000000000000000000000000000000", balance: "1" }],
        tokenBalances: [],
        scanErrors: [],
      },
    ],
  });

  assert.equal(report.status, "blocked_nonrefreshable_input");
  assert.equal(report.requiredRefreshes.length, 0);
  assert.equal(report.blockedInputs[0].reason, "blocked_source_inventory:insufficient_source_inventory:0<50000");
});
