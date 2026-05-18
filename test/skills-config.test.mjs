import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

function runSkillsConfigChecker() {
  return spawnSync(process.execPath, ["scripts/check-skills-config.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function withTempSkillFixture(fixtureDirName, contents, callback) {
  const fixtureDir = path.join(".claude", "skills", fixtureDirName);
  const fixturePath = path.join(fixtureDir, "SKILL.md");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(fixturePath, contents);
  try {
    callback(fixturePath);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

test("skills and agents configuration checker coverage", async (t) => {
  await t.test(
    "enforces delegated-entry validation + 5-step Mandatory Verification Procedure + Coding Agent Operating Mode reference",
    () => {
      assert.equal(existsSync(".grok/skills/bob-claw-readiness-safety-verification/SKILL.md"), true);
      assert.equal(existsSync(".grok/agents/coordinator.md"), true);
      assert.equal(existsSync(".claude/skills/bob-claw-readiness-safety-verification/SKILL.md"), true);
      assert.equal(existsSync(".claude/agents/policy-agent.md"), true);

      const result = runSkillsConfigChecker();

      assert.equal(
        result.status,
        0,
        "checker must exit 0 when all tracked files contain the required delegated-entry validation + 5-step + Coding Agent Operating Mode blocks",
      );
    },
  );

  await t.test("rejects a temporary skill fixture that omits the required blocks", () => {
    withTempSkillFixture(
      "tmp-invalid-check",
      [
        "---",
        "name: tmp-invalid-check",
        "description: Temporary invalid skill fixture for test coverage.",
        "---",
        "",
        "This file intentionally omits the required delegated-entry validation block.",
        "",
      ].join("\n"),
      () => {
        const badResult = runSkillsConfigChecker();
        assert.notEqual(
          badResult.status,
          0,
          "checker must still exit non-zero when a tracked file is missing the required blocks (fixture test)",
        );
        assert.match(
          `${badResult.stdout}\n${badResult.stderr}`,
          /tmp-invalid-check\/SKILL\.md/u,
          "checker output should identify the invalid temporary skill fixture",
        );
      },
    );
  });

  await t.test("rejects a temporary skill fixture that buries the opening block", () => {
    const canonicalSkill = readFileSync(".claude/skills/bob-claw-readiness-safety-verification/SKILL.md", "utf8");
    const lateIntro = Array.from({ length: 13 }, (_, index) => `Late intro line ${index + 1}.`).join("\n\n");
    const buriedSkill = canonicalSkill.replace(
      "\n\nThis skill follows",
      `\n\n## Late Intro\n\n${lateIntro}\n\nThis skill follows`,
    );

    withTempSkillFixture("tmp-buried-check", buriedSkill, () => {
      const buriedResult = runSkillsConfigChecker();
      assert.notEqual(
        buriedResult.status,
        0,
        "checker must exit non-zero when the opening instructions are buried below other content",
      );
      assert.match(
        `${buriedResult.stdout}\n${buriedResult.stderr}`,
        /tmp-buried-check\/SKILL\.md/u,
        "checker output should identify the buried-block fixture",
      );
      assert.match(
        `${buriedResult.stdout}\n${buriedResult.stderr}`,
        /opening block|opening instructions/u,
        "checker output should explain that the required block is not at the opening of the file body",
      );
    });
  });

  await t.test("rejects a temporary skill fixture with required phrases out of order", () => {
    withTempSkillFixture(
      "tmp-misordered-check",
      [
        "---",
        "name: tmp-misordered-check",
        "description: Temporary misordered skill fixture for test coverage.",
        "---",
        "",
        "# Misordered Skill",
        "",
        "Legacy Claude compatibility surface only. Grok-native sessions and other tools must use shared docs plus their own native prompt surface instead of this file.",
        "",
        "This skill follows `AGENTS.md`, `docs/skill-usage-guidelines.md`, and the repo's **Coding Agent Operating Mode**.",
        "",
        "**Mandatory Verification Procedure (5 steps — execute in order on every activation; no shortcuts; integrate then continue):**",
        "",
        "2. Validate the task-defining request using `Original Task Name:` plus the parent's explicit objective and scope text only.",
        "1. Re-read in full: `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md`.",
        "",
        "DELEGATION ENTRY VALIDATION FAILED",
        "",
        "The delegated task definition is missing, ambiguous, contradictory, or outside this agent's ownership.",
        "",
        "5. Perform final hygiene verification and continue in **Execution Mode** without unsolicited status reports.",
        "",
      ].join("\n"),
      () => {
        const misorderedResult = runSkillsConfigChecker();
        assert.notEqual(
          misorderedResult.status,
          0,
          "checker must exit non-zero when required phrases are out of order",
        );
        assert.match(
          `${misorderedResult.stdout}\n${misorderedResult.stderr}`,
          /tmp-misordered-check\/SKILL\.md/u,
          "checker output should identify the misordered fixture",
        );
      },
    );
  });

  await t.test("rejects a temporary skill fixture that only quotes the block inside fenced code", () => {
    withTempSkillFixture(
      "tmp-fenced-check",
      [
        "---",
        "name: tmp-fenced-check",
        "description: Temporary fenced-example fixture for test coverage.",
        "---",
        "",
        "# Fenced Example Skill",
        "",
        "Legacy Claude compatibility surface only. Grok-native sessions and other tools must use shared docs plus their own native prompt surface instead of this file.",
        "",
        "```md",
        "This skill follows `AGENTS.md`, `docs/skill-usage-guidelines.md`, and the repo's **Coding Agent Operating Mode**.",
        "",
        "DELEGATION ENTRY VALIDATION FAILED",
        "",
        "The delegated task definition is missing, ambiguous, contradictory, or outside this agent's ownership.",
        "",
        "**Mandatory Verification Procedure (5 steps — execute in order on every activation; no shortcuts; integrate then continue):**",
        "",
        "1. Re-read in full: `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, and `docs/skill-usage-guidelines.md`.",
        "2. Validate the task-defining request using `Original Task Name:` plus the parent's explicit objective and scope text only.",
        "5. Perform final hygiene verification and continue in **Execution Mode** without unsolicited status reports.",
        "```",
        "",
        "Actual runtime instructions are intentionally omitted here.",
        "",
      ].join("\n"),
      () => {
        const fencedResult = runSkillsConfigChecker();
        assert.notEqual(
          fencedResult.status,
          0,
          "checker must exit non-zero when required phrases only appear inside fenced code",
        );
        assert.match(
          `${fencedResult.stdout}\n${fencedResult.stderr}`,
          /tmp-fenced-check\/SKILL\.md/u,
          "checker output should identify the fenced-code fixture",
        );
        assert.match(
          `${fencedResult.stdout}\n${fencedResult.stderr}`,
          /fenced code block/u,
          "checker output should explain that fenced examples do not satisfy opening-instruction requirements",
        );
      },
    );
  });

  await t.test("fails when a required tracked agent surface file is missing", () => {
    const targetPath = ".grok/agents/coordinator.md";
    const backupDir = mkdtempSync(path.join(tmpdir(), "skills-config-missing-"));
    const backupPath = path.join(backupDir, "coordinator.md");
    assert.equal(existsSync(targetPath), true);

    renameSync(targetPath, backupPath);
    try {
      const result = runSkillsConfigChecker();
      assert.notEqual(
        result.status,
        0,
        "checker must exit non-zero when a required tracked agent surface file is missing",
      );
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /Required agent surface source files are missing[\s\S]*\.grok\/agents\/coordinator\.md/u,
        "checker output should call out the missing required agent surface file",
      );
    } finally {
      renameSync(backupPath, targetPath);
      rmSync(backupDir, { recursive: true, force: true });
    }
  });

  await t.test("keeps repo skills trackable while the rest of .claude stays ignored", () => {
    const gitignore = readFileSync(".gitignore", "utf8");
    assert.match(gitignore, /^\.claude\/\*$/mu);
    assert.match(gitignore, /^!\.claude\/skills\/$/mu);
    assert.match(gitignore, /^!\.claude\/skills\/\*\/$/mu);
    assert.match(gitignore, /^!\.claude\/skills\/\*\/SKILL\.md$/mu);
  });
});
