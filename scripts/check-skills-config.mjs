import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SKILL_ROOTS = Object.freeze([".grok/skills", ".claude/skills", ".skills", ".factory/skills"]);
const AGENT_DIRS = Object.freeze([".grok/agents", ".claude/agents"]);
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u;
const REQUIRED_TRACKED_FILES = Object.freeze([
  ".grok/skills/bob-claw-readiness-safety-verification/SKILL.md",
  ".grok/skills/defi-portfolio-accounting/SKILL.md",
  ".grok/agents/coordinator.md",
  ".grok/agents/reviewer-agent.md",
  ".grok/agents/verifier-agent.md",
  ".claude/skills/bob-claw-readiness-safety-verification/SKILL.md",
  ".claude/skills/defi-portfolio-accounting/SKILL.md",
  ".claude/agents/bob-claw-coordinator.md",
  ".claude/agents/infra-agent.md",
  ".claude/agents/payback-agent.md",
  ".claude/agents/policy-agent.md",
  ".claude/agents/strategy-agent.md",
  ".claude/agents/treasury-agent.md",
  ".claude/agents/verifier-agent.md",
  ".claude/launch.json",
  ".claude/settings.json",
]);

function parseFrontmatter(sourceText) {
  const match = String(sourceText || "").match(FRONTMATTER_REGEX);
  if (!match) {
    return { fields: null, body: "" };
  }

  const fieldMap = new Map();
  for (const rawLine of match[1].split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, "");
    fieldMap.set(key, value);
  }

  return { fields: fieldMap, body: match[2] || "" };
}

const REQUIRED_OPENING_PHRASES = Object.freeze([
  {
    phrase: "Coding Agent Operating Mode",
    desc: '"Coding Agent Operating Mode" reference (from AGENTS.md)',
  },
  {
    phrase: "DELEGATION ENTRY VALIDATION FAILED",
    desc: "delegated-entry validation refusal template",
  },
  {
    phrase: "The delegated task definition is missing, ambiguous, contradictory, or outside this agent's ownership.",
    desc: "delegated-entry validation message in refusal block",
  },
  {
    phrase: "Mandatory Verification Procedure (5 steps",
    desc: "5-step Mandatory Verification Procedure header",
  },
  {
    phrase:
      "Re-read in full: `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md`",
    desc: "step 1 of the 5-step Mandatory Verification Procedure",
  },
  {
    phrase: "Validate the task-defining",
    desc: "step 2 delegated-entry validation instruction",
  },
  {
    phrase: "Execution Mode",
    desc: '"Execution Mode" reference',
  },
]);

const MAX_NON_EMPTY_LINES_BEFORE_OPENING_BLOCK = 12;
const MAX_NON_EMPTY_LINES_THROUGH_OPENING_BLOCK = 40;

function countNonEmptyLines(text) {
  return String(text || "")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0).length;
}

