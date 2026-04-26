import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildDashboardStatus } from "../src/status/dashboard-status.mjs";
import { buildResearchFunnelSlice } from "../src/status/research-funnel-slice.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("dashboard status includes public-safe research funnel without raw event rows", () => {
  const researchFunnel = buildResearchFunnelSlice({
    resultsRows: [
      { event: "create", candidate_name: "agent_alpha", sharpe: 1.1, notes: "agent row" },
      { event: "stable", candidate_name: "factor_beta", sharpe: 0.7, notes: "factor row" },
    ],
    promotionIntents: [
      {
        ts: "2026-04-26T00:00:00.000Z",
        track: "B",
        candidateName: "factor_beta",
        gate: { passed: true },
      },
    ],
    trackBRuns: [
      {
        observedAt: "2026-04-26T00:00:00.000Z",
        generatedCount: 1,
        oosEligibleCount: 1,
      },
    ],
    generatedAt: "2026-04-26T00:00:00.000Z",
  });

  const status = buildDashboardStatus(
    {
      routesRecords: [],
      quotes: [],
      failures: [],
      researchFunnel,
    },
    { now: "2026-04-26T00:00:00.000Z" },
  );

  assert.equal(status.researchFunnel.available, true);
  assert.equal(status.researchFunnel.summary.promotionIntentCount, 1);
  assert.equal(status.researchFunnel.tracks.B.oosEligibleCount, 1);
  assert.equal(status.exposurePolicy.containsPrivateKeys, false);
  assert.doesNotMatch(JSON.stringify(status.researchFunnel), /agent row|factor row|rawRows|signer|executor/);
});

test("dashboard UI renders a compact read-only research funnel", () => {
  const source = readFileSync(join(HERE, "..", "dashboard", "public", "app.jsx"), "utf8");
  assert.match(source, /function ResearchFunnelCard/);
  assert.match(source, /Research funnel/);
  assert.match(source, /read-only/);
  assert.match(source, /OOS/);
  const cardStart = source.indexOf("function ResearchFunnelCard");
  const cardEnd = source.indexOf("function pairTokens", cardStart);
  const card = source.slice(cardStart, cardEnd);
  assert.doesNotMatch(card, /signer|executor|private key|deploy live/i);
});
