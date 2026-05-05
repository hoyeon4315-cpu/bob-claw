import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAssetUniverse, assetUniverseTokenTargets } from "../src/treasury/asset-universe.mjs";

test("asset universe derives token targets from receipts, signer intents, inbound events, and protocol marks", () => {
  const universe = buildAssetUniverse({
    chains: ["base", "ethereum"],
    receiptReconciliations: [{
      observedAt: "2026-05-05T09:00:00.000Z",
      txHash: "0xreceipt",
      routeContext: {
        routeKey: "base:0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf->ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      },
      output: {
        asset: {
          chain: "ethereum",
          token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
          ticker: "WBTC",
          decimals: 8,
          family: "wrapped_btc",
        },
      },
    }],
    signerAuditRecords: [{
      timestamp: "2026-05-05T09:01:00.000Z",
      chain: "base",
      intentId: "intent-1",
      intent: {
        metadata: {
          inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          outputToken: "0x1234567890123456789012345678901234567890",
        },
      },
    }],
    inboundEvents: [{
      observedAt: "2026-05-05T09:02:00.000Z",
      chain: "base",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      ticker: "USDC",
    }],
    protocolPositionMarks: [{
      event: "position_marked",
      confidence: "verified_current",
      observedAt: "2026-05-05T09:03:00.000Z",
      chain: "base",
      positionId: "pos-1",
      protocolId: "yo",
      shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      assetSymbol: "yoUSD",
      assetDecimals: 6,
    }],
    generatedAt: "2026-05-05T09:04:00.000Z",
  });

  assert.equal(universe.status, "needs_review");
  assert.equal(universe.targets.some((target) => target.chain === "base" && target.symbol === "USDC" && target.registered), true);
  assert.equal(universe.targets.some((target) => target.chain === "base" && target.token === "0x0000000f2eb9f69274678c76222b35eec7588a65" && target.trackingStatus === "protocol_reader_covered"), true);
  assert.equal(universe.unknownTargets.some((target) => target.token === "0x1234567890123456789012345678901234567890"), true);
  assert.equal(assetUniverseTokenTargets(universe).some((target) => target.token === "0x1234567890123456789012345678901234567890"), true);
});

test("asset universe is closed when all discovered targets are registry or fresh protocol-reader covered", () => {
  const universe = buildAssetUniverse({
    chains: ["base"],
    signerAuditRecords: [{
      chain: "base",
      intent: {
        metadata: {
          inputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          outputToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        },
      },
    }],
    protocolPositionMarks: [{
      event: "position_marked",
      confidence: "verified_current",
      chain: "base",
      shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      assetSymbol: "yoUSD",
      assetDecimals: 6,
    }],
  });

  assert.equal(universe.status, "closed");
  assert.equal(universe.unknownTargetCount, 0);
});
