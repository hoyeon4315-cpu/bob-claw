import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readJsonl } from "../src/lib/jsonl-read.mjs";

test("readJsonl returns an empty array for missing files", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-jsonl-read-missing-"));
  assert.deepEqual(await readJsonl(dataDir, "missing"), []);
});

test("readJsonl streams newline-delimited records without requiring a final newline", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bob-claw-jsonl-read-"));
  await writeFile(
    join(dataDir, "records.jsonl"),
    [
      JSON.stringify({ observedAt: "2026-05-08T00:00:00.000Z", value: 1 }),
      JSON.stringify({ observedAt: "2026-05-08T00:01:00.000Z", value: 2 }),
    ].join("\n"),
    "utf8",
  );

  assert.deepEqual(await readJsonl(dataDir, "records"), [
    { observedAt: "2026-05-08T00:00:00.000Z", value: 1 },
    { observedAt: "2026-05-08T00:01:00.000Z", value: 2 },
  ]);
});
