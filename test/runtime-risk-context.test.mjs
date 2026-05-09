import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadRuntimeRiskContext } from "../src/executor/runtime/risk-context.mjs";

test("runtime risk context derives both signer and opportunity allocation shapes from open positions", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-risk-context-"));
  try {
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "data", "merkl-portfolio-positions.jsonl"),
      [
        JSON.stringify({
          event: "position_opened",
          status: "open",
          strategyId: "gateway_native_asset_conversion_sleeve",
          opportunityId: "base-yo-usdc",
          chain: "base",
          protocolId: "yo",
          amountUsd: 60,
        }),
        JSON.stringify({
          event: "position_opened",
          status: "open",
          strategyId: "eth_destination_deployment",
          opportunityId: "bsc-venus-usdc",
          chain: "bsc",
          protocolId: "venus",
          amountUsd: 40,
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const context = await loadRuntimeRiskContext({
      rootDir: root,
      activeBudgetUsd: 200,
      now: "2026-05-08T00:00:00.000Z",
    });

    assert.equal(context.totalOperatingCapitalUsd, 200);
    assert.equal(context.currentAllocations.perChain.base, 0.3);
    assert.equal(context.currentAllocations.perProtocol.venus, 0.2);
    assert.equal(context.currentAllocations.chainSharePct.base, 0.3);
    assert.equal(context.currentAllocations.protocolSharePct.yo, 0.3);
    assert.equal(context.currentAllocations.opportunitySharePct["bsc-venus-usdc"], 0.2);
    assert.equal(context.source.positionRecordCount, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime risk context leaves assetCoverage null when wallet holdings snapshot is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-risk-context-"));
  try {
    await mkdir(join(root, "data"), { recursive: true });
    const context = await loadRuntimeRiskContext({
      rootDir: root,
      now: "2026-05-09T00:00:00.000Z",
    });

    assert.equal(context.assetCoverage, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime risk context derives closed assetCoverage envelope from wallet assetUniverse", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-risk-context-"));
  try {
    await mkdir(join(root, "dashboard", "public"), { recursive: true });
    await writeFile(
      join(root, "dashboard", "public", "wallet-holdings.json"),
      JSON.stringify({
        observedAt: "2026-05-09T00:01:00.000Z",
        assetUniverse: {
          status: "closed",
          unknownTargetCount: 0,
          unknownTargets: [],
        },
        unknownAssetBalanceCount: 0,
        unknownAssetBalances: [],
      }),
      "utf8",
    );

    const context = await loadRuntimeRiskContext({
      rootDir: root,
      now: "2026-05-09T00:02:00.000Z",
    });

    assert.equal(context.assetCoverage.status, "closed");
    assert.equal(context.assetCoverage.ok, true);
    assert.equal(context.assetCoverage.unknownAssetBalanceCount, 0);
    assert.equal(context.assetCoverage.unknownTargetCount, 0);
    assert.deepEqual(context.assetCoverage.gaps, []);
    assert.equal(context.assetCoverage.sourceObservedAt, "2026-05-09T00:01:00.000Z");
    assert.equal(context.assetCoverage.sourcePath, "dashboard/public/wallet-holdings.json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime risk context marks needs_review assetCoverage with unknown balances as not ok", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-risk-context-"));
  try {
    await mkdir(join(root, "dashboard", "public"), { recursive: true });
    await writeFile(
      join(root, "dashboard", "public", "wallet-holdings.json"),
      JSON.stringify({
        sourceObservedAt: "2026-05-09T00:01:00.000Z",
        assetUniverse: {
          status: "needs_review",
          unknownTargetCount: 1,
          unknownTargets: [{ chain: "base", token: "0xunknown" }],
        },
        unknownAssetBalanceCount: 1,
        unknownAssetBalances: [{ chain: "base", token: "0xunknown", actual: "1" }],
      }),
      "utf8",
    );

    const context = await loadRuntimeRiskContext({
      rootDir: root,
      now: "2026-05-09T00:02:00.000Z",
    });

    assert.equal(context.assetCoverage.status, "needs_review");
    assert.equal(context.assetCoverage.ok, false);
    assert.equal(context.assetCoverage.unknownAssetBalanceCount, 1);
    assert.equal(context.assetCoverage.unknownTargetCount, 1);
    assert.equal(context.assetCoverage.gaps.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
