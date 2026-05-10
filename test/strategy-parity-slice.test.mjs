import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStrategyParitySlice } from "../src/status/strategy-parity-slice.mjs";

test("strategy parity carries tick timing and allocation through to dashboard rows", () => {
  const slice = buildStrategyParitySlice({
    strategyTickStatus: {
      strategies: [
        {
          strategyId: "wrapped-btc-loop-base-moonwell",
          lastTickAt: "2026-04-24T20:34:49.307Z",
          lastTickMode: "live_candidate",
          lastTickBlockers: [],
          receiptCountTotal: 3,
          receiptCountSignerBacked: 2,
          scoredAllocation: {
            strategyId: "wrapped-btc-loop-base-moonwell",
            chain: "base",
            protocol: "moonwell",
            allocatedSats: 499999,
            score: 0.905,
          },
        },
      ],
      strategyStage: {
        byStrategy: {
          "wrapped-btc-loop-base-moonwell": {
            readinessVerdict: "live_ready",
            topBlocker: null,
          },
        },
      },
      microCanary: {
        byStrategy: {},
      },
    },
  });

  assert.equal(
    slice.byStrategy["wrapped-btc-loop-base-moonwell"].lastTickAt,
    "2026-04-24T20:34:49.307Z",
  );
  assert.deepEqual(
    slice.byStrategy["wrapped-btc-loop-base-moonwell"].scoredAllocation,
    {
      strategyId: "wrapped-btc-loop-base-moonwell",
      chain: "base",
      protocol: "moonwell",
      allocatedSats: 499999,
      score: 0.905,
    },
  );
  assert.equal(slice.byStrategy["wrapped-btc-loop-base-moonwell"].readinessVerdict, "live_ready");
});

test("strategy parity preserves non-Base generic candidate chain metadata", () => {
  const slice = buildStrategyParitySlice({
    deterministicCandidates: {
      candidates: [
        {
          id: "generic-unichain-vault",
          chain: "unichain",
          status: "dry_run_evidence_recorded",
          deterministicStatus: "planning_adapter_ready",
          protocolAdapterId: "erc4626_like",
          dryRunReceiptRecorded: true,
          blockers: [],
        },
      ],
    },
    researchBoard: [
      {
        id: "generic-sonic-carry",
        chain: "sonic",
        status: "research_backlog",
        evidence: {
          executionSupportStatus: "repo_auto_build_supported",
          dryRunReceiptRecorded: false,
        },
        blockers: ["cost_variance_unmeasured"],
      },
    ],
  });

  assert.deepEqual(slice.byStrategy["generic-unichain-vault"].chainSet, ["unichain"]);
  assert.deepEqual(slice.byStrategy["generic-sonic-carry"].chainSet, ["sonic"]);
});

test("strategy parity does not silently default generic missing chain metadata to Base", () => {
  const slice = buildStrategyParitySlice({
    deterministicCandidates: {
      candidates: [
        {
          id: "generic-chainless-vault",
          status: "dry_run_evidence_recorded",
          deterministicStatus: "planning_adapter_ready",
          protocolAdapterId: "erc4626_like",
          dryRunReceiptRecorded: true,
          blockers: [],
        },
      ],
    },
  });

  assert.deepEqual(slice.byStrategy["generic-chainless-vault"].chainSet, []);
  assert.equal(slice.byStrategy["generic-chainless-vault"].blockers.includes("chain_metadata_missing"), true);
});
