import { test } from "node:test";
import assert from "node:assert/strict";

import {
  listReaders,
  resolveReaderForBinding,
  _resetForTesting,
} from "../src/protocol-readers/registry.mjs";
import { bootstrapReaders, _resetBootstrap } from "../src/protocol-readers/bootstrap.mjs";
import { buildReaderParams, dispatchPosition } from "../src/protocol-readers/dispatch.mjs";

function freshBootstrap() {
  _resetForTesting();
  _resetBootstrap();
  bootstrapReaders();
}

test("bootstrapReaders registers all five in-tree readers", () => {
  freshBootstrap();
  const readers = listReaders();
  assert.equal(readers.length, 5);
  const ids = readers.map((r) => r.id).sort();
  assert.deepEqual(ids, ["aave-v3", "beefy", "erc4626", "pendle", "venus"]);
});

test("bootstrapReaders covers expected bindingKinds", () => {
  freshBootstrap();
  const expected = [
    "erc4626_vault_supply_withdraw",
    "euler_evault_deposit_withdraw",
    "morpho_metamorpho_supply_withdraw",
    "yo_protocol_vault_deposit_withdraw",
    "aave_v3_supply_withdraw",
    "aave_v3_pool_supply_withdraw",
    "aave_v3_borrow_repay",
    "beefy_vault_deposit_withdraw",
    "pendle_market_swap",
    "pendle_market_lp",
    "venus_market_supply_withdraw",
    "venus_pool_supply_withdraw",
  ];
  for (const kind of expected) {
    const reader = resolveReaderForBinding(kind);
    assert.ok(reader, `missing reader for bindingKind ${kind}`);
  }
});

test("bootstrapReaders is idempotent", () => {
  freshBootstrap();
  bootstrapReaders();
  bootstrapReaders();
  assert.equal(listReaders().length, 5);
});

test("dispatchPosition routes erc4626 binding to reader", async () => {
  freshBootstrap();
  const dispatch = await dispatchPosition({
    position: {
      bindingKind: "erc4626_vault_supply_withdraw",
      protocolId: "yo",
      chain: "base",
      params: { vaultAddress: null }, // missing -> reader returns missing_params
    },
    chain: "base",
    walletAddress: null,
  });
  assert.equal(dispatch.kind, "reader");
  assert.equal(dispatch.id, "erc4626");
  assert.equal(dispatch.result.ok, false);
  assert.equal(dispatch.result.code, "missing_params");
});

test("buildReaderParams hoists live top-level fields into canonical reader params", () => {
  const params = buildReaderParams({
    bindingKind: "aave_v3_pool_supply_withdraw",
    vaultAddress: "0xVault",
    shareTokenAddress: "0xAToken",
    poolAddress: "0xPool",
    poolAddressProviderAddress: "0xProvider",
    assetAddress: "0xAsset",
    marketName: "proto_mainnet_v3",
    assetDecimals: 18,
  });

  assert.equal(params.vaultAddress, "0xVault");
  assert.equal(params.aTokenAddress, "0xAToken");
  assert.equal(params.shareTokenAddress, "0xAToken");
  assert.equal(params.poolAddress, "0xPool");
  assert.equal(params.poolAddressProviderAddress, "0xProvider");
  assert.equal(params.underlyingTokenAddress, "0xAsset");
  assert.equal(params.marketLabel, "proto_mainnet_v3");
  assert.equal(params.underlyingDecimals, 18);
});

test("dispatchPosition unknown bindingKind does not throw", async () => {
  freshBootstrap();
  const dispatch = await dispatchPosition({
    position: {
      bindingKind: "unknown_xyz",
      protocolId: "x",
      chain: "ethereum",
      marketKey: "m",
    },
    chain: "ethereum",
    walletAddress: null,
  });
  assert.ok(dispatch.kind === "legacy" || dispatch.kind === "none");
});

test("dispatchPosition missing bindingKind returns explicit none", async () => {
  freshBootstrap();
  const dispatch = await dispatchPosition({
    position: {
      protocolId: "x",
      chain: "ethereum",
      marketKey: "m",
    },
    chain: "ethereum",
    walletAddress: null,
  });
  assert.equal(dispatch.kind, "none");
  assert.equal(dispatch.reason, "missing_binding_kind");
});

