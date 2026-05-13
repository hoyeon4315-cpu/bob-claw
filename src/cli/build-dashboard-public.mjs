#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { writeTextIfChanged } from "../lib/file-write.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IS_MAIN = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
export const DASHBOARD_PUBLIC_DIR = resolve(ROOT, "dashboard/public");
export const DASHBOARD_PUBLIC_BUILD_ENTRIES = Object.freeze([
  Object.freeze({ source: "logos.jsx", output: "logos.js" }),
  Object.freeze({ source: "data.jsx", output: "data.js" }),
  Object.freeze({ source: "ios-frame.jsx", output: "ios-frame.js" }),
  Object.freeze({ source: "mindmap.jsx", output: "mindmap.js" }),
  Object.freeze({ source: "analytics.jsx", output: "analytics.js" }),
  Object.freeze({ source: "app.jsx", output: "app.js" }),
]);

export function parseArgs(argv) {
  const options = Object.fromEntries(
    argv
      .filter((item) => item.startsWith("--") && item.includes("="))
      .map((item) => {
        const [key, ...parts] = item.slice(2).split("=");
        return [key, parts.join("=")];
      }),
  );
  return {
    publicDir: resolve(options["public-dir"] || DASHBOARD_PUBLIC_DIR),
    sourceMaps: argv.includes("--sourcemap") || argv.includes("--source-maps"),
    quiet: argv.includes("--quiet"),
  };
}

function normalizeCompiledSource(code, sourceName, sourceMapName = null) {
  const body = String(code || "").trim();
  const lines = [
    `// Generated from ${sourceName} by src/cli/build-dashboard-public.mjs.`,
    "",
    "(() => {",
    body,
    "})();",
    "",
  ];
  if (sourceMapName) lines.push(`//# sourceMappingURL=${sourceMapName}`, "");
  return lines.join("\n");
}

export async function buildDashboardPublic({
  publicDir = DASHBOARD_PUBLIC_DIR,
  entries = DASHBOARD_PUBLIC_BUILD_ENTRIES,
  transformFn = null,
  sourceMaps = false,
} = {}) {
  const { transform } = transformFn ? { transform: transformFn } : await import("esbuild");
  const writes = [];

  for (const entry of entries) {
    const sourcePath = join(publicDir, entry.source);
    const outputPath = join(publicDir, entry.output);
    const source = await readFile(sourcePath, "utf8");
    const compiled = await transform(source, {
      loader: "jsx",
      jsx: "transform",
      jsxFactory: "React.createElement",
      jsxFragment: "React.Fragment",
      legalComments: "none",
      sourcemap: sourceMaps ? "external" : false,
      sourcefile: entry.source,
      target: "es2020",
    });
    const sourceMapName = sourceMaps && compiled.map ? `${entry.output}.map` : null;
    const write = await writeTextIfChanged(
      outputPath,
      normalizeCompiledSource(compiled.code, entry.source, sourceMapName),
    );
    let sourceMapWrite = null;
    let sourceMapPath = null;
    if (sourceMapName) {
      sourceMapPath = join(publicDir, sourceMapName);
      sourceMapWrite = await writeTextIfChanged(sourceMapPath, `${compiled.map.trim()}\n`);
    }
    writes.push(
      Object.freeze({
        sourcePath,
        outputPath,
        sourceMapPath,
        changed: Boolean(write?.changed),
        sourceMapChanged: Boolean(sourceMapWrite?.changed),
      }),
    );
  }

  return Object.freeze({
    publicDir,
    writes: Object.freeze(writes),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await buildDashboardPublic({
    publicDir: args.publicDir,
    sourceMaps: args.sourceMaps,
  });
  if (!args.quiet) {
    const changed = result.writes.filter((item) => item.changed).length;
    const sourceMaps = result.writes.filter((item) => item.sourceMapPath).length;
    console.log(`dashboardBuild=ok outputs=${result.writes.length} changed=${changed} sourceMaps=${sourceMaps}`);
  }
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
