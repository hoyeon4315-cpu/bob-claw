import assert from "node:assert/strict";
import { test } from "node:test";
import { runPreflightBroadcastCli } from "../src/cli/preflight-broadcast.mjs";

test("preflight broadcast injects a default command timeout when none is provided", async () => {
  const seen = [];
  const payloadByStep = {
    kill_status: { halted: false },
    signer_health: { readiness: { readyForBroadcast: true, telemetryComplete: true, limitations: [] }, cause: null },
    wallet_inventory_refresh: {
      source: "live_rpc",
      totalUsd: 100,
      summary: {
        walletCoverage: "full_rpc",
        assetUniverseStatus: "closed",
        scanErrorCount: 0,
        unknownAssetBalanceCount: 0,
      },
    },
    wallet_holdings: {
      totalUsd: 100,
      pending: false,
      freshnessCoveragePct: 1,
      staleItemCount: 0,
      stalePriceItemCount: 0,
      divergenceWarnCount: 0,
      divergenceBlockCount: 0,
    },
    payback_status: {
      decision: { status: "carry", reason: "planned_payback_below_minimum" },
      payback: {
        accumulatorPendingSats: 594,
        scheduler: {
          minimumPaybackProgress: {
            progressToMinimumRatio: 0.1,
            minPaybackSats: 1000,
          },
        },
      },
      policy: { minPaybackSats: 1000 },
    },
    dispatch_dry_run: {
      record: {
        strategyResults: [
          {
            strategyId: "wrapped-btc-loop-base-moonwell",
            executionStatus: "preview",
            blockedReason: null,
            selectedMode: "live",
            broadcastReadiness: {
              readyForPolicyDispatch: true,
              readyForLiveBroadcast: true,
              policyDispatchBlockers: [],
              selectedMode: "live",
              advisoryEvidence: { adviceCode: null },
            },
          },
        ],
      },
    },
  };

  const result = await runPreflightBroadcastCli(["--target=wrapped-btc-loop-base-moonwell", "--json"], {
    runCommandImpl: async ({ step, timeoutMs }) => {
      seen.push({ id: step.id, timeoutMs });
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stdout: `${JSON.stringify(payloadByStep[step.id])}\n`,
        stderr: "",
      };
    },
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    seen.map((item) => item.timeoutMs),
    [120000, 120000, 120000, 120000, 120000, 120000],
  );
});

test("preflight broadcast surfaces wrapped-BTC cooldown timing from dispatch dry-run evidence", async () => {
  const nextEligibleAt = "2026-05-18T08:26:33.124Z";
  const payloadByStep = {
    kill_status: { halted: false },
    signer_health: { readiness: { readyForBroadcast: true, telemetryComplete: true, limitations: [] }, cause: null },
    wallet_inventory_refresh: {
      source: "live_scan",
      totalUsd: 100,
      summary: {
        walletCoverage: "full_rpc",
        assetUniverseStatus: "needs_review",
        scanErrorCount: 0,
        unknownAssetBalanceCount: 0,
      },
    },
    wallet_holdings: {
      totalUsd: 100,
      pending: false,
      freshnessCoveragePct: 1,
      staleItemCount: 0,
      stalePriceItemCount: 0,
      divergenceWarnCount: 0,
      divergenceBlockCount: 0,
    },
    payback_status: {
      decision: { status: "carry", reason: "planned_payback_below_minimum" },
      payback: { accumulatorPendingSats: 593 },
      policy: { minPaybackSats: 5000 },
    },
    dispatch_dry_run: {
      executionSurfaces: {
        strategies: [
          {
            id: "wrapped-btc-loop-base-moonwell",
            evidence: {
              liveRunControl: {
                blocked: true,
                reason: "recent_live_transaction_cooldown",
                nextEligibleAt,
                recentTxCount: 3,
              },
            },
          },
        ],
      },
      record: {
        strategyResults: [
          {
            strategyId: "wrapped-btc-loop-base-moonwell",
            executionStatus: "preview",
            blockedReason: null,
            selectedMode: "dry_run",
            broadcastReadiness: {
              readyForPolicyDispatch: true,
              readyForLiveBroadcast: false,
              policyDispatchBlockers: [],
              selectedMode: "dry_run",
              advisoryEvidence: {
                adviceCode: "recent_live_transaction_cooldown",
                currentLiveEligible: false,
                fallbackReason: "recent_live_transaction_cooldown",
                liveAdmissionBlockers: ["recent_live_transaction_cooldown"],
              },
            },
          },
        ],
      },
    },
  };

  const result = await runPreflightBroadcastCli(["--target=wrapped-btc-loop-base-moonwell", "--json"], {
    runCommandImpl: async ({ step, timeoutMs }) => ({
      ok: true,
      exitCode: 0,
      signal: null,
      durationMs: timeoutMs === 120000 ? 1 : 0,
      stdout: `${JSON.stringify(payloadByStep[step.id])}\n`,
      stderr: "",
    }),
  });

  assert.equal(result.exitCode, 2);
  assert.equal(result.payload.blockers[0].reason, "recent_live_transaction_cooldown");
  assert.equal(result.payload.blockers[0].adviceCode, "recent_live_transaction_cooldown");
  assert.equal(result.payload.blockers[0].nextEligibleAt, nextEligibleAt);
  assert.equal(result.payload.summary.dispatch.nextEligibleAt, nextEligibleAt);
  assert.equal(result.payload.summary.dispatch.liveAdmissionBlockers[0], "recent_live_transaction_cooldown");
});
