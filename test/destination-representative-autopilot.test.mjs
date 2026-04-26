import assert from "node:assert/strict";
import { test } from "node:test";
import { failedRepresentativeTemplates } from "../src/executor/destination-representative-autopilot.mjs";

test("failedRepresentativeTemplates expires stale failures after cooldown", () => {
  const failed = failedRepresentativeTemplates(
    [
      {
        observedAt: "2026-04-25T00:00:00.000Z",
        blockedReason: "destination_representative_execution_error",
        plan: { templateId: "avalanche:stablecoin_lending_carry" },
      },
      {
        observedAt: "2026-04-26T11:30:00.000Z",
        blockedReason: "destination_representative_execution_error",
        plan: { templateId: "optimism:stablecoin_lending_carry" },
      },
    ],
    {
      now: "2026-04-26T15:30:00.000Z",
      cooldownMs: 12 * 60 * 60 * 1000,
    },
  );

  assert.equal(failed.has("avalanche:stablecoin_lending_carry"), false);
  assert.equal(failed.has("optimism:stablecoin_lending_carry"), true);
});

test("failedRepresentativeTemplates clears failure once a later delivery exists", () => {
  const failed = failedRepresentativeTemplates(
    [
      {
        observedAt: "2026-04-26T08:00:00.000Z",
        blockedReason: "destination_representative_execution_error",
        plan: { templateId: "sei:stablecoin_lending_carry" },
      },
      {
        observedAt: "2026-04-26T10:00:00.000Z",
        status: "delivered",
        summary: {
          selected: { templateId: "sei:stablecoin_lending_carry" },
          proofStatus: "delivered",
        },
      },
    ],
    {
      now: "2026-04-26T15:30:00.000Z",
      cooldownMs: 12 * 60 * 60 * 1000,
    },
  );

  assert.equal(failed.has("sei:stablecoin_lending_carry"), false);
});
