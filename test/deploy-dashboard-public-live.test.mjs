import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeHasFreshPublicUrl } from "../src/cli/deploy-dashboard-public-live.mjs";

test("public live deploy waits for a fresh ready runtime with Pages origin sync", () => {
  const minStartedAtMs = Date.parse("2026-05-01T11:00:00.000Z");
  const staleRuntime = {
    startedAt: "2026-05-01T10:59:59.000Z",
    publicUrl: "https://old.trycloudflare.com",
    tunnelStatus: "ready",
    pagesOriginSync: { succeeded: true },
  };
  const unsyncedRuntime = {
    startedAt: "2026-05-01T11:00:01.000Z",
    publicUrl: "https://new.trycloudflare.com",
    tunnelStatus: "ready",
    pagesOriginSync: { succeeded: false },
  };
  const freshRuntime = {
    startedAt: "2026-05-01T11:00:01.000Z",
    publicUrl: "https://new.trycloudflare.com",
    tunnelStatus: "ready",
    pagesOriginSync: { succeeded: true },
  };

  assert.equal(runtimeHasFreshPublicUrl(staleRuntime, { minStartedAtMs }), false);
  assert.equal(runtimeHasFreshPublicUrl(unsyncedRuntime, { minStartedAtMs }), false);
  assert.equal(runtimeHasFreshPublicUrl(freshRuntime, { minStartedAtMs }), true);
});
