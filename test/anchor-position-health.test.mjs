import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { PROTOCOL_READERS } from "../src/executor/health/position-reconciler.mjs";
import { collectAnchorPositionHealth } from "../src/cli/report-anchor-position-health.mjs";

describe("anchor-position-health", () => {
  let originalAerodromeReader = null;

  before(() => {
    originalAerodromeReader = PROTOCOL_READERS.aerodrome;
  });

  after(() => {
    PROTOCOL_READERS.aerodrome = originalAerodromeReader;
  });

  it("reports no active Aerodrome positions when none exist", async () => {
    PROTOCOL_READERS.aerodrome = async () => [];

    const report = await collectAnchorPositionHealth({
      address: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    });

    assert.equal(report.status, "no_positions");
    assert.equal(report.message, "No active Aerodrome CL positions detected.");
    assert.equal(report.positions.length, 0);
  });

  it("reports expected fields for active Aerodrome positions", async () => {
    PROTOCOL_READERS.aerodrome = async () => [
      {
        protocol: "aerodrome",
        chain: "base",
        tokenId: "123",
        token0: "0x4200000000000000000000000000000000000006",
        token1: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        fee: 500,
        tickLower: -100000,
        tickUpper: 100000,
        liquidity: "1000000000000",
        tokensOwed0: "5000000000000000",
        tokensOwed1: "100000",
      },
    ];

    const report = await collectAnchorPositionHealth({
      address: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      tokenIds: [123],
    });

    assert.equal(report.status, "active");
    assert.equal(report.positionCount, 1);
    assert.equal(report.positions.length, 1);

    const pos = report.positions[0];
    assert.equal(pos.tokenId, "123");
    assert.equal(pos.token0, "0x4200000000000000000000000000000000000006");
    assert.equal(pos.token1, "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf");
    assert.equal(pos.tickLower, -100000);
    assert.equal(pos.tickUpper, 100000);
    assert.equal(pos.liquidity, "1000000000000");
    assert.deepEqual(pos.unclaimedFees, {
      token0: "5000000000000000",
      token1: "100000",
    });
    assert.equal(pos.exitRoute, "remove liquidity -> swap to USDC via Aerodrome router");
    assert.ok("estimatedIlPct" in pos);
    assert.ok("estimatedIlUsd" in pos);
    assert.ok("timeInRange" in pos);
    assert.ok("inRange" in pos);
  });

  it("reconciler aerodrome reader returns note when no tokenIds provided", async () => {
    PROTOCOL_READERS.aerodrome = originalAerodromeReader;
    const result = await PROTOCOL_READERS.aerodrome({
      chain: "base",
      signerAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      tokenIds: [],
    });
    assert.ok(result.positions);
    assert.equal(result.positions.length, 0);
    assert.ok(result.note.includes("not enumerable"));
  });
});
