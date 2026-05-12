import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { writeTextIfChanged } from "../src/lib/file-write.mjs";

const execFile = promisify(execFileCallback);
const COMMIT_RECORD_SEPARATOR = "\u001e";
const COMMIT_FIELD_SEPARATOR = "\u001f";
const CONVENTIONAL_SUBJECT_PATTERN =
  /^(?<type>[a-z][a-z0-9-]*)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<summary>.+)$/iu;
const BREAKING_CHANGE_PATTERN = /^BREAKING CHANGE:/mu;
const SECTION_ORDER = ["breaking", "feat", "fix", "refactor", "perf", "test", "docs", "build", "ci", "chore", "other"];

const SECTION_LABELS = {
  breaking: "Breaking Changes",
  feat: "Features",
  fix: "Fixes",
  refactor: "Refactors",
  perf: "Performance",
  test: "Tests",
  docs: "Docs",
  build: "Build",
  ci: "CI",
  chore: "Chores",
  other: "Other Changes",
};

function usage() {
  return [
    "Usage: node scripts/generate-release-notes.mjs [options]",
    "",
    "Options:",
    "  --from <git-ref>              Start ref for the changelog range.",
    "  --to <git-ref>                End ref for the changelog range. Defaults to HEAD.",
    "  --version <label>             Release label to render in the heading.",
    "  --title <title>               Override the default heading title.",
    "  --write-changelog <path>      Prepend generated notes to a changelog file.",
    "  --write-notes <path>          Write the generated notes to a standalone file.",
    "  --stdout                      Print the generated notes to stdout.",
    "  --help                        Show this help text.",
  ].join("\n");
}