test("dispatchPosition aave_v3 binding routes to aave-v3 reader", async () => {
  freshBootstrap();
  const dispatch = await dispatchPosition({
    position: {
      bindingKind: "aave_v3_supply_withdraw",
      protocolId: "aave-v3",
      chain: "ethereum",
    },
    chain: "ethereum",
    walletAddress: null,
  });
  assert.equal(dispatch.kind, "reader");
  assert.equal(dispatch.id, "aave-v3");
});

test("dispatchPosition canonicalizes aave_v3 pool bindings to the aave-v3 reader", async () => {
  freshBootstrap();
  const dispatch = await dispatchPosition({
    position: {
      bindingKind: "aave_v3_pool_supply_withdraw",
      protocolId: "aave",
      chain: "ethereum",
      shareTokenAddress: "0xAToken",
      assetAddress: "0xAsset",
      poolAddress: "0xPool",
    },
    chain: "ethereum",
    walletAddress: null,
  });
  assert.equal(dispatch.kind, "reader");
  assert.equal(dispatch.id, "aave-v3");
  assert.equal(dispatch.result.ok, false);
  assert.equal(dispatch.result.code, "missing_params");
});

test("dispatchPosition legacy fallback for compound-v2 (no reader, has legacy adapter)", async () => {
  freshBootstrap();
  const dispatch = await dispatchPosition({
    position: {
      bindingKind: "compound_v2_supply_withdraw",
      protocolId: "compound-v2",
      chain: "ethereum",
    },
    chain: "ethereum",
    walletAddress: null,
  });
  assert.equal(dispatch.kind, "legacy");
  assert.equal(dispatch.adapter?.id, "compound-v2");
});

test("dispatchPosition routes Venus market bindings to the Venus reader", async () => {
  freshBootstrap();
  const dispatch = await dispatchPosition({
    position: {
      bindingKind: "venus_market_supply_withdraw",
      protocolId: "venus",
      chain: "bsc",
      shareTokenAddress: "0xVToken",
      assetAddress: "0xAsset",
    },
    chain: "bsc",
    walletAddress: null,
  });
  assert.equal(dispatch.kind, "reader");
  assert.equal(dispatch.id, "venus");
  assert.equal(dispatch.result.ok, false);
  assert.equal(dispatch.result.code, "missing_params");
});

test("evaluateCoverage track1 fail when reader_errors present", async () => {
  freshBootstrap();
  const { evaluateCoverage } = await import("../src/cli/report-portfolio-coverage.mjs");
  const result = evaluateCoverage({
    auditPositions: [],
    snapshotPositions: [
      {
        positionId: "base:yo:0xw:0xv",
        bindingKind: "erc4626_vault_supply_withdraw",
        protocolId: "yo",
        valueUsd: 80,
      },
    ],
    readerErrors: [
      { positionId: "p2", bindingKind: "unknown_xyz", code: "no_reader_no_adapter", error: "no" },
    ],
    totals: { protocolUsd: 80, tokenUsd: 0, totalUsd: 80 },
  });
  assert.equal(result.track1.pass, false);
  assert.equal(result.track1.readerErrorCount, 1);
});

test("evaluateCoverage track1 pass when all positions covered and protocolUsd > 0", async () => {
  freshBootstrap();
  const { evaluateCoverage } = await import("../src/cli/report-portfolio-coverage.mjs");
  const result = evaluateCoverage({
    auditPositions: [
      { positionId: "base:yo:0xw:0xv", valueUsd: 80 },
    ],
    snapshotPositions: [
      {
        positionId: "base:yo:0xw:0xv",
        bindingKind: "erc4626_vault_supply_withdraw",
        protocolId: "yo",
        valueUsd: 80,
      },
    ],
    readerErrors: [],
    totals: { protocolUsd: 80, tokenUsd: 0, totalUsd: 80 },
  });
  assert.equal(result.track1.pass, true);
  assert.equal(result.track1.protocolUsd, 80);
});

test("evaluateCoverage track1 fail when protocol positions exist but protocolUsd == 0", async () => {
  freshBootstrap();
  const { evaluateCoverage } = await import("../src/cli/report-portfolio-coverage.mjs");
  const result = evaluateCoverage({
    auditPositions: [],
    snapshotPositions: [
      {
        positionId: "base:yo:0xw:0xv",
        bindingKind: "erc4626_vault_supply_withdraw",
        protocolId: "yo",
        valueUsd: 0,
      },
    ],
    readerErrors: [],
    totals: { protocolUsd: 0, tokenUsd: 0, totalUsd: 0 },
  });
  assert.equal(result.track1.pass, false);
  assert.equal(result.track1.protocolUsdViolation, true);
});
