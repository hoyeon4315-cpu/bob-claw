#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { createSentryErrorTracker, ERROR_TRACKING_ENV_VARS } from "../observability/error-tracking.mjs";

export async function runErrorTrackingCheck({ env = process.env } = {}) {
  const tracker = await createSentryErrorTracker({
    component: "check-error-tracking",
    env: {
      ...env,
      BOB_CLAW_ERROR_TRACKING_ENABLED: "0",
    },
  });
  const preview = tracker.captureException(new Error("error tracking smoke check"), {
    context: {
      sourceMaps: "dry_run_verified_by_check_error_tracking_sourcemaps",
      userAddress: "0x000000000000000000000000000000000000dEaD",
    },
    tags: {
      component: "check-error-tracking",
    },
  });
  await tracker.flush();
  return {
    envVars: ERROR_TRACKING_ENV_VARS,
    preview,
    status: tracker.status,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runErrorTrackingCheck()
    .then((result) => {
      console.log(
        `errorTracking=ok enabled=${result.status.enabled} reason=${result.status.reason} sent=${result.preview.sent}`,
      );
    })
    .catch((error) => {
      console.error(`errorTracking=error message=${JSON.stringify(error.message)}`);
      process.exitCode = 1;
    });
}
