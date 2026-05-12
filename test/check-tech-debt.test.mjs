import test from "node:test";
import assert from "node:assert/strict";

import {
  compareTechDebtMarkers,
  readTechDebtBaseline,
  scanTechDebtMarkersFromText,
} from "../scripts/check-tech-debt.mjs";

test("scanTechDebtMarkersFromText detects tracked and legacy debt markers", () => {
  const trackedTodo = "T" + "ODO(ISSUE-123): refactor this branch";
  const legacyTodo = "T" + "ODO: keep this as a baseline item";
  const trackedFixme = "F" + "IXME(owner): add coverage";
  const proseMention = "docs mention T" + "ODO values but do not use a marker";

  const markers = scanTechDebtMarkersFromText(
    [`const a = 1; // ${trackedTodo}`, `// ${legacyTodo}`, proseMention, `/* ${trackedFixme} */`].join("\n"),
    "src/example.mjs",
  );

  assert.equal(markers.length, 3);
  assert.deepEqual(
    markers.map((marker) => ({
      kind: marker.kind,
      trackingTag: marker.trackingTag,
      trackedFormat: marker.trackedFormat,
      line: marker.line,
    })),
    [
      { kind: "TODO", trackingTag: "ISSUE-123", trackedFormat: true, line: 1 },
      { kind: "TODO", trackingTag: null, trackedFormat: false, line: 2 },
      { kind: "FIXME", trackingTag: "owner", trackedFormat: true, line: 4 },
    ],
  );
});

test("readTechDebtBaseline returns sorted unique baseline entries", () => {
  const baseline = readTechDebtBaseline(
    JSON.stringify({
      issues: [
        { fingerprint: "b", path: "src/b.mjs", line: 12, kind: "TODO" },
        { fingerprint: "a", path: "src/a.mjs", line: 3, kind: "FIXME" },
        { fingerprint: "b", path: "src/b.mjs", line: 12, kind: "TODO" },
      ],
    }),
  );

  assert.deepEqual(
    baseline.map((entry) => ({ fingerprint: entry.fingerprint, path: entry.path, kind: entry.kind })),
    [
      { fingerprint: "a", path: "src/a.mjs", kind: "FIXME" },
      { fingerprint: "b", path: "src/b.mjs", kind: "TODO" },
    ],
  );
});

test("compareTechDebtMarkers distinguishes new, resolved, and unchanged markers", () => {
  const comparison = compareTechDebtMarkers({
    baselineEntries: [
      { fingerprint: "a", path: "src/a.mjs" },
      { fingerprint: "b", path: "src/b.mjs" },
    ],
    currentEntries: [
      { fingerprint: "b", path: "src/b.mjs" },
      { fingerprint: "c", path: "src/c.mjs" },
    ],
  });

  assert.deepEqual(
    comparison.newEntries.map((entry) => entry.fingerprint),
    ["c"],
  );
  assert.deepEqual(
    comparison.resolvedEntries.map((entry) => entry.fingerprint),
    ["a"],
  );
  assert.deepEqual(
    comparison.unchangedEntries.map((entry) => entry.fingerprint),
    ["b"],
  );
});
