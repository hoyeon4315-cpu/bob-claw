import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOverfitDisplay } from "../dashboard/public/overfit-display.js";
import { buildUpdateSummary } from "../dashboard/public/update-summary.js";
import { buildWatchlistDisplay } from "../dashboard/public/watchlist-display.js";

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
    audit: overrides.audit ?? { quoteDecayWindows: [] },
    market: overrides.market ?? { chainWbtcPrices: [], observedChainCount: 0, missingChainCount: 0, staleChainCount: 0 },
    strategy: overrides.strategy ?? null,
    watchers: overrides.watchers ?? null,
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
        topRoute: {
          label: "bob->base wBTC.OFT->wBTC.OFT",
          tradeReadiness: "reject_no_net_edge",
          tradeReadinessLabel: "알려진 비용 반영 후 순이익이 아직 음수",
          tradeReadinessDetail: "순엣지 -$0.83",
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
        audit: { issues: [] },
      },
      audit: {
        decision: "LIVE_BLOCKED",
        blockers: ["shadow time window", "time bucket diversity"],
        earliestTimeGateReadyAt: "2026-04-18T02:00:00.000Z",
        quoteDecayWindows: [
          { windowSeconds: 5, profitableStartGroups: 1, coveredGroups: 1, survivedGroups: 1 },
          { windowSeconds: 15, profitableStartGroups: 1, coveredGroups: 1, survivedGroups: 0 },
          { windowSeconds: 30, profitableStartGroups: 0, coveredGroups: 0, survivedGroups: 0 },
        ],
      },
      market: {
        chainWbtcPrices: [
          { chain: "bitcoin", usd: 72823 },
          { chain: "base", usd: 72763 },
          { chain: "ethereum", usd: 72743.12, stale: true },
          { chain: "avalanche", usd: null },
          { chain: "bera", usd: null },
          { chain: "bob", usd: null },
          { chain: "bsc", usd: null },
          { chain: "soneium", usd: null },
          { chain: "sonic", usd: null },
          { chain: "unichain", usd: null },
        ],
        observedChainCount: 2,
        missingChainCount: 7,
        staleChainCount: 1,
      },
      watchers: {
        gasRefresh: { shouldRefresh: false },
        dexRefresh: { shouldRefresh: false, chains: ["avalanche", "base"], chainCount: 2 },
        blockedScore: { shouldRefresh: false },
        quoteDecay: {
          shouldRefresh: true,
          pendingWindowSeconds: 5,
          routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
          reasonLabel: "다음 decay 측정 창이 열려 재확인 가능",
        },
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
  assert.match(summary.body, /관찰 시간 최소치 4\/18 11:00 예상/);
  assert.match(summary.body, /약 7일 후/);
  assert.match(summary.body, /알려진 비용 반영 후 순이익이 아직 음수/);
  assert.match(summary.body, /순엣지 -\$0\.83/);
  assert.match(summary.body, /5s 1\/1 · 15s 0\/1/);
  assert.doesNotMatch(summary.body, /30s 0\/0/);
  assert.match(summary.body, /bob->base wBTC\.OFT->wBTC\.OFT · decay 5s 재확인 대기 · 다음 decay 측정 창이 열려 재확인 가능/);
  assert.match(summary.body, /체인 가격 2\/9개 · stale 1 · missing 7/);
  assert.match(summary.body, /수요 대기 refill 2건/);
  assert.equal(summary.body.match(/bob->base wBTC\.OFT->wBTC\.OFT/g)?.length, 1);
});

