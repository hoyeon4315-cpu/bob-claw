import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveOperationalAddress } from "../src/config/operational-address.mjs";

async function writeJsonl(baseDir, name, records) {
  await mkdir(baseDir, { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(join(baseDir, `${name}.jsonl`), body ? `${body}\n` : "", "utf8");
}

test("operational address falls back to latest treasury inventory when env default is stale", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-operational-address-"));
  const dataDir = join(cwd, "data");
  await writeJsonl(dataDir, "treasury-inventory", [
    {
      observedAt: "2026-05-02T22:23:10.650Z",
      address: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      native: [],
      tokens: [],
      summary: {
        estimatedWalletUsd: 0,
      },
    },
  ]);

  const resolved = await resolveOperationalAddress({
    configuredAddress: "0x000000000000000000000000000000000000dEaD",
    dataDir,
  });

  assert.equal(resolved.address.toLowerCase(), "0x96262be63aa687563789225c2fe898c27a3b0ae4");
  assert.equal(resolved.source, "latest_treasury_inventory");
  assert.equal(resolved.audit.issues.includes("configured_address_stale_vs_resolved_cycle_address"), true);
});
