import assert from "node:assert/strict";
import { test } from "node:test";
import { runMonitorFirstPaybackCycleCli } from "../src/cli/monitor-first-payback-cycle.mjs";

function paybackStatus({ pendingSats, effectiveMinSats = 5000, progress }) {
  return {
    policy: {
      minPaybackSats: effectiveMinSats,
    },
    payback: {
      accumulatorPendingSats: pendingSats,
      scheduler: {
        minimumPaybackProgress: {
          minPaybackSats: effectiveMinSats,
          progressToMinimumRatio: progress,
        },
      },
    },
    decision: {
      status: progress >= 1 ? "plan" : "carry",
      reason: progress >= 1 ? null : "planned_payback_below_minimum",
    },
  };
}

test("monitor-first-payback-cycle reports delivery candidate readiness without triggering payback", async () => {
  const commands = [];
  const samples = [
    paybackStatus({ pendingSats: 2400, progress: 0.48 }),
    paybackStatus({ pendingSats: 5100, progress: 1.02 }),
  ];

  const result = await runMonitorFirstPaybackCycleCli(["--interval-sec=0", "--max-ticks=2", "--json"], {
    sleepImpl: async () => {},
    runCommandImpl: async ({ command, args }) => {
      commands.push([command, ...args].join(" "));
      assert.doesNotMatch([command, ...args].join(" "), /payback-scheduler/);
      const payload = samples.shift();
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        durationMs: 2,
        stdout: `${JSON.stringify(payload)}\n`,
        stderr: "",
      };
    },
    now: () => "2026-05-09T00:00:00.000Z",
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "first_delivery_candidate_ready");
  assert.equal(payload.autoTriggeredPayback, false);
  assert.equal(payload.ticks.length, 2);
  assert.equal(payload.trajectory.deltaPendingSats, 2700);
  assert.match(payload.nextActionGuide.command, /executor:payback-scheduler:once/);
  assert.equal(commands.length, 2);
  assert.ok(commands.every((command) => command === "npm run report:payback-status -- --json"));
});
