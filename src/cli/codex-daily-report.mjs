// Codex daily report CLI scaffold.
//
// Reads 24h slices of audit logs + position snapshot + triage queue + payback
// KPI, hands a maskedcontext-pack to Codex (mini, dryRun-friendly), writes
// dashboard/public/daily-report.json. Telegram alerter remains read-only.
//
// AGENTS.md: Reporting Style respected — output is structured and the LLM
// produces summary text only. Decisions are not delegated.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { callCodex, PURPOSE } from "../llm/codex-client.mjs";
import { buildContextPack } from "../llm/context-pack.mjs";

function readJsonl24h(path, now = new Date()) {
  if (!existsSync(path)) return [];
  const cutoff = new Date(now).getTime() - 24 * 60 * 60 * 1000;
  const out = [];
  for (const line of readFileSync(path, "utf8").split(/\n/).filter(Boolean)) {
    try {
      const obj = JSON.parse(line);
      const ts = obj?.ts ? new Date(obj.ts).getTime() : 0;
      if (ts >= cutoff) out.push(obj);
    } catch { /* skip */ }
  }
  return out;
}

function readJsonOr(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function ensureDir(p) {
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
}

export async function buildDailyReport({
  now = new Date(),
  signerAuditPath = "logs/signer-audit.jsonl",
  positionMonitorAuditPath = "logs/position-monitor-audit.jsonl",
  triageQueuePath = "data/codex-triage/queue.json",
  paybackKpiPath = "data/payback/kpi-latest.json",
  outPath = "dashboard/public/daily-report.json",
  callLlm = callCodex,
} = {}) {
  const audit = [
    ...readJsonl24h(signerAuditPath, now),
    ...readJsonl24h(positionMonitorAuditPath, now),
  ];
  const queue = readJsonOr(triageQueuePath, { items: [] });
  const payback = readJsonOr(paybackKpiPath, {});

  const ctx = buildContextPack({
    purpose: "report",
    auditSlice: audit.slice(-200),
    positions: [],
    fileExcerpts: [
      { path: "triage-queue", content: JSON.stringify(queue).slice(0, 2000) },
      { path: "payback-kpi", content: JSON.stringify(payback).slice(0, 2000) },
    ],
  });

  const llm = await callLlm({
    purpose: PURPOSE.REPORT,
    prompt: "AGENTS.md Reporting Style 한국어 운영 요약. 1단계/이번에 한 일/왜 아직/다음 체크리스트 3개.",
    context: ctx,
  });

  const result = {
    generatedAt: new Date(now).toISOString(),
    auditEvents24h: audit.length,
    triageQueueSize: Array.isArray(queue?.items) ? queue.items.length : 0,
    paybackKpi: payback,
    llm: {
      ok: !!llm.ok,
      dryRun: !!llm.dryRun,
      reason: llm.reason || null,
      summary: llm.output || null,
    },
  };
  ensureDir(outPath);
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildDailyReport().then((r) => {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
