import { SMALL_CAPITAL_CAMPAIGN_MODE } from "../../config/small-capital-campaign-mode.mjs";
import { resolveProfileCapMatrix } from "../../config/sleeve-profile.mjs";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pnlValue(record = {}) {
  const usd = finite(record.netRealizedPnlUsd);
  if (usd !== null) return { value: usd, unit: "usd" };
  const sats = finite(record.netRealizedPnlSats);
  if (sats !== null) return { value: sats, unit: "sats" };
  return { value: null, unit: null };
}

function groupKey(record = {}) {
  return record.strategyId || record.familyKey || record.candidateId || "unknown";
}

function windowKey(record = {}) {
  return record.campaignWindowId || record.opportunityId || record.candidateId || record.runId || "unknown";
}

function currentTinyCapUsd(strategyId, strategyCapsById = {}) {
  const config = strategyCapsById[strategyId];
  const resolved = resolveProfileCapMatrix(config, { includeRadarCaps: true });
  return finite(Math.min(
    resolved?.tinyLivePerTxUsd ?? Number.POSITIVE_INFINITY,
    resolved?.radarCaps?.perCanaryUsd ?? Number.POSITIVE_INFINITY,
  ));
}

function nextGraduationCap(current, ladder = []) {
  const sorted = [...ladder].filter((value) => finite(value) !== null).sort((a, b) => a - b);
  for (const value of sorted) {
    if (current === null || value > current) return value;
  }
  if (current === null) return null;
  return Math.ceil(current * 1.5);
}

function withinLast24h(record = {}, now) {
  const settledAt = record.settledAt || record.observedAt;
  if (!settledAt) return false;
  const ageMs = new Date(now).getTime() - new Date(settledAt).getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 86_400_000;
}

function realizedRecords(records = []) {
  return records.filter((record) => record.lifecycle?.strategyRealized === true);
}

export function buildRadarCapGraduationReview({
  realizationRecords = [],
  now = new Date().toISOString(),
  policy = SMALL_CAPITAL_CAMPAIGN_MODE.radarLane,
  strategyCapsById = {},
} = {}) {
  const records = realizedRecords(realizationRecords);
  const loss24hUsd = records
    .filter((record) => withinLast24h(record, now))
    .reduce((total, record) => {
      const pnl = finite(record.netRealizedPnlUsd);
      return pnl !== null && pnl < 0 ? total + Math.abs(pnl) : total;
    }, 0);
  const lossLock = {
    tripped: loss24hUsd > Number(policy?.realizedDailyLossLockUsd ?? 25),
    loss24hUsd,
    thresholdUsd: Number(policy?.realizedDailyLossLockUsd ?? 25),
  };

  const groups = new Map();
  for (const record of records) {
    const key = groupKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const candidates = [...groups.entries()].map(([key, groupRecords]) => {
    const first = groupRecords[0] || {};
    const positiveRecords = groupRecords.filter((record) => {
      const pnl = pnlValue(record);
      return pnl.value !== null && pnl.value > 0;
    });
    const distinctWindows = new Set(positiveRecords.map(windowKey));
    const blockers = [];
    if (positiveRecords.length < 2) blockers.push("positive_realized_pnl_count_below_2");
    if (distinctWindows.size < 2) blockers.push("distinct_campaign_window_count_below_2");
    if (lossLock.tripped) blockers.push("radar_loss_lock_threshold_breached");

    const strategyId = first.strategyId || null;
    const current = currentTinyCapUsd(strategyId, strategyCapsById);
    if (current === null) blockers.push("tiny_live_cap_missing");

    return {
      key,
      strategyId,
      familyKey: first.familyKey || null,
      eligible: blockers.length === 0,
      blockers,
      realizedCount: groupRecords.length,
      positiveRealizedPnlCount: positiveRecords.length,
      distinctCampaignWindowCount: distinctWindows.size,
      currentTinyLivePerTxUsd: current,
      suggestedNextTinyLivePerTxUsd: blockers.length === 0
        ? nextGraduationCap(current, policy?.capGraduationUsd || [])
        : null,
      requiresCommittedDiff: true,
      autoRaise: false,
    };
  });

  return {
    generatedAt: now,
    lossLock,
    candidates,
  };
}
