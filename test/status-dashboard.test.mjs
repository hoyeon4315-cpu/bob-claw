import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function writeJsonl(baseDir, name, records) {
  await mkdir(baseDir, { recursive: true });
  const path = join(baseDir, `${name}.jsonl`);
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

test("status dashboard refreshes shadow cycle before writing public status", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "bob-claw-status-"));
  const dataDir = join(cwd, "data");
  await mkdir(join(cwd, "dashboard", "public"), { recursive: true });

  await writeJsonl(dataDir, "treasury-inventory", [
    {
      observedAt: "2026-04-11T02:03:25.161Z",
      address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
      supportedChains: ["bob"],
      activeChains: ["bob"],
      native: [],
      tokens: [],
      allowances: [],
      summary: {
        estimatedWalletUsd: 25.01,
      },
    },
  ]);

  const result = spawnSync(process.execPath, [join(ROOT, "src/cli/status-dashboard.mjs")], {
    cwd,
    env: {
      ...process.env,
      BOB_CLAW_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const shadowCycle = JSON.parse(await readFile(join(dataDir, "shadow-cycle-latest.json"), "utf8"));
  const publicStatus = JSON.parse(await readFile(join(cwd, "dashboard/public/dashboard-status.json"), "utf8"));

  assert.equal(typeof shadowCycle.mode, "string");
  assert.equal(publicStatus.dataCounts.shadowCyclePresent, 1);
  assert.equal(publicStatus.shadowCycle.mode, shadowCycle.mode);
  if (publicStatus.canaryInputs) {
    assert.equal(typeof publicStatus.canaryInputs.routeLabel, "string");
    assert.equal(typeof publicStatus.canaryInputs.gatewayQuote?.state, "string");
    assert.equal(typeof publicStatus.canaryInputs.exactGas?.state, "string");
    assert.equal(Array.isArray(publicStatus.canaryInputs.blockers), true);
  } else {
    assert.equal(publicStatus.canaryInputs, null);
  }
  assert.equal(typeof publicStatus.watchers?.canaryInputs?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.canaryInputs?.reasonLabel, "string");
  assert.equal(Array.isArray(publicStatus.watchers?.canaryInputs?.inputLabels), true);
  assert.equal(typeof publicStatus.watchers?.gasRefresh?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.gasRefresh?.reasonLabel, "string");
  assert.equal(typeof publicStatus.watchers?.dexRefresh?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.dexRefresh?.reasonLabel, "string");
  assert.equal(typeof publicStatus.watchers?.dexRefresh?.targetRouteCount, "number");
  assert.equal(Array.isArray(publicStatus.watchers?.dexRefresh?.targetRoutes), true);
  assert.equal(typeof publicStatus.watchers?.blockedScore?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.blockedScore?.scope, "string");
  assert.equal(typeof publicStatus.watchers?.blockedScore?.targetRouteCount, "number");
  assert.equal(Array.isArray(publicStatus.watchers?.blockedScore?.targetRoutes), true);
  assert.equal(Array.isArray(publicStatus.watchers?.blockedScore?.changedInputLabels), true);
  assert.equal(typeof publicStatus.watchers?.quoteDecay?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.quoteDecay?.reasonLabel, "string");
  assert.equal(typeof publicStatus.watchers?.dexEnvironment?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.dexEnvironment?.reasonLabel, "string");
  assert.equal(typeof publicStatus.watchers?.dexEnvironment?.targetRouteCount, "number");
  assert.equal(Array.isArray(publicStatus.watchers?.dexEnvironment?.targetRoutes), true);
  assert.equal(typeof publicStatus.watchers?.gatewayCoverage?.shouldRefresh, "boolean");
  assert.equal(typeof publicStatus.watchers?.gatewayCoverage?.reasonLabel, "string");
  assert.equal(typeof publicStatus.watchers?.gatewayCoverage?.targetRouteCount, "number");
  assert.equal(Array.isArray(publicStatus.watchers?.gatewayCoverage?.targetRoutes), true);
  assert.equal(Array.isArray(publicStatus.gateway?.btcWatchlist?.observedTickers), true);
  assert.equal(Array.isArray(publicStatus.gateway?.btcWatchlist?.missingTickers), true);
  assert.equal(typeof publicStatus.gateway?.btcWatchlist?.unknownAssetCount, "number");
  assert.equal(
    publicStatus.strategy?.canarySelectionGap == null || typeof publicStatus.strategy?.canarySelectionGap?.selectionCode === "string",
    true,
  );
  assert.equal(
    publicStatus.strategy?.canarySelectionGap == null ||
      Array.isArray(publicStatus.strategy?.canarySelectionGap?.reviewPlan?.actionLabels),
    true,
  );
});
