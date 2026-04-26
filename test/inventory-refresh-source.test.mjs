import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INVENTORY_TREASURY = readFileSync(join(HERE, "..", "src", "cli", "inventory-treasury.mjs"), "utf8");
const DEPLOY_DASHBOARD = readFileSync(join(HERE, "..", "src", "cli", "deploy-dashboard-cloudflare.mjs"), "utf8");

test("inventory treasury refresh uses stored snapshot fallback on partial RPC failure", () => {
  assert.match(INVENTORY_TREASURY, /import \{ resolveShadowCycleContext \} from "\.\.\/session\/shadow-cycle-context\.mjs";/);
  assert.match(INVENTORY_TREASURY, /const context = await resolveShadowCycleContext\(/);
  assert.match(INVENTORY_TREASURY, /continueOnError: Boolean\(context\.inventorySnapshot\)/);
  assert.match(INVENTORY_TREASURY, /fallbackInventory: context\.inventorySnapshot/);
  assert.match(INVENTORY_TREASURY, /inventorySource=\$\{inventory\.scanErrors\?\.length \? "live_scan_with_fallback" : "live_scan"\}/);
});

test("dashboard deploy refreshes treasury inventory before rebuilding status", () => {
  assert.match(DEPLOY_DASHBOARD, /await runCommand\("node", \["src\/cli\/inventory-treasury\.mjs"\], commandEnv\);/);
  assert.match(DEPLOY_DASHBOARD, /await runCommand\("node", \["src\/cli\/inventory-whole-wallet\.mjs"\], commandEnv\);/);
  assert.match(DEPLOY_DASHBOARD, /await runCommand\("node", \["src\/cli\/status-dashboard\.mjs"\], commandEnv\);/);
});
