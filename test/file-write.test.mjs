import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeTextIfChanged } from "../src/lib/file-write.mjs";

test("writeTextIfChanged writes new content and skips identical rewrites", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-write-if-changed-"));
  const path = join(dir, "status.txt");

  const first = await writeTextIfChanged(path, "hello\n");
  const second = await writeTextIfChanged(path, "hello\n");
  const third = await writeTextIfChanged(path, "world\n");

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(third.changed, true);
  assert.equal(await readFile(path, "utf8"), "world\n");
});

test("writeTextIfChanged can skip rewrites after normalization", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bob-claw-write-normalized-"));
  const path = join(dir, "status.txt");

  const first = await writeTextIfChanged(path, "Updated: 2026-04-11T07:00:00.000Z\nsame\n", {
    normalize: (value) => String(value || "").replace(/^Updated: .*\n/m, "Updated: <volatile>\n"),
  });
  const second = await writeTextIfChanged(path, "Updated: 2026-04-11T07:05:00.000Z\nsame\n", {
    normalize: (value) => String(value || "").replace(/^Updated: .*\n/m, "Updated: <volatile>\n"),
  });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
});