export function parseArgs(argv) {
  const options = {
    from: null,
    to: "HEAD",
    version: null,
    title: null,
    writeChangelog: null,
    writeNotes: null,
    stdout: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const rawValue = argv[index];
    const equalsIndex = rawValue.indexOf("=");
    const value = equalsIndex > -1 ? rawValue.slice(0, equalsIndex) : rawValue;
    const inlineValue = equalsIndex > -1 ? rawValue.slice(equalsIndex + 1) : null;
    if (value === "--stdout") {
      if (inlineValue !== null) {
        throw new Error(`Unknown argument: ${rawValue}`);
      }
      options.stdout = true;
      continue;
    }
    if (value === "--help" || value === "-h") {
      if (inlineValue !== null) {
        throw new Error(`Unknown argument: ${rawValue}`);
      }
      options.help = true;
      continue;
    }
    if (!value.startsWith("--")) {
      throw new Error(`Unknown argument: ${rawValue}`);
    }
    const next = inlineValue ?? argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${rawValue}`);
    }
    if (inlineValue === null) {
      index += 1;
    }
    switch (value) {
      case "--from":
        options.from = next;
        break;
      case "--to":
        options.to = next;
        break;
      case "--version":
        options.version = next;
        break;
      case "--title":
        options.title = next;
        break;
      case "--write-changelog":
        options.writeChangelog = next;
        break;
      case "--write-notes":
        options.writeNotes = next;
        break;
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }

  return options;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function parseConventionalSubject(subject, body = "") {
  const normalizedSubject = String(subject || "").trim();
  const match = normalizedSubject.match(CONVENTIONAL_SUBJECT_PATTERN);
  const breaking = BREAKING_CHANGE_PATTERN.test(String(body || "")) || Boolean(match?.groups?.breaking);

  if (!match?.groups) {
    return {
      sectionKey: breaking ? "breaking" : "other",
      scope: null,
      summary: normalizedSubject || "(no subject)",
      conventional: false,
      breaking,
      type: null,
    };
  }

  const type = String(match.groups.type || "").toLowerCase();
  const summary = String(match.groups.summary || "").trim();
  const scope = String(match.groups.scope || "").trim() || null;
  const normalizedType = breaking ? "breaking" : type;
  const sectionKey = SECTION_LABELS[normalizedType] ? normalizedType : "other";

  return {
    sectionKey,
    scope,
    summary: summary || "(no subject)",
    conventional: true,
    breaking,
    type,
  };
}

function slugifyRemotePath(remoteUrl) {
  const sshMatch = String(remoteUrl || "").match(/github\.com[:/](.+?)(?:\.git)?$/iu);
  if (!sshMatch?.[1]) return null;
  return sshMatch[1];
}

async function runGit(args, options = {}) {
  const { stdout } = await execFile("git", args, {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  return String(stdout || "").trim();
}

async function resolveReleaseRange({ from, to = "HEAD", cwd = process.cwd() } = {}) {
  let resolvedFrom = from ? await runGit(["rev-parse", "--verify", from], { cwd }) : null;
  const resolvedTo = await runGit(["rev-parse", "--verify", to], { cwd });

  if (!resolvedFrom) {
    const latestTag = await runGit(["describe", "--tags", "--abbrev=0"], { cwd }).catch(() => "");
    if (latestTag) {
      resolvedFrom = await runGit(["rev-parse", "--verify", latestTag], { cwd });
    }
  }

  if (!resolvedFrom) {
    const firstCommit = await runGit(["rev-list", "--max-parents=0", resolvedTo], { cwd });
    resolvedFrom = String(firstCommit || "").split(/\r?\n/u)[0] || resolvedTo;
  }

  return {
    from: resolvedFrom,
    to: resolvedTo,
  };
}

export async function collectCommitEntries({ from, to = "HEAD", cwd = process.cwd() } = {}) {
  const range = await resolveReleaseRange({ from, to, cwd });
  const raw = await runGit(
    ["log", "--reverse", "--format=%H%x1f%s%x1f%an%x1f%ae%x1f%b%x1e", `${range.from}..${range.to}`],
    { cwd },
  );
  const remoteUrl = await runGit(["remote", "get-url", "origin"], { cwd }).catch(() => "");
  const githubPath = slugifyRemotePath(remoteUrl);
  const compareUrl = githubPath ? `https://github.com/${githubPath}/compare/${range.from}...${range.to}` : null;

  const commits = raw
    .split(COMMIT_RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, authorName, authorEmail, body] = record.split(COMMIT_FIELD_SEPARATOR);
      const parsed = parseConventionalSubject(subject, body);
      return {
        hash,
        shortHash: hash.slice(0, 8),
        subject: String(subject || "").trim(),
        body: String(body || "").trim(),
        authorName: String(authorName || "").trim() || "unknown",
        authorEmail: String(authorEmail || "").trim() || null,
        scope: parsed.scope,
        summary: parsed.summary,
        sectionKey: parsed.sectionKey,
        conventional: parsed.conventional,
        breaking: parsed.breaking,
        type: parsed.type,
        commitUrl: githubPath ? `https://github.com/${githubPath}/commit/${hash}` : null,
      };
    });

  return {
    range,
    compareUrl,
    commits,
  };
}

function formatCommitLine(commit) {
  const scopeLabel = commit.scope ? `**${commit.scope}:** ` : "";
  const hashLabel = commit.commitUrl ? `([${commit.shortHash}](${commit.commitUrl}))` : `(${commit.shortHash})`;
  return `- ${scopeLabel}${commit.summary} ${hashLabel} - ${commit.authorName}`;
}

function buildContributors(commits) {
  const contributors = new Map();
  for (const commit of commits) {
    const key = `${commit.authorName}\u0000${commit.authorEmail || ""}`;
    if (!contributors.has(key)) {
      contributors.set(key, {
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
        commits: 0,
      });
    }
    contributors.get(key).commits += 1;
  }
  return [...contributors.values()].sort((left, right) => {
    if (right.commits !== left.commits) return right.commits - left.commits;
    return left.authorName.localeCompare(right.authorName);
  });
}

function defaultHeading({ title, version, generatedOn }) {
  if (title) return title;
  if (version) return version;
  return `Unreleased Preview (${generatedOn})`;
}