test("update summary skips time-gate copy when audit is blocked for non-time reasons only", () => {
  const summary = buildUpdateSummary(
    baseStatus({
      shadowCycle: {
        mode: "CANARY_PREP_BLOCKED",
        headline: "Best prepared route still fails objective score review",
        canary: {
          nextReadinessCheck: null,
          nextReadinessRefresh: null,
          readinessCheckCount: 0,
        },
        topRoute: {
          label: "bob->base wBTC.OFT->wBTC.OFT",
          tradeReadiness: "reject_no_net_edge",
          tradeReadinessLabel: "알려진 비용 반영 후 순이익이 아직 음수",
          tradeReadinessDetail: "순엣지 -$0.83",
        },
        treasury: {
          estimatedWalletUsd: 280,
          walletValueShortfallUsd: 0,
          noDemandBlockerCount: 0,
          nextNeeds: [],
        },
        audit: { issues: [] },
      },
      audit: {
        decision: "LIVE_BLOCKED",
        blockers: ["fresh gas snapshots"],
        earliestTimeGateReadyAt: "2026-04-18T02:00:00.000Z",
        quoteDecayWindows: [],
      },
    }),
    { now: new Date("2026-04-11T02:00:00.000Z").getTime() },
  );

  assert.doesNotMatch(summary.body, /관찰 시간 최소치/);
});

test("update summary promotes net-negative objective score blockers into the title", () => {
  const summary = buildUpdateSummary(
    baseStatus({
      strategy: {
        canarySelectionGap: {
          measuredLeader: {
            label: "ethereum->base WBTC->wBTC.OFT",
          },
          blockerLabels: [
            "wallet readiness check pending",
            "source gas snapshot stale",
            "exact execution gas pending",
          ],
        },
      },
      shadowCycle: {
        mode: "CANARY_PREP_BLOCKED",
        headline: "Best prepared route still fails objective score review",
        canary: {
          nextReadinessCheck: null,
          nextReadinessRefresh: null,
          readinessCheckCount: 0,
        },
        topRoute: {
          label: "bob->base wBTC.OFT->wBTC.OFT",
          tradeReadiness: "reject_no_net_edge",
          tradeReadinessLabel: "알려진 비용 반영 후 순이익이 아직 음수",
          tradeReadinessDetail: "순엣지 -$0.83",
        },
        treasury: {
          estimatedWalletUsd: 280,
          walletValueShortfallUsd: 0,
          noDemandBlockerCount: 0,
          nextNeeds: [],
        },
        audit: { issues: [] },
      },
    }),
    { now: new Date("2026-04-11T02:00:00.000Z").getTime() },
  );

  assert.equal(summary.title, "순이익 기준 미달");
  assert.match(summary.body, /Best prepared route still fails objective score review/);
  assert.match(summary.body, /측정상 ethereum->base WBTC->wBTC\.OFT는 더 좋아 보임/);
  assert.match(summary.body, /wallet readiness check pending/);
  assert.match(summary.body, /bob->base wBTC\.OFT->wBTC\.OFT/);
  assert.match(summary.body, /순엣지 -\$0\.83/);
});

test("update summary prefers active cycle guidance over static announced-chain gaps", () => {
  const summary = buildUpdateSummary(
    baseStatus({
      gateway: {
        announcedChainCoverage: { missingAnnouncedChains: ["optimism", "sei"] },
      },
      shadowCycle: {
        mode: "CANARY_PREP_BLOCKED",
        headline: "Best prepared route still fails objective score review",
        canary: {
          nextReadinessCheck: null,
          nextReadinessRefresh: null,
          readinessCheckCount: 0,
        },
        topRoute: {
          label: "bob->base wBTC.OFT->wBTC.OFT",
          tradeReadiness: "reject_no_net_edge",
          tradeReadinessLabel: "알려진 비용 반영 후 순이익이 아직 음수",
          tradeReadinessDetail: "순엣지 -$0.83",
        },
        treasury: {
          estimatedWalletUsd: 280,
          walletValueShortfallUsd: 0,
          noDemandBlockerCount: 0,
          nextNeeds: [],
        },
        audit: { issues: [] },
      },
    }),
    { now: new Date("2026-04-11T02:00:00.000Z").getTime() },
  );

  assert.equal(summary.title, "순이익 기준 미달");
  assert.doesNotMatch(summary.body, /announced, not live yet/);
});

