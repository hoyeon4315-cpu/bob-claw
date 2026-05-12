import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("skills configuration checker passes for tracked repository skills", async () => {
  assert.equal(existsSync(".claude/skills/bob-claw-readiness-safety-verification/SKILL.md"), true);

  const result = spawnSync(process.execPath, ["scripts/check-skills-config.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /skill ok: \.claude\/skills\/bob-claw-readiness-safety-verification\/SKILL\.md/u);
  assert.match(result.stdout, /Skills configuration check passed: 1 valid skill\(s\)\./u);
});

test(".gitignore keeps repo skills trackable while the rest of .claude stays ignored", async () => {
  const gitignore = await readFileSync(".gitignore", "utf8");
  assert.match(gitignore, /^\.claude\/\*$/mu);
  assert.match(gitignore, /^!\.claude\/skills\/$/mu);
  assert.match(gitignore, /^!\.claude\/skills\/\*\/$/mu);
  assert.match(gitignore, /^!\.claude\/skills\/\*\/SKILL\.md$/mu);
});