export function renderReleaseNotes({
  commits,
  range,
  compareUrl = null,
  title = null,
  version = null,
  generatedOn = null,
} = {}) {
  const normalizedCommits = Array.isArray(commits) ? commits : [];
  const dateLabel = generatedOn || new Date().toISOString().slice(0, 10);
  const heading = defaultHeading({ title, version, generatedOn: dateLabel });
  const lines = [
    `## ${heading}`,
    "",
    `- Generated on: ${dateLabel}`,
    `- Commit range: \`${range?.from || "?"}..${range?.to || "?"}\``,
  ];
  if (compareUrl) {
    lines.push(`- Compare: ${compareUrl}`);
  }
  lines.push("");

  if (normalizedCommits.length === 0) {
    lines.push("No commits found for this range.", "");
    return `${lines.join("\n").trim()}\n`;
  }

  const sections = new Map(SECTION_ORDER.map((sectionKey) => [sectionKey, []]));
  for (const commit of normalizedCommits) {
    if (!sections.has(commit.sectionKey)) {
      sections.set(commit.sectionKey, []);
    }
    sections.get(commit.sectionKey).push(commit);
  }

  for (const sectionKey of SECTION_ORDER) {
    const entries = sections.get(sectionKey) || [];
    if (entries.length === 0) continue;
    lines.push(`### ${SECTION_LABELS[sectionKey]}`, "");
    lines.push(...entries.map(formatCommitLine), "");
  }

  const contributors = buildContributors(normalizedCommits);
  if (contributors.length > 0) {
    lines.push("### Contributors", "");
    lines.push(
      ...contributors.map(
        (entry) => `- ${entry.authorName} (${entry.commits} commit${entry.commits === 1 ? "" : "s"})`,
      ),
      "",
    );
  }

  return `${lines.join("\n").trim()}\n`;
}

export function prependChangelogEntry(existingText, entryText) {
  const normalizedExisting = String(existingText || "").trim();
  const normalizedEntry = String(entryText || "").trim();
  if (!normalizedExisting) {
    return `# Changelog\n\n${normalizedEntry}\n`;
  }

  const headerPattern = /^# Changelog\s*/u;
  if (headerPattern.test(normalizedExisting)) {
    const body = normalizedExisting.replace(headerPattern, "").trim();
    return `# Changelog\n\n${normalizedEntry}\n\n${body}\n`;
  }

  return `# Changelog\n\n${normalizedEntry}\n\n${normalizedExisting}\n`;
}

async function writeOutputs({ changelogPath, notesPath, notesText }) {
  const writes = [];
  if (notesPath) {
    writes.push(writeTextIfChanged(resolve(process.cwd(), notesPath), notesText));
  }
  if (changelogPath) {
    const fullPath = resolve(process.cwd(), changelogPath);
    let existing = "";
    try {
      existing = await readFile(fullPath, "utf8");
    } catch {
      existing = "";
    }
    const nextText = prependChangelogEntry(existing, notesText);
    writes.push(writeTextIfChanged(fullPath, nextText));
  }
  return Promise.all(writes);
}

export async function generateReleaseNotes(options = {}) {
  const commitData = await collectCommitEntries({
    from: options.from,
    to: options.to,
    cwd: options.cwd || process.cwd(),
  });
  const notesText = renderReleaseNotes({
    commits: commitData.commits,
    range: commitData.range,
    compareUrl: commitData.compareUrl,
    title: options.title,
    version: options.version,
    generatedOn: options.generatedOn,
  });
  return {
    ...commitData,
    notesText,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const generated = await generateReleaseNotes(options);
  const shouldWrite = Boolean(options.writeChangelog || options.writeNotes);
  if (shouldWrite) {
    await writeOutputs({
      changelogPath: options.writeChangelog,
      notesPath: options.writeNotes,
      notesText: generated.notesText,
    });
  }
  if (options.stdout || !shouldWrite) {
    process.stdout.write(generated.notesText);
  }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
