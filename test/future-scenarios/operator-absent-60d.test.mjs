import assert from "node:assert/strict";
import { test } from "node:test";
import {
  K_for_capital,
  canarySizeForCapital,
  reservePctForCapital,
} from "../../src/config/portfolio-rotator.mjs";

test("operator absence does not create manual gates or runtime cap mutation", () => {
  const capitalUsd = 500;
  const k = K_for_capital(capitalUsd);
  const reservePct = reservePctForCapital(capitalUsd);
  const canary = canarySizeForCapital(capitalUsd, "aggressive_calibrated");

  assert.equal(k, 2);
  assert.equal(reservePct > 0.15, true);
  assert.equal(canary > 0, true);
  assert.equal(canary <= 30, true);
});