test("update summary prioritizes source gas refresh ahead of later watcher work", () => {
  const summary = buildUpdateSummary(
    baseStatus({
      shadowCycle: {
        mode: "CANARY_PREP_BLOCKED",
        headline: "Best prepared route still fails objective score review",
        canary: {
          nextReadinessCheck: null,
          nextReadinessRefresh: null,
          readinessCheckCount: 0,
        },
        topRoute: {
          label: "bob->base wBTC.OFT->wBTC.OFT",
          tradeReadiness: "insufficient_data",
          tradeReadinessLabel: "source gas snapshot이 오래됨",
          tradeReadinessDetail: "base gas age 44m",
        },
        treasury: {
          estimatedWalletUsd: 280,
          walletValueShortfallUsd: 0,
          noDemandBlockerCount: 0,
          nextNeeds: [],
        },
        audit: { issues: [] },
      },
      watchers: {
        gasRefresh: {
          shouldRefresh: true,
          chains: ["base"],
          targetRouteCount: 1,
          routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
          reasonLabel: "source 체인 gas가 오래되어 다시 확인 필요",
        },
        dexRefresh: { shouldRefresh: true, chains: ["base"], chainCount: 1, targetRouteCount: 1, reasonLabel: "관측 중인 체인 가격이 모두 최신 상태" },
        blockedScore: { shouldRefresh: false },
        quoteDecay: { shouldRefresh: false },
      },
    }),
    { now: new Date("2026-04-11T02:00:00.000Z").getTime() },
  );

  assert.match(summary.body, /bob->base wBTC\.OFT->wBTC\.OFT · Base gas 재확인 · route 1개 다시 계산 · source 체인 gas가 오래되어 다시 확인 필요/);
});

test("update summary shows touched-chain rescoring scope for blocked score refresh", () => {
  const summary = buildUpdateSummary(
    baseStatus({
      shadowCycle: {
        mode: "CANARY_PREP_BLOCKED",
        headline: "Best prepared route still fails objective score review",
        canary: {
          nextReadinessCheck: null,
          nextReadinessRefresh: null,
          readinessCheckCount: 0,
        },
        topRoute: {
          label: "bob->base wBTC.OFT->wBTC.OFT",
          tradeReadiness: "reject_no_net_edge",
          tradeReadinessLabel: "알려진 비용 반영 후 순이익이 아직 음수",
          tradeReadinessDetail: "순엣지 -$0.83",
        },
        treasury: {
          estimatedWalletUsd: 280,
          walletValueShortfallUsd: 0,
          noDemandBlockerCount: 0,
          nextNeeds: [],
        },
        audit: { issues: [] },
      },
      watchers: {
        gasRefresh: { shouldRefresh: false },
        dexRefresh: { shouldRefresh: false },
        blockedScore: {
          shouldRefresh: true,
          scope: "touch_chains",
          chains: ["bob", "base"],
          targetRouteCount: 3,
          routeLabel: "bob->base wBTC.OFT->wBTC.OFT",
          changedInputLabels: ["source 가격 변경", "destination 가격 변경"],
        },
        quoteDecay: { shouldRefresh: false },
      },
    }),
    { now: new Date("2026-04-11T02:00:00.000Z").getTime() },
  );

  assert.match(summary.body, /bob->base wBTC\.OFT->wBTC\.OFT · BOB Mainnet · Base BTC route 3개 다시 계산 · source 가격 변경 · destination 가격 변경/);
});

test("update summary uses plain decay copy when no decay coverage exists yet", () => {
  const summary = buildUpdateSummary(
    baseStatus({
      shadowCycle: {
        mode: "SHADOW_ONLY",
        headline: "Collect more shadow data",
        canary: {
          nextReadinessCheck: null,
          nextReadinessRefresh: null,
          readinessCheckCount: 0,
        },
        topRoute: {
          label: "bob->base wBTC.OFT->wBTC.OFT",
          tradeReadiness: "reject_no_net_edge",
          tradeReadinessLabel: "알려진 비용 반영 후 순이익이 아직 음수",
          tradeReadinessDetail: "순엣지 -$0.83",
        },
        treasury: {
          estimatedWalletUsd: 280,
          walletValueShortfallUsd: 0,
          noDemandBlockerCount: 0,
          nextNeeds: [],
        },
        audit: { issues: [] },
      },
      audit: {
        quoteDecayWindows: [
          { windowSeconds: 5, profitableStartGroups: 0, coveredGroups: 0, survivedGroups: 0 },
          { windowSeconds: 15, profitableStartGroups: 0, coveredGroups: 0, survivedGroups: 0 },
          { windowSeconds: 30, profitableStartGroups: 0, coveredGroups: 0, survivedGroups: 0 },
        ],
      },
    }),
    { now: new Date("2026-04-11T02:00:00.000Z").getTime() },
  );

  assert.match(summary.body, /decay 샘플 축적 중/);
  assert.doesNotMatch(summary.body, /5s 0\/0/);
});

