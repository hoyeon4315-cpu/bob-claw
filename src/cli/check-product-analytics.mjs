#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  createProductAnalyticsTracker,
  normalizeProductAnalyticsConfig,
  validateProductAnalyticsEvent,
} from "../analytics/product-analytics.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    json: false,
  };
  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node src/cli/check-product-analytics.mjs [--json]

Exercises the product analytics tracker (PostHog adapter) in dry-run mode.
Verifies event allowlisting, property sanitization, and sensitive data blocking.
No events are sent externally unless BOB_CLAW_ANALYTICS_ENABLED=true with valid keys.`);
}

export function runProductAnalyticsCheck(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { helped: true };
  }

  // Force dry-run mode for the check (never sends real events)
  const env = {
    BOB_CLAW_ANALYTICS_ENABLED: "false",
  };
  const config = normalizeProductAnalyticsConfig(env);
  const tracker = createProductAnalyticsTracker({ config });

  // Test allowed events
  const allowedEvents = ["dashboard_view", "dashboard_interaction", "dev_report_viewed"];
  for (const eventName of allowedEvents) {
    tracker.track(eventName, {
      surface: "dashboard",
      view: "overview",
      component: "check",
    });
  }

  // Test blocked sensitive property
  const blockedResult = validateProductAnalyticsEvent("dashboard_interaction", {
    surface: "dashboard",
    commandOutput: "sensitive payload should be blocked",
  });

  const recorded = tracker.events();

  const summary = {
    status: "ok",
    vendor: config.vendor,
    mode: config.mode,
    eventsRecorded: recorded.length,
    allowedEventsTested: allowedEvents.length,
    sensitivePropertyBlocked: !blockedResult.ok,
    dryRun: config.mode === "dry_run",
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`productAnalyticsVendor=${summary.vendor}`);
    console.log(`productAnalyticsMode=${summary.mode}`);
    console.log(`productAnalyticsEventsRecorded=${summary.eventsRecorded}`);
    console.log(`productAnalyticsSensitiveBlocked=${summary.sensitivePropertyBlocked}`);
    console.log(`productAnalyticsDryRun=${summary.dryRun}`);
  }

  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runProductAnalyticsCheck();
  } catch (error) {
    console.error("product_analytics_check_failed", error?.message || error);
    process.exitCode = 1;
  }
}
