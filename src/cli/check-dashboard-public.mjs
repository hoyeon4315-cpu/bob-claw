#!/usr/bin/env node

import process from "node:process";
import { validateDashboardPublicSources } from "../dashboard/public-source-check.mjs";

function parseArgs(argv) {
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...parts] = item.slice(2).split("=");
        return [key, parts.join("=")];
      }),
  );
  return {
    publicDir: options["public-dir"] || "dashboard/public",
    json: argv.includes("--json"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await validateDashboardPublicSources({ publicDir: args.publicDir });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`dashboardPublic=${report.ok ? "ok" : "missing"} refs=${report.localReferences.length}`);
    if (report.missing.length > 0) {
      console.log(`missing=${report.missing.join(",")}`);
    }
    if (report.browserBabelUsage.length > 0) {
      console.log(`browserBabelUsage=${report.browserBabelUsage.join(",")}`);
    }
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
