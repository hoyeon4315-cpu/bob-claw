import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMerklActivePositions } from "../src/status/merkl-active-slice.mjs";

test("signer-derived active position candidates need a live mark for current value", () => {
  const slice = buildMerklActivePositions([
    {
      event: "position_opened",
      status: "open",
      positionId: "signer:base:pendle:op:pendle_market_swap:0xmarket",
      opportunityId: "op",
      chain: "base",
      protocolId: "pendle",
      amountUsd: 5,
      liveMarkRequired: true,
    },
  ]);

  assert.equal(slice.activeCount, 1);
  assert.equal(slice.items[0].capUsd, 5);
  assert.equal(slice.items[0].valueUsd, null);
  assert.equal(slice.items[0].markUsd, null);
});
