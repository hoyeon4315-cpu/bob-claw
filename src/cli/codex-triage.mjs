// codex-triage CLI scaffold (cron-friendly).
// Reads dashboard/public/autonomous-discovery-board.json + queue,
// applies codex-candidate-filter, asks Codex mini for category labels (dryRun
// safe), writes data/codex-triage/<isoTs>.json + updates queue.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { callCodex, PURPOSE } from "../llm/codex-client.mjs";
import { buildContextPack } from "../llm/context-pack.mjs";
import { filterCandidates } from "../strategy/codex-candidate-filter.mjs";

function readJsonOr(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function ensureDir(p) {
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
}

export async function runTriage({
  boardPath = "dashboard/public/autonomous-discovery-board.json",
  queuePath = "data/codex-triage/queue.json",
  outDir = "data/codex-triage",
  bindings = new Set(),
  history = [],
  regime = null,
  now = new Date(),
  callLlm = callCodex,
} = {}) {
  const board = readJsonOr(boardPath, { candidates: [] });
  const queue = readJsonOr(queuePath, { items: [] });
  const filtered = filterCandidates({
    candidates: board.candidates || [],
    history,
    bindings,
    regime,
    now,
  });

  const ctx = buildContextPack({
    purpose: "triage",
    fileExcerpts: [{ path: "filtered", content: JSON.stringify(filtered).slice(0, 4000) }],
  });

  const llm = await callLlm({
    purpose: PURPOSE.TRIAGE,
    prompt: "분류: new | stale | duplicate | reject. 한 줄 사유.",
    context: ctx,
  });

  const ts = new Date(now).toISOString();
  const result = {
    generatedAt: ts,
    boardSize: (board.candidates || []).length,
    accepted: filtered.filter((f) => f.decision === "accept").length,
    needsAdapter: filtered.filter((f) => f.decision === "needs_adapter").length,
    rejected: filtered.filter((f) => f.decision === "reject").length,
    items: filtered,
    llm: { ok: !!llm.ok, dryRun: !!llm.dryRun, reason: llm.reason || null, output: llm.output || null },
  };
  const outPath = join(outDir, `${ts.replace(/[:.]/g, "-")}.json`);
  ensureDir(outPath);
  writeFileSync(outPath, JSON.stringify(result, null, 2));

  const newQueue = {
    updatedAt: ts,
    items: [
      ...(queue.items || []),
      ...filtered
        .filter((f) => f.decision === "needs_adapter" || f.decision === "accept")
        .map((f) => ({ candidateId: f.candidateId, decision: f.decision, score: f.score, queuedAt: ts })),
    ],
  };
  ensureDir(queuePath);
  writeFileSync(queuePath, JSON.stringify(newQueue, null, 2));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTriage().then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
    .catch((err) => { console.error(err); process.exitCode = 1; });
}
