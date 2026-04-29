import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("report-campaign-aware-opportunities import has no CLI side effects", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `
      global.fetch = () => { throw new Error("fetch-called-during-import"); };
      await import("./src/cli/report-campaign-aware-opportunities.mjs");
      if (process.exitCode) process.exit(process.exitCode);
    `,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "");
  assert.equal(result.stderr.trim(), "");
});
