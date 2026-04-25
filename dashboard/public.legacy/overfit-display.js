function compact(value) {
  return Number.isFinite(value) ? value.toLocaleString("ko-KR", { maximumFractionDigits: value >= 100 ? 0 : 1 }) : null;
}

function compactTimestamp(value) {
  if (!value) return null;
  return String(value).replace(".000Z", "Z");
}

function blockerLabel(label) {
  return {
    "shadow time window": "관찰 시간 부족",
    "BOB-neighbor route coverage": "BOB 인접 경로 부족",
    "candidate sample depth": "샘플 수 부족",
    "candidate amount diversity": "금액 다양성 부족",
    "quote decay windows": "decay 검증 부족",
    "time bucket diversity": "시간대 다양성 부족",
    "failure rate": "실패율 높음",
    "fresh gas snapshots": "gas 스냅샷 오래됨",
    "global route coverage": "전역 경로 커버리지 약함",
    "legacy records": "구형 레코드 남음",
    "Cloudflare failures": "Cloudflare 실패 존재",
    "gas snapshot failures": "gas 수집 실패 존재",
    "quote decay survival": "decay 생존 확인 부족",
  }[label] || label;
}

export function buildOverfitDisplay(audit) {
  if (!audit) {
    return {
      badge: "점검 대기",
      title: "과적합 점검 대기",
      body: "anti-overfit audit 결과를 기다리는 중",
    };
  }

  const blockers = (audit.blockers || []).map(blockerLabel);
  const warnings = (audit.warningLabels || []).map(blockerLabel);
  const horizon = Number.isFinite(audit.shadowHours) ? `${compact(audit.shadowHours)}h` : null;
  const buckets = Number.isFinite(audit.hourBuckets) ? `${audit.hourBuckets} bucket` : null;
  const runway =
    Number.isFinite(audit.remainingShadowHours) || Number.isFinite(audit.remainingHourBuckets)
      ? [
          Number.isFinite(audit.remainingShadowHours) ? `남은 ${compact(audit.remainingShadowHours)}h` : null,
          Number.isFinite(audit.remainingHourBuckets) ? `남은 ${audit.remainingHourBuckets} bucket` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
  const eta = audit.earliestTimeGateReadyAt ? `시간 게이트 최단 ${compactTimestamp(audit.earliestTimeGateReadyAt)}` : null;
  const source = audit.sampleSource === "shadow_observations" ? "shadow 기준" : "quote 기준";

  if (audit.decision === "LIVE_BLOCKED") {
    return {
      badge: "차단",
      title: "과적합 방지 차단 중",
      body: [blockers.slice(0, 2).join(" · "), horizon, buckets, runway, eta, source, warnings[0] ? `warn ${warnings[0]}` : null]
        .filter(Boolean)
        .join(" · "),
    };
  }

  return {
    badge: "통과",
    title: "과적합 핵심 점검 통과",
    body: [horizon, buckets, runway, eta, source, warnings[0] ? `warn ${warnings[0]}` : "추가 경고 없음"].filter(Boolean).join(" · "),
  };
}
