import assert from "node:assert/strict";
import test from "node:test";

import {
  SCALE_BANDS,
  effectiveBudgetUsd,
  operatingCapitalScaleBand,
} from "../src/config/operating-capital-scale.mjs";

test("operating capital scale bands preserve the $1000 baseline", () => {
  assert.deepEqual(
    SCALE_BANDS.map((band) => [band.maxCapitalUsd, band.bandId, band.multiplier]),
    [
      [500, "tiny", 0.6],
      [1000, "small", 1.0],
      [5000, "moderate", 2.0],
      [25000, "operating", 4.0],
      [null, "scaling", 8.0],
    ],
  );

  assert.equal(operatingCapitalScaleBand(500).bandId, "tiny");
  assert.equal(operatingCapitalScaleBand(500.01).bandId, "small");
  assert.equal(operatingCapitalScaleBand(1000).bandId, "small");
  assert.equal(operatingCapitalScaleBand(1000.01).bandId, "moderate");
});

test("effectiveBudgetUsd applies the committed capital multiplier", () => {
  assert.equal(effectiveBudgetUsd(10, 358), 6);
  assert.equal(effectiveBudgetUsd(125, 358), 75);
  assert.equal(effectiveBudgetUsd(125, 1000), 125);
  assert.equal(effectiveBudgetUsd(125, 5000), 250);
  assert.equal(effectiveBudgetUsd(125, 25000), 500);
  assert.equal(effectiveBudgetUsd(125, 25000.01), 1000);
});

test("capital scale multipliers are monotonic across band edges", () => {
  const sampleCapitalUsd = [0, 1, 500, 500.01, 1000, 1000.01, 5000, 5000.01, 25000, 25000.01];
  let previous = 0;
  for (const capitalUsd of sampleCapitalUsd) {
    const current = effectiveBudgetUsd(100, capitalUsd);
    assert.ok(current >= previous, `${capitalUsd} regressed ${current} below ${previous}`);
    previous = current;
  }
});
