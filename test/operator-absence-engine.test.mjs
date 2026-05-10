import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  evaluateOperatorAbsence,
  featureEnabled,
  logAbsenceTransition,
} from "../src/executor/health/operator-absence-engine.mjs";

test("featureEnabled returns true by default", () => {
  assert.equal(featureEnabled(), true);
  assert.equal(featureEnabled({}), true);
  assert.equal(featureEnabled({ operatorAbsenceEngine: true }), true);
});

test("featureEnabled returns false when profile disables it", () => {
  assert.equal(featureEnabled({ operatorAbsenceEngine: false }), false);
});

test("metrics fresh → present", () => {
  const now = 1_000_000;
  const result = evaluateOperatorAbsence({
    metrics: {
      heartbeatAt: now - 60_000,
      lastHarvestAt: now - 3_600_000,
      lastPaybackAt: now - 86_400_000,
      lastSignerAuditAt: now - 60_000,
    },
    policy: {},
    now,
  });
  assert.equal(result.state, "present");
  assert.equal(result.stale.heartbeat, false);
  assert.equal(result.stale.harvest, false);
  assert.equal(result.stale.payback, false);
  assert.equal(result.stale.signerAudit, false);
});

test("heartbeat stale only → degraded", () => {
  const now = 1_000_000;
  const result = evaluateOperatorAbsence({
    metrics: {
      heartbeatAt: now - 400_000,
      lastHarvestAt: now - 3_600_000,
      lastPaybackAt: now - 86_400_000,
      lastSignerAuditAt: now - 60_000,
    },
    policy: {},
    now,
  });
  assert.equal(result.state, "degraded");
  assert.equal(result.stale.heartbeat, true);
  assert.equal(result.stale.harvest, false);
  assert.equal(result.stale.payback, false);
  assert.equal(result.stale.signerAudit, false);
});

test("all stale → absent", () => {
  const now = 1_000_000;
  const result = evaluateOperatorAbsence({
    metrics: {
      heartbeatAt: now - 400_000,
      lastHarvestAt: now - 90_000_000,
      lastPaybackAt: now - 700_000_000,
      lastSignerAuditAt: now - 400_000,
    },
    policy: {},
    now,
  });
  assert.equal(result.state, "absent");
  assert.equal(result.stale.heartbeat, true);
  assert.equal(result.stale.harvest, true);
  assert.equal(result.stale.payback, true);
  assert.equal(result.stale.signerAudit, true);
});

test("custom thresholds from policy override defaults", () => {
  const now = 1_000_000;
  const result = evaluateOperatorAbsence({
    metrics: {
      heartbeatAt: now - 400_000,
      lastHarvestAt: now - 3_600_000,
      lastPaybackAt: now - 86_400_000,
      lastSignerAuditAt: now - 60_000,
    },
    policy: { heartbeatStaleMs: 500_000 },
    now,
  });
  assert.equal(result.state, "present");
  assert.equal(result.thresholds.heartbeatStaleMs, 500_000);
});

test("missing metrics treated as Infinity (stale)", () => {
  const now = 1_000_000;
  const result = evaluateOperatorAbsence({
    metrics: {},
    policy: {},
    now,
  });
  assert.equal(result.state, "absent");
  assert.equal(result.ages.heartbeatAgeMs, Infinity);
});

test("logAbsenceTransition appends JSONL record", async () => {
  const root = await mkdtemp(join(tmpdir(), "bob-claw-absence-audit-"));
  try {
    const auditPath = join(root, "operator-absence-audit.jsonl");
    await logAbsenceTransition({
      previousState: "present",
      currentState: "degraded",
      details: { reason: "heartbeat_stale" },
      auditPath,
      now: "2026-05-10T00:00:00.000Z",
    });
    const written = await readFile(auditPath, "utf8");
    const parsed = JSON.parse(written.trim());
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.previousState, "present");
    assert.equal(parsed.currentState, "degraded");
    assert.equal(parsed.details.reason, "heartbeat_stale");
    assert.equal(parsed.timestamp, "2026-05-10T00:00:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("feature off → present with reason feature_disabled", () => {
  const result = evaluateOperatorAbsence({
    metrics: {},
    policy: {},
    now: 1_000_000,
    profile: { operatorAbsenceEngine: false },
  });
  assert.equal(result.state, "present");
  assert.equal(result.reason, "feature_disabled");
});
