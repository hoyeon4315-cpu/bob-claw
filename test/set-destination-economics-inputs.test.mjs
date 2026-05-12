import assert from "node:assert/strict";
import { test } from "node:test";
import { REPO_ROOT, repoPath } from "./helpers/repo-root.mjs";

test("set destination economics inputs writes numeric fields into overrides", async () => {
  const { readFile, mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  const execFileAsync = promisify(execFile);
  const tempDir = await mkdtemp(join(tmpdir(), "bob-claw-econ-set-"));
  const dataDir = join(tempDir, "data");
  await mkdir(dataDir, { recursive: true });

  const overridesPath = join(dataDir, "destination-input-overrides.json");
  await writeFile(
    overridesPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        entries: [
          {
            templateId: "base:stablecoin_lending_carry",
            status: "partially_seeded",
            values: {},
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  await execFileAsync(
    "node",
    [
      repoPath("src/cli/set-destination-economics-inputs.mjs"),
      "--template-id=base:stablecoin_lending_carry",
      '--set-json={"grossReturnBps":120,"depositFeeBps":10,"withdrawFeeBps":10,"unwindSlippageBps":20}',
      "--write",
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        BOB_CLAW_DATA_DIR: dataDir,
      },
    },
  );

  const updated = JSON.parse(await readFile(overridesPath, "utf8"));
  assert.equal(updated.entries[0].values.grossReturnBps, 120);
  assert.equal(updated.entries[0].values.unwindSlippageBps, 20);
});
