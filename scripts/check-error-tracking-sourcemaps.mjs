#!/usr/bin/env node

import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DASHBOARD_PUBLIC_BUILD_ENTRIES,
  DASHBOARD_PUBLIC_DIR,
  buildDashboardPublic,
} from "../src/cli/build-dashboard-public.mjs";

async function main() {
  const workDir = await mkdtemp(join(tmpdir(), "bob-error-tracking-sourcemaps-"));
  try {
    for (const entry of DASHBOARD_PUBLIC_BUILD_ENTRIES) {
      await copyFile(join(DASHBOARD_PUBLIC_DIR, entry.source), join(workDir, entry.source));
    }

    const result = await buildDashboardPublic({
      publicDir: workDir,
      entries: DASHBOARD_PUBLIC_BUILD_ENTRIES,
      sourceMaps: true,
    });

    const missing = result.writes.filter((item) => !item.sourceMapPath);
    if (missing.length > 0) {
      throw new Error(`missing source maps for ${missing.map((item) => item.outputPath).join(",")}`);
    }

    for (const item of result.writes) {
      const sourceMap = JSON.parse(await readFile(item.sourceMapPath, "utf8"));
      if (!Array.isArray(sourceMap.sources) || sourceMap.sources.length === 0) {
        throw new Error(`empty source map sources: ${item.sourceMapPath}`);
      }
    }

    console.log(
      `errorTrackingSourcemaps=ok mode=dry-run entries=${result.writes.length} maps=${result.writes.length} upload=skipped`,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`errorTrackingSourcemaps=error message=${JSON.stringify(error.message)}`);
  process.exitCode = 1;
});
