import { labelFor } from "./scene-model.js";
import { marketCoverage } from "./market-display.js";

function money(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 100) return `$${value.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}`;
}

function compactAge(value, now = Date.now()) {
  if (!value) return "-";
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}초 전`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  return `${Math.round(minutes / 60)}시간 전`;
}

function treasuryNeedText(treasury) {
  const topNeed = treasury?.nextNeeds?.[0];
  if (!topNeed) return null;
  const label = `${labelFor(topNeed.chain)} ${topNeed.ticker}`;
  const usd = Number.isFinite(topNeed.refillEstimatedUsd) ? money(topNeed.refillEstimatedUsd) : null;
  const lead = `${label}${usd ? ` ${usd}` : ""} ${topNeed.state === "ready_now" ? "보강 우선" : "보강 후보"}`;
  const activation = topNeed.activation?.label || (topNeed.state === "ready_now" ? "즉시 보강 가능" : "수요 신호 대기");
  const routeText = topNeed.activation?.routeLabel ? `${topNeed.activation.routeLabel}` : null;
  const extraCount = (treasury?.nextNeeds?.length || 0) - 1;
  return [lead, activation, routeText, extraCount > 0 ? `외 ${extraCount}건` : null].filter(Boolean).join(" · ");
}

function readinessCheckText(cycle, now) {
  const nextCheck = cycle?.canary?.nextReadinessCheck;
  if (!nextCheck) return null;
  const refresh = cycle?.canary?.nextReadinessRefresh || null;
  const extraCount = (cycle?.canary?.readinessCheckCount || 0) - 1;
  const refreshText =
    refresh?.state === "cooldown"
      ? [
          refresh.latestObservedAt ? `최근 점검 ${compactAge(refresh.latestObservedAt, now)}` : "최근 점검 있음",
          Number.isFinite(refresh.maxAgeSeconds) && Number.isFinite(refresh.ageSeconds)
            ? `약 ${Math.max(0, refresh.maxAgeSeconds - refresh.ageSeconds)}초 후 재점검`
            : null,
        ].filter(Boolean).join(" · ")
      : refresh?.state === "ready_now"
        ? "지금 재점검 가능"
        : null;
  return [
    `다음 점검 ${nextCheck.label}`,
    refreshText,
    extraCount > 0 ? `외 ${extraCount}개 route` : null,
  ].filter(Boolean).join(" · ");
}

function topRouteText(cycle) {
  if (!cycle?.topRoute?.label) return "상위 경로 없음";
  if (!cycle.topRoute.tradeReadinessLabel) return cycle.topRoute.label;
  return [
    cycle.topRoute.label,
    cycle.topRoute.tradeReadinessLabel,
    cycle.topRoute.tradeReadinessDetail,
  ].filter(Boolean).join(" · ");
}

function marketCoverageText(status) {
  const market = status.market || null;
  const prices = market?.chainWbtcPrices || [];
  if (!market || prices.length === 0) return null;
  const { observed, missing, stale, total } = marketCoverage(market);
  if (total <= 0) return null;
  if (!stale && !missing) return `체인 가격 ${observed}/${total}개 관측`;
  return `체인 가격 ${observed}/${total}개 · stale ${stale} · missing ${missing}`;
}

function quoteDecayText(status) {
  const windows = status.audit?.quoteDecayWindows || [];
  if (!windows.length) return null;
  const required = windows.filter((item) => [5, 15, 30].includes(item.windowSeconds));
  if (!required.length) return null;
  return required
    .map((item) => `${item.windowSeconds}s ${item.survivedGroups}/${item.profitableStartGroups || item.coveredGroups}`)
    .join(" · ");
}

export function buildUpdateSummary(status, options = {}) {
  const now = options.now ?? Date.now();
  const hasUpdate = status.gateway.updateDetected || status.gateway.probeFailures.length;
  const missingAnnounced = status.gateway.announcedChainCoverage?.missingAnnouncedChains || [];
  if (hasUpdate) {
    return {
      badge: "확인 필요",
      title: "새 움직임 확인 중",
      body: `${status.gateway.changeReasons.join(", ") || "경로 상태 변화"} · ${compactAge(status.gateway.observedAt, now)}`,
    };
  }
  if (missingAnnounced.length) {
    return {
      badge: "확인 필요",
      title: "API route gap",
      body: `${missingAnnounced.map(labelFor).join(" · ")} announced, not live yet`,
    };
  }

  const cycle = status.shadowCycle;
  if (cycle?.mode) {
    const titleByMode = {
      CANARY_PREP_BLOCKED: "지갑 준비 확인 필요",
      REVIEW_CANARY_PROGRESS: "검토 가능한 경로 있음",
      SHADOW_REVIEW_ONLY: "관찰 결과 검토 단계",
      SHADOW_ONLY: "데이터 관찰 중",
    };
    const auditIssue = cycle.audit?.issues?.[0] || null;
    const walletShortfall = cycle.treasury?.walletValueShortfallUsd;
    const routeText = topRouteText(cycle);
    const walletText = Number.isFinite(cycle.treasury?.estimatedWalletUsd)
      ? `지갑 추정 ${money(cycle.treasury.estimatedWalletUsd)}`
      : null;
    const needText = treasuryNeedText(cycle.treasury);
    const nextCheckText = readinessCheckText(cycle, now);
    const marketText = marketCoverageText(status);
    const decayText = quoteDecayText(status);
    const walletShortfallText =
      Number.isFinite(walletShortfall) && walletShortfall > 0
        ? `floor까지 ${money(walletShortfall)} 부족`
        : null;
    const noDemandText =
      (cycle.treasury?.noDemandBlockerCount || 0) > 0 ? `수요 대기 refill ${cycle.treasury.noDemandBlockerCount}건` : null;
    return {
      badge: auditIssue ? "점검" : cycle.mode === "REVIEW_CANARY_PROGRESS" ? "리뷰" : "사이클",
      title: auditIssue
        ? "운영 주소 점검 필요"
        : Number.isFinite(walletShortfall) && walletShortfall > 0
          ? "지갑 규모 보강 필요"
          : cycle.topRoute?.tradeReadiness === "reject_no_net_edge"
            ? "순이익 기준 미달"
          : titleByMode[cycle.mode] || "현재 사이클 상태",
      body: [auditIssue?.label || walletShortfallText || cycle.headline, needText, nextCheckText, decayText, marketText, routeText, walletText, noDemandText]
        .filter(Boolean)
        .join(" · "),
    };
  }

  return {
    badge: "조용함",
    title: "새 업데이트 없음",
    body: `${status.gateway.routeCount}개 경로 · ${status.gateway.probeOk}/${status.gateway.probeTotal} probe · ${compactAge(status.gateway.observedAt, now)}`,
  };
}
