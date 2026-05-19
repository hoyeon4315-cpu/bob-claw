import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freshnessForObservedAt,
  normalizeProtocolPositionMark,
  protocolMarkKey,
} from "../src/treasury/protocol-position-mark-schema.mjs";

test("normalizes a successful protocol mark with exact USD and BTC values", () => {
  const mark = normalizeProtocolPositionMark(
    {
      event: "position_marked",
      observedAt: "2026-05-03T12:00:00.000Z",
      positionId: "merkl:base:op:tx",
      opportunityId: "op",
      chain: "base",
      protocolId: "yo",
      bindingKind: "erc4626_vault_supply_withdraw",
      adapterId: "erc4626",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      assetSymbol: "USDC",
      assetDecimals: 6,
      assetBalance: "5015801",
      assetAmount: 5.015801,
      assetPriceUsd: 1,
      btcPriceUsd: 103000,
      walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      markSource: "onchain_erc4626_convert_to_assets",
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.equal(mark.schemaVersion, 1);
  assert.equal(mark.event, "position_marked");
  assert.equal(mark.positionId, "merkl:base:op:tx");
  assert.equal(mark.valueUsd, 5.015801);
  assert.equal(mark.valueBtc, 5.015801 / 103000);
  assert.equal(mark.confidence, "verified_current");
  assert.equal(protocolMarkKey(mark), "merkl:base:op:tx");
});

test("classifies protocol mark freshness deterministically", () => {
  const now = "2026-05-03T12:10:00.000Z";
  assert.equal(freshnessForObservedAt("2026-05-03T12:09:00.000Z", now), "fresh");
  assert.equal(freshnessForObservedAt("2026-05-03T12:01:00.000Z", now), "recent");
  assert.equal(freshnessForObservedAt("2026-05-03T11:20:00.000Z", now), "stale");
  assert.equal(freshnessForObservedAt("2026-05-03T10:59:59.000Z", now), "expired");
});

test("uses boundary-inclusive freshness windows and fails invalid dates", () => {
  const now = "2026-05-03T12:10:00.000Z";
  assert.equal(freshnessForObservedAt("2026-05-03T12:08:30.000Z", now), "fresh");
  assert.equal(freshnessForObservedAt("2026-05-03T12:00:00.000Z", now), "recent");
  assert.equal(freshnessForObservedAt("2026-05-03T11:10:00.000Z", now), "stale");
  assert.equal(freshnessForObservedAt("not-a-date", now), "failed");
  assert.equal(freshnessForObservedAt("2026-05-03T12:00:00.000Z", "bad-now"), "failed");
});

test("defaults event observedAt status and derives key without a position id", () => {
  const mark = normalizeProtocolPositionMark(
    {
      opportunityId: "op-42",
      chain: "base",
      assetAddress: "0xasset",
      assetAmount: "2.5",
      assetPriceUsd: "4",
      btcPriceUsd: "100000",
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.equal(mark.event, "position_marked");
  assert.equal(mark.observedAt, "2026-05-03T12:00:00.000Z");
  assert.equal(mark.status, "open");
  assert.equal(mark.valueUsd, 10);
  assert.equal(mark.valueBtc, 0.0001);
  assert.equal(mark.confidence, "verified_current");
  assert.equal(protocolMarkKey(mark), "base:op-42:0xasset");
});

test("prefers share token address in fallback keys", () => {
  const key = protocolMarkKey({
    chain: "base",
    opportunityId: "op-42",
    shareTokenAddress: "0xshare",
    assetAddress: "0xasset",
  });

  assert.equal(key, "base:op-42:0xshare");
});

test("normalizes failed marks with failed freshness and adapter_missing confidence", () => {
  const mark = normalizeProtocolPositionMark(
    {
      event: "position_mark_failed",
      observedAt: "2026-05-03T10:00:00.000Z",
      positionId: "merkl:base:op:tx",
      chain: "base",
      opportunityId: "op",
      failureKind: "rpc_call_failed",
      message: "convertToAssets reverted",
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.equal(mark.freshness, "failed");
  assert.equal(mark.confidence, "adapter_missing");
  assert.equal(mark.valueUsd, null);
  assert.equal(mark.valueBtc, null);
});

test("marks stale successful values as verified minimum and preserves string balances", () => {
  const mark = normalizeProtocolPositionMark(
    {
      observedAt: "2026-05-03T10:59:00.000Z",
      chain: "base",
      opportunityId: "op",
      shareTokenAddress: "0xshare",
      shareBalance: "123456789012345678901234567890",
      assetBalance: "987654321098765432109876543210",
      assetAmount: Number.POSITIVE_INFINITY,
      assetPriceUsd: 1,
      valueUsd: "15.5",
      btcPriceUsd: 0,
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.equal(mark.freshness, "expired");
  assert.equal(mark.confidence, "verified_minimum");
  assert.equal(mark.shareBalance, "123456789012345678901234567890");
  assert.equal(mark.assetBalance, "987654321098765432109876543210");
  assert.equal(mark.assetAmount, null);
  assert.equal(mark.valueUsd, 15.5);
  assert.equal(mark.valueBtc, null);
});

test("normalizes raw on-chain balance fields to strings when present", () => {
  const mark = normalizeProtocolPositionMark(
    {
      observedAt: "2026-05-03T12:00:00.000Z",
      chain: "base",
      opportunityId: "op",
      shareBalance: 12345678901234567890n,
      assetBalance: 5015801,
      debtBalance: "9000000000000000000",
      rewardBalance: 42n,
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.equal(mark.shareBalance, "12345678901234567890");
  assert.equal(mark.assetBalance, "5015801");
  assert.equal(mark.debtBalance, "9000000000000000000");
  assert.equal(mark.rewardBalance, "42");
});

test("does not create raw balance fields when values are absent", () => {
  const mark = normalizeProtocolPositionMark(
    {
      observedAt: "2026-05-03T12:00:00.000Z",
      chain: "base",
      opportunityId: "op",
      shareBalance: null,
      debtBalance: undefined,
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.equal(mark.shareBalance, null);
  assert.equal(Object.hasOwn(mark, "debtBalance"), false);
});

test("fails clearly future observedAt values instead of treating them as fresh", () => {
  const now = "2026-05-03T12:00:00.000Z";
  assert.equal(freshnessForObservedAt("2026-05-03T12:00:00.001Z", now), "failed");
  assert.equal(freshnessForObservedAt("2026-05-03T12:00:01.000Z", now), "failed");
  assert.equal(freshnessForObservedAt("2026-05-03T12:05:00.000Z", now), "failed");
});

test("normalizes invalid now without throwing and marks successful input unverified", () => {
  assert.doesNotThrow(() =>
    normalizeProtocolPositionMark(
      {
        observedAt: "2026-05-03T12:00:00.000Z",
        chain: "base",
        opportunityId: "op",
        valueUsd: 1,
      },
      { now: "bad-now" },
    ),
  );

  const mark = normalizeProtocolPositionMark(
    {
      observedAt: "2026-05-03T12:00:00.000Z",
      chain: "base",
      opportunityId: "op",
      valueUsd: 1,
    },
    { now: "bad-now" },
  );

  assert.equal(mark.freshness, "failed");
  assert.equal(mark.confidence, "adapter_missing");
});

test("uses adapter_missing confidence for successful marks with invalid observedAt", () => {
  const mark = normalizeProtocolPositionMark(
    {
      observedAt: "not-a-date",
      chain: "base",
      opportunityId: "op",
      valueUsd: 1,
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.equal(mark.freshness, "failed");
  assert.equal(mark.confidence, "adapter_missing");
});

test("unpriced valuationKind forces assetPriceUsd and valueUsd to null", () => {
  const mark = normalizeProtocolPositionMark(
    {
      event: "position_marked",
      observedAt: "2026-05-03T12:00:00.000Z",
      chain: "base",
      opportunityId: "pendle-direct:8453:0xmarket",
      assetSymbol: "YT",
      assetAmount: 349.24,
      // A defective writer may still pass a number here (e.g. full underlying
      // BTC price). The schema must drop it when the mark is marked unpriced.
      assetPriceUsd: 77053,
      valuationKind: "unpriced",
      valuationProvenance: "unpriced_per_share_price_unavailable",
      btcPriceUsd: 77053,
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.equal(mark.assetPriceUsd, null);
  assert.equal(mark.valueUsd, null);
  assert.equal(mark.valueBtc, null);
  assert.equal(mark.confidence, "unpriced_observation");
  assert.equal(mark.valuationProvenance, "unpriced_per_share_price_unavailable");
});

test("proxy valuationKind forces assetPriceUsd and valueUsd to null", () => {
  const mark = normalizeProtocolPositionMark(
    {
      event: "position_marked",
      observedAt: "2026-05-03T12:00:00.000Z",
      chain: "base",
      opportunityId: "op",
      assetAmount: 1.5,
      assetPriceUsd: 42,
      valuationKind: "proxy",
      valuationProvenance: "proxy_family_correlated",
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.equal(mark.assetPriceUsd, null);
  assert.equal(mark.valueUsd, null);
  assert.equal(mark.valuationKind, "proxy");
  assert.equal(mark.confidence, "unpriced_observation");
});

test("priced valuationKind preserves assetPriceUsd and computes valueUsd", () => {
  const mark = normalizeProtocolPositionMark(
    {
      event: "position_marked",
      observedAt: "2026-05-03T12:00:00.000Z",
      chain: "base",
      opportunityId: "op",
      assetSymbol: "USDC",
      assetAmount: 5.015801,
      assetPriceUsd: 1,
      btcPriceUsd: 103000,
      valuationKind: "priced",
      valuationProvenance: "current_position_onchain",
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.equal(mark.assetPriceUsd, 1);
  assert.equal(mark.valueUsd, 5.015801);
  assert.equal(mark.confidence, "verified_current");
  assert.equal(mark.valuationProvenance, "current_position_onchain");
});

test("normalizes underlyingAssetPriceUsd as a numeric field for downstream EV producers", () => {
  const mark = normalizeProtocolPositionMark(
    {
      event: "position_marked",
      observedAt: "2026-05-03T12:00:00.000Z",
      chain: "base",
      opportunityId: "op",
      assetSymbol: "YT",
      assetAmount: 0.5,
      valuationKind: "unpriced",
      valuationProvenance: "unpriced_per_share_price_unavailable",
      underlyingAssetSymbol: "cbBTC",
      underlyingAssetPriceUsd: "77000",
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.equal(mark.underlyingAssetPriceUsd, 77000);
  assert.equal(mark.underlyingAssetSymbol, "cbBTC");
  assert.equal(mark.valueUsd, null);
});

test("normalizes unknown bigint fields into JSON-safe strings", () => {
  const mark = normalizeProtocolPositionMark(
    {
      observedAt: "2026-05-03T12:00:00.000Z",
      chain: "base",
      opportunityId: "op",
      blockNumber: 123n,
      nested: { raw: 456n },
    },
    { now: "2026-05-03T12:00:00.000Z" },
  );

  assert.doesNotThrow(() => JSON.stringify(mark));
  assert.equal(mark.blockNumber, "123");
  assert.deepEqual(mark.nested, { raw: "456" });
  assert.match(JSON.stringify(mark), /"blockNumber":"123"/);
  assert.match(JSON.stringify(mark), /"raw":"456"/);
});
