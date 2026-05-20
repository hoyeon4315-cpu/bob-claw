#!/usr/bin/env node

import { join, resolve } from "node:path";
import { config } from "../config/env.mjs";
import { operationalArtifactRetentionConfig } from "../config/operational-artifact-retention.mjs";
import { auditOperationalArtifacts } from "../lib/operational-artifact-retention.mjs";

function parseArgs(argv) {
  const flags = new Set(argv);
  const options = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );

  return {
    json: flags.has("--json"),
    archive: flags.has("--archive"),
    compact: flags.has("--compact"),
    dryRun: flags.has("--dry-run") ? true : undefined,
    dataDir: options["data-dir"] || config.dataDir,
    logsDir: options["logs-dir"] || "./logs",
    dashboardDir: options["dashboard-dir"] || "./dashboard/public",
    archiveDir:
      options["archive-dir"] || join(config.dataDir, ...operationalArtifactRetentionConfig.archiveDestinationSegments),
    manifestPath: options["manifest-path"],
    compactMinBytes: options["compact-min-bytes"] ? Number(options["compact-min-bytes"]) : undefined,
    retainLines: options["retain-lines"] ? Number(options["retain-lines"]) : undefined,
    compactPaths: options["compact-path"]
      ? options["compact-path"]
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined,
    top: options.top ? Number(options.top) : undefined,
  };
}

function bytesText(value) {
  if (!Number.isFinite(value)) return "n/a";
  if (value < 1024) return `${value}B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)}KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)}MB`;
  return `${(value / 1024 ** 3).toFixed(2)}GB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await auditOperationalArtifacts({
    dataDir: resolve(args.dataDir),
    logsDir: resolve(args.logsDir),
    dashboardDir: resolve(args.dashboardDir),
    archiveDir: resolve(args.archiveDir),
    archive: args.archive,
    compact: args.compact,
    dryRun: args.dryRun,
    manifestPath: args.manifestPath ? resolve(args.manifestPath) : undefined,
    compactCandidateMinBytes: args.compactMinBytes,
    compactRetainLines: args.retainLines,
    compactPaths: args.compactPaths,
    topFilesLimit: args.top,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`dryRun=${report.dryRun}`);
  console.log(`archiveEnabled=${report.archiveEnabled}`);
  console.log(`compactEnabled=${report.compactEnabled}`);
  console.log(`totalBytes=${report.totalBytes}`);
  console.log(`reclaimableBytes=${report.reclaimableBytes}`);
  console.log(`total=${bytesText(report.totalBytes)}`);
  console.log(`reclaimable=${bytesText(report.reclaimableBytes)}`);
  console.log(`archiveDir=${report.archiveDir}`);
  console.log(`manifestPath=${report.manifestPath}`);
  for (const [category, summary] of Object.entries(report.byCategory)) {
    console.log(
      `${category} files=${summary.fileCount} total=${bytesText(summary.totalBytes)} reclaimable=${bytesText(summary.reclaimableBytes)}`,
    );
  }
  if (report.topFiles.length) {
    console.log("topReclaimableFiles:");
    for (const item of report.topFiles) {
      console.log(`- ${item.relativePath} ${item.category} ${bytesText(item.bytes)} action=${item.plannedAction}`);
    }
  } else {
    console.log("topReclaimableFiles: none");
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
