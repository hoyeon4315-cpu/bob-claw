import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../src/cli/run-dashboard-public-live.mjs";

test("public live dashboard does not periodically republish Pages by default", () => {
  const parsed = parseArgs([], {});
  assert.equal(parsed.syncPagesOrigin, true);
  assert.equal(parsed.pagesRepublishMs, 0);
});

test("public live dashboard accepts explicit periodic Pages republish override", () => {
  assert.equal(parseArgs(["--pages-republish-ms=120000"], {}).pagesRepublishMs, 120000);
  assert.equal(parseArgs([], { BOB_CLAW_DASHBOARD_PAGES_REPUBLISH_MS: "60000" }).pagesRepublishMs, 60000);
  assert.equal(parseArgs(["--no-sync-pages-origin"], {}).syncPagesOrigin, false);
});
