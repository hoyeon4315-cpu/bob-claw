import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SKILL_ROOTS = Object.freeze([".grok/skills"]);
const AGENTS_DIR = resolve(ROOT_DIR, ".grok/agents");
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u;

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

function assertReferencesSupremeLaw(sourceText, relativePath) {
  const requiredPhrases = ["AGENT-SUPREME-LAW.md", "5-step", "Execution Mode"];

  for (const phrase of requiredPhrases) {
    if (!String(sourceText || "").includes(phrase)) {
      throw new Error(
        `${relativePath} must reference docs/AGENT-SUPREME-LAW.md and the required scope/ownership / 5-step / Execution Mode rules.\n` +
          `Missing required phrase: ${JSON.stringify(phrase)}`,
      );
    }
  }

  const lowercaseSource = String(sourceText || "").toLowerCase();
  if (!lowercaseSource.includes("scope") && !lowercaseSource.includes("ownership")) {
    throw new Error(
      `${relativePath} must mention delegated scope or ownership guardrails from docs/AGENT-SUPREME-LAW.md.`,
    );
  }

  const forbiddenPhrases = ["literal `Gateway`", 'literal word "Gateway"', "Gateway Protection"];
  for (const phrase of forbiddenPhrases) {
    if (String(sourceText || "").includes(phrase)) {
      throw new Error(`${relativePath} must not reintroduce the removed Gateway-specific refusal rule.`);
    }
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
  if (!existsSync(AGENTS_DIR)) return [];
  const entries = readdirSync(AGENTS_DIR, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".") && entry.name !== "README.md",
    )
    .map((entry) => join(AGENTS_DIR, entry.name))
    .sort((left, right) => left.localeCompare(right));
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

  assertReferencesSupremeLaw(sourceText, relativePath);
  assertNotIgnored(filePath);
  return { relativePath, name, description };
}

function validateAgentFile(filePath) {
  const relativePath = relative(ROOT_DIR, filePath).replaceAll("\\", "/");
  if (!relativePath.includes(".grok/agents/") || !relativePath.endsWith(".md")) {
    throw new Error(`${relativePath} must be under .grok/agents/ and end with .md`);
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

  assertReferencesSupremeLaw(sourceText, relativePath);
  assertNotIgnored(filePath);
  return { relativePath, name, description };
}

function main() {
  const skillFiles = SKILL_ROOTS.flatMap((root) => listSkillFiles(resolve(ROOT_DIR, root)));
  const agentFiles = listAgentFiles();

  if (skillFiles.length === 0 && agentFiles.length === 0) {
    throw new Error("No skills found under .grok/skills and no agent definitions found under .grok/agents");
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