test("watchlist display compresses observed and missing BTC-family coverage for the mobile card", () => {
  const summary = buildWatchlistDisplay({
    observedTickers: ["BTC", "solvBTC", "uniBTC", "WBTC", "wBTC.OFT"],
    missingTickers: ["FBTC", "LBTC", "SolvBTC.BBN", "tBTC", "xSolvBTC"],
    unknownAssets: [],
  });

  assert.equal(summary.badge, "5 live · 5 watch");
  assert.equal(summary.observedText, "BTC, solvBTC, uniBTC, WBTC, wBTC.OFT");
  assert.equal(summary.missingText, "FBTC, LBTC, SolvBTC.BBN, tBTC +1");
  assert.equal(summary.unknownText, "none");
});

test("watchlist display shortens unknown token addresses when review is needed", () => {
  const summary = buildWatchlistDisplay({
    observedTickers: [],
    missingTickers: [],
    unknownAssets: [
      { chain: "bob", token: "0x1111111111111111111111111111111111111111" },
      { chain: "base", token: "0x2222222222222222222222222222222222222222" },
      { chain: "ethereum", token: "0x3333333333333333333333333333333333333333" },
    ],
  });

  assert.equal(summary.badge, "0 live · 0 watch");
  assert.equal(
    summary.unknownText,
    "bob:0x1111111111111111111111111111111111111111, base:0x2222222222222222222222222222222222222222 +1",
  );
});

test("overfit display surfaces live-blocking anti-overfit risks clearly", () => {
  const summary = buildOverfitDisplay({
    decision: "LIVE_BLOCKED",
    sampleSource: "shadow_observations",
    shadowHours: 11.12,
    hourBuckets: 6,
    remainingShadowHours: 156.88,
    remainingHourBuckets: 18,
    earliestTimeGateReadyAt: "2026-04-18T02:00:00.000Z",
    blockers: ["shadow time window", "failure rate", "fresh gas snapshots"],
    warningLabels: ["Cloudflare failures"],
  });

  assert.equal(summary.badge, "차단");
  assert.equal(summary.title, "과적합 방지 차단 중");
  assert.match(summary.body, /관찰 시간 부족/);
  assert.match(summary.body, /실패율 높음/);
  assert.match(summary.body, /11\.1h/);
  assert.match(summary.body, /6 bucket/);
  assert.match(summary.body, /남은 157h/);
  assert.match(summary.body, /남은 18 bucket/);
  assert.match(summary.body, /시간 게이트 최단 2026-04-18T02:00:00Z/);
  assert.match(summary.body, /shadow 기준/);
  assert.match(summary.body, /warn Cloudflare 실패 존재/);
});

test("overfit display marks review-ready audits without hiding warnings", () => {
  const summary = buildOverfitDisplay({
    decision: "LIVE_CANARY_REVIEW_POSSIBLE",
    sampleSource: "quotes",
    shadowHours: 180,
    hourBuckets: 26,
    remainingShadowHours: 0,
    remainingHourBuckets: 0,
    earliestTimeGateReadyAt: "2026-04-11T02:00:00.000Z",
    blockers: [],
    warningLabels: ["global route coverage"],
  });

  assert.equal(summary.badge, "통과");
  assert.equal(summary.title, "과적합 핵심 점검 통과");
  assert.match(summary.body, /180h/);
  assert.match(summary.body, /26 bucket/);
  assert.match(summary.body, /남은 0h/);
  assert.match(summary.body, /남은 0 bucket/);
  assert.match(summary.body, /시간 게이트 최단 2026-04-11T02:00:00Z/);
  assert.match(summary.body, /quote 기준/);
  assert.match(summary.body, /warn 전역 경로 커버리지 약함/);
});
