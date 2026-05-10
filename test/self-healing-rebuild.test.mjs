import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  featureEnabled,
  runSelfHealing,
} from "../src/executor/health/self-healing-rebuild.mjs";

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled(), true);
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ selfHealingRebuild: true }), true);
});

test("featureEnabled returns false when profile disables it", () => {
  assert.equal(featureEnabled({ selfHealingRebuild: false }), false);
});

test("present state → no rebuild", async () => {
  const result = await runSelfHealing({
    absenceState: "present",
    components: { heartbeatStale: true },
    now: 1_000_000,
  });
  assert.equal(result.rebuilt, false);
  assert.equal(result.reason, "state_not_absent");
  assert.equal(result.steps.length, 0);
});

test("absent state with all components triggers ordered rebuild steps", async () => {
  const result = await runSelfHealing({
    absenceState: "absent",
    components: {
      heartbeatStale: true,
      receiptIngestorLagMs: 700_000,
      dashboardStaleMs: 2_000_000,
    },
    now: 1_000_000,
  });
  assert.equal(result.rebuilt, true);
  assert.equal(result.dryRun, false);
  assert.equal(result.steps.length, 4);
  assert.equal(result.steps[0].step, "restart_signer_daemon");
  assert.equal(result.steps[1].step, "replay_audit_logs");
  assert.equal(result.steps[2].step, "rebuild_dashboard_slices");
  assert.equal(result.steps[3].step, "emit_alert");
  assert.equal(result.steps[0].executed, true);
  assert.equal(result.steps[1].executed, true);
  assert.equal(result.steps[2].executed, true);
  assert.equal(result.steps[3].executed, true);
});

test("absent state with only heartbeat stale triggers partial rebuild", async () => {
  const result = await runSelfHealing({
    absenceState: "absent",
    components: {
      heartbeatStale: true,
      receiptIngestorLagMs: 100_000,
      dashboardStaleMs: 100_000,
    },
    now: 1_000_000,
  });
  assert.equal(result.rebuilt, true);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].step, "restart_signer_daemon");
  assert.equal(result.steps[1].step, "emit_alert");
});

test("dry-run shows steps without executing or auditing", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-self-heal-dry-"));
  try {
    const auditPath = join(root, "self-healing-rebuild-audit.jsonl");
    const result = await runSelfHealing({
      absenceState: "absent",
      components: { heartbeatStale: true },
      now: 1_000_000,
      dryRun: true,
      auditPath,
    });
    assert.equal(result.rebuilt, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.steps[0].executed, false);

    // Audit file should not exist because dry-run skips writing
    let fileExists = false;
    try {
      await readFile(auditPath, "utf8");
      fileExists = true;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    assert.equal(fileExists, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rebuild appends audit log when not dry-run", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-self-heal-audit-"));
  try {
    const auditPath = join(root, "self-healing-rebuild-audit.jsonl");
    const result = await runSelfHealing({
      absenceState: "absent",
      components: { heartbeatStale: true },
      now: 1_000_000,
      dryRun: false,
      auditPath,
    });
    assert.equal(result.rebuilt, true);

    const written = await readFile(auditPath, "utf8");
    const parsed = JSON.parse(written.trim());
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.rebuilt, true);
    assert.equal(parsed.steps.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("feature off → no rebuild with reason feature_disabled", async () => {
  const result = await runSelfHealing({
    absenceState: "absent",
    components: { heartbeatStale: true },
    now: 1_000_000,
    profile: { selfHealingRebuild: false },
  });
  assert.equal(result.rebuilt, false);
  assert.equal(result.reason, "feature_disabled");
  assert.equal(result.steps.length, 0);
});

test("idempotent: same inputs produce same step set", async () => {
  const args = {
    absenceState: "absent",
    components: { heartbeatStale: true, receiptIngestorLagMs: 700_000 },
    now: 1_000_000,
  };
  const r1 = await runSelfHealing(args);
  const r2 = await runSelfHealing(args);
  assert.deepEqual(r1.steps.map((s) => s.step), r2.steps.map((s) => s.step));
});
