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

test("skills and agents configuration checker enforces verbatim BOB Gateway Protection block + 5-step Mandatory Verification Procedure + Coding Agent Operating Mode reference", async () => {
  assert.equal(existsSync(".claude/skills/bob-claw-readiness-safety-verification/SKILL.md"), true);
  assert.equal(existsSync(".claude/agents/policy-agent.md"), true);

  const result = runSkillsConfigChecker();

  // After the hardening changes, all tracked files now contain the required verbatim blocks.
  // The checker must therefore SUCCEED (exit 0) on the current tree.
  assert.equal(
    result.status,
    0,
    "checker must exit 0 when all tracked files contain the required verbatim BOB Gateway Protection + 5-step + Coding Agent Operating Mode blocks",
  );

  // To verify that the checker detects missing blocks, create a temporary tracked
  // skill directory with an invalid SKILL.md. This exercises the real file scan.
  const tmpDir = path.join(".claude", "skills", "tmp-invalid-check");
  const tmpBad = path.join(tmpDir, "SKILL.md");
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      tmpBad,
      [
        "---",
        "name: tmp-invalid-check",
        "description: Temporary invalid skill fixture for test coverage.",
        "---",
        "",
        "This file intentionally omits the required BOB Gateway Protection block.",
        "",
      ].join("\n"),
    );

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
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("skills and agents configuration checker fails when a required tracked Claude source file is missing", () => {
  const targetPath = ".claude/agents/policy-agent.md";
  const backupDir = mkdtempSync(path.join(tmpdir(), "skills-config-missing-"));
  const backupPath = path.join(backupDir, "policy-agent.md");
  assert.equal(existsSync(targetPath), true);

  renameSync(targetPath, backupPath);
  try {
    const result = runSkillsConfigChecker();
    assert.notEqual(
      result.status,
      0,
      "checker must exit non-zero when a required tracked Claude source file is missing",
    );
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Required Claude-compatible source files are missing[\s\S]*\.claude\/agents\/policy-agent\.md/u,
      "checker output should call out the missing required Claude source file",
    );
  } finally {
    renameSync(backupPath, targetPath);
    rmSync(backupDir, { recursive: true, force: true });
  }
});

test(".gitignore keeps repo skills trackable while the rest of .claude stays ignored", async () => {
  const gitignore = await readFileSync(".gitignore", "utf8");
  assert.match(gitignore, /^\.claude\/\*$/mu);
  assert.match(gitignore, /^!\.claude\/skills\/$/mu);
  assert.match(gitignore, /^!\.claude\/skills\/\*\/$/mu);
  assert.match(gitignore, /^!\.claude\/skills\/\*\/SKILL\.md$/mu);
});
