import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_AGENTS_PATH = resolve(ROOT_DIR, "AGENTS.md");
const DEFAULT_GRAPH_REPORTS = ["src/graphify-out/GRAPH_REPORT.md", "graphify-out/GRAPH_REPORT.md"];
const PATH_EXTENSIONS = [
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".md",
  ".mjs",
  ".plist",
  ".py",
  ".sh",
  ".sol",
  ".toml",
  ".txt",
  ".yaml",
  ".yml",
];
const SOURCE_PREFIXES = [
  ".github/",
  "dashboard/public/",
  "docs/",
  "graphify-out/",
  "research/",
  "scripts/",
  "src/",
  "test/",
];
const GENERATED_PREFIXES = [
  ".cloudflare/",
  ".playwright-cli/",
  ".wrangler/",
  "artifacts/",
  "build/",
  "coverage/",
  "data/",
  "dist/",
  "logs/",
  "node_modules/",
  "out/",
];
const SOURCE_ROOT_FILES = new Set([
  ".dependency-cruiser.cjs",
  ".jscpd.json",
  "AGENTS.md",
  "CHANGELOG.md",
  "dashboard-desktop.yaml",
  "knip.config.js",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
]);
const GENERATED_EXACT_PATHS = new Set(["docs/current-status.md"]);
const GENERATED_BASENAMES = new Set([
  "all-chain-autopilot-latest.json",
  "btc-nav-history.jsonl",
  "destination-promotion-gate.json",
  "protocol-position-marks.jsonl",
  "treasury-inventory.jsonl",
]);
const KNOWN_READONLY_SCRIPT_PREFIXES = [
  "audit:",
  "check:",
  "diagnose:",
  "graph:",
  "inventory:",
  "ops:",
  "plan:",
  "probe:",
  "report:",
  "risk:auto-kill-check",
  "validate:",
  "verify:",
  "watch:",
];
const UNSAFE_SCRIPT_PREFIXES = [
  "approval:reaper",
  "auto:research-refresh",
  "capital:routing-plan:execute",
  "deploy",
  "executor:",
  "kill:",
  "live:",
  "radar:promote",
  "rotate:",
  "run:",
  "submit:",
  "treasury:idle-consolidation",
  "treasury:inbound-watch:",
];
const UNSAFE_SCRIPT_EXACT = new Set([
  "capital:routing-plan",
  "dashboard:public:run",
  "dashboard:public:launchd:install",
  "dashboard:public:launchd:write",
  "dashboard:serve",
  "dashboard:serve:static",
  "dashboard:stage-explain",
  "dashboard:build",
  "deploy:dashboard:cloudflare",
  "deploy:dashboard:public-live",
  "executor:dispatch-target",
  "executor:send-intent",
  "preflight:broadcast",
  "research",
  "research:daily",
  "research:launchd:install",
  "research:launchd:write",
  "signer:daemon",
  "watchdog:run",
]);
const UNSAFE_NODE_KEYWORDS = [
  "deploy",
  "execute",
  "install",
  "kill",
  "launchd",
  "offramp",
  "onramp",
  "payback",
  "promote",
  "restart",
  "run-",
  "send-",
  "signer",
  "watchdog",
];

function normalizePath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .trim();
}

