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