function isInsideFencedCodeBlock(text, index) {
  const prefix = String(text || "").slice(0, Math.max(0, index));
  const fenceCount = (prefix.match(/^```/gmu) || []).length;
  return fenceCount % 2 === 1;
}

/**
 * Enforce that every tracked SKILL.md and agent .md contains the delegated-entry
 * validation block, the full 5-step Mandatory Verification Procedure, and
 * reference to "Coding Agent Operating Mode" as opening instructions in the
 * post-frontmatter body. Missing, buried, misordered, or fenced-example-only
 * phrases fail the check with a clear actionable error.
 */
function assertContainsRequiredBobClawBlocks(bodyText, relativePath) {
  const sourceText = String(bodyText || "");
  const orderedMatches = [];
  let cursor = 0;

  for (const { phrase, desc } of REQUIRED_OPENING_PHRASES) {
    const index = sourceText.indexOf(phrase, cursor);
    if (index === -1) {
      throw new Error(
        `${relativePath} does not contain the required delegated-entry validation block + 5-step Mandatory Verification Procedure + "Coding Agent Operating Mode" reference.\n` +
          `Missing required phrase for: ${desc}\n` +
          `Expected exact substring: ${JSON.stringify(phrase)}\n` +
          `Per docs/skill-usage-guidelines.md, every SKILL.md and every agent .md MUST embed the refusal template, delegated-entry validation instruction, the full 5-step procedure, and the Coding Agent Operating Mode reference as opening instructions. ` +
          `Copy the exact block from the guideline into the file, then re-run this check. This is a hard safety requirement with no exceptions.`,
      );
    }

    if (isInsideFencedCodeBlock(sourceText, index)) {
      throw new Error(
        `${relativePath} places required opening instructions inside a fenced code block.\n` +
          `Phrase found inside fenced example: ${JSON.stringify(phrase)}\n` +
          `Per docs/skill-usage-guidelines.md, the delegated-entry validation block and 5-step procedure must be live opening instructions, not quoted examples or sample text.`,
      );
    }

    orderedMatches.push({ phrase, index });
    cursor = index + phrase.length;
  }

  const firstMatch = orderedMatches[0];
  const lastMatch = orderedMatches.at(-1);
  const nonEmptyLinesBeforeOpeningBlock = countNonEmptyLines(sourceText.slice(0, firstMatch.index));
  if (nonEmptyLinesBeforeOpeningBlock > MAX_NON_EMPTY_LINES_BEFORE_OPENING_BLOCK) {
    throw new Error(
      `${relativePath} buries the required delegated-entry validation block below other instructions.\n` +
        `Found ${nonEmptyLinesBeforeOpeningBlock} non-empty lines before the opening block, but at most ${MAX_NON_EMPTY_LINES_BEFORE_OPENING_BLOCK} are allowed.\n` +
        `Per docs/skill-usage-guidelines.md, these instructions must appear at the opening of the file body.`,
    );
  }

  const openingBlockEnd = lastMatch.index + lastMatch.phrase.length;
  const nonEmptyLinesThroughOpeningBlock = countNonEmptyLines(sourceText.slice(0, openingBlockEnd));
  if (nonEmptyLinesThroughOpeningBlock > MAX_NON_EMPTY_LINES_THROUGH_OPENING_BLOCK) {
    throw new Error(
      `${relativePath} places the required opening instructions too deep in the file body.\n` +
        `The opening block extends through ${nonEmptyLinesThroughOpeningBlock} non-empty lines, but it must complete within the first ${MAX_NON_EMPTY_LINES_THROUGH_OPENING_BLOCK} non-empty lines.\n` +
        `Move the delegated-entry validation block and 5-step procedure to the top of the file body.`,
    );
  }

  if (relativePath.startsWith(".claude/") && !sourceText.includes("Legacy Claude compatibility surface only.")) {
    throw new Error(
      `${relativePath} must clearly mark itself as Claude-only compatibility so Grok/other tools do not treat it as shared routing truth.`,
    );
  }

  if (relativePath.startsWith(".grok/") && !sourceText.includes("Grok-native prompt surface only.")) {
    throw new Error(
      `${relativePath} must clearly mark itself as a Grok-native prompt surface so cross-tool sessions know this is tool-specific guidance.`,
    );
  }
}

function listSkillFiles(rootPath) {
  if (!existsSync(rootPath)) return [];
  const entries = readdirSync(rootPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(rootPath, entry.name, "SKILL.md"))
    .filter((skillPath) => existsSync(skillPath))
    .sort((left, right) => left.localeCompare(right));
}

function listAgentFiles() {
  return AGENT_DIRS.flatMap((agentDir) => {
    const absoluteDir = resolve(ROOT_DIR, agentDir);
    if (!existsSync(absoluteDir)) return [];
    const entries = readdirSync(absoluteDir, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md" && !entry.name.startsWith("."),
      )
      .map((entry) => join(absoluteDir, entry.name));
  }).sort((left, right) => left.localeCompare(right));
}

function assertNotIgnored(filePath) {
  const result = spawnSync("git", ["check-ignore", filePath], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  if (result.status === 0) {
    throw new Error(`${relative(ROOT_DIR, filePath)} is ignored by git`);
  }
}

function assertRequiredTrackedFilesPresent() {
  const missingRelativePaths = REQUIRED_TRACKED_FILES.filter((relativePath) => {
    return !existsSync(resolve(ROOT_DIR, relativePath));
  });
  if (missingRelativePaths.length > 0) {
    throw new Error(
      "Required agent surface source files are missing.\n" +
        missingRelativePaths.map((relativePath) => `- ${relativePath}`).join("\n") +
        "\nThese tracked agent surface files are a coupled source surface in this repository. " +
        "Do not delete or rename a subset without updating the checker, tests, docs, and source references in the same patch.",
    );
  }

  for (const relativePath of REQUIRED_TRACKED_FILES) {
    assertNotIgnored(resolve(ROOT_DIR, relativePath));
  }
}

function validateSkillFile(filePath) {
  const relativePath = relative(ROOT_DIR, filePath).replaceAll("\\", "/");
  const expectedSegments = relativePath.split("/");
  if (expectedSegments.length < 3 || expectedSegments.at(-1) !== "SKILL.md") {
    throw new Error(`${relativePath} must use {skill-name}/SKILL.md structure`);
  }

  const sourceText = readFileSync(filePath, "utf8");
  const { fields, body } = parseFrontmatter(sourceText);
  if (!fields) {
    throw new Error(`${relativePath} is missing YAML frontmatter`);
  }

  const name = String(fields.get("name") || "").trim();
  const description = String(fields.get("description") || "").trim();
  if (!name) {
    throw new Error(`${relativePath} frontmatter.name must be non-empty`);
  }
  if (!description) {
    throw new Error(`${relativePath} frontmatter.description must be non-empty`);
  }
  if (!String(body || "").trim()) {
    throw new Error(`${relativePath} body must be non-empty`);
  }

  assertContainsRequiredBobClawBlocks(body, relativePath);
  assertNotIgnored(filePath);
  return { relativePath, name, description };
}

function validateAgentFile(filePath) {
  const relativePath = relative(ROOT_DIR, filePath).replaceAll("\\", "/");
  if (
    !(relativePath.includes(".claude/agents/") || relativePath.includes(".grok/agents/")) ||
    !relativePath.endsWith(".md")
  ) {
    throw new Error(`${relativePath} must be under .grok/agents/ or .claude/agents/ and end with .md`);
  }

  const sourceText = readFileSync(filePath, "utf8");
  const { fields, body } = parseFrontmatter(sourceText);
  if (!fields) {
    throw new Error(`${relativePath} is missing YAML frontmatter`);
  }

  const name = String(fields.get("name") || "").trim();
  const description = String(fields.get("description") || "").trim();
  if (!name) {
    throw new Error(`${relativePath} frontmatter.name must be non-empty`);
  }
  if (!description) {
    throw new Error(`${relativePath} frontmatter.description must be non-empty`);
  }
  if (!String(body || "").trim()) {
    throw new Error(`${relativePath} body must be non-empty`);
  }

  assertContainsRequiredBobClawBlocks(body, relativePath);
  assertNotIgnored(filePath);
  return { relativePath, name, description };
}

function main() {
  assertRequiredTrackedFilesPresent();

  const skillFiles = SKILL_ROOTS.flatMap((root) => listSkillFiles(resolve(ROOT_DIR, root)));
  const agentFiles = listAgentFiles();

  if (skillFiles.length === 0 && agentFiles.length === 0) {
    throw new Error(
      "No compatible skills found under .grok/skills, .claude/skills, .skills, or .factory/skills " +
        "and no agent definitions found under .grok/agents or .claude/agents",
    );
  }

  const validatedSkills = skillFiles.map((filePath) => validateSkillFile(filePath));
  const validatedAgents = agentFiles.map((filePath) => validateAgentFile(filePath));

  for (const skill of validatedSkills) {
    console.log(`skill ok: ${skill.relativePath} name=${skill.name} description=${skill.description}`);
  }
  for (const agent of validatedAgents) {
    console.log(`agent ok: ${agent.relativePath} name=${agent.name} description=${agent.description}`);
  }
  console.log(
    `Skills and agents configuration check passed: ${validatedSkills.length} valid skill(s), ${validatedAgents.length} valid agent(s).`,
  );
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
