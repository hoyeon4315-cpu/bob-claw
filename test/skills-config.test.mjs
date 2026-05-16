import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

test("skills and agents configuration checker validates the active Grok runtime surfaces", () => {
  assert.equal(existsSync(".grok/skills/bob-claw-readiness-safety-verification/SKILL.md"), true);
  assert.equal(existsSync(".grok/agents/coordinator.md"), true);
  assert.equal(existsSync(".grok/agents/verifier-agent.md"), true);

  const result = spawnSync(process.execPath, ["scripts/check-skills-config.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, "checker must exit 0 for the current Grok runtime surfaces");

  const tmpDir = join(".grok", "skills", "broken-readiness-skill");
  const tmpSkill = join(tmpDir, "SKILL.md");
  try {
    mkdirSync(tmpDir, { recursive: true });
    cpSync(".grok/skills/bob-claw-readiness-safety-verification/SKILL.md", tmpSkill);
    const content = readFileSync(tmpSkill, "utf8")
      .replaceAll("AGENT-SUPREME-LAW.md", "SUPREME-LAW.md")
      .replace("Gateway", "gateway");
    writeFileSync(tmpSkill, content);

    const badResult = spawnSync(process.execPath, ["scripts/check-skills-config.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.notEqual(
      badResult.status,
      0,
      "checker must still exit non-zero when a Grok skill drops its Supreme Law reference",
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test(".grok agent surfaces stay trackable by git", () => {
  const coordinator = spawnSync("git", ["check-ignore", ".grok/agents/coordinator.md"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.notEqual(coordinator.status, 0);

  const skill = spawnSync("git", ["check-ignore", ".grok/skills/bob-claw-readiness-safety-verification/SKILL.md"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.notEqual(skill.status, 0);
});