function stripWrappingQuotes(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith("`") && text.endsWith("`"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function trimTrailingPunctuation(value) {
  return String(value || "").replace(/[),.;:]+$/u, "");
}

function shellSplit(command) {
  const parts = String(command || "").match(/"[^"]*"|'[^']*'|\S+/gu) || [];
  return parts.map((part) => stripWrappingQuotes(part));
}

export function collectInlineCodeEntries(markdown) {
  const text = String(markdown || "");
  const entries = [];
  let index = 0;

  while (index < text.length) {
    const nextFence = text.indexOf("```", index);
    const nextInline = text.indexOf("`", index);
    const hasFence = nextFence !== -1;
    const hasInline = nextInline !== -1;

    if (!hasFence && !hasInline) {
      break;
    }

    const useFence = hasFence && (!hasInline || nextFence <= nextInline);
    if (useFence) {
      const fenceStart = nextFence;
      const lineBreak = text.indexOf("\n", fenceStart + 3);
      if (lineBreak === -1) {
        break;
      }
      const fenceEnd = text.indexOf("```", lineBreak + 1);
      if (fenceEnd === -1) {
        break;
      }
      const value = text.slice(lineBreak + 1, fenceEnd).trim();
      if (value) {
        entries.push({ kind: "fenced", value });
      }
      index = fenceEnd + 3;
      continue;
    }

    const inlineStart = nextInline;
    const inlineEnd = text.indexOf("`", inlineStart + 1);
    if (inlineEnd === -1) {
      break;
    }
    const value = text.slice(inlineStart + 1, inlineEnd).trim();
    if (value && !value.includes("\n")) {
      entries.push({ kind: "inline", value });
    }
    index = inlineEnd + 1;
  }

  return entries;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function splitCommandCandidates(entry) {
  if (entry.kind === "fenced") {
    return entry.value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [entry.value.trim()].filter(Boolean);
}

function extractNpmRunReferences(command) {
  const match = String(command).match(/^npm run ([A-Za-z0-9:_-]+(?:\|[A-Za-z0-9:_-]+)*)(.*)$/u);
  if (!match) return [];
  const alternates = match[1].split("|").filter(Boolean);
  const suffix = match[2] || "";
  if (suffix.trimStart().startsWith("...")) return [];
  if (alternates.some((scriptName) => scriptName.endsWith(":"))) return [];
  return alternates.map((scriptName) => ({
    type: "npm",
    command: `npm run ${scriptName}${suffix}`.trim(),
    npmScripts: [scriptName],
  }));
}

export function extractCommandReferences(markdown) {
  const commands = [];
  for (const entry of collectInlineCodeEntries(markdown)) {
    for (const candidate of splitCommandCandidates(entry)) {
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("npm run ")) {
        commands.push(...extractNpmRunReferences(trimmed));
        continue;
      }
      if (trimmed.startsWith("node ")) {
        const nodeFileMatch = trimmed.match(/\b([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._*-]+)+\.(?:c?js|mjs))\b/u);
        commands.push({
          type: "node",
          command: trimmed,
          nodeFile: nodeFileMatch ? normalizePath(nodeFileMatch[1]) : null,
        });
        continue;
      }
      if (trimmed.startsWith("python3 -m ") || trimmed.startsWith("python -m ")) {
        const pythonMatch = trimmed.match(/^python(?:3)? -m ([A-Za-z0-9_.-]+)\b/u);
        commands.push({
          type: "python",
          command: trimmed,
          pythonModule: pythonMatch ? pythonMatch[1] : null,
        });
      }
    }
  }
  return uniqueBy(commands, (entry) => entry.command);
}

function looksLikePathToken(value) {
  const token = normalizePath(trimTrailingPunctuation(stripWrappingQuotes(value)));
  if (!token) return false;
  if (token.startsWith("$") || token.startsWith("~")) return true;
  if (token.includes("/")) return true;
  return PATH_EXTENSIONS.some((extension) => token.endsWith(extension));
}

function looksLikeCommand(entryValue) {
  return /^(?:npm run|node |python(?:3)? -m|touch |rm |git |npx )/u.test(String(entryValue || "").trim());
}

export function extractPathReferences(markdown) {
  const paths = [];
  for (const entry of collectInlineCodeEntries(markdown)) {
    if (entry.kind !== "inline") continue;
    const value = entry.value.trim();
    if (!value || looksLikeCommand(value)) continue;
    if (!looksLikePathToken(value)) continue;
    const path = normalizePath(trimTrailingPunctuation(value));
    if (/^\.[A-Za-z0-9]+$/u.test(path)) continue;
    if (classifyReferencedPath(path).kind === "external") continue;
    paths.push({ path });
  }
  return uniqueBy(paths, (entry) => entry.path);
}

function isSourceRootFile(targetPath) {
  return SOURCE_ROOT_FILES.has(targetPath);
}

function isGeneratedDashboardPath(targetPath) {
  return (
    targetPath.startsWith("dashboard/public/") &&
    !targetPath.endsWith(".jsx") &&
    targetPath !== "dashboard/public/index.html" &&
    targetPath !== "dashboard/public/_headers"
  );
}

function isGraphifyOutputPath(targetPath) {
  return (
    targetPath === "src/graphify-out/" ||
    targetPath === "graphify-out/" ||
    targetPath.startsWith("src/graphify-out/") ||
    targetPath.startsWith("graphify-out/")
  );
}

function classifyPatternScope(targetPath) {
  if (GENERATED_PREFIXES.some((prefix) => targetPath.startsWith(prefix)) || isGeneratedDashboardPath(targetPath)) {
    return "generated";
  }
  return "source";
}

export function classifyReferencedPath(inputPath) {
  const targetPath = normalizePath(trimTrailingPunctuation(stripWrappingQuotes(inputPath)));
  if (!targetPath) return { kind: "unknown", path: targetPath };
  if (targetPath.startsWith("$") || targetPath.startsWith("~")) {
    return { kind: "external", path: targetPath };
  }
  if (targetPath.includes("*")) {
    return { kind: "pattern", scope: classifyPatternScope(targetPath), path: targetPath };
  }
  if (
    GENERATED_EXACT_PATHS.has(targetPath) ||
    GENERATED_BASENAMES.has(targetPath) ||
    isGraphifyOutputPath(targetPath)
  ) {
    return { kind: "generated", path: targetPath };
  }
  if (GENERATED_PREFIXES.some((prefix) => targetPath.startsWith(prefix)) || isGeneratedDashboardPath(targetPath)) {
    return { kind: "generated", path: targetPath };
  }
  if (SOURCE_PREFIXES.some((prefix) => targetPath.startsWith(prefix)) || isSourceRootFile(targetPath)) {
    return { kind: "source", path: targetPath };
  }
  if (PATH_EXTENSIONS.some((extension) => targetPath.endsWith(extension))) {
    return { kind: "source", path: targetPath };
  }
  return { kind: "unknown", path: targetPath };
}

function escapeRegex(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

function globToRegex(pattern) {
  const normalized = normalizePath(pattern);
  let regex = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    const next = normalized[index + 1];
    if (current === "*" && next === "*") {
      regex += ".*";
      index += 1;
      continue;
    }
    if (current === "*") {
      regex += "[^/]*";
      continue;
    }
    regex += escapeRegex(current);
  }
  regex += "$";
  return new RegExp(regex, "u");
}

function isSkippedRepoDirectory(relativePath) {
  const skippedPrefixes = [".claude", ".git", "node_modules", "preview", "dashboard/public.legacy"];
  return skippedPrefixes.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

function walkRepoFiles(startDir, { includeDirectories = false } = {}) {
  const items = [];
  const stack = [startDir];

  while (stack.length > 0) {
    const current = stack.pop();
    let stats;
    try {
      stats = statSync(current);
    } catch {
      continue;
    }

    const relativePath = normalizePath(relative(ROOT_DIR, current));
    if (relativePath === ".") {
      for (const entry of readdirSync(current)) {
        stack.push(resolve(current, entry));
      }
      continue;
    }

    if (stats.isDirectory()) {
      if (includeDirectories) items.push(relativePath.endsWith("/") ? relativePath : `${relativePath}/`);
      if (isSkippedRepoDirectory(relativePath)) {
        continue;
      }
      for (const entry of readdirSync(current)) {
        stack.push(resolve(current, entry));
      }
      continue;
    }

    if (stats.isFile()) {
      items.push(relativePath);
    }
  }

  return items.sort((left, right) => left.localeCompare(right));
}

function resolveImplicitRepoPath(targetPath, repoEntries) {
  const normalized = normalizePath(targetPath);
  if (!normalized) {
    return normalized;
  }
  if (/^\.[A-Za-z0-9]+$/u.test(normalized)) {
    return null;
  }
  if (normalized.includes("/") || normalized.startsWith(".") || isSourceRootFile(normalized)) {
    return normalized;
  }
  if (!PATH_EXTENSIONS.some((extension) => normalized.endsWith(extension))) {
    return normalized;
  }

  const matches = repoEntries.filter(
    (entry) => !entry.endsWith("/") && (entry === normalized || entry.endsWith(`/${normalized}`)),
  );
  if (matches.length === 0) return normalized;

  const scoredMatches = matches.map((entry) => ({
    entry,
    score:
      GENERATED_PREFIXES.some((prefix) => entry.startsWith(prefix)) || isGeneratedDashboardPath(entry)
        ? 0
        : SOURCE_PREFIXES.some((prefix) => entry.startsWith(prefix)) || isSourceRootFile(entry)
          ? 1
          : 5,
    depth: entry.split("/").length,
  }));
  scoredMatches.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    if (left.depth !== right.depth) return left.depth - right.depth;
    return left.entry.localeCompare(right.entry);
  });

  if (scoredMatches.length === 1) return scoredMatches[0].entry;
  if (scoredMatches[0].score < scoredMatches[1].score) return scoredMatches[0].entry;
  if (scoredMatches[0].depth < scoredMatches[1].depth) return scoredMatches[0].entry;
  return null;
}

