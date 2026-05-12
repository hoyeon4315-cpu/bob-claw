import test from "node:test";
import assert from "node:assert/strict";

import {
  compareDuplicateCounts,
  normalizeJscpdDuplicates,
  readDuplicateBaseline,
} from "../scripts/check-duplicate-code.mjs";

test("normalizeJscpdDuplicates groups duplicate fragments by stable fingerprint", () => {
  const duplicates = normalizeJscpdDuplicates({
    duplicates: [
      {
        format: "javascript",
        lines: 14,
        fragment: "const threshold = parseFlag(argv, index);",
        firstFile: { name: "scripts/a.mjs" },
        secondFile: { name: "scripts/b.mjs" },
      },
      {
        format: "javascript",
        lines: 14,
        fragment: "const threshold = parseFlag(argv, index);",
        firstFile: { name: "scripts/b.mjs" },
        secondFile: { name: "scripts/a.mjs" },
      },
      {
        format: "javascript",
        lines: 8,
        fragment: "console.log('other');",
        firstFile: { name: "scripts/c.mjs" },
        secondFile: { name: "scripts/d.mjs" },
      },
    ],
  });

  assert.equal(duplicates.length, 2);
  assert.equal(duplicates[0].count, 2);
  assert.equal(duplicates[0].format, "javascript");
  assert.equal(duplicates[0].lines, 14);
  assert.deepEqual(duplicates[0].files, ["scripts/a.mjs", "scripts/b.mjs"]);
  assert.equal(duplicates[1].count, 1);
  assert.deepEqual(duplicates[1].files, ["scripts/c.mjs", "scripts/d.mjs"]);
});

test("readDuplicateBaseline returns sorted baseline duplicate entries", () => {
  const baseline = readDuplicateBaseline(
    JSON.stringify({
      duplicates: [
        {
          fingerprint: "b",
          count: 1,
          format: "javascript",
          lines: 10,
          files: ["scripts/b.mjs", "scripts/c.mjs"],
        },
        {
          fingerprint: "a",
          count: 2,
          format: "javascript",
          lines: 14,
          files: ["scripts/a.mjs", "scripts/b.mjs"],
        },
      ],
    }),
  );

  assert.deepEqual(
    baseline.map((entry) => ({ fingerprint: entry.fingerprint, count: entry.count })),
    [
      { fingerprint: "a", count: 2 },
      { fingerprint: "b", count: 1 },
    ],
  );
});

test("compareDuplicateCounts distinguishes new, resolved, unchanged, and count regressions", () => {
  const comparison = compareDuplicateCounts({
    baselineEntries: [
      { fingerprint: "a", count: 2 },
      { fingerprint: "b", count: 1 },
      { fingerprint: "c", count: 3 },
    ],
    currentEntries: [
      { fingerprint: "a", count: 2 },
      { fingerprint: "b", count: 4 },
      { fingerprint: "d", count: 1 },
    ],
  });

  assert.deepEqual(
    comparison.newEntries.map((entry) => ({ fingerprint: entry.fingerprint, count: entry.count })),
    [{ fingerprint: "d", count: 1 }],
  );
  assert.deepEqual(
    comparison.resolvedEntries.map((entry) => ({ fingerprint: entry.fingerprint, count: entry.count })),
    [{ fingerprint: "c", count: 3 }],
  );
  assert.deepEqual(
    comparison.countRegressions.map((entry) => ({
      fingerprint: entry.fingerprint,
      baselineCount: entry.baselineCount,
      currentCount: entry.currentCount,
    })),
    [{ fingerprint: "b", baselineCount: 1, currentCount: 4 }],
  );
  assert.deepEqual(
    comparison.unchangedEntries.map((entry) => ({ fingerprint: entry.fingerprint, count: entry.count })),
    [{ fingerprint: "a", count: 2 }],
  );
});
