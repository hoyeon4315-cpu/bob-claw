import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildIdleConsolidationSlice,
  buildIdleConsolidationSliceFromAudit,
} from "../src/status/idle-consolidation-slice.mjs";

const NOW = "2026-05-08T12:00:00.000Z";

function plannedRecord({
  timestamp,
  runId,
  chain,
  estimatedUsd,
} = {}) {
  return {
    schemaVersion: 1,
    timestamp,
    strategyId: "gateway-btc-funding-transfer",
    chain,
    amountUsd: estimatedUsd,
    policyVerdict: "planned",
    lifecycle: {
      stage: "idle_consolidation_planned",
      autopilotRunId: runId,
      candidate: {
        srcChain: chain,
        dstChain: "base",
        srcSym: "wBTC.OFT",
        estimatedUsd,
      },
    },
  };
}

test("idle consolidation slice counts trailing 7d plans and latest plan totals", () => {
  const slice = buildIdleConsolidationSlice({
    now: NOW,
    auditRecords: [
      plannedRecord({
        timestamp: "2026-05-01T11:59:59.000Z",
        runId: "old",
        chain: "sonic",
        estimatedUsd: 9,
      }),
      plannedRecord({
        timestamp: "2026-05-08T10:00:00.000Z",
        runId: "run-1",
        chain: "avalanche",
        estimatedUsd: 7,
      }),
      plannedRecord({
        timestamp: "2026-05-08T10:00:00.000Z",
        runId: "run-1",
        chain: "bsc",
        estimatedUsd: 7,
      }),
      plannedRecord({
        timestamp: "2026-05-08T11:00:00.000Z",
        runId: "run-2",
        chain: "sei",
        estimatedUsd: 5.5,
      }),
    ],
  });

  assert.equal(slice.status, "planned_recent");
  assert.equal(slice.plannedCount7d, 3);
  assert.equal(slice.aggregateUsd7d, 19.5);
  assert.equal(slice.lastPlannedAt, "2026-05-08T11:00:00.000Z");
  assert.equal(slice.lastPlanCandidateCount, 1);
  assert.equal(slice.lastPlanAggregateUsd, 5.5);
  assert.deepEqual(slice.lastPlanChains, ["sei"]);
});

test("idle consolidation slice returns stable empty shape for empty audit", () => {
  const slice = buildIdleConsolidationSlice({
    now: NOW,
    auditRecords: [],
  });

  assert.equal(slice.status, "no_recent_plan");
  assert.equal(slice.plannedCount7d, 0);
  assert.equal(slice.aggregateUsd7d, 0);
  assert.equal(slice.lastPlannedAt, null);
  assert.equal(slice.lastPlanCandidateCount, 0);
  assert.equal(slice.killSwitchBlockedCount7d, 0);
});

test("idle consolidation slice reports kill-switch blocked window without counting it as a plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-idle-slice-"));
  try {
    await mkdir(join(root, "logs"), { recursive: true });
    const rows = [
      {
        schemaVersion: 1,
        timestamp: "2026-05-08T09:00:00.000Z",
        strategyId: "gateway-btc-funding-transfer",
        chain: "bsc",
        amountUsd: 7,
        policyVerdict: "rejected",
        lifecycle: {
          stage: "rejected",
          blockers: ["kill_switch_present"],
        },
      },
      plannedRecord({
        timestamp: "2026-04-30T12:00:00.000Z",
        runId: "old",
        chain: "bsc",
        estimatedUsd: 7,
      }),
    ];
    await writeFile(join(root, "logs", "signer-audit.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");

    const slice = await buildIdleConsolidationSliceFromAudit({ rootDir: root, now: NOW });

    assert.equal(slice.status, "blocked_by_kill_switch_recently");
    assert.equal(slice.plannedCount7d, 0);
    assert.equal(slice.killSwitchBlockedCount7d, 1);
    assert.equal(slice.lastKillSwitchBlockedAt, "2026-05-08T09:00:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
