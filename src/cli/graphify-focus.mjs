#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const APP_GRAPH = join(ROOT, "src/graphify-out/graph.json");
const ROOT_GRAPH = join(ROOT, "graphify-out/graph.json");
const APP_REPORT = join(ROOT, "src/graphify-out/GRAPH_REPORT.md");
const ROOT_REPORT = join(ROOT, "graphify-out/GRAPH_REPORT.md");

function printHelp() {
  console.log("Usage:");
  console.log("  npm run graph:focus -- explain <symbol>");
  console.log("  npm run graph:focus -- path <from> <to>");
  console.log("  npm run graph:focus -- query <question> [--budget=N]");
  console.log("  npm run graph:focus -- report [--root] [--lines=N]");
  console.log("  npm run graph:focus -- status");
  console.log("  npm run graph:focus -- update [--root|--all]");
  console.log("");
  console.log("Defaults:");
  console.log("  graph: src/graphify-out/graph.json");
  console.log("  query budget: 700");
  console.log("  report lines: 120");
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const options = Object.fromEntries(
    rest
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, ...valueParts] = arg.slice(2).split("=");
        return [key, valueParts.join("=")];
      }),
  );
  const flags = new Set(rest.filter((arg) => arg.startsWith("--") && !arg.includes("=")));
  const positionals = rest.filter((arg) => !arg.startsWith("--"));
  return {
    mode: mode || "help",
    positionals,
    root: flags.has("--root"),
    all: flags.has("--all"),
    budget: options.budget ? Number(options.budget) : 700,
    lines: options.lines ? Number(options.lines) : 120,
  };
}

function graphPath(root = false) {
  return root ? ROOT_GRAPH : APP_GRAPH;
}

function reportPath(root = false) {
  return root ? ROOT_REPORT : APP_REPORT;
}

function runGraphify(args) {
  return execFileSync("graphify", args, {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function runGraphifyUpdate(target) {
  const outputDir = target === "src" ? join(ROOT, "src/graphify-out") : join(ROOT, "graphify-out");
  const graph = join(outputDir, "graph.json");
  const report = join(outputDir, "GRAPH_REPORT.md");
  const graphBefore = existsSync(graph) ? statSync(graph).mtimeMs : 0;
  const reportBefore = existsSync(report) ? statSync(report).mtimeMs : 0;
  const result = spawnSync("graphify", ["update", target], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status === 0) return output;
  const graphUpdated = existsSync(graph) && statSync(graph).mtimeMs > graphBefore;
  const reportUpdated = existsSync(report) && statSync(report).mtimeMs > reportBefore;
  if (output.includes("too large for HTML viz") && graphUpdated && reportUpdated) {
    return `Graph JSON/report updated for ${target}; HTML viz skipped because the graph is over graphify's size limit.`;
  }
  if (output === "Nothing to update or rebuild failed — check output above.") {
    return `No graph update needed for ${target}.`;
  }
  throw new Error(output || `graphify update ${target} failed with exit code ${result.status}`);
}

function formatTimestamp(filePath) {
  if (!existsSync(filePath)) return "missing";
  return statSync(filePath).mtime.toISOString();
}

function staleMarkerState(staleMarker, graph) {
  if (!existsSync(staleMarker)) return "no";
  if (existsSync(graph) && statSync(staleMarker).mtime <= statSync(graph).mtime) {
    return "stale marker only";
  }
  return "yes";
}

function graphState(label, baseDir) {
  const outputDir = join(ROOT, baseDir);
  const graph = join(outputDir, "graph.json");
  const report = join(outputDir, "GRAPH_REPORT.md");
  const html = join(outputDir, "graph.html");
  const staleMarker = join(outputDir, "needs_update");
  return [
    `${label}:`,
    `  graph: ${formatTimestamp(graph)}`,
    `  report: ${formatTimestamp(report)}`,
    `  html: ${formatTimestamp(html)}`,
    `  needs_update: ${staleMarkerState(staleMarker, graph)}`,
  ].join("\n");
}

function printStatus() {
  console.log("Graphify focus status");
  console.log(graphState("app", "src/graphify-out"));
  console.log(graphState("root", "graphify-out"));
  console.log(runGraphify(["hook", "status"]).trim());
}

function printReport(filePath, lineCount) {
  if (!existsSync(filePath)) {
    throw new Error(`Graph report not found: ${filePath}. Run npm run graph:focus -- update${filePath === ROOT_REPORT ? " --root" : ""}.`);
  }
  const contents = readFileSync(filePath, "utf8");
  const lines = contents.split(/\r?\n/u).slice(0, Math.max(1, lineCount));
  console.log(lines.join("\n"));
}

function requirePositionals(mode, positionals, count) {
  if (positionals.length >= count) return;
  throw new Error(`graph:focus ${mode} requires ${count} positional argument(s)`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "help" || args.mode === "--help" || args.mode === "-h") {
    printHelp();
    return;
  }

  if (args.mode === "explain") {
    requirePositionals("explain", args.positionals, 1);
    console.log(runGraphify(["explain", args.positionals[0], "--graph", graphPath(args.root)]).trim());
    return;
  }

  if (args.mode === "path") {
    requirePositionals("path", args.positionals, 2);
    console.log(runGraphify(["path", args.positionals[0], args.positionals[1], "--graph", graphPath(args.root)]).trim());
    return;
  }

  if (args.mode === "query") {
    requirePositionals("query", args.positionals, 1);
    const budget = Number.isFinite(args.budget) && args.budget > 0 ? Math.round(args.budget) : 700;
    console.log(
      runGraphify(["query", args.positionals.join(" "), "--graph", graphPath(args.root), "--budget", String(budget)]).trim(),
    );
    return;
  }

  if (args.mode === "report") {
    const lineCount = Number.isFinite(args.lines) && args.lines > 0 ? Math.round(args.lines) : 120;
    printReport(reportPath(args.root), lineCount);
    return;
  }

  if (args.mode === "status") {
    printStatus();
    return;
  }

  if (args.mode === "update") {
    const targets = args.all ? ["src", "."] : [args.root ? "." : "src"];
    for (const target of targets) {
      console.log(runGraphifyUpdate(target));
    }
    return;
  }

  throw new Error(`Unsupported graph:focus mode: ${args.mode}`);
}

const isCli = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isCli) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

export { parseArgs };