function defaultPathExists(targetPath) {
  return existsSync(resolve(ROOT_DIR, targetPath));
}

function defaultPatternExists(targetPath, repoEntries) {
  const matcher = globToRegex(targetPath);
  return repoEntries.some((entry) => matcher.test(entry));
}

function findCommandPathTokens(command) {
  const tokens = shellSplit(command);
  if (tokens.length === 0) return [];
  const results = [];

  let startIndex = 0;
  if (tokens[0] === "npm" && tokens[1] === "run") {
    startIndex = 3;
  } else if (tokens[0] === "node") {
    startIndex = 1;
  } else if ((tokens[0] === "python3" || tokens[0] === "python") && tokens[1] === "-m") {
    startIndex = 3;
  }

  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = trimTrailingPunctuation(tokens[index]);
    if (!token || token.startsWith("-")) continue;
    if (!looksLikePathToken(token)) continue;
    results.push(normalizePath(token));
  }

  return uniqueBy(results, (item) => item);
}

function loadPackageScripts(rootDir = ROOT_DIR) {
  const packageJsonPath = resolve(rootDir, "package.json");
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
}

function resolveNpmScriptEntrypoints(scriptName, packageScripts, visited = new Set()) {
  if (visited.has(scriptName)) return [];
  visited.add(scriptName);
  const scriptCommand = packageScripts[scriptName];
  if (typeof scriptCommand !== "string") return [];

  const entrypoints = [];
  for (const segment of scriptCommand
    .split("&&")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (segment.startsWith("npm run ")) {
      const nested = extractNpmRunReferences(segment);
      for (const reference of nested) {
        for (const nestedScript of reference.npmScripts || []) {
          entrypoints.push(...resolveNpmScriptEntrypoints(nestedScript, packageScripts, visited));
        }
      }
      continue;
    }

    for (const targetPath of findCommandPathTokens(segment)) {
      const classified = classifyReferencedPath(targetPath);
      if (classified.kind === "source" || (classified.kind === "pattern" && classified.scope === "source")) {
        entrypoints.push(targetPath);
      }
    }
  }

  return uniqueBy(entrypoints, (entry) => entry);
}

