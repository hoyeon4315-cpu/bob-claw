import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateCoverage } from "../src/cli/report-portfolio-coverage.mjs";

test("track1 passes when every audit position present and labeled", () => {
  const r = evaluateCoverage({
    auditPositions: [{ positionId: "p1", valueUsd: 100 }],
    snapshotPositions: [{ positionId: "p1", valueUsd: 100, bindingKind: "k", protocolId: "x" }],
  });
  assert.equal(r.track1.pass, true);
  assert.equal(r.track2.pass, true);
});

test("track1 fails when audit position missing in snapshot", () => {
  const r = evaluateCoverage({
    auditPositions: [{ positionId: "p1", valueUsd: 100 }, { positionId: "p2", valueUsd: 50 }],
    snapshotPositions: [{ positionId: "p1", valueUsd: 100, bindingKind: "k", protocolId: "x" }],
  });
  assert.equal(r.track1.pass, false);
  assert.deepEqual(r.track1.missing, ["p2"]);
});

test("track1 fails on silent skip flag", () => {
  const r = evaluateCoverage({
    auditPositions: [{ positionId: "p1", valueUsd: 100 }],
    snapshotPositions: [{ positionId: "p1", valueUsd: 100, bindingKind: "k", protocolId: "x", silent: true }],
  });
  assert.equal(r.track1.pass, false);
  assert.equal(r.track1.silentSkips, 1);
});

test("track1 fails on unlabeled position", () => {
  const r = evaluateCoverage({
    auditPositions: [{ positionId: "p1", valueUsd: 100 }],
    snapshotPositions: [{ positionId: "p1", valueUsd: 100 }],
  });
  assert.equal(r.track1.pass, false);
  assert.equal(r.track1.unlabeled.length, 1);
});

test("track2 warns when value drifts beyond max($1, 0.5%)", () => {
  const r = evaluateCoverage({
    auditPositions: [{ positionId: "p1", valueUsd: 1000 }],
    snapshotPositions: [{ positionId: "p1", valueUsd: 1010, bindingKind: "k", protocolId: "x" }],
  });
  assert.equal(r.track1.pass, true);
  assert.equal(r.track2.pass, false);
  assert.equal(r.track2.outOfTolerance[0].diff, 10);
});

test("track2 stays within tolerance when drift small", () => {
  const r = evaluateCoverage({
    auditPositions: [{ positionId: "p1", valueUsd: 1000 }],
    snapshotPositions: [{ positionId: "p1", valueUsd: 1004, bindingKind: "k", protocolId: "x" }],
  });
  assert.equal(r.track2.pass, true);
});

test("requireTotals=true + missing totals fails track1 even with positions present", () => {
  const r = evaluateCoverage({
    auditPositions: [],
    snapshotPositions: [{ positionId: "p1", valueUsd: 100, bindingKind: "k", protocolId: "x" }],
    totals: null,
    requireTotals: true,
  });
  assert.equal(r.track1.pass, false);
  assert.equal(r.track1.protocolUsdViolation, true);
});

test("requireTotals=true + totals.protocolUsd<=0 with positions fails track1", () => {
  const r = evaluateCoverage({
    auditPositions: [],
    snapshotPositions: [{ positionId: "p1", valueUsd: 100, bindingKind: "k", protocolId: "x" }],
    totals: { tokenUsd: 50, protocolUsd: 0, totalUsd: 50 },
    requireTotals: true,
  });
  assert.equal(r.track1.pass, false);
  assert.equal(r.track1.protocolUsdViolation, true);
});

test("requireTotals=true + healthy totals passes track1", () => {
  const r = evaluateCoverage({
    auditPositions: [],
    snapshotPositions: [{ positionId: "p1", valueUsd: 100, bindingKind: "k", protocolId: "x" }],
    totals: { tokenUsd: 50, protocolUsd: 100, totalUsd: 150 },
    requireTotals: true,
  });
  assert.equal(r.track1.pass, true);
});

test("requireTotals=false (default) + missing totals does not violate", () => {
  const r = evaluateCoverage({
    auditPositions: [],
    snapshotPositions: [{ positionId: "p1", valueUsd: 100, bindingKind: "k", protocolId: "x" }],
    totals: null,
  });
  assert.equal(r.track1.pass, true);
  assert.equal(r.track1.protocolUsdViolation, false);
});
