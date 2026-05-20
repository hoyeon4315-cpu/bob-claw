import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { format as formatWithPrettier } from "prettier";

import { writeTextIfChanged } from "../src/lib/file-write.mjs";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DEFAULT_OUTPUT_PATH = "docs/reference/agent-automation-reference.generated.md";
const GRAPH_PATH = "src/graphify-out/graph.json";
const CANONICAL_DOC_PATHS = ["AGENTS.md", "docs/system-map.md", "docs/harness-engineering.md", "docs/README.md"];
const SOURCE_FILE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

function usage() {
  return [
    "Usage: node scripts/generate-agent-reference-docs.mjs [options]",
    "",
    "Options:",
    "  --write             Write the generated markdown to the default output path.",
    "  --check             Fail when the generated markdown differs from the committed file.",
    "  --stdout            Print the generated markdown to stdout.",
    `  --out <path>        Override the output path. Default: ${DEFAULT_OUTPUT_PATH}`,
    "  --help              Show this help text.",
  ].join("\n");
}

export function parseArgs(argv) {
  const options = {
    write: false,
    check: false,
    stdout: false,
    out: DEFAULT_OUTPUT_PATH,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--write":
        options.write = true;
        break;
      case "--check":
        options.check = true;
        break;
      case "--stdout":
        options.stdout = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--out": {
        const next = argv[index + 1];
        if (!next || next.startsWith("--")) {
          throw new Error("Missing value for --out");
        }
        options.out = next;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }

  return options;
}

function normalizePath(filePath) {
  return String(filePath || "").replaceAll("\\", "/");
}

function firstSegment(scriptName) {
  const normalized = String(scriptName || "").trim();
  if (!normalized) return "other";
  const [head] = normalized.split(":");
  return head || normalized;
}

export function buildScriptCatalog(scripts = {}) {
  const buckets = new Map();

  for (const [name, command] of Object.entries(scripts)) {
    const category = firstSegment(name);
    if (!buckets.has(category)) {
      buckets.set(category, []);
    }
    buckets.get(category).push({
      name,
      command: String(command || "").trim(),
    });
  }

  return [...buckets.entries()]
    .map(([category, entries]) => ({
      category,
      count: entries.length,
      entries: entries.sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.category.localeCompare(right.category));
}

async function walkFiles(startPath) {
  const results = [];
  const stack = [startPath];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (entry.isFile()) {
        results.push(nextPath);
      }
    }
  }

  return results.sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
}

