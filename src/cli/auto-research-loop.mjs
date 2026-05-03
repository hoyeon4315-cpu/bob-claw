// auto-research-loop CLI scaffold (Andrej Karpathy-style iterate-until-pass).
// Runs research/run.mjs candidate scoring repeatedly with bounded budgets.
//
// Hard caps (decided locks):
//   - iterationCap: 20 iterations
//   - wallclockCapMs: 2 hours
//   - costCapUsd: $2 per loop (Codex spend per loop)
//   - sameFailureCap: 3 (same blocker repeats → abort)
//   - maxFiles: 15 per iteration (bounded by output-validator)
//   - maxDiffLines: 400 per iteration
//
// AGENTS.md: never auto-merges PR, never toggles kill-switch / dev-lock, never
// raises caps. Failures append to logs/auto-research-audit.jsonl.

import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export const LOOP_LIMITS = Object.freeze({
  iterationCap: 20,
  wallclockCapMs: 2 * 60 * 60 * 1000,
  costCapUsd: 2.0,
  sameFailureCap: 3,
  maxFiles: 15,
  maxDiffLines: 400,
});

function ensureDir(p) {
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
}

export async function runLoop({
  iterate,
  scorer,
  limits = LOOP_LIMITS,
  auditPath = "logs/auto-research-audit.jsonl",
  now = () => new Date(),
} = {}) {
  if (typeof iterate !== "function") throw new TypeError("iterate(iter) function required");
  if (typeof scorer !== "function") throw new TypeError("scorer(result) function required");
  const startMs = now().getTime();
  let cumulativeCostUsd = 0;
  const failureCounts = new Map();
  const history = [];

  for (let i = 0; i < limits.iterationCap; i++) {
    const elapsedMs = now().getTime() - startMs;
    if (elapsedMs > limits.wallclockCapMs) {
      ensureDir(auditPath);
      appendFileSync(auditPath, JSON.stringify({ ts: now().toISOString(), action: "abort", reason: "wallclock_cap", iteration: i, elapsedMs }) + "\n");
      return { ok: false, reason: "wallclock_cap", iteration: i, history };
    }
    if (cumulativeCostUsd >= limits.costCapUsd) {
      ensureDir(auditPath);
      appendFileSync(auditPath, JSON.stringify({ ts: now().toISOString(), action: "abort", reason: "cost_cap", iteration: i, cumulativeCostUsd }) + "\n");
      return { ok: false, reason: "cost_cap", iteration: i, history };
    }

    const iter = await iterate({ iteration: i, history, cumulativeCostUsd });
    cumulativeCostUsd += Number(iter?.costUsd) || 0;

    if (iter?.files && iter.files.length > limits.maxFiles) {
      history.push({ iteration: i, ok: false, reason: "max_files_exceeded" });
      continue;
    }
    if (iter?.diffLines && iter.diffLines > limits.maxDiffLines) {
      history.push({ iteration: i, ok: false, reason: "max_diff_lines_exceeded" });
      continue;
    }

    const score = await scorer(iter);
    history.push({ iteration: i, score, costUsd: iter?.costUsd || 0 });

    if (score?.passed) {
      ensureDir(auditPath);
      appendFileSync(auditPath, JSON.stringify({ ts: now().toISOString(), action: "pass", iteration: i, cumulativeCostUsd }) + "\n");
      return { ok: true, iteration: i, history, score, cumulativeCostUsd };
    }

    const failureKey = (score?.blockers || []).slice().sort().join("|") || "unknown";
    const newCount = (failureCounts.get(failureKey) || 0) + 1;
    failureCounts.set(failureKey, newCount);
    if (newCount >= limits.sameFailureCap) {
      ensureDir(auditPath);
      appendFileSync(auditPath, JSON.stringify({ ts: now().toISOString(), action: "abort", reason: "same_failure_cap", failureKey, count: newCount }) + "\n");
      return { ok: false, reason: "same_failure_cap", failureKey, history, cumulativeCostUsd };
    }
  }
  ensureDir(auditPath);
  appendFileSync(auditPath, JSON.stringify({ ts: now().toISOString(), action: "abort", reason: "iteration_cap", cumulativeCostUsd }) + "\n");
  return { ok: false, reason: "iteration_cap", history, cumulativeCostUsd };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("auto-research-loop is a library; provide iterate+scorer via runLoop().");
  console.log(JSON.stringify({ limits: LOOP_LIMITS }, null, 2));
}
