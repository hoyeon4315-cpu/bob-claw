import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildInventoryConsistencyAudit,
  resolveShadowCycleContext,
} from "../src/session/shadow-cycle-context.mjs";

test("shadow cycle context prefers latest treasury inventory address over stale configured default", async () => {
  const context = await resolveShadowCycleContext({
    dataDir: "./data",
    configuredAddress: "0x08709e61584016d36fade4da9667b374d7b9b776",
    readJsonlImpl: async (_dataDir, name) => {
      if (name === "treasury-inventory") {
        return [
          {
            observedAt: "2026-04-11T02:03:25.161Z",
            address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
            native: [],
            tokens: [],
            summary: { estimatedWalletUsd: 25 },
          },
        ];
      }
      if (name === "estimator-wallet-readiness") {
        return [
          {
            observedAt: "2026-04-11T01:05:48.911Z",
            address: "0x08709e61584016d36fade4da9667b374d7b9b776",
          },
          {
            observedAt: "2026-04-11T01:47:13.591Z",
            address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
          },
        ];
      }
      if (name === "estimator-wallet-readiness-failures") {
        return [];
      }
      return [];
    },
  });

  assert.equal(context.address, "0x96262be63aa687563789225c2fe898c27a3b0ae4");
  assert.equal(context.addressSource, "latest_treasury_inventory");
  assert.equal(context.addressAudit.issues.includes("configured_address_stale_vs_resolved_cycle_address"), true);
  assert.equal(context.inventorySnapshot.address, "0x96262be63aa687563789225c2fe898c27a3b0ae4");
});

test("shadow cycle context respects an explicit address override", async () => {
  const context = await resolveShadowCycleContext({
    dataDir: "./data",
    explicitAddress: "0x1111111111111111111111111111111111111111",
    configuredAddress: "0x08709e61584016d36fade4da9667b374d7b9b776",
    readJsonlImpl: async (_dataDir, name) => {
      if (name === "treasury-inventory") {
        return [
          {
            observedAt: "2026-04-11T02:03:25.161Z",
            address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
            native: [],
            tokens: [],
            summary: { estimatedWalletUsd: 25 },
          },
        ];
      }
      return [];
    },
  });

  assert.equal(context.address, "0x1111111111111111111111111111111111111111");
  assert.equal(context.addressSource, "explicit_argument");
  assert.equal(context.inventorySnapshot, null);
  assert.equal(context.addressAudit.issues.includes("explicit_address_differs_from_latest_inventory"), true);
});

test("inventory consistency audit recomputes wallet value from holdings", () => {
  const audit = buildInventoryConsistencyAudit({
    expectedAddress: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    source: "stored_snapshot",
    inventory: {
      observedAt: "2026-04-11T02:03:25.161Z",
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      native: [{ estimatedUsd: 11.07 }],
      tokens: [{ estimatedUsd: 12.08 }],
      summary: { estimatedWalletUsd: 23.16 },
    },
  });

  assert.equal(audit.consistent, false);
  assert.equal(audit.issues.includes("inventory_summary_value_mismatch"), true);
  assert.equal(audit.recomputedEstimatedWalletUsd, 23.15);
  assert.equal(Math.abs(audit.differenceUsd - 0.01) < 1e-9, true);
});
