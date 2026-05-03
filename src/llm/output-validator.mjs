// Output validator for Codex-produced patches.
// Runs in this order, fail-fast:
//   1. ban-list scan (text + simple AST checks)
//   2. node --check on every produced .mjs / .js file
//   3. git apply --check on the unified diff
//
// AGENTS.md ban-list categories:
//   - process.env.BURNER_*  reads
//   - direct signer module imports outside policy/signer chain
//   - mutations to src/config/strategy-caps/*
//   - audit-log file rewrites or unlink (logs/*-audit.jsonl)
//   - kill-switch / dev-lock toggles outside cli/dev-lock.mjs

import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const BAN_PATTERNS = [
  { id: "burner_env_read", re: /process\.env\.BURNER_[A-Z0-9_]+/g },
  { id: "strategy_caps_write", re: /strategy-caps\/[\w./-]+\.mjs/g, requireWrite: true },
  { id: "audit_log_unlink", re: /(?:unlink(?:Sync)?|rm(?:Sync)?|truncate(?:Sync)?)\([^)]*-audit\.jsonl/g },
  { id: "dev_lock_toggle", re: /(?:writeFile(?:Sync)?|unlink(?:Sync)?)\([^)]*dev-lock(?!-audit)/g },
  { id: "kill_switch_toggle", re: /(?:writeFile(?:Sync)?|unlink(?:Sync)?)\([^)]*kill-switch(?!-audit)/g },
  { id: "raw_signer_import", re: /from\s+["'][^"']*signer\/(?!policy-)[a-z-]+["']/g },
];

export function scanBanList({ files = [] } = {}) {
  const findings = [];
  for (const file of files) {
    const content = String(file.content || "");
    for (const rule of BAN_PATTERNS) {
      const matches = content.match(rule.re) || [];
      if (matches.length === 0) continue;
      if (rule.requireWrite) {
        // For strategy-caps the rule is to flag when the patch writes to that path.
        // We approximate by detecting +/- lines if a unified diff is in the file.
        const isDiff = content.startsWith("diff ") || content.includes("\n+++ ");
        if (!isDiff) continue;
      }
      findings.push({ file: file.path, ruleId: rule.id, matches });
    }
  }
  return findings;
}

export function nodeCheck({ path, content }) {
  const dir = join(tmpdir(), `codex-validate-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, path.replace(/[/\\]/g, "_"));
  writeFileSync(target, content);
  const r = spawnSync(process.execPath, ["--check", target], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return { ok: r.status === 0, stderr: (r.stderr || "").trim() };
}

export function gitApplyCheck({ diffText, repoDir = process.cwd() }) {
  const r = spawnSync("git", ["apply", "--check", "-"], {
    cwd: repoDir,
    input: diffText,
    encoding: "utf8",
  });
  return { ok: r.status === 0, stderr: (r.stderr || "").trim() };
}

export function validateOutput({ files = [], diffText = null, repoDir = process.cwd() } = {}) {
  const banFindings = scanBanList({ files: [...files, ...(diffText ? [{ path: "<diff>", content: diffText }] : [])] });
  if (banFindings.length > 0) {
    return { ok: false, stage: "ban_list", findings: banFindings };
  }
  for (const f of files) {
    if (!/\.(mjs|js|cjs)$/.test(f.path)) continue;
    const r = nodeCheck(f);
    if (!r.ok) {
      return { ok: false, stage: "node_check", file: f.path, stderr: r.stderr };
    }
  }
  if (diffText) {
    const r = gitApplyCheck({ diffText, repoDir });
    if (!r.ok) {
      return { ok: false, stage: "git_apply", stderr: r.stderr };
    }
  }
  return { ok: true };
}