function sourceAreaFromRelativePath(relativePath) {
  const normalized = normalizePath(relativePath).replace(/^src\//u, "");
  const [head] = normalized.split("/");
  return head || "(root)";
}

export async function collectSourceAreas(rootDir = ROOT_DIR) {
  const srcDir = resolve(rootDir, "src");
  const files = await walkFiles(srcDir);
  const areas = new Set();

  for (const filePath of files) {
    const extension = extname(filePath);
    if (!SOURCE_FILE_EXTENSIONS.has(extension)) {
      continue;
    }
    const relativePath = relative(rootDir, filePath);
    const area = sourceAreaFromRelativePath(relativePath);
    areas.add(area);
  }

  return [...areas]
    .map((area) => ({
      area,
      path: area === "(root)" ? "src" : `src/${area}`,
    }))
    .sort((left, right) => left.area.localeCompare(right.area));
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  const sourceText = await readFile(filePath, "utf8");
  return JSON.parse(sourceText);
}

function isGitTracked(relativePath, rootDir = ROOT_DIR) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", normalizePath(relativePath)], {
      cwd: rootDir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function buildGraphSummary(graphData) {
  if (!graphData || !Array.isArray(graphData.nodes) || !Array.isArray(graphData.links)) {
    return null;
  }

  const communities = new Set();
  for (const node of graphData.nodes) {
    if (node?.community != null) {
      communities.add(String(node.community));
    }
  }

  const confidenceCounts = new Map();
  for (const edge of graphData.links) {
    const confidence = String(edge?.confidence || "unknown").toUpperCase();
    confidenceCounts.set(confidence, (confidenceCounts.get(confidence) || 0) + 1);
  }

  return {
    nodeCount: graphData.nodes.length,
    edgeCount: graphData.links.length,
    communityCount: communities.size,
    confidenceBreakdown: [...confidenceCounts.entries()]
      .map(([confidence, count]) => ({ confidence, count }))
      .sort((left, right) => left.confidence.localeCompare(right.confidence)),
  };
}

function existingCanonicalDocs(rootDir = ROOT_DIR) {
  return CANONICAL_DOC_PATHS.filter((filePath) => existsSync(resolve(rootDir, filePath)));
}

export async function collectAgentReferenceModel(rootDir = ROOT_DIR, outputPath = DEFAULT_OUTPUT_PATH) {
  const packageJsonPath = resolve(rootDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const graphData = isGitTracked(GRAPH_PATH, rootDir) ? await readJsonIfExists(resolve(rootDir, GRAPH_PATH)) : null;

  return {
    outputPath: normalizePath(outputPath),
    canonicalDocs: existingCanonicalDocs(rootDir),
    sourceAreas: await collectSourceAreas(rootDir),
    scriptCatalog: buildScriptCatalog(packageJson.scripts || {}),
    graphSummary: buildGraphSummary(graphData),
  };
}

function renderCanonicalDocs(paths) {
  return paths.map((filePath) => `- \`${normalizePath(filePath)}\``);
}

function renderSourceAreaTable(sourceAreas) {
  const lines = ["| Area | Path |", "| --- | --- |"];
  for (const entry of sourceAreas) {
    lines.push(`| ${entry.area} | \`${entry.path}\` |`);
  }
  return lines;
}

function renderScriptSummaryTable(scriptCatalog) {
  const lines = ["| Category | Scripts |", "| --- | ---: |"];
  for (const entry of scriptCatalog) {
    lines.push(`| ${entry.category} | ${entry.count} |`);
  }
  return lines;
}

function renderScriptDetails(scriptCatalog) {
  const lines = [];
  for (const category of scriptCatalog) {
    lines.push(`### ${category.category} (${category.count})`, "");
    for (const entry of category.entries) {
      lines.push(`- \`${entry.name}\` -> \`${entry.command}\``);
    }
    lines.push("");
  }
  return lines;
}

function renderGraphSection(graphSummary) {
  if (!graphSummary) {
    return [
      "## Graph Snapshot",
      "",
      "Graphify output is not present in this checkout, so the generated reference falls back to source and script metadata only.",
      "",
      `If local graph artifacts exist, this generator also reads \`${GRAPH_PATH}\` for graph metrics.`,
      "",
    ];
  }

  const lines = [
    "## Graph Snapshot",
    "",
    `- Nodes: ${graphSummary.nodeCount}`,
    `- Edges: ${graphSummary.edgeCount}`,
    `- Communities: ${graphSummary.communityCount}`,
    "",
    "| Edge Confidence | Count |",
    "| --- | ---: |",
  ];
  for (const entry of graphSummary.confidenceBreakdown) {
    lines.push(`| ${entry.confidence} | ${entry.count} |`);
  }
  lines.push("");
  return lines;
}

export function renderAgentReferenceDoc(model) {
  const lines = [
    "# Agent Automation Reference",
    "",
    `Generated by \`npm run docs:generate\` from repo metadata. Do not edit this file by hand; update \`${model.outputPath}\` via the generator.`,
    "",
    "## Canonical Docs",
    "",
    ...renderCanonicalDocs(model.canonicalDocs),
    "",
    "## Source Area Inventory",
    "",
    ...renderSourceAreaTable(model.sourceAreas),
    "",
    "## Script Catalog",
    "",
    ...renderScriptSummaryTable(model.scriptCatalog),
    "",
    ...renderScriptDetails(model.scriptCatalog),
    ...renderGraphSection(model.graphSummary),
  ];

  return `${lines.join("\n").trim()}\n`;
}

async function formatMarkdown(content) {
  return formatWithPrettier(content, { parser: "markdown" });
}

async function writeOutput(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeTextIfChanged(filePath, content);
}

async function readFileIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function runCheck(filePath, content) {
  const existing = await readFileIfExists(filePath);
  if (existing !== content) {
    throw new Error(
      `Generated documentation is out of date: ${normalizePath(relative(ROOT_DIR, filePath))}. Run npm run docs:generate.`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const outputPath = resolve(ROOT_DIR, options.out);
  const model = await collectAgentReferenceModel(ROOT_DIR, options.out);
  const content = await formatMarkdown(renderAgentReferenceDoc(model));

  if (options.write) {
    await writeOutput(outputPath, content);
    console.log(`Generated documentation written: ${normalizePath(relative(ROOT_DIR, outputPath))}`);
  }
  if (options.check) {
    await runCheck(outputPath, content);
    console.log(`Generated documentation is current: ${normalizePath(relative(ROOT_DIR, outputPath))}`);
  }
  if (options.stdout || (!options.write && !options.check)) {
    process.stdout.write(content);
  }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
