import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("skills and agents configuration checker enforces verbatim BOB Gateway Protection block + 5-step Mandatory Verification Procedure + Coding Agent Operating Mode reference", async () => {
  assert.equal(existsSync(".claude/skills/bob-claw-readiness-safety-verification/SKILL.md"), true);
  assert.equal(existsSync(".claude/agents/policy-agent.md"), true);

  const result = spawnSync(process.execPath, ["scripts/check-skills-config.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  // After the hardening changes, all tracked files now contain the required verbatim blocks.
  // The checker must therefore SUCCEED (exit 0) on the current tree.
  assert.equal(
    result.status,
    0,
    "checker must exit 0 when all tracked files contain the required verbatim BOB Gateway Protection + 5-step + Coding Agent Operating Mode blocks",
  );

  // To still verify that the checker *detects* missing blocks, we deliberately create a temp bad file and run the checker on it.
  // (The original test intent is preserved via this fixture approach.)
  const fs = await import("node:fs");
  const path = await import("node:path");
  const tmpBad = path.join(".claude", "skills", "bob-claw-readiness-safety-verification", "SKILL.bad.md");
  try {
    fs.copyFileSync(".claude/skills/bob-claw-readiness-safety-verification/SKILL.md", tmpBad);
    // Corrupt it by removing the protection block
    let content = fs.readFileSync(tmpBad, "utf8");
    content = content.replace(
      /BOB GATEWAY PROTECTION[\s\S]*?Re-issue the complete, unmodified original task directly to the primary session\./u,
      "",
    );
    fs.writeFileSync(tmpBad, content);

    const badResult = spawnSync(process.execPath, ["scripts/check-skills-config.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.notEqual(
      badResult.status,
      0,
      "checker must still exit non-zero when a tracked file is missing the required blocks (fixture test)",
    );
  } finally {
    if (fs.existsSync(tmpBad)) fs.unlinkSync(tmpBad);
  }
});

test(".gitignore keeps repo skills trackable while the rest of .claude stays ignored", async () => {
  const gitignore = await readFileSync(".gitignore", "utf8");
  assert.match(gitignore, /^\.claude\/\*$/mu);
  assert.match(gitignore, /^!\.claude\/skills\/$/mu);
  assert.match(gitignore, /^!\.claude\/skills\/\*\/$/mu);
  assert.match(gitignore, /^!\.claude\/skills\/\*\/SKILL\.md$/mu);
});
