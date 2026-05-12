import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseArgs,
  parseConventionalSubject,
  prependChangelogEntry,
  renderReleaseNotes,
} from "../scripts/generate-release-notes.mjs";

test("parseArgs accepts equals-form options used by npm scripts and docs", () => {
  const options = parseArgs([
    "--from=HEAD~1",
    "--to=HEAD",
    "--version=v1.2.3",
    "--title=Release Preview",
    "--write-changelog=CHANGELOG.md",
    "--write-notes=/tmp/release-notes.md",
    "--stdout",
  ]);

  assert.equal(options.from, "HEAD~1");
  assert.equal(options.to, "HEAD");
  assert.equal(options.version, "v1.2.3");
  assert.equal(options.title, "Release Preview");
  assert.equal(options.writeChangelog, "CHANGELOG.md");
  assert.equal(options.writeNotes, "/tmp/release-notes.md");
  assert.equal(options.stdout, true);
});

test("parseArgs rejects inline values for boolean flags", () => {
  assert.throws(() => parseArgs(["--stdout=true"]), /Unknown argument: --stdout=true/);
  assert.throws(() => parseArgs(["--help=false"]), /Unknown argument: --help=false/);
});

test("parseConventionalSubject classifies conventional commits and breaking changes", () => {
  const parsedFeature = parseConventionalSubject("feat(release): add preview workflow");
  assert.equal(parsedFeature.sectionKey, "feat");
  assert.equal(parsedFeature.scope, "release");
  assert.equal(parsedFeature.summary, "add preview workflow");

  const parsedBreaking = parseConventionalSubject(
    "fix!: tighten release range",
    "BREAKING CHANGE: old range format removed",
  );
  assert.equal(parsedBreaking.sectionKey, "breaking");
  assert.equal(parsedBreaking.breaking, true);
});

test("renderReleaseNotes groups commits and prints contributors", () => {
  const notes = renderReleaseNotes({
    commits: [
      {
        hash: "1234567890abcdef",
        shortHash: "12345678",
        scope: "release",
        summary: "add changelog generator",
        sectionKey: "feat",
        authorName: "Codex",
        commitUrl: "https://example.test/commit/1234567890abcdef",
      },
      {
        hash: "abcdef1234567890",
        shortHash: "abcdef12",
        scope: null,
        summary: "document preview mode",
        sectionKey: "docs",
        authorName: "Maintainer",
        commitUrl: null,
      },
    ],
    range: { from: "aaa111", to: "bbb222" },
    compareUrl: "https://example.test/compare/aaa111...bbb222",
    title: "v0.2.0",
    generatedOn: "2026-05-12",
  });

  assert.match(notes, /## v0\.2\.0/);
  assert.match(notes, /### Features/);
  assert.match(notes, /\*\*release:\*\* add changelog generator/);
  assert.match(notes, /### Docs/);
  assert.match(notes, /### Contributors/);
  assert.match(notes, /- Codex \(1 commit\)/);
  assert.match(notes, /- Maintainer \(1 commit\)/);
});

test("prependChangelogEntry keeps the changelog header at the top", () => {
  const existing = "# Changelog\n\n## v0.1.0\n\n- existing entry\n";
  const next = prependChangelogEntry(existing, "## v0.2.0\n\n- new entry");
  assert.match(next, /^# Changelog\n\n## v0\.2\.0/);
  assert.match(next, /## v0\.1\.0/);
});
