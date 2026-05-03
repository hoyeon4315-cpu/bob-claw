// Wires Codex triage → scaffold → output validation → scoring into the
// generic auto-research-loop. Pure orchestration; never raises caps,
// never auto-merges, never toggles kill-switch / dev-lock.
//
// Each iteration:
//   1. runTriage -> classifies candidates, writes queue
//   2. runScaffold -> for needs_adapter, asks Codex coder + validates
//   3. scoreCandidateResults -> applies regime + OOS gates
//   4. returns { passed, blockers, costUsd, files, diffLines }
//
// In dryRun (no OPENAI_API_KEY_PATH), Codex calls return { dryRun: true } so
// scaffold yields zero files and the loop aborts on same_failure_cap quickly.
// That is the expected, safe default.

import { runTriage } from "./codex-triage.mjs";
import { runScaffold } from "./codex-scaffold-adapter.mjs";
import { scoreCandidateResults } from "../../research/score.mjs";
import { runLoop, LOOP_LIMITS } from "./auto-research-loop.mjs";

export function buildIterate({
  triagePaths = {},
  scaffoldPaths = {},
  bindings = new Set(),
  history = [],
  regime = null,
  family = "vault_share",
  callLlm,
} = {}) {
  return async function iterate({ iteration }) {
    const triage = await runTriage({ ...triagePaths, bindings, history, regime, callLlm });
    const scaffold = await runScaffold({ ...scaffoldPaths, family, callLlm });
    const files = [];
    let diffLines = 0;
    let costUsd = 0;
    for (const r of scaffold.results || []) {
      if (Array.isArray(r.files)) files.push(...r.files.map((p) => ({ path: p })));
      if (r.llm?.usage?.costUsd) costUsd += Number(r.llm.usage.costUsd) || 0;
      if (r.llm?.usage?.diffLines) diffLines += Number(r.llm.usage.diffLines) || 0;
    }
    return { iteration, triage, scaffold, files, diffLines, costUsd };
  };
}

export function buildScorer({ candidateName = "auto-research", track = "trackA", foldResults = [] } = {}) {
  return async function scorer(iter) {
    const okResults = (iter.scaffold?.results || []).filter((r) => r.ok);
    if (okResults.length === 0) {
      const blockers = ["scaffold_zero_ok"];
      if ((iter.scaffold?.results || []).every((r) => r.reason === "llm_unavailable")) {
        blockers.push("llm_unavailable");
      }
      return { passed: false, blockers };
    }
    const score = scoreCandidateResults({ candidateName, track, foldResults });
    const blockers = [];
    if (!score.regimeBreakdown?.bear?.sampleCount) blockers.push("regime_breakdown_missing");
    if (score.oosHoldout && score.oosHoldout.netPositive === false) blockers.push("oos_holdout_negative");
    if (!score.passed) blockers.push("score_failed");
    return { passed: blockers.length === 0, blockers, score };
  };
}

export async function runAutoResearch({
  limits = LOOP_LIMITS,
  auditPath = "logs/auto-research-audit.jsonl",
  iterateOptions = {},
  scorerOptions = {},
} = {}) {
  const iterate = buildIterate(iterateOptions);
  const scorer = buildScorer(scorerOptions);
  return runLoop({ iterate, scorer, limits, auditPath });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryLimits = { ...LOOP_LIMITS, iterationCap: 3, sameFailureCap: 2 };
  const r = await runAutoResearch({ limits: dryLimits });
  console.log(JSON.stringify({ summary: { ok: r.ok, reason: r.reason, iterations: r.history.length, cumulativeCostUsd: r.cumulativeCostUsd } }, null, 2));
  process.exit(r.ok ? 0 : 0);
}
