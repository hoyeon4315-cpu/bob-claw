import assert from "node:assert/strict";
import { test } from "node:test";
import { runPreflightBroadcastCli } from "../src/cli/preflight-broadcast.mjs";

const TARGET = "wrapped-btc-loop-base-moonwell";

function commandResult(payload, extras = {}) {
  return {
    ok: true,
    exitCode: 0,
    signal: null,
    durationMs: 3,
    stdout: `${JSON.stringify(payload)}\n`,
    stderr: "",
    ...extras,
  };
}

function cleanDispatchPayload({ readyForLiveBroadcast = true } = {}) {
  return {
    record: {
      strategyResults: [
        {
          strategyId: TARGET,
          broadcastReadiness: {
            readyForPolicyDispatch: true,
            readyForLiveBroadcast,
            policyDispatchBlockers: [],
            selectedMode: readyForLiveBroadcast ? "live" : "dry_run",
            advisoryEvidence: {
              adviceCode: readyForLiveBroadcast ? null : "fresh_roundtrip_proof_recorded",
            },
          },
        },
      ],
    },
  };
}

function preflightRunner({ readyForLiveBroadcast = true } = {}) {
  const commands = [];
  return {
    commands,
    runCommandImpl: async ({ step, command, args }) => {
      commands.push([command, ...args].join(" "));
      if (step.id === "kill_status") return commandResult({ halted: false });
      if (step.id === "signer_health") {
        return commandResult({
          readiness: {
            readyForBroadcast: true,
            telemetryComplete: true,
            limitations: [],
          },
        });
      }
      if (step.id === "wallet_holdings") {
        return commandResult(
          {
            ok: true,
            pending: false,
            totalUsd: 360.98,
          },
          {
            walletPayload: {
              pending: false,
              totalUsd: 360.98,
              staleItemCount: 0,
              stalePriceItemCount: 0,
              assetMetadataCoverage: {
                freshnessCoveragePct: 1,
                divergenceWarnCount: 0,
                divergenceBlockCount: 0,
              },
            },
          },
        );
      }
      if (step.id === "payback_status") {
        return commandResult({
          policy: {
            minPaybackSats: 5000,
          },
          payback: {
            accumulatorPendingSats: 601,
            scheduler: {
              minimumPaybackProgress: {
                minPaybackSats: 5000,
                progressToMinimumRatio: 0.1202,
              },
            },
          },
        });
      }
      if (step.id === "dispatch_dry_run") return commandResult(cleanDispatchPayload({ readyForLiveBroadcast }));
      throw new Error(`unexpected step ${step.id}`);
    },
  };
}

test("preflight-broadcast returns preflight_clean when all broadcast prechecks pass", async () => {
  const runner = preflightRunner();
  const result = await runPreflightBroadcastCli([`--target=${TARGET}`, "--json"], {
    runCommandImpl: runner.runCommandImpl,
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "preflight_clean");
  assert.equal(payload.executeAllowed, true);
  assert.equal(payload.target, TARGET);
  assert.equal(payload.stages.length, 5);
  assert.ok(payload.nextActionGuide.command.includes("--execute"));
  assert.ok(runner.commands.some((command) => command.includes("npm run report:wallet-holdings -- --json")));
  assert.equal(payload.summary.payback.pendingSats, 601);
  assert.equal(payload.summary.payback.effectiveMinSats, 5000);
  assert.equal(payload.summary.wallet.totalUsd, 360.98);
});

test("preflight-broadcast blocks when dispatch dry-run is not live-broadcast ready", async () => {
  const runner = preflightRunner({ readyForLiveBroadcast: false });
  const result = await runPreflightBroadcastCli([`--target=${TARGET}`, "--json"], {
    runCommandImpl: runner.runCommandImpl,
    now: "2026-05-09T00:00:00.000Z",
  });

  assert.equal(result.exitCode, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "preflight_blocked");
  assert.equal(payload.executeAllowed, false);
  assert.equal(payload.blockers.length, 1);
  assert.equal(payload.blockers[0].stage, "dispatch_dry_run");
  assert.equal(payload.blockers[0].reason, "dispatch_not_ready_for_live_broadcast");
  assert.equal(payload.summary.dispatch.readyForPolicyDispatch, true);
  assert.equal(payload.summary.dispatch.readyForLiveBroadcast, false);
});
