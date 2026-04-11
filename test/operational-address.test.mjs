import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveOperationalAddress } from "../src/config/operational-address.mjs";

test("operational address falls back to latest treasury inventory when env default is stale", async () => {
  const originalDataDir = process.env.BOB_CLAW_DATA_DIR;
  const originalEstimateFrom = process.env.BOB_CLAW_ESTIMATE_FROM;

  process.env.BOB_CLAW_DATA_DIR = "./data";
  process.env.BOB_CLAW_ESTIMATE_FROM = "0x000000000000000000000000000000000000dEaD";

  try {
    const resolved = await resolveOperationalAddress({
      configuredAddress: process.env.BOB_CLAW_ESTIMATE_FROM,
      dataDir: process.env.BOB_CLAW_DATA_DIR,
    });

    assert.equal(resolved.address, "0x96262be63aa687563789225c2fe898c27a3b0ae4");
    assert.equal(resolved.source, "latest_treasury_inventory");
    assert.equal(resolved.audit.issues.includes("configured_address_stale_vs_resolved_cycle_address"), true);
  } finally {
    if (originalDataDir === undefined) delete process.env.BOB_CLAW_DATA_DIR;
    else process.env.BOB_CLAW_DATA_DIR = originalDataDir;
    if (originalEstimateFrom === undefined) delete process.env.BOB_CLAW_ESTIMATE_FROM;
    else process.env.BOB_CLAW_ESTIMATE_FROM = originalEstimateFrom;
  }
});
