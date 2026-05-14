import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runStrategyCatalogDispatcherCli } from "../src/cli/run-strategy-catalog-dispatcher.mjs";

function strategyFixture(overrides = {}) {
  return {
    id: "wrapped-btc-loop-base-moonwell",
    label: "Base Moonwell wrapped BTC loop",
    lane: "destination_btc_yield",
    status: "live_cap_validation",
    capabilityBucket: "wrapped_btc_loop",
    selectedMode: "dry_run",
    liveCapable: true,
    currentLiveEligible: false,
    reportingOnly: true,
    runtimeGateAuthority: "policy_engine_only",
    liveAdmissionBlockers: ["fresh_roundtrip_proof_recorded"],
    selectedCommands: [
      {
        command: "npm run report:wrapped-btc-loop-dry-run -- --json",
        script: "report:wrapped-btc-loop-dry-run",
      },
    ],
    ...overrides,
  };
}

test("dispatch-target --execute rejects strategies that are not ready for live broadcast", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-dispatch-readiness-"));
  const logsDir = join(root, "logs");
  let executed = false;

  const result = await runStrategyCatalogDispatcherCli(
    ["--target=wrapped-btc-loop-base-moonwell", "--execute", "--json"],
    {
      dataDir: join(root, "data"),
      logsDir,
      loadStrategyCatalogDispatchInputsImpl: async () => ({
        executionSurfaces: {
          summary: {},
          strategies: [strategyFixture()],
        },
        planningBridge: {
          authority: "none",
          candidateCount: 1,
          topCandidateId: "wrapped-btc-loop-base-moonwell",
        },
      }),
      runCommand: async () => {
        executed = true;
        throw new Error("execute command must not run when readiness blocks");
      },
      readExecutionGuardsImpl: async () => ({ blocked: false, reasons: [] }),
    },
  );

  assert.equal(result.exitCode, 2);
  assert.equal(executed, false);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "execute_blocked_by_readiness");
  assert.equal(payload.blockers.length, 1);
  assert.equal(payload.blockers[0].strategyId, "wrapped-btc-loop-base-moonwell");
  assert.equal(payload.blockers[0].selectedMode, "dry_run");
  assert.deepEqual(payload.blockers[0].policyBlockers, []);
  assert.equal(payload.blockers[0].adviceCode, "fresh_roundtrip_proof_recorded");
  assert.match(payload.nextActionGuide.command, /preflight:broadcast/);

  const auditLines = (await readFile(join(logsDir, "operator-action-audit.jsonl"), "utf8")).trim().split("\n");
  assert.equal(auditLines.length, 1);
  const audit = JSON.parse(auditLines[0]);
  assert.equal(audit.action, "broadcast_blocked_at_cli");
  assert.equal(audit.reason, "execute_blocked_by_readiness");
  assert.equal(audit.strategyId, "wrapped-btc-loop-base-moonwell");
});

test("dispatch-target --execute rejects immediately when the kill-switch guard is active", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-dispatch-kill-switch-"));
  const logsDir = join(root, "logs");
  let loadedInputs = false;

  const result = await runStrategyCatalogDispatcherCli(
    ["--target=wrapped-btc-loop-base-moonwell", "--execute", "--json"],
    {
      dataDir: join(root, "data"),
      logsDir,
      loadStrategyCatalogDispatchInputsImpl: async () => {
        loadedInputs = true;
        throw new Error("inputs must not load when kill-switch blocks immediately");
      },
      readExecutionGuardsImpl: async () => ({
        blocked: true,
        reasons: ["kill_switch_active"],
        killSwitchActive: true,
      }),
    },
  );

  assert.equal(result.exitCode, 2);
  assert.equal(loadedInputs, false);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "execute_blocked_by_kill_switch");
  assert.deepEqual(payload.blockers, [
    {
      strategyId: "wrapped-btc-loop-base-moonwell",
      policyBlockers: ["kill_switch_active"],
      adviceCode: null,
      selectedMode: null,
    },
  ]);

  const auditLines = (await readFile(join(logsDir, "operator-action-audit.jsonl"), "utf8")).trim().split("\n");
  assert.equal(auditLines.length, 1);
  const audit = JSON.parse(auditLines[0]);
  assert.equal(audit.action, "broadcast_blocked_at_cli");
  assert.equal(audit.reason, "execute_blocked_by_kill_switch");
});

test("dispatch-target --execute rejects when the explicit target selects no strategy", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-dispatch-empty-target-"));
  const logsDir = join(root, "logs");
  let executed = false;

  const result = await runStrategyCatalogDispatcherCli(["--target=missing-strategy", "--execute", "--json"], {
    dataDir: join(root, "data"),
    logsDir,
    loadStrategyCatalogDispatchInputsImpl: async () => ({
      executionSurfaces: {
        summary: {},
        strategies: [strategyFixture({ id: "other-strategy" })],
      },
      planningBridge: null,
    }),
    runCommand: async () => {
      executed = true;
    },
    readExecutionGuardsImpl: async () => ({ blocked: false, reasons: [] }),
  });

  assert.equal(result.exitCode, 2);
  assert.equal(executed, false);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "execute_blocked_by_empty_selection");
  assert.deepEqual(payload.blockers, [
    {
      strategyId: "missing-strategy",
      policyBlockers: ["target_not_selected"],
      adviceCode: null,
      selectedMode: null,
    },
  ]);
});
