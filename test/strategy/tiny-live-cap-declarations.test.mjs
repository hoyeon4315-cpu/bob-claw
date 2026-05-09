import assert from "node:assert/strict";
import test from "node:test";

import { getStrategyCaps, resolveStrategyCapMatrix } from "../../src/config/strategy-caps.mjs";

const NEW_TINY_LIVE_CAPS = Object.freeze({
  eth_destination_deployment: 5,
  tokenized_reserve_sleeve: 25,
});

test("new Merkl-mapped tiny live caps resolve through strategy lookup", () => {
  for (const [strategyId, expectedTinyCapUsd] of Object.entries(NEW_TINY_LIVE_CAPS)) {
    const config = getStrategyCaps(strategyId);
    assert.ok(config, `${strategyId} must resolve committed strategy caps`);
    assert.equal(config.caps.tinyLivePerTxUsd, expectedTinyCapUsd);

    const resolved = resolveStrategyCapMatrix(config, { includeRadarCaps: true });
    assert.equal(resolved.tinyLivePerTxUsd, expectedTinyCapUsd);
    assert.ok(
      resolved.tinyLivePerTxUsd <= 30,
      `${strategyId} tiny live cap must stay within the $30 radar canary boundary`,
    );
  }
});
