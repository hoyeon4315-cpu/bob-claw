#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function printReport(filePath, lineCount) {
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

  throw new Error(`Unsupported graph:focus mode: ${args.mode}`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