export function classifyCommandRisk(command) {
  const text = String(command || "").trim();
  if (!text) return { risk: "unknown", reason: "empty command" };

  if (text.startsWith("npm run ")) {
    const scriptName = text.replace(/^npm run /u, "").split(/\s+/u)[0] || "";
    if (UNSAFE_SCRIPT_EXACT.has(scriptName) || UNSAFE_SCRIPT_PREFIXES.some((prefix) => scriptName.startsWith(prefix))) {
      return { risk: "unsafe_live", reason: `script ${scriptName} can execute runtime, deploy, or control actions` };
    }
    if (KNOWN_READONLY_SCRIPT_PREFIXES.some((prefix) => scriptName.startsWith(prefix))) {
      return {
        risk: "readonly_probe",
        reason: `script ${scriptName} is report/check oriented and only probeable with explicit opt-in`,
      };
    }
    return { risk: "unknown", reason: `script ${scriptName} is not in the known readonly allowlist` };
  }

  if (text.startsWith("node ")) {
    const hasReadOnlyFlag = /(?:^|\s)(--json|--status|--help|--once)(?:\s|$)/u.test(text);
    const lower = text.toLowerCase();
    if (UNSAFE_NODE_KEYWORDS.some((keyword) => lower.includes(keyword))) {
      return {
        risk: "unsafe_live",
        reason: `node entrypoint name suggests execution-capable behavior (${keywordMatch(lower)})`,
      };
    }
    return {
      risk: hasReadOnlyFlag ? "readonly_probe" : "unknown",
      reason: hasReadOnlyFlag
        ? "node command looks observational but still requires explicit opt-in to execute"
        : "node command not classified as safe to execute by default",
    };
  }

  if (text.startsWith("python3 -m ") || text.startsWith("python -m ")) {
    return { risk: "readonly_probe", reason: "python graph tooling is observational and opt-in only" };
  }

  return { risk: "unknown", reason: "command type not recognized for probing" };
}

function keywordMatch(text) {
  return UNSAFE_NODE_KEYWORDS.find((keyword) => text.includes(keyword)) || "unsafe";
}

function runReadonlyProbe(targetPath) {
  const result = spawnSync(process.execPath, ["--check", targetPath], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: (result.status ?? 1) === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1,
  };
}

