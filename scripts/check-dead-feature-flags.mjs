import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { FEATURE_FLAGS } from "../src/config/feature-flags.mjs";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFINITION_FILE_REL = "src/config/feature-flags.mjs";

const SCAN_DIRS = ["src", "test", "scripts", "dashboard/public", "docs", ".github"];
const SOURCE_EXTENSIONS = new Set([".mjs", ".js", ".cjs", ".jsx", ".md", ".yml", ".yaml", ".json"]);

const EXCLUDE_DIRS = new Set(["node_modules", ".git", "artifacts", "build", "dist", "coverage", "out", "data", "logs"]);

export function getDefinedFeatureFlagIds(manifest = FEATURE_FLAGS) {
  if (!manifest || typeof manifest !== "object") return [];
  return Object.keys(manifest).sort();
}

export function extractFeatureFlagCallIds(content) {
  const ids = new Set();
  if (typeof content !== "string" || content.length === 0) return ids;

  const callRe = /(?:isFeatureEnabled|getFeatureFlagDefinition)\s*\(\s*["'`]([^"'`]+?)["'`]/g;
  let match;
  while ((match = callRe.exec(content)) !== null) {
    const id = (match[1] || "").trim();
    // Require at least one alphanumeric char on each side of a dot; reject "..." placeholders and pure punctuation
    if (
      id &&
      /[a-z0-9]/iu.test(id) &&
      /^[a-z0-9_.-]*[a-z0-9][a-z0-9_.-]*\.[a-z0-9_.-]*[a-z0-9][a-z0-9_.-]*$/iu.test(id)
    ) {
      ids.add(id);
    }
  }
  return ids;
}

function shouldSkipDir(dirName) {
  return EXCLUDE_DIRS.has(dirName);
}

function walkFiles(startDir) {
  const results = [];
  function walk(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (shouldSkipDir(entry)) continue;
      const fullPath = join(currentDir, entry);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(fullPath);
      } else {
        const dot = entry.lastIndexOf(".");
        const ext = dot === -1 ? "" : entry.slice(dot);
        if (SOURCE_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }
  walk(startDir);
  return results;
}

export function scanFeatureFlagUsage({ rootDir = ROOT_DIR, manifest = FEATURE_FLAGS } = {}) {
  const definedIds = new Set(getDefinedFeatureFlagIds(manifest));
  const usageMap = new Map(); // id -> { files: string[], callSites: number }
  const staleRefs = new Set();
  const scannedFiles = [];

  for (const dirName of SCAN_DIRS) {
    const absDir = resolve(rootDir, dirName);
    let dirFiles;
    try {
      dirFiles = walkFiles(absDir);
    } catch {
      continue;
    }
    scannedFiles.push(...dirFiles);
  }

  const definitionAbs = resolve(rootDir, DEFINITION_FILE_REL);

  for (const filePath of scannedFiles) {
    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const relPath = relative(rootDir, filePath).replace(/\\/g, "/");
    const isDefinitionFile = filePath === definitionAbs || relPath === DEFINITION_FILE_REL;

    const apiIds = extractFeatureFlagCallIds(content);
    for (const id of apiIds) {
      if (!definedIds.has(id)) {
        if (!relPath.startsWith("test/")) {
          staleRefs.add(id);
        }
        continue;
      }
      if (!usageMap.has(id)) {
        usageMap.set(id, { files: [], callSites: 0 });
      }
      const entry = usageMap.get(id);
      if (!entry.files.includes(relPath)) {
        entry.files.push(relPath);
      }
      entry.callSites += 1;
    }

    // Bare string mentions (for docs, tests, config references) — but NOT the definition file itself
    if (!isDefinitionFile) {
      for (const id of definedIds) {
        // Match quoted or as whole token to reduce noise
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const bareRe = new RegExp(`["'\`]${escaped}["'\`]|\\b${escaped}\\b`, "u");
        if (bareRe.test(content)) {
          if (!usageMap.has(id)) {
            usageMap.set(id, { files: [], callSites: 0 });
          }
          const entry = usageMap.get(id);
          if (!entry.files.includes(relPath)) {
            entry.files.push(relPath);
          }
        }
      }
    }
  }

  const deadFlags = [];
  const usage = {};
  for (const id of definedIds) {
    const entry = usageMap.get(id) || { files: [], callSites: 0 };
    const sortedFiles = [...entry.files].sort();
    usage[id] = {
      files: sortedFiles,
      fileCount: sortedFiles.length,
      callSites: entry.callSites,
    };
    if (sortedFiles.length === 0) {
      deadFlags.push(id);
    }
  }

  deadFlags.sort();
  const staleFlagRefs = [...staleRefs].sort();

  return {
    definedCount: definedIds.size,
    deadFlags,
    staleFlagRefs,
    usage,
    scannedFileCount: scannedFiles.length,
    definitionFile: DEFINITION_FILE_REL,
  };
}

function printUsageTable(usage) {
  const entries = Object.entries(usage).sort(([a], [b]) => a.localeCompare(b));
  for (const [id, info] of entries) {
    const status = info.fileCount > 0 ? "live" : "DEAD";
    console.log(`  ${id} [${status}] — ${info.fileCount} file(s), ${info.callSites} call sites`);
    if (info.files.length > 0 && info.files.length <= 5) {
      for (const f of info.files) {
        console.log(`    - ${f}`);
      }
    } else if (info.files.length > 5) {
      for (const f of info.files.slice(0, 3)) {
        console.log(`    - ${f}`);
      }
      console.log(`    ... and ${info.files.length - 3} more`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json") || args.includes("-j");
  const verbose = args.includes("--verbose") || args.includes("-v");

  try {
    const result = scanFeatureFlagUsage();

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      if (result.deadFlags.length > 0 || result.staleFlagRefs.length > 0) {
        process.exitCode = 1;
      }
      return;
    }

    console.log("Dead Feature Flag Detection");
    console.log(`Defined flags: ${result.definedCount}`);
    console.log(`Scanned source files: ${result.scannedFileCount}`);
    console.log(`Definition file: ${result.definitionFile}`);
    console.log("");

    const hasProblems = result.deadFlags.length > 0 || result.staleFlagRefs.length > 0;

    if (!hasProblems) {
      console.log("✓ No dead flags or stale references found.");
      console.log("");
      printUsageTable(result.usage);
    } else {
      if (result.deadFlags.length > 0) {
        console.error(
          `✗ DEAD FLAGS (${result.deadFlags.length}): defined in manifest but ZERO consumer references or mentions:`,
        );
        for (const f of result.deadFlags) {
          console.error(`  - ${f}`);
        }
        console.error("");
      }
      if (result.staleFlagRefs.length > 0) {
        console.error(
          `✗ STALE REFERENCES (${result.staleFlagRefs.length}): code calls feature flag APIs with unknown IDs (not in manifest):`,
        );
        for (const f of result.staleFlagRefs) {
          console.error(`  - ${f}`);
        }
        console.error("");
      }
      console.error(
        "Action: remove dead flags from FEATURE_FLAGS or wire a real consumer (isFeatureEnabled + test + slice if report).",
      );
      console.error(
        "Stale refs must be removed or the flag must be added to the committed manifest with proper metadata.",
      );
      process.exitCode = 1;
    }

    if (verbose && hasProblems) {
      console.log("\nFull usage map:");
      printUsageTable(result.usage);
    }
  } catch (error) {
    console.error("Dead feature flag check error:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}
