import assert from "node:assert/strict";
import { test } from "node:test";
import { REPO_ROOT, repoPath } from "./helpers/repo-root.mjs";

test("seed destination input overrides script seeds top missing templates without duplicates", async () => {
  const { readFile, mkdtemp, mkdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  const execFileAsync = promisify(execFile);
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-seed-"));
  const dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });

  const workbenchPath = join(dataDir, "destination-input-workbench.json");
  const overridesPath = join(dataDir, "destination-input-overrides.json");

  const workbench = {
    workItems: [
      {
        templateId: "base:stablecoin_lending_carry",
        chain: "base",
        familyId: "stablecoin_lending_carry",
        label: "Stablecoin lending carry",
        missingFields: ["allowlistDecision", "grossReturnBps"],
      },
      {
        templateId: "bsc:wrapped_btc_destination_yield",
        chain: "bsc",
        familyId: "wrapped_btc_destination_yield",
        label: "Wrapped BTC destination yield allocation",
        missingFields: ["allowlistDecision"],
      },
    ],
  };

  const overrides = {
    schemaVersion: 1,
    entries: [
      {
        templateId: "base:stablecoin_lending_carry",
        values: {},
      },
    ],
  };

  await import("node:fs/promises").then(({ writeFile }) =>
    Promise.all([
      writeFile(workbenchPath, `${JSON.stringify(workbench, null, 2)}\n`),
      writeFile(overridesPath, `${JSON.stringify(overrides, null, 2)}\n`),
    ]),
  );

  await execFileAsync(
    "node",
    [repoPath("src/cli/seed-destination-input-overrides.mjs"), "--top=5", "--write"],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BOB_CLAW_DATA_DIR: dataDir,
      },
    },
  );

  const seeded = JSON.parse(await readFile(overridesPath, "utf8"));
  assert.equal(seeded.entries.length, 2);
  assert.equal(seeded.entries[1].templateId, "bsc:wrapped_btc_destination_yield");
});