function pushReadonlyProbe(probes, command, targetPath) {
  if (!/\.(?:c?js|mjs)$/u.test(targetPath)) return;
  if (probes.some((probe) => probe.command === command && probe.target === targetPath)) return;
  probes.push({
    command,
    target: targetPath,
    result: runReadonlyProbe(targetPath),
  });
}

function countPathReference(reference, context) {
  const resolvedPath = resolveImplicitRepoPath(reference.path, context.repoEntries) || reference.path;
  const classified = classifyReferencedPath(resolvedPath);
  if (classified.kind === "source") {
    context.summary.sourcePathCount += 1;
    if (!context.pathExists(classified.path)) {
      context.failures.push(`Missing source path referenced in AGENTS.md: ${classified.path}`);
    }
    return;
  }
  if (classified.kind === "generated") {
    context.summary.generatedPathCount += 1;
    return;
  }
  if (classified.kind === "pattern") {
    context.summary.patternPathCount += 1;
    if (classified.scope === "source" && !context.hasPattern(classified.path)) {
      context.failures.push(`Missing source path pattern referenced in AGENTS.md: ${classified.path}`);
    }
  }
}

function maybeWarnAboutGraphify(commandReferences, graphReports, pathExists, warnings) {
  if (!commandReferences.some((reference) => reference.pythonModule === "graphify")) return;
  if (graphReports.some((reportPath) => pathExists(reportPath))) return;
  warnings.push(
    `Graphify command is referenced in AGENTS.md, but none of the expected graph reports exist: ${graphReports.join(", ")}`,
  );
}

function maybeProbeReadonlyEntrypoint({ allowReadonlyProbes, classified, command, pathExists, probes, risk }) {
  if (!allowReadonlyProbes || risk.risk !== "readonly_probe" || classified.kind !== "source") return;
  if (!pathExists(classified.path)) return;
  pushReadonlyProbe(probes, command, classified.path);
}

function validateScriptEntrypoint({
  allowReadonlyProbes,
  classified,
  command,
  failures,
  hasPattern,
  pathExists,
  probes,
  risk,
  scriptName,
}) {
  if (classified.kind === "source" && !pathExists(classified.path)) {
    failures.push(`Missing script entrypoint for npm script ${scriptName}: ${classified.path}`);
  }
  if (classified.kind === "pattern" && classified.scope === "source" && !hasPattern(classified.path)) {
    failures.push(`Missing script entrypoint pattern for npm script ${scriptName}: ${classified.path}`);
  }
  maybeProbeReadonlyEntrypoint({ allowReadonlyProbes, classified, command, pathExists, probes, risk });
}

function validateNpmCommandReference(reference, context, risk) {
  for (const scriptName of reference.npmScripts || []) {
    if (!(scriptName in context.packageScriptMap)) {
      context.failures.push(`Missing npm script referenced in AGENTS.md: ${scriptName}`);
      continue;
    }
    for (const entrypoint of resolveNpmScriptEntrypoints(scriptName, context.packageScriptMap)) {
      validateScriptEntrypoint({
        allowReadonlyProbes: context.allowReadonlyProbes,
        classified: classifyReferencedPath(entrypoint),
        command: reference.command,
        failures: context.failures,
        hasPattern: context.hasPattern,
        pathExists: context.pathExists,
        probes: context.probes,
        risk,
        scriptName,
      });
    }
  }
}

function validateCommandPathReference(reference, commandPath, context, risk) {
  const resolvedPath = resolveImplicitRepoPath(commandPath, context.repoEntries) || commandPath;
  const classified = classifyReferencedPath(resolvedPath);
  if (classified.kind === "source" && !context.pathExists(classified.path)) {
    const prefix = reference.type === "node" ? "Missing node entrypoint" : "Missing command path";
    context.failures.push(`${prefix} referenced in AGENTS.md: ${classified.path}`);
  }
  if (classified.kind === "pattern" && classified.scope === "source" && !context.hasPattern(classified.path)) {
    context.failures.push(`Missing command path pattern referenced in AGENTS.md: ${classified.path}`);
  }
  maybeProbeReadonlyEntrypoint({
    allowReadonlyProbes: context.allowReadonlyProbes,
    classified,
    command: reference.command,
    pathExists: context.pathExists,
    probes: context.probes,
    risk,
  });
}

