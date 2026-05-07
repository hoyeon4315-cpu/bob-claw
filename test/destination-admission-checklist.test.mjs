import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDestinationAdmissionChecklist } from "../src/strategy/destination-admission-checklist.mjs";

test("destination admission checklist counts missing fields across templates", () => {
  const venueTemplate = {
    chains: [
      {
        chain: "base",
        templates: [
          {
            category: "yield",
            defaults: {
              allowlistDecision: null,
              grossReturnBps: null,
              depositFeeBps: null,
              withdrawFeeBps: null,
              unwindSlippageBps: null,
              withdrawalDelayHours: null,
              minPositionUsd: null,
              sourceName: null,
              sourceType: null,
              lastVerifiedAt: null,
            },
          },
          {
            category: "platform",
            defaults: {
              allowlistDecision: "pending",
              sourceName: "Gateway docs",
              sourceType: null,
              lastVerifiedAt: null,
            },
          },
        ],
      },
    ],
  };

  const overrides = {
    entries: [
      {
        templateId: undefined,
      },
      {
        templateId: "base:platform_example",
        values: {
          allowlistDecision: "pending_review",
        },
      },
    ],
  };

  const report = buildDestinationAdmissionChecklist({ venueTemplate, overrides });

  assert.equal(report.summary.templateCount, 2);
  assert.equal(report.summary.readyForPolicyReviewCount, 0);
  assert.equal(report.summary.incompleteCount, 2);
  assert.equal(report.summary.topMissingFields[0].field, "lastVerifiedAt");
  assert.equal(report.summary.topMissingFields[0].count, 2);
  assert.equal(report.chains[0].templates[0].admission.missingFields.includes("grossReturnBps"), true);
});

test("destination admission checklist merges override values before counting missing fields", () => {
  const venueTemplate = {
    chains: [
      {
        chain: "base",
        templates: [
          {
            templateId: "base:custom_destination_actions",
            category: "platform",
            defaults: {
              allowlistDecision: null,
              sourceName: null,
              sourceType: null,
              lastVerifiedAt: null,
            },
          },
        ],
      },
    ],
  };

  const overrides = {
    entries: [
      {
        templateId: "base:custom_destination_actions",
        values: {
          sourceName: "BOB Gateway Overview",
          sourceType: "official_docs",
          lastVerifiedAt: "2026-04-14",
        },
      },
    ],
  };

  const report = buildDestinationAdmissionChecklist({ venueTemplate, overrides });
  assert.deepEqual(report.chains[0].templates[0].admission.missingFields, ["allowlistDecision"]);
});
