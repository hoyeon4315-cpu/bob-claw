import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const FILES = [
  "src/config/small-capital-campaign-mode.mjs",
  "src/status/sleeve-profile-slice.mjs",
];

test("operating capital does not silently default to 1_000", async () => {
  for (const path of FILES) {
    const text = await readFile(path, "utf8");
    const matches = text.match(/operatingCapitalUsd[^a-zA-Z0-9_][^,;\n]*1_000/g) || [];
    assert.deepEqual(
      matches,
      [],
      `unexpected 1_000 default in ${path}: ${matches.join(", ")}`,
    );
  }
});