function recordCommandRiskWarning(reference, risk, allowReadonlyProbes, warnings) {
  if (risk.risk === "unsafe_live") {
    warnings.push(`Unsafe execution-capable command intentionally not executed: ${reference.command}`);
    return;
  }
  if (risk.risk === "readonly_probe" && !allowReadonlyProbes) {
    warnings.push(
      `Readonly command left unexecuted by default; rerun with --allow-readonly-probes to syntax-probe it: ${reference.command}`,
    );
  }
}

function validateCommandReference(reference, context) {
  const risk = classifyCommandRisk(reference.command);
  if (risk.risk === "readonly_probe") context.summary.readonlyProbeCommandCount += 1;
  if (risk.risk === "unsafe_live") context.summary.unsafeCommandCount += 1;
  if (reference.type === "npm") {
    validateNpmCommandReference(reference, context, risk);
  }
  for (const commandPath of findCommandPathTokens(reference.command)) {
    validateCommandPathReference(reference, commandPath, context, risk);
  }
  recordCommandRiskWarning(reference, risk, context.allowReadonlyProbes, context.warnings);
}

function appendProbeFailures(probes, failures) {
  for (const probe of probes) {
    if (!probe.result.ok) {
      failures.push(
        `Readonly probe failed for ${probe.target} (from "${probe.command}"): ${
          probe.result.stderr.trim() || probe.result.stdout.trim() || `exit ${probe.result.status}`
        }`,
      );
    }
  }
}

export function validateAgentsFreshnessText(
  agentsText,
  {
    packageScripts = null,
    pathExists = defaultPathExists,
    patternExists = null,
    allowReadonlyProbes = false,
    graphReports = DEFAULT_GRAPH_REPORTS,
  } = {},
) {
  const packageScriptMap =
    packageScripts instanceof Set
      ? Object.fromEntries([...packageScripts].map((scriptName) => [scriptName, "<external-set>"]))
      : packageScripts && typeof packageScripts === "object"
        ? packageScripts
        : loadPackageScripts(ROOT_DIR);
  const repoEntries = walkRepoFiles(ROOT_DIR, { includeDirectories: true });
  const hasPattern = patternExists || ((targetPath) => defaultPatternExists(targetPath, repoEntries));
  const failures = [];
  const warnings = [];
  const probes = [];
  const pathReferences = extractPathReferences(agentsText);
  const commandReferences = extractCommandReferences(agentsText);
  const summary = {
    sourcePathCount: 0,
    generatedPathCount: 0,
    patternPathCount: 0,
    readonlyProbeCommandCount: 0,
    unsafeCommandCount: 0,
  };
  const context = {
    allowReadonlyProbes,
    failures,
    hasPattern,
    packageScriptMap,
    pathExists,
    probes,
    repoEntries,
    summary,
    warnings,
  };

  for (const reference of pathReferences) {
    countPathReference(reference, context);
  }

  maybeWarnAboutGraphify(commandReferences, graphReports, pathExists, warnings);

  for (const reference of commandReferences) {
    validateCommandReference(reference, context);
  }

  appendProbeFailures(probes, failures);

  return {
    failures,
    warnings,
    probes,
    pathReferences,
    commandReferences,
    summary: {
      ...summary,
      failureCount: failures.length,
      warningCount: warnings.length,
      probeCount: probes.length,
    },
  };
}

function formatSummary(summary) {
  return [
    `source_path_refs=${summary.sourcePathCount}`,
    `generated_path_refs=${summary.generatedPathCount}`,
    `pattern_refs=${summary.patternPathCount}`,
    `readonly_commands=${summary.readonlyProbeCommandCount}`,
    `unsafe_commands=${summary.unsafeCommandCount}`,
    `warnings=${summary.warningCount}`,
    `probes=${summary.probeCount}`,
  ].join(" ");
}

function main() {
  const args = new Set(process.argv.slice(2));
  const allowReadonlyProbes = args.has("--allow-readonly-probes");
  const agentsText = readFileSync(DEFAULT_AGENTS_PATH, "utf8");
  const result = validateAgentsFreshnessText(agentsText, { allowReadonlyProbes });

  for (const failure of result.failures) {
    console.error(`FAIL ${failure}`);
  }
  for (const warning of result.warnings) {
    console.warn(`WARN ${warning}`);
  }

  if (result.failures.length > 0) {
    console.error(
      `AGENTS.md freshness validation failed: ${result.failures.length} issue(s). ${formatSummary(result.summary)}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`AGENTS.md freshness validation passed: ${formatSummary(result.summary)}`);
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
