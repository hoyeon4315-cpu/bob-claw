import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpdateSummary } from "../dashboard/public/update-summary.js";

function baseStatus(overrides = {}) {
  return {
    gateway: {
      updateDetected: false,
      probeFailures: [],
      announcedChainCoverage: { missingAnnouncedChains: [] },
      changeReasons: [],
      observedAt: "2026-04-11T02:00:00.000Z",
      routeCount: 10,
      probeOk: 10,
      probeTotal: 10,
      ...overrides.gateway,
    },
    shadowCycle: overrides.shadowCycle ?? null,
  };
}

test("update summary prioritizes gateway updates ahead of shadow cycle copy", () => {
  const summary = buildUpdateSummary(
    baseStatus({
      gateway: {
        updateDetected: true,
        changeReasons: ["probe_health"],
        observedAt: "2026-04-11T01:58:00.000Z",
      },
      shadowCycle: {
        mode: "SHADOW_ONLY",
        headline: "Collect more shadow data",
        canary: {
          nextReadinessCheck: { label: "base->bitcoin ETH->BTC" },
          nextReadinessRefresh: { state: "cooldown", latestObservedAt: "2026-04-11T01:59:10.000Z", ageSeconds: 50, maxAgeSeconds: 300 },
          readinessCheckCount: 2,
        },
        treasury: {
          estimatedWalletUsd: 25.01,
          walletValueShortfallUsd: 224.99,
          noDemandBlockerCount: 2,
          nextNeeds: [{
            state: "waiting_demand",
            chain: "base",
            ticker: "ETH",
            refillEstimatedUsd: 7.11,
            activation: { label: "지갑 준비 점검이 더 필요함", routeLabel: "base->bitcoin ETH->BTC" },
          }],
        },
      },
    }),
    { now: new Date("2026-04-11T02:00:00.000Z").getTime() },
  );

  assert.equal(summary.badge, "확인 필요");
  assert.equal(summary.title, "새 움직임 확인 중");
  assert.equal(summary.body, "probe_health · 2분 전");
});

test("update summary falls back to shadow cycle guidance when gateway is quiet", () => {
  const summary = buildUpdateSummary(
    baseStatus({
      shadowCycle: {
        mode: "SHADOW_ONLY",
        headline: "Collect more shadow data",
        canary: {
          nextReadinessCheck: { label: "base->bitcoin ETH->BTC" },
          nextReadinessRefresh: { state: "cooldown", latestObservedAt: "2026-04-11T01:59:10.000Z", ageSeconds: 50, maxAgeSeconds: 300 },
          readinessCheckCount: 2,
        },
        topRoute: { label: "bob->base wBTC.OFT->wBTC.OFT" },
        treasury: {
          estimatedWalletUsd: 25.01,
          walletValueShortfallUsd: 224.99,
          noDemandBlockerCount: 2,
          nextNeeds: [{
            state: "waiting_demand",
            chain: "base",
            ticker: "ETH",
            refillEstimatedUsd: 7.11,
            activation: { label: "지갑 준비 점검이 더 필요함", routeLabel: "base->bitcoin ETH->BTC" },
          }],
        },
        audit: { issues: [] },
      },
    }),
    { now: new Date("2026-04-11T02:00:00.000Z").getTime() },
  );

  assert.equal(summary.badge, "사이클");
  assert.equal(summary.title, "지갑 규모 보강 필요");
  assert.match(summary.body, /floor까지 \$225 부족/);
  assert.match(summary.body, /Base ETH \$7\.11 보강 후보/);
  assert.match(summary.body, /지갑 준비 점검이 더 필요함/);
  assert.match(summary.body, /다음 점검 base->bitcoin ETH->BTC/);
  assert.match(summary.body, /최근 점검 50초 전/);
  assert.match(summary.body, /약 250초 후 재점검/);
  assert.match(summary.body, /외 1개 route/);
  assert.match(summary.body, /base->bitcoin ETH->BTC/);
  assert.match(summary.body, /수요 대기 refill 2건/);
});
