import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProductAnalyticsTracker,
  normalizeProductAnalyticsConfig,
  validateProductAnalyticsEvent,
} from "../src/analytics/product-analytics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

test("product analytics defaults to disabled dry-run without external delivery", async () => {
  const deliveries = [];
  const tracker = createProductAnalyticsTracker({
    config: normalizeProductAnalyticsConfig({}),
    now: () => "2026-05-13T00:00:00.000Z",
    transport: async (event) => deliveries.push(event),
  });

  const result = await tracker.track("dashboard_view", {
    surface: "dashboard",
    view: "flow",
    releaseChannel: "local",
  });

  assert.equal(result.status, "dry_run");
  assert.equal(result.vendor, "posthog");
  assert.equal(deliveries.length, 0);
  assert.deepEqual(tracker.events(), [
    {
      eventName: "dashboard_view",
      vendor: "posthog",
      mode: "dry_run",
      observedAt: "2026-05-13T00:00:00.000Z",
      properties: {
        surface: "dashboard",
        view: "flow",
        releaseChannel: "local",
      },
    },
  ]);
});

test("product analytics sends only when explicitly enabled with PostHog env config", async () => {
  const deliveries = [];
  const tracker = createProductAnalyticsTracker({
    config: normalizeProductAnalyticsConfig({
      BOB_CLAW_ANALYTICS_ENABLED: "true",
      BOB_CLAW_POSTHOG_PROJECT_KEY: "ph_project_key_from_env",
      BOB_CLAW_POSTHOG_API_HOST: "https://posthog.example",
    }),
    now: () => "2026-05-13T00:00:00.000Z",
    transport: async (event) => deliveries.push(event),
  });

  const result = await tracker.track("dashboard_tab_changed", {
    surface: "dashboard",
    view: "defi",
    interaction: "tab_click",
  });

  assert.equal(result.status, "sent");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].apiHost, "https://posthog.example");
  assert.equal(deliveries[0].projectKey, "ph_project_key_from_env");
  assert.equal(deliveries[0].event.eventName, "dashboard_tab_changed");
});

test("product analytics rejects sensitive and high-cardinality properties", () => {
  const blocked = validateProductAnalyticsEvent("dashboard_interaction", {
    surface: "dashboard",
    interaction: "expand_history",
    walletAddress: "0x0000000000000000000000000000000000000000",
    txHash: "0x1234",
    rawError: "RPC failed with private token",
    rawCommandOutput: "node src/cli/run-live --secret",
    rawFilePath: "/Users/love/.bob-claw/key",
  });

  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.errors, [
    "blocked_sensitive_property:rawCommandOutput",
    "blocked_sensitive_property:rawError",
    "blocked_sensitive_property:rawFilePath",
    "blocked_sensitive_property:txHash",
    "blocked_sensitive_property:walletAddress",
  ]);
});

test("dashboard public source wires privacy-safe product analytics before app startup", () => {
  const indexHtml = readFileSync(join(ROOT, "dashboard/public/index.html"), "utf8");
  const appSource = readFileSync(join(ROOT, "dashboard/public/app.jsx"), "utf8");
  const analyticsSource = readFileSync(join(ROOT, "dashboard/public/analytics.jsx"), "utf8");

  assert.match(indexHtml, /\.\/analytics\.js/);
  assert.ok(
    indexHtml.indexOf("./analytics.js") < indexHtml.indexOf("./app.js"),
    "analytics helper must load before app.js",
  );
  assert.match(analyticsSource, /PostHog/i);
  assert.match(analyticsSource, /blockedSensitivePropertyNames/);
  assert.match(appSource, /trackProductAnalytics\(\s*["']dashboard_view["']/);
  assert.match(appSource, /trackProductAnalytics\(\s*["']dashboard_tab_changed["']/);
});
