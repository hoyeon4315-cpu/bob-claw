export function buildFinalOperatorExplainer({
  strategySnapshot = null,
  phase3Validation = null,
  allocatorCore = null,
  protocolMarketWatchers = null,
  btcOnlyE2eDryRun = null,
  tinyLiveCanaryRollout = null,
  preliveValidation = null,
  liveOpsHandoff = null,
  now = null,
} = {}) {
  const strategyPrimary = liveOpsHandoff?.summary?.candidateType === "strategy";
  const primaryLiveLane = liveOpsHandoff?.primaryLiveLane || null;
  const exactRouteLane = liveOpsHandoff?.blockedExactRouteLane || null;
  const signerBackedWrappedLoopMissing =
    liveOpsHandoff?.candidate?.blockerReasons?.includes("signer_backed_oos_receipts_missing") ||
    phase3Validation?.summary?.topBlockedId === "wrapped_btc_loop_validation";
  const blockerPhrases = [
    strategyPrimary && signerBackedWrappedLoopMissing ? "1순위 live 후보인 wrapped loop의 signer-backed OOS receipt 부족" : null,
    !strategyPrimary && (btcOnlyE2eDryRun?.summary?.nextAction?.code || "") === "hold_dex_quote" ? "현재 exact-route의 DEX 미지원/blocked quote" : null,
    !strategyPrimary && preliveValidation?.exactRouteForkEconomicStatus === "blocked_no_net_edge" ? "현재 후보 route의 no net edge" : null,
    strategyPrimary && ((btcOnlyE2eDryRun?.summary?.nextAction?.code || "") === "hold_dex_quote" || preliveValidation?.exactRouteForkEconomicStatus === "blocked_no_net_edge")
      ? "exact-route 경로는 여전히 DEX 미지원/no net edge로 별도 보류"
      : null,
    !strategyPrimary && signerBackedWrappedLoopMissing ? "wrapped loop의 signer-backed OOS receipt 부족" : null,
    (protocolMarketWatchers?.summary?.reviewRequiredCount ?? 0) > 0 ? "미기록 trust tier" : null,
  ].filter(Boolean);
  const primaryLaneSummary = primaryLiveLane?.label
    ? `1순위 live 승격 대상은 ${primaryLiveLane.label}`
    : "1순위 live 승격 대상이 아직 정리되지 않았고";
  const exactRouteSummary =
    exactRouteLane?.status === "blocked"
      ? "exact-route lane은 blocked secondary로 분리돼 있습니다"
      : "exact-route lane은 별도 추적 중입니다";
  const koSummary = `지금은 구축은 많이 됐지만 라이브 진입 단계는 아닙니다. 전략 후보 ${allocatorCore?.summary?.candidateCount ?? 0}개가 정리됐고, 실제 active allocation은 0개이며, ${primaryLaneSummary}, ${exactRouteSummary}. 핵심 blocker는 ${blockerPhrases.join(" · ") || "운영 증거 부족"}입니다.`;
  const koWhatWorks = [
    "완화된 정책 기준으로 Phase 1 재분류, 연구 보드, Phase 3 검증, allocator core까지 연결됨",
    "wrapped-BTC lending loop는 dry-run receipt와 auto-unwind 설계까지 연결됨",
    "prelive / canary / handoff 표면이 이미 current context 기준으로 이어짐",
  ];
  const koWhatBlocks = [
    `primary live lane=${primaryLiveLane?.status || "unknown"} target=${primaryLiveLane?.label || "none"}`,
    `exact-route lane=${exactRouteLane?.priority || "secondary"} ${exactRouteLane?.status || "unknown"} stuck=${exactRouteLane?.topBlockedStageId || btcOnlyE2eDryRun?.summary?.topStuckPointId || "none"}`,
    `Phase 3 blocked=${phase3Validation?.summary?.validationCount ? (phase3Validation.summary.validationCount - (phase3Validation.summary.passedCount || 0)) : 0}`,
    `watcher blocked=${protocolMarketWatchers?.summary?.blockedCount ?? 0}`,
    `tiny canary decision=${tinyLiveCanaryRollout?.summary?.decision || "unknown"}`,
  ];
  const koNext = [
    preliveValidation?.nextActionCode || null,
    protocolMarketWatchers?.summary?.nextAction?.code || null,
    btcOnlyE2eDryRun?.summary?.nextAction?.code || null,
  ].filter(Boolean);
  return {
    schemaVersion: 1,
    generatedAt: now || new Date().toISOString(),
    status: tinyLiveCanaryRollout?.summary?.status || preliveValidation?.validationStatus || "blocked",
    simpleKoreanSummary: koSummary,
    korean: {
      whatWorks: koWhatWorks,
      whatBlocks: koWhatBlocks,
      nextSteps: koNext,
      pnlLabels: {
        paper: "가정 기반 계산값",
        estimated: "드라이런/시뮬레이션 기반 추정값",
        realized: "실제 receipt 기반 확정값",
      },
    },
    english: {
      summary:
        "The system is no longer missing strategy surfaces; it is blocked by evidence quality and operational freshness rather than by lack of ideas.",
      currentBuildStatus: {
        phase3PassedCount: phase3Validation?.summary?.passedCount ?? 0,
        candidateCount: allocatorCore?.summary?.candidateCount ?? 0,
        activeAllocationCount: allocatorCore?.summary?.activeAllocationCount ?? 0,
        watcherBlockedCount: protocolMarketWatchers?.summary?.blockedCount ?? 0,
      },
    },
    laneStatus: {
      primaryLive: {
        label: primaryLiveLane?.label || null,
        priority: primaryLiveLane?.priority || "primary",
        status: primaryLiveLane?.status || null,
        blockerSummary: blockerPhrases[0] || null,
        nextActionCode: liveOpsHandoff?.summary?.nextAction || null,
      },
      exactRoute: {
        label: exactRouteLane?.label || "BTC exact-route lane",
        priority: exactRouteLane?.priority || "secondary",
        status: exactRouteLane?.status || null,
        blockerSummary: exactRouteLane?.blockerReasons?.join(",") || null,
        nextActionCode: exactRouteLane?.nextAction?.code || btcOnlyE2eDryRun?.summary?.nextAction?.code || null,
      },
    },
    nextAction: liveOpsHandoff?.summary?.nextAction ? {
      code: liveOpsHandoff.summary.nextAction,
      command: liveOpsHandoff.summary.nextActionCommand || null,
    } : tinyLiveCanaryRollout?.summary?.nextAction || preliveValidation?.nextAction || btcOnlyE2eDryRun?.summary?.nextAction || null,
    receiptIngestionGuide: liveOpsHandoff?.receiptIngestionGuide || null,
    references: {
      strategySnapshot: "data/strategy-snapshot.json",
      phase3StrategyValidation: "data/phase3-strategy-validation.json",
      allocatorCore: "data/allocator-core.json",
      protocolMarketWatchers: "data/protocol-market-watchers.json",
      btcOnlyE2eDryRun: "data/btc-only-e2e-dry-run.json",
      tinyLiveCanaryRollout: "data/tiny-live-canary-rollout.json",
      liveOpsHandoff: "data/live-ops-handoff.json",
    },
  };
}
