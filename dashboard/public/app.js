// Generated from app.jsx by src/cli/build-dashboard-public.mjs.

(() => {
const { useState, useEffect, useRef } = React;
const TABS = [
  { id: "flow", label: "Flow" },
  { id: "defi", label: "DeFi" },
  { id: "assets", label: "Assets" }
];
function TabView({ tabs, active, onChange, children }) {
  const trackRef = useRef(null);
  const programmaticRef = useRef(false);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const idx = tabs.findIndex((t) => t.id === active);
    const target = idx * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) < 2) return;
    programmaticRef.current = true;
    el.scrollTo({ left: target, behavior: "smooth" });
    clearTimeout(programmaticRef.timer);
    programmaticRef.timer = setTimeout(() => {
      programmaticRef.current = false;
    }, 500);
  }, [active, tabs]);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf, settleTimer;
    const onScroll = () => {
      if (programmaticRef.current) return;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const idx = Math.round(el.scrollLeft / el.clientWidth);
          const next = tabs[idx]?.id;
          if (next && next !== active) onChange(next);
        });
      }, 140);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(settleTimer);
    };
  }, [tabs, active, onChange]);
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "tabbar", role: "tablist" }, tabs.map((t) => /* @__PURE__ */ React.createElement("button", { key: t.id, role: "tab", "aria-selected": active === t.id, onClick: () => onChange(t.id) }, t.label))), /* @__PURE__ */ React.createElement("div", { className: "tabtrack", ref: trackRef }, children));
}
function fmtSats(n) {
  if (!Number.isFinite(n) || n <= 0) return "\u2014";
  if (n >= 1e8) return (n / 1e8).toFixed(4) + " BTC";
  return n.toLocaleString() + " sats";
}
function fmtUsd(n) {
  if (!Number.isFinite(n)) return "\u2014";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toFixed(2);
}
function fmtUsdCompact(n) {
  if (!Number.isFinite(n)) return "\u2014";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs > 0 && abs < 1) return sign + "<$1";
  return sign + "$" + abs.toLocaleString(void 0, { maximumFractionDigits: 0 });
}
function fmtPct(n, digits = 2) {
  if (!Number.isFinite(n)) return "\u2014";
  return n.toFixed(digits) + "%";
}
function fmtYieldTag(value, basis) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = value >= 10 ? `$${value.toFixed(0)}` : value >= 1 ? `$${value.toFixed(2)}` : value >= 0.01 ? `$${value.toFixed(3)}` : "<$0.01";
  return basis === "estimated" ? `~${rounded}` : `+${rounded}`;
}
function fmtYieldSubLabel(basis) {
  if (basis === "estimated") return "Est. yield";
  if (basis === "realized") return "Realized";
  return null;
}
function fmtWhen(value) {
  if (!value) return "\uC2DC\uAC04 \uBBF8\uD655\uC778";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "\uC2DC\uAC04 \uBBF8\uD655\uC778";
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
function pnlKindLabel(kind) {
  return {
    gas_zip_native_refuel: "Gas refuel",
    erc4626_protocol_canary: "ERC4626 canary",
    lifi_bridge: "LI.FI bridge",
    token_dex_experiment: "Token DEX probe",
    native_dex_experiment: "Native DEX probe",
    gateway_btc_consolidation: "Gateway consolidation",
    across_bridge: "Across bridge"
  }[kind] || titleCaseLabel(kind || "activity");
}
function formatStatusAge(value) {
  if (!value) return null;
  const observedAtMs = new Date(value).getTime();
  if (!Number.isFinite(observedAtMs)) return null;
  const ageMs = Date.now() - observedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  if (ageMs < 15e3) return "just now";
  if (ageMs < 6e4) return `${Math.round(ageMs / 1e3)}s ago`;
  if (ageMs < 36e5) return `${Math.round(ageMs / 6e4)}m ago`;
  return `${Math.round(ageMs / 36e5)}h ago`;
}
const HISTORY_FILTER_STORAGE_KEY = "bob-claw:history-filter";
const HISTORY_EXPANDED_STORAGE_KEY = "bob-claw:history-expanded";
function readPersistedHistoryFilter() {
  try {
    const value = window.localStorage.getItem(HISTORY_FILTER_STORAGE_KEY);
    return value || "all";
  } catch {
    return "all";
  }
}
function writePersistedHistoryFilter(value) {
  try {
    window.localStorage.setItem(HISTORY_FILTER_STORAGE_KEY, value);
  } catch {
  }
}
function readPersistedHistoryExpanded() {
  try {
    return window.localStorage.getItem(HISTORY_EXPANDED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}
function writePersistedHistoryExpanded(value) {
  try {
    window.localStorage.setItem(HISTORY_EXPANDED_STORAGE_KEY, value ? "true" : "false");
  } catch {
  }
}
function normalizeUiStrategyId(id) {
  return String(id || "").replace(/-/g, "_");
}
function findStrategyById(id) {
  const key = normalizeUiStrategyId(id);
  return (window.STRATEGIES || []).find((item) => normalizeUiStrategyId(item.id) === key) || null;
}
function titleCaseLabel(value) {
  return String(value || "").split(/[\s._-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function normalizeChainId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const alias = {
    btc: "bitcoin",
    bitcoin: "bitcoin",
    eth: "ethereum",
    ethereum: "ethereum",
    avalanche: "avalanche",
    base: "base",
    berachain: "bera",
    bnb: "bsc",
    bsc: "bsc",
    bob: "bob",
    optimism: "optimism",
    sei: "sei",
    soneium: "soneium",
    sonic: "sonic",
    unichain: "unichain"
  }[raw];
  if (alias) return alias;
  const hit = (window.CHAINS || []).find((chain) => {
    const chainName = String(chain?.name || "").trim().toLowerCase();
    return chain?.id === raw || chainName === raw;
  });
  return hit?.id || null;
}
function displayChainName(id) {
  const hit = (window.CHAINS || []).find((chain) => chain?.id === id);
  return hit?.name || titleCaseLabel(id);
}
function displayProtocolName(id) {
  const known = {
    yo: "YO",
    gmx: "GMX"
  };
  return id ? known[String(id).toLowerCase()] || titleCaseLabel(id) : null;
}
function parseRouteHint(label) {
  const parts = String(label || "").split(/\s*→\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? { source: parts[0], target: parts[1] } : null;
}
function StatCard({ label, main, sub, accent, onTap, tappable }) {
  return /* @__PURE__ */ React.createElement("div", { onClick: onTap, style: {
    padding: "8px 12px",
    background: "var(--card)",
    borderRadius: 12,
    border: "0.5px solid var(--line)",
    cursor: tappable ? "pointer" : "default",
    transition: `transform 180ms ${"cubic-bezier(0.22, 1, 0.36, 1)"}`
  } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 8.5, color: "var(--ink-4)", letterSpacing: 1, textTransform: "uppercase" } }, label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 600, letterSpacing: -0.3, marginTop: 2, color: accent || "var(--ink)" } }, main), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--ink-3)", marginTop: 0 } }, sub));
}
function TriCard({ cells, compact = false }) {
  return /* @__PURE__ */ React.createElement("div", { style: {
    display: "flex",
    alignItems: "stretch",
    padding: compact ? "6px 2px" : "10px 4px",
    background: "var(--card)",
    borderRadius: compact ? 12 : 14,
    border: "0.5px solid var(--line)"
  } }, cells.map((c, i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: c.label }, /* @__PURE__ */ React.createElement("div", { onClick: c.onTap, style: {
    flex: 1,
    padding: compact ? "0 8px" : "0 10px",
    textAlign: "center",
    cursor: c.onTap ? "pointer" : "default",
    minWidth: 0
  } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: compact ? 7.4 : 8.5, color: "var(--ink-4)", letterSpacing: compact ? 0.7 : 1, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, c.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: compact ? 12.2 : 14, fontWeight: 600, letterSpacing: -0.3, marginTop: compact ? 1 : 2, color: c.accent || "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, c.main), c.sub && /* @__PURE__ */ React.createElement("div", { style: { fontSize: compact ? 8.8 : 10, color: "var(--ink-3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, c.sub)), i < cells.length - 1 && /* @__PURE__ */ React.createElement("div", { style: { width: 0.5, background: "var(--line)" } }))));
}
function statusLabel(status) {
  if (status === "completed") return "\uC644\uB8CC";
  if (status === "completed_with_blockers") return "\uBD80\uBD84 \uC644\uB8CC";
  if (status === "error") return "\uC810\uAC80";
  if (status === "missing") return "\uB300\uAE30";
  return status || "\uB300\uAE30";
}
function blockerLabel(item) {
  if (!item) return null;
  const prefix = item.chain && item.asset ? `${item.chain} ${item.asset}` : item.source;
  return [prefix, item.reason].filter(Boolean).join(" \xB7 ");
}
function activityStatusLabel(activity) {
  const status = activity?.status;
  if (status === "delivered") return "Delivered";
  if (status === "confirmed") return "Confirmed";
  if (status === "broadcasted") return "Broadcasted";
  if (status === "signed") return "Signed";
  if (status === "rejected" && !activityHasSentTx(activity)) return "No tx sent";
  if (status === "rejected") return "Rejected";
  if (status === "error") return "Error";
  if (status === "open") return "Open";
  if (status === "settled") return "Settled";
  return status ? titleCaseLabel(status) : "Logged";
}
function activityHasSentTx(activity) {
  if (!activity) return false;
  if (activity.txHash) return true;
  return false;
}
function activityStatusTone(activity) {
  if (activity?.kind === "payback") return { bg: "#FFF4E2", fg: "#8A520C" };
  if (activity?.status === "rejected" && !activityHasSentTx(activity)) return { bg: "#ECECEE", fg: "var(--ink-3)" };
  if (activity?.status === "rejected" || activity?.status === "error") return { bg: "#FDECEC", fg: "#B42318" };
  if (activity?.status === "signed" || activity?.status === "broadcasted") return { bg: "#FFF6E8", fg: "#8A520C" };
  if (activity?.status === "delivered" || activity?.status === "confirmed" || activity?.status === "open") {
    return { bg: "#EAF6EE", fg: "var(--green)" };
  }
  return { bg: "#ECECEE", fg: "var(--ink-3)" };
}
function activityAmount(activity) {
  if (Number.isFinite(activity?.amountUsd) && activity.amountUsd > 0) return fmtUsdCompact(activity.amountUsd);
  if (Number.isFinite(activity?.amountSats) && activity.amountSats > 0) return fmtSats(activity.amountSats);
  if (Number.isFinite(activity?.realizedNetPnlUsd) && activity.realizedNetPnlUsd !== 0) return fmtUsd(activity.realizedNetPnlUsd);
  const detail = String(activity?.detail || "").toLowerCase();
  if (detail.includes("approve")) return "Approve";
  if (detail.includes("erc4626_deposit")) return "Deposit";
  if (detail.includes("erc4626_redeem")) return "Redeem";
  if (activity?.kind === "transaction") return "TX";
  return "\u2014";
}
function assetDisplayLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.length <= 12 ? raw.toUpperCase() : raw;
}
function isCompactAssetSymbol(value) {
  return /^[A-Za-z0-9./_-]{1,16}$/u.test(String(value || "").trim());
}
function deriveActivityFinalAsset(activity, strategy) {
  if (activity?.finalAssetId || activity?.finalAssetLabel) {
    return {
      id: activity.finalAssetId || activity.finalAssetLabel,
      label: assetDisplayLabel(activity.finalAssetLabel || activity.finalAssetId)
    };
  }
  if (activity?.kind === "payback") return { id: "btc", label: "BTC" };
  const detail = String(activity?.detail || "").trim();
  if (isCompactAssetSymbol(detail)) {
    return { id: detail, label: assetDisplayLabel(detail) };
  }
  const pair = Array.isArray(strategy?.pair) ? strategy.pair.filter(Boolean) : [];
  if (activity?.kind === "position" && pair[0]) {
    return { id: pair[0], label: assetDisplayLabel(pair[0]) };
  }
  if (pair.length > 1) {
    return { id: pair[pair.length - 1], label: assetDisplayLabel(pair[pair.length - 1]) };
  }
  if (pair[0]) {
    return { id: pair[0], label: assetDisplayLabel(pair[0]) };
  }
  return null;
}
function leverageHintForActivity(activity) {
  const strategy = findStrategyById(activity?.strategyId);
  const raw = window.FLOW?.strategyRiskById || {};
  return strategy?.riskHint || raw?.[activity?.strategyId] || raw?.[normalizeUiStrategyId(activity?.strategyId)] || null;
}
function leverageHintLabel(hint) {
  if (!hint) return null;
  const bits = [];
  const projectedHf = Number.isFinite(hint.projectedHealthFactor) ? hint.projectedHealthFactor : hint.targetHealthFactor;
  const bufferPct = Number.isFinite(hint.projectedLiquidationBufferPct) ? hint.projectedLiquidationBufferPct : hint.liquidationBufferPct;
  if (Number.isFinite(projectedHf)) bits.push(`HF ${projectedHf.toFixed(2)}`);
  if (Number.isFinite(hint.healthFactorMin)) bits.push(`min ${hint.healthFactorMin.toFixed(2)}`);
  if (Number.isFinite(bufferPct)) bits.push(`liq buffer ${bufferPct.toFixed(2)}%`);
  return bits.length ? bits.join(" \xB7 ") : null;
}
function FlowMetricGrid({ cards }) {
  return /* @__PURE__ */ React.createElement("div", { style: {
    margin: "8px 12px 0",
    display: "flex",
    alignItems: "stretch",
    padding: "10px 4px",
    background: "var(--card)",
    borderRadius: 14,
    border: "0.5px solid var(--line)",
    flexShrink: 0
  } }, cards.map((card, index) => /* @__PURE__ */ React.createElement(React.Fragment, { key: card.label }, /* @__PURE__ */ React.createElement(
    "div",
    {
      onClick: card.onTap,
      style: {
        flex: 1,
        minWidth: 0,
        padding: "0 6px",
        textAlign: "center",
        cursor: card.onTap ? "pointer" : "default"
      }
    },
    /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 7.8,
      color: "var(--ink-4)",
      letterSpacing: 0.9,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    } }, card.label),
    /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 12.6,
      fontWeight: 700,
      letterSpacing: -0.25,
      marginTop: 2,
      color: card.accent || "var(--ink)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    } }, card.main),
    /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 8.8,
      color: "var(--ink-3)",
      marginTop: 1,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    } }, card.sub)
  ), index < cards.length - 1 && /* @__PURE__ */ React.createElement("div", { style: { width: 0.5, background: "var(--line)" } }))));
}
function strategyApyWeightUsd(strategy) {
  if (Number.isFinite(strategy?.capUsd) && strategy.capUsd > 0) return strategy.capUsd;
  if (Number.isFinite(strategy?.actualProtocolCapitalUsd) && strategy.actualProtocolCapitalUsd > 0) {
    return strategy.actualProtocolCapitalUsd;
  }
  return 0;
}
function weightedApyForStrategies(strategies = []) {
  const rows = (strategies || []).filter((strategy) => strategy?.status === "LIVE" && Number.isFinite(strategy?.apyPct) && strategyApyWeightUsd(strategy) > 0);
  const weight = rows.reduce((sum, strategy) => sum + strategyApyWeightUsd(strategy), 0);
  if (weight <= 0) return null;
  const weighted = rows.reduce((sum, strategy) => sum + strategyApyWeightUsd(strategy) * strategy.apyPct, 0);
  return weighted / weight;
}
function friendlyBlockerLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "clear";
  const mapped = {
    source_inventory_reserved: "source reserved",
    routing_exhausted: "route missing",
    signer_rejected: "policy rejected",
    planned_payback_below_minimum: "minimum not reached",
    payback_below_minimum: "minimum not reached",
    max_consecutive_failures_reached: "cooldown",
    kill_switch_present: "paused",
    strategy_per_tx_cap_exceeded: "per-tx cap exceeded",
    strategy_per_day_cap_exceeded: "daily cap exceeded",
    strategy_per_chain_cap_exceeded: "chain cap exceeded",
    strategy_max_daily_loss_breached: "daily loss cap breached",
    collect_observations: "collect observations",
    review_existing_policy_path: "review path",
    calibrate_operator_policy: "calibrate policy"
  }[raw];
  if (mapped) return mapped;
  return raw.split(/[\s._-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function laneTone(status) {
  if (status === "good") return { color: "var(--green)", bg: "#EAF6EE" };
  if (status === "warn") return { color: "#8A520C", bg: "#FFF4E2" };
  if (status === "bad") return { color: "#B42318", bg: "#FDECEC" };
  return { color: "var(--ink-3)", bg: "#F5F5F6" };
}
function LiveLaneCard() {
  const status = window.STATUS || {};
  const overall = status.overall || {};
  const runtime = status.executorRuntime || {};
  const operations = window.OPERATIONS || status.operations?.allChainAutopilot || {};
  const radar = window.RADAR || status.radar || {};
  const payback = status.payback || {};
  const canaryLadder = operations.canaryLadder || {};
  const liveAllowed = overall.liveTrading === "ALLOWED";
  const runtimeReady = runtime.available === true && runtime.runtimeStatus === "healthy";
  const opRunning = operations.status === "running";
  const opObservedAt = operations.observedAt || runtime.observedAt || status.generatedAt || null;
  const opBlocker = operations.topBlockers?.[0]?.reason || operations.blockedReason || overall.blockers?.[0] || null;
  const radarCounts = radar.stageCounts || {};
  const radarCap = radar.capReview || {};
  const radarLocked = radarCap.lossLockOn === true;
  const radarReady = Number(radarCounts.executableReview || 0) > 0 || Number(radarCap.eligibleCount || 0) > 0;
  const radarMain = radarLocked ? "Locked" : radarReady ? "Policy candidate" : radar.guardrails?.thresholdsResolved === false ? "Calibrate" : "Watching";
  const radarSub = radarLocked ? "loss lock" : Number(radarCap.eligibleCount || 0) > 0 ? `${radarCap.eligibleCount} cap review` : Number(radarCounts.executableReview || 0) > 0 ? `${Number(radarCounts.executableReview || 0)} candidate \xB7 read-only \xB7 no signing` : `${Number(radarCounts.observed || 0)} seen \xB7 no signing`;
  const pendingSats = Number(payback.carry?.pendingSats ?? payback.accumulatorPendingSats ?? 0);
  const remainingSats = Number(payback.carry?.remainingSatsToMinimum ?? payback.scheduler?.minimumPaybackProgress?.satsToMinimumPayback ?? NaN);
  const paybackReady = payback.scheduler?.status === "ready" || payback.carry?.active === false && pendingSats > 0;
  const ladderRungs = Array.isArray(canaryLadder.rungsUsd) ? canaryLadder.rungsUsd.filter(Number.isFinite) : [];
  const ladderMain = canaryLadder.enabled && ladderRungs.length ? `$${ladderRungs[0]}\u2192$${ladderRungs[ladderRungs.length - 1]}` : "off";
  const ladderSub = canaryLadder.noTxSentNeutral ? "auto sizing" : "review";
  const gateTone = laneTone(liveAllowed && runtimeReady ? "good" : "bad");
  const gateLine = `Operation gate: ${liveAllowed ? "Allowed" : "Blocked"} \xB7 ${runtimeReady ? "Runtime healthy" : friendlyBlockerLabel(overall.blockers?.[0] || runtime.runtimeStatus || "checking")}`;
  const cells = [
    {
      label: "Autopilot",
      main: opRunning ? "Running" : friendlyBlockerLabel(operations.status || "idle"),
      sub: opBlocker ? friendlyBlockerLabel(opBlocker) : `${operations.officialChainCount || 11} chains`,
      tone: opRunning && !opBlocker ? "good" : opRunning ? "warn" : "neutral"
    },
    {
      label: "Radar",
      main: radarMain,
      sub: radarSub,
      tone: radarLocked ? "bad" : radarReady ? "warn" : "neutral"
    },
    {
      label: "Ladder",
      main: ladderMain,
      sub: ladderSub,
      tone: canaryLadder.enabled ? "good" : "neutral"
    },
    {
      label: "Payback",
      main: pendingSats > 0 ? fmtSats(pendingSats) : paybackReady ? "ready" : "carry",
      sub: Number.isFinite(remainingSats) && remainingSats > 0 ? `${fmtSats(remainingSats)} to min` : friendlyBlockerLabel(payback.scheduler?.reason || "accruing"),
      tone: paybackReady ? "good" : pendingSats > 0 ? "warn" : "neutral"
    }
  ];
  return /* @__PURE__ */ React.createElement("div", { style: {
    margin: "0 0 8px",
    padding: "7px 9px 7px",
    background: "var(--card)",
    border: "0.5px solid var(--line)",
    borderRadius: 12,
    flexShrink: 0,
    animation: `slideUp 220ms cubic-bezier(0.22,1,0.36,1) both`
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 700, letterSpacing: 0.1, whiteSpace: "nowrap" } }, "Live lane"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--ink-3)", whiteSpace: "nowrap" } }, formatStatusAge(opObservedAt) || fmtWhen(opObservedAt))), /* @__PURE__ */ React.createElement("div", { style: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
    minWidth: 0,
    color: gateTone.color
  } }, /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: 6, background: gateTone.color, flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { style: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0
  } }, gateLine)), /* @__PURE__ */ React.createElement("div", { style: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "4px 9px",
    marginTop: 6
  } }, cells.map((cell) => {
    const tone = laneTone(cell.tone);
    return /* @__PURE__ */ React.createElement("div", { key: cell.label, style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 7.4,
      color: "var(--ink-4)",
      letterSpacing: 0.9,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    } }, cell.label), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4, marginTop: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: 6, background: tone.color, flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { style: {
      fontSize: 10.8,
      fontWeight: 700,
      letterSpacing: 0,
      color: tone.color,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      minWidth: 0
    } }, cell.main)), /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 8.2,
      color: "var(--ink-3)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    } }, cell.sub));
  })));
}
function RouteNode({ kind = "text", id, label }) {
  return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, flexShrink: 1 } }, kind === "chain" && id ? /* @__PURE__ */ React.createElement(ChainLogo, { id, size: 16 }) : null, kind === "protocol" && id ? /* @__PURE__ */ React.createElement(ProtocolLogo, { id, size: 16 }) : null, /* @__PURE__ */ React.createElement("span", { style: {
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  } }, label));
}
function activityRouteSummary(activity, strategy) {
  const hint = parseRouteHint(strategy?.sub || activity?.detail || "");
  const sourceChainId = activity?.kind === "payback" ? normalizeChainId(strategy?.chain) || normalizeChainId(hint?.source) || normalizeChainId(activity?.chain) : normalizeChainId(activity?.fromChainId) || normalizeChainId(hint?.source) || normalizeChainId(activity?.chain) || normalizeChainId(strategy?.chain);
  const source = sourceChainId ? { kind: "chain", id: sourceChainId, label: displayChainName(sourceChainId) } : { kind: "text", id: null, label: "Capital" };
  const hintedTargetChainId = activity?.kind === "payback" ? "bitcoin" : normalizeChainId(activity?.toChainId) || normalizeChainId(hint?.target);
  const protocolId = activity?.protocol || strategy?.protocol || null;
  const target = hintedTargetChainId && hintedTargetChainId !== sourceChainId ? { kind: "chain", id: hintedTargetChainId, label: displayChainName(hintedTargetChainId) } : protocolId ? { kind: "protocol", id: protocolId, label: displayProtocolName(protocolId) } : hintedTargetChainId ? { kind: "chain", id: hintedTargetChainId, label: displayChainName(hintedTargetChainId) } : { kind: "text", id: null, label: strategy?.label || activity?.detail || "Recent move" };
  return {
    source,
    target,
    title: strategy?.label || activity?.detail || target.label
  };
}
function FlowActivityRow({ activity, isLast }) {
  const strategy = findStrategyById(activity?.strategyId);
  const tone = activityStatusTone(activity);
  const riskLabel = leverageHintLabel(leverageHintForActivity(activity));
  const route = activityRouteSummary(activity, strategy);
  const finalAsset = deriveActivityFinalAsset(activity, strategy);
  const policyReason = activity?.status === "rejected" && Array.isArray(activity?.blockers) && activity.blockers.length > 0 ? friendlyBlockerLabel(activity.blockers[0]) : null;
  return /* @__PURE__ */ React.createElement("div", { style: {
    padding: "9px 0",
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    minWidth: 0
  } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    fontSize: 10.3,
    fontWeight: 600,
    letterSpacing: -0.15
  } }, /* @__PURE__ */ React.createElement(RouteNode, { kind: route.source.kind, id: route.source.id, label: route.source.label }), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--ink-4)", flexShrink: 0 } }, "\u2192"), /* @__PURE__ */ React.createElement(RouteNode, { kind: route.target.kind, id: route.target.id, label: route.target.label })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 5, minWidth: 0, marginTop: 4 } }, /* @__PURE__ */ React.createElement("div", { style: {
    fontSize: 10.4,
    fontWeight: 600,
    letterSpacing: -0.15,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0
  } }, route.title), /* @__PURE__ */ React.createElement("span", { style: {
    fontSize: 8.3,
    padding: "1px 5px",
    borderRadius: 999,
    background: tone.bg,
    color: tone.fg,
    fontWeight: 700,
    letterSpacing: 0.15,
    flexShrink: 0
  } }, activityStatusLabel(activity))), riskLabel && /* @__PURE__ */ React.createElement("div", { style: {
    fontSize: 8.9,
    color: "#8A520C",
    marginTop: 2,
    lineHeight: 1.3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  } }, riskLabel), policyReason && /* @__PURE__ */ React.createElement("div", { style: {
    fontSize: 8.9,
    color: "var(--ink-3)",
    marginTop: 2,
    lineHeight: 1.3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  } }, "Policy: ", policyReason)), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right", flexShrink: 0, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    maxWidth: 148
  } }, finalAsset && /* @__PURE__ */ React.createElement("div", { style: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
    color: "var(--ink-3)"
  } }, /* @__PURE__ */ React.createElement(AssetLogo, { id: finalAsset.id, size: 11 }), /* @__PURE__ */ React.createElement("span", { style: {
    fontSize: 9.1,
    fontWeight: 600,
    color: "var(--ink-3)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 54
  } }, finalAsset.label)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.6, fontWeight: 700, letterSpacing: -0.15 } }, activityAmount(activity))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.2, color: "var(--ink-3)", marginTop: 1 } }, fmtWhen(activity?.observedAt))), !isLast && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: 0, right: 0, bottom: 0, height: 0.5, background: "var(--line)" } }));
}
function OpsStrip({ fill = false, onExpandedChange = null }) {
  const flow = window.FLOW || {};
  const activities = flow?.recentActivities || [];
  const txActivities = activities.filter((activity) => activity?.kind === "transaction");
  const positionActivities = activities.filter((activity) => activity?.kind === "position");
  const paybackActivities = activities.filter((activity) => activity?.kind === "payback");
  const inFlightTxCount = txActivities.filter((activity) => activity?.status === "signed" || activity?.status === "broadcasted").length;
  const confirmedTxCount = txActivities.filter((activity) => activity?.status === "confirmed").length;
  const [expanded, setExpanded] = useState(() => readPersistedHistoryExpanded());
  const [filter, setFilter] = useState(() => readPersistedHistoryFilter());
  const scrollInsideCard = fill && expanded;
  const filteredActivities = activities.filter((activity) => {
    if (filter === "in_flight") return activity?.kind === "transaction" && (activity?.status === "signed" || activity?.status === "broadcasted");
    if (filter === "confirmed") return activity?.kind === "transaction" && activity?.status === "confirmed";
    if (filter === "tx") return activity?.kind === "transaction";
    if (filter === "position") return activity?.kind === "position";
    if (filter === "payback") return activity?.kind === "payback";
    return true;
  });
  const visibleActivities = expanded ? filteredActivities : filteredActivities.slice(0, 3);
  const filterChips = [
    { id: "all", label: `All ${activities.length}`, tone: { bg: "#111113", fg: "#F4F4F4" } },
    { id: "in_flight", label: `In flight ${inFlightTxCount}`, tone: { bg: "#FFF4E2", fg: "#8A520C" }, hidden: inFlightTxCount === 0 },
    { id: "confirmed", label: `Confirmed ${confirmedTxCount}`, tone: { bg: "#EAF6EE", fg: "var(--green)" }, hidden: confirmedTxCount === 0 },
    { id: "tx", label: `TX ${txActivities.length}`, tone: { bg: "#ECECEE", fg: "var(--ink-3)" }, hidden: txActivities.length === 0 },
    { id: "position", label: `Position ${positionActivities.length}`, tone: { bg: "#EEF2FF", fg: "#3256D7" }, hidden: positionActivities.length === 0 },
    { id: "payback", label: `Payback ${paybackActivities.length}`, tone: { bg: "#FFF4E2", fg: "#8A520C" }, hidden: paybackActivities.length === 0 }
  ].filter((item) => !item.hidden);
  useEffect(() => {
    const allowed = new Set(filterChips.map((item) => item.id));
    if (!allowed.has(filter)) {
      setFilter("all");
      return;
    }
    writePersistedHistoryFilter(filter);
  }, [filter, filterChips]);
  useEffect(() => {
    writePersistedHistoryExpanded(expanded);
  }, [expanded]);
  useEffect(() => {
    if (typeof onExpandedChange === "function") onExpandedChange(expanded);
  }, [expanded, onExpandedChange]);
  return /* @__PURE__ */ React.createElement("div", { style: {
    margin: fill ? "0 12px" : "4px 12px 0",
    padding: "8px 10px 6px",
    background: "var(--card)",
    border: "0.5px solid var(--line)",
    borderRadius: 12,
    flexShrink: 0,
    animation: `slideUp 220ms cubic-bezier(0.22,1,0.36,1) both`,
    display: "flex",
    flexDirection: "column",
    minHeight: fill ? 0 : void 0,
    flex: scrollInsideCard ? "1 1 auto" : fill ? "1 1 auto" : "0 0 auto",
    overflow: "hidden"
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: {
    width: 22,
    height: 22,
    borderRadius: 11,
    background: "#FFF4E2",
    color: "#8A520C",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10.5,
    fontWeight: 700,
    flexShrink: 0
  } }, "H"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.4, fontWeight: 700, letterSpacing: 0.15 } }, "History"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--ink-3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "Latest capital moves across chains and protocols"), filterChips.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 } }, filterChips.map((chip) => {
    const active = filter === chip.id;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: chip.id,
        onClick: () => {
          setExpanded(false);
          setFilter(chip.id);
        },
        style: {
          display: "inline-flex",
          alignItems: "center",
          padding: "1px 6px",
          borderRadius: 999,
          border: "none",
          background: active ? chip.tone.bg : "#F5F5F6",
          color: active ? chip.tone.fg : "var(--ink-3)",
          fontSize: 8.1,
          fontWeight: 700,
          letterSpacing: 0.1,
          cursor: "pointer"
        }
      },
      chip.label
    );
  }))), filteredActivities.length > 3 && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setExpanded((value) => !value),
      style: {
        border: "none",
        background: "transparent",
        color: "var(--ink-3)",
        fontSize: 10,
        fontWeight: 600,
        padding: 0,
        cursor: "pointer",
        flexShrink: 0
      }
    },
    expanded ? "Show less" : `Show more \xB7 ${filteredActivities.length}`
  )), /* @__PURE__ */ React.createElement("div", { style: {
    marginTop: 6,
    flex: scrollInsideCard ? "1 1 auto" : "0 0 auto",
    minHeight: scrollInsideCard ? 0 : void 0,
    overflowY: scrollInsideCard ? "auto" : "visible",
    overflowX: "hidden",
    paddingRight: scrollInsideCard ? 4 : 0,
    overscrollBehavior: "contain"
  } }, filteredActivities.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--ink-4)", padding: "4px 0 2px" } }, "No matching capital move yet."), visibleActivities.map((activity, index) => /* @__PURE__ */ React.createElement(
    FlowActivityRow,
    {
      key: activity.id || `${activity.kind}-${index}`,
      activity,
      isLast: index === visibleActivities.length - 1
    }
  ))));
}
function PnlBreakdownStrip({ inline = false }) {
  const flow = window.FLOW || {};
  const metrics = flow?.metrics || {};
  const strategyUsd = metrics.realizedStrategyUsd;
  const evidenceUsd = metrics.realizedEvidenceCostUsd;
  const totalUsd = metrics.realizedTotalUsd;
  const strategyCount = metrics.realizedStrategyTradeCount || 0;
  const evidenceCount = metrics.realizedEvidenceCount || 0;
  const topKinds = Array.isArray(metrics.realizedByKind) ? metrics.realizedByKind.filter((item) => Number.isFinite(item?.realizedNetPnlUsd) && item.realizedNetPnlUsd < 0).slice(0, 3) : [];
  if (!Number.isFinite(strategyUsd) && !Number.isFinite(evidenceUsd) && !Number.isFinite(totalUsd)) return null;
  return /* @__PURE__ */ React.createElement("div", { style: {
    margin: inline ? "0 0 8px" : "0 12px",
    padding: inline ? "7px 10px 6px" : "8px 10px 7px",
    background: "var(--card)",
    border: "0.5px solid var(--line)",
    borderRadius: 12,
    flexShrink: 0,
    animation: `slideUp 220ms cubic-bezier(0.22,1,0.36,1) both`
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: inline ? 10 : 10.2, fontWeight: 700, letterSpacing: 0.15 } }, "Realized split"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: inline ? 8.5 : 9, color: "var(--ink-3)", marginTop: inline ? 0 : 1 } }, "strategy vs transport / probe cost")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: inline ? 8.5 : 9.2, color: "var(--ink-3)", whiteSpace: "nowrap" } }, strategyCount, " strategy \xB7 ", evidenceCount, " probe")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: inline ? 5 : 6 } }, /* @__PURE__ */ React.createElement(TriCard, { compact: true, cells: [
    {
      label: "Strategy",
      main: fmtUsd(strategyUsd),
      sub: `${strategyCount} receipts`,
      accent: Number.isFinite(strategyUsd) && strategyUsd < 0 ? "#B42318" : "var(--green)"
    },
    {
      label: "Probe cost",
      main: fmtUsd(evidenceUsd),
      sub: `${evidenceCount} receipts`,
      accent: Number.isFinite(evidenceUsd) && evidenceUsd < 0 ? "#8A520C" : "var(--ink)"
    },
    {
      label: "Total",
      main: fmtUsd(totalUsd),
      sub: "combined impact",
      accent: Number.isFinite(totalUsd) && totalUsd < 0 ? "#B42318" : "var(--green)"
    }
  ] })), topKinds.length > 0 && /* @__PURE__ */ React.createElement("div", { style: {
    fontSize: inline ? 8.2 : 8.9,
    color: "var(--ink-3)",
    marginTop: inline ? 4 : 6,
    lineHeight: inline ? 1.2 : 1.35,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  } }, "Top drags: ", topKinds.map((item) => `${pnlKindLabel(item.kind)} ${fmtUsd(item.realizedNetPnlUsd)}`).join(" \xB7 ")));
}
function FlowPane({ refreshTick }) {
  const HOLDINGS = window.HOLDINGS || globalThis.HOLDINGS;
  const STRATEGIES = window.STRATEGIES || globalThis.STRATEGIES || [];
  const flow = window.FLOW || {};
  const items = HOLDINGS?.all || [];
  const pending = HOLDINGS?.pending;
  const positions = HOLDINGS?.positions || [];
  const [mindmapFocus, setMindmapFocus] = useState({ layer: "root" });
  const [historyExpanded, setHistoryExpanded] = useState(() => readPersistedHistoryExpanded());
  const overlayActive = mindmapFocus?.layer === "chain" || mindmapFocus?.layer === "protocol";
  const lowerPanePointerEvents = historyExpanded ? "auto" : overlayActive ? "none" : "auto";
  const totalUsd = HOLDINGS?.totalUsd != null ? HOLDINGS.totalUsd : items.reduce((s, a) => s + (a.usd || 0), 0) + positions.reduce((s, a) => s + (a.usd || 0), 0);
  const currentWalletUsd = Number.isFinite(HOLDINGS?.currentWalletUsd) ? HOLDINGS.currentWalletUsd : Number.isFinite(HOLDINGS?.displayWalletUsd) ? HOLDINGS.displayWalletUsd : Number(HOLDINGS?.walletUsd || 0);
  const protocolDeployedUsd = Number.isFinite(HOLDINGS?.protocolDeployedUsd) ? HOLDINGS.protocolDeployedUsd : Number(HOLDINGS?.deployedUsd || 0);
  const currentTotalUsd = Number.isFinite(HOLDINGS?.currentTotalUsd) ? HOLDINGS.currentTotalUsd : Number.isFinite(currentWalletUsd) && Number.isFinite(protocolDeployedUsd) ? currentWalletUsd + protocolDeployedUsd : totalUsd;
  const estimatedProtocolDeployedUsd = Number.isFinite(HOLDINGS?.estimatedProtocolDeployedUsd) ? HOLDINGS.estimatedProtocolDeployedUsd : protocolDeployedUsd;
  const estimatedCurrentTotalUsd = Number.isFinite(HOLDINGS?.estimatedCurrentTotalUsd) ? HOLDINGS.estimatedCurrentTotalUsd : currentTotalUsd;
  const verifiedMinimumUsd = Number.isFinite(HOLDINGS?.verifiedMinimumUsd) ? HOLDINGS.verifiedMinimumUsd : currentTotalUsd;
  const protocolTrackingGapUsd = Number.isFinite(HOLDINGS?.protocolTrackingGapUsd) ? HOLDINGS.protocolTrackingGapUsd : Number.isFinite(HOLDINGS?.trackingGapUsd) ? HOLDINGS.trackingGapUsd : Number(HOLDINGS?.planGapUsd || 0);
  const assetEstimateAvailable = Number.isFinite(estimatedCurrentTotalUsd) && Number.isFinite(currentTotalUsd) && estimatedCurrentTotalUsd > currentTotalUsd + 1;
  const displayAssetUsd = assetEstimateAvailable ? estimatedCurrentTotalUsd : currentTotalUsd;
  const assetValueUsd = Number.isFinite(displayAssetUsd) ? displayAssetUsd : Number.isFinite(flow?.metrics?.assetValueUsd) ? flow.metrics.assetValueUsd : 0;
  const paidSats = flow?.metrics?.paidBackSatsLifetime ?? KPI?.paidBack?.sats ?? 0;
  const paidUsd = flow?.metrics?.paidBackUsdLifetime ?? KPI?.paidBack?.usd;
  const carrySats = flow?.metrics?.pendingCarrySats ?? KPI?.pendingCarry?.sats ?? 0;
  const carryUsd = flow?.metrics?.pendingCarryUsd ?? KPI?.pendingCarry?.usd;
  const grossYieldUsd = flow?.metrics?.grossProfitUsdPeriod ?? KPI?.totalEarning?.usd;
  const grossYieldSats = flow?.metrics?.grossProfitSatsPeriod ?? KPI?.totalEarning?.sats ?? 0;
  const strategyYieldUsd = STRATEGIES.reduce((sum, strategy) => sum + (Number.isFinite(strategy?.earnedUsd) ? strategy.earnedUsd : 0), 0);
  const liveYieldSats = flow?.metrics?.liveEstimatedYieldSats ?? flow?.liveYield?.estimatedYieldSats ?? null;
  const liveYieldUsd = flow?.metrics?.liveEstimatedYieldUsd ?? flow?.liveYield?.estimatedYieldUsd ?? null;
  const liveYieldAprPct = flow?.metrics?.liveYieldAprPct ?? flow?.liveYield?.weightedAprPct ?? null;
  const liveYieldPositionCount = flow?.metrics?.liveYieldPositionCount ?? flow?.liveYield?.positionCount ?? 0;
  const liveYieldAprPositionCount = flow?.liveYield?.aprPositionCount ?? liveYieldPositionCount;
  const liveAnnualizedYieldUsd = flow?.metrics?.liveAnnualizedYieldUsd ?? flow?.liveYield?.annualizedYieldUsd ?? null;
  const showLiveYield = Number.isFinite(liveYieldSats) && liveYieldSats > 0 || Number.isFinite(liveYieldUsd) && liveYieldUsd > 0;
  const liveYieldSub = [
    Number.isFinite(liveYieldUsd) && liveYieldUsd > 0 ? `${fmtUsdCompact(liveYieldUsd)} est. accrued` : null,
    Number.isFinite(liveAnnualizedYieldUsd) && liveAnnualizedYieldUsd > 0 ? `${fmtUsdCompact(liveAnnualizedYieldUsd)}/yr` : null,
    liveYieldAprPositionCount > 0 ? `${liveYieldAprPositionCount} APR position${liveYieldAprPositionCount > 1 ? "s" : ""}` : null
  ].filter(Boolean).join(" \xB7 ");
  const yieldMain = showLiveYield ? Number.isFinite(liveYieldSats) && liveYieldSats > 0 ? fmtSats(liveYieldSats) : fmtUsdCompact(liveYieldUsd) : grossYieldSats > 0 ? fmtSats(grossYieldSats) : strategyYieldUsd > 0 ? fmtUsdCompact(strategyYieldUsd) : Number.isFinite(grossYieldUsd) && grossYieldUsd > 0 ? fmtUsdCompact(grossYieldUsd) : "\u2014";
  const yieldSub = showLiveYield ? liveYieldSub : Number.isFinite(grossYieldUsd) && grossYieldUsd > 0 ? `${fmtUsdCompact(grossYieldUsd)} \xB7 all protocols` : strategyYieldUsd > 0 ? "live est. \xB7 all protocols" : "all protocols";
  const flowMapBaseHeight = "calc(52% - 4px)";
  const lowerPaneTop = "calc(52% + 4px)";
  const lowerPaneExpandedOffset = "calc(52% + 10px)";
  const totalApr = Number.isFinite(liveYieldAprPct) ? liveYieldAprPct : weightedApyForStrategies(STRATEGIES);
  const [aprOpen, setAprOpen] = useState(false);
  const assetIsVerifiedFloor = HOLDINGS?.assetConfidence === "verified_minimum";
  const assetHasReconciliationGap = protocolTrackingGapUsd > 1 || Boolean(HOLDINGS?.accountingWarning);
  const assetEquationTotalLabel = assetEstimateAvailable ? "estimated total" : assetIsVerifiedFloor || assetHasReconciliationGap ? "verified minimum" : "current total";
  const protocolTrackingGapSub = protocolTrackingGapUsd > 1 ? ` \xB7 ${fmtUsdCompact(protocolTrackingGapUsd)} unreconciled protocol estimate` : "";
  const trackedProtocolUsd = assetEstimateAvailable ? estimatedProtocolDeployedUsd : protocolDeployedUsd;
  const assetSub = pending ? "pending" : assetEstimateAvailable ? `${fmtUsdCompact(currentWalletUsd)} free + ${fmtUsdCompact(estimatedProtocolDeployedUsd)} est. protocols = ${fmtUsdCompact(estimatedCurrentTotalUsd)} est. \xB7 verified floor ${fmtUsdCompact(verifiedMinimumUsd)}` : assetIsVerifiedFloor ? `verified floor \xB7 ${fmtUsdCompact(currentWalletUsd)} free + ${fmtUsdCompact(trackedProtocolUsd)} tracked protocols${protocolTrackingGapSub}` : `${fmtUsdCompact(currentWalletUsd)} free + ${fmtUsdCompact(trackedProtocolUsd)} tracked protocols${protocolTrackingGapSub}`;
  const assetMetricLabel = assetEstimateAvailable ? "Assets" : assetHasReconciliationGap ? "Observed" : "Total";
  const assetMain = pending ? "\u2014" : fmtUsd(displayAssetUsd || 0);
  const apySub = aprOpen ? `${liveYieldAprPositionCount || 0} APR-backed open position${liveYieldAprPositionCount === 1 ? "" : "s"} \xB7 estimated, not realized` : "tap for note";
  return /* @__PURE__ */ React.createElement("div", { className: "tabpane", style: { position: "relative", display: "flex", flexDirection: "column", overflowX: "hidden", overflowY: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 4,
    height: historyExpanded ? flowMapBaseHeight : overlayActive ? "calc(100% - 12px)" : flowMapBaseHeight,
    zIndex: historyExpanded ? 1 : 4,
    pointerEvents: historyExpanded ? "none" : "auto",
    transition: "height 450ms var(--ease), transform 450ms var(--ease)"
  } }, /* @__PURE__ */ React.createElement("div", { style: {
    height: "100%",
    borderRadius: overlayActive ? 22 : 18,
    overflow: "hidden",
    background: "var(--card)",
    border: "0.5px solid var(--line)",
    boxShadow: overlayActive ? "0 18px 48px rgba(17,17,19,0.16)" : "0 0 0 rgba(17,17,19,0)",
    transition: "border-radius 450ms var(--ease), box-shadow 450ms var(--ease)"
  } }, /* @__PURE__ */ React.createElement(Mindmap, { motionSpeed: 1.4, refreshTick, onFocusChange: setMindmapFocus }))), /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    left: 0,
    right: 0,
    top: lowerPaneTop,
    bottom: 0,
    paddingTop: historyExpanded ? 0 : void 0,
    zIndex: historyExpanded ? 6 : 1,
    opacity: historyExpanded ? 1 : overlayActive ? 0.28 : 1,
    transform: historyExpanded ? "translateY(0) scale(1)" : overlayActive ? "translateY(18px) scale(0.985)" : "translateY(0) scale(1)",
    filter: historyExpanded ? "none" : overlayActive ? "saturate(0.72)" : "none",
    pointerEvents: lowerPanePointerEvents,
    transition: "opacity 450ms var(--ease), transform 450ms var(--ease), filter 450ms var(--ease)"
  } }, /* @__PURE__ */ React.createElement("div", { style: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingBottom: 6,
    overflow: "hidden"
  } }, !historyExpanded && /* @__PURE__ */ React.createElement(FlowMetricGrid, { cards: [
    {
      label: assetMetricLabel,
      main: assetMain,
      sub: assetSub
    },
    {
      label: "Open APR",
      main: totalApr != null ? fmtPct(totalApr) : "\u2014",
      sub: apySub,
      onTap: () => setAprOpen((o) => !o),
      accent: aprOpen ? "var(--ink)" : void 0
    },
    {
      label: "Paid back",
      main: fmtSats(paidSats),
      sub: paidUsd != null ? fmtUsdCompact(paidUsd) : "\u2014"
    },
    {
      label: "Payback",
      main: fmtSats(carrySats),
      sub: carryUsd != null ? `${fmtUsdCompact(carryUsd)} pending` : "pending"
    },
    {
      label: "Est. yield",
      main: yieldMain,
      sub: yieldSub
    }
  ] }), !historyExpanded && aprOpen && /* @__PURE__ */ React.createElement("div", { style: {
    margin: "0 12px",
    padding: "8px 12px",
    background: "#111113",
    color: "#F4F4F4",
    borderRadius: 12,
    fontSize: 11,
    lineHeight: 1.45,
    flexShrink: 0,
    animation: `slideUp 200ms cubic-bezier(0.22,1,0.36,1) both`
  } }, "open APR estimate only. It is value-weighted over APR-backed open positions and is estimated, not realized PnL or payback."), /* @__PURE__ */ React.createElement(OpsStrip, { fill: historyExpanded, onExpandedChange: setHistoryExpanded }))));
}
function KpiCard({ label, main, sub }) {
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 14px", background: "var(--card)", borderRadius: 16, border: "0.5px solid var(--line)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.5, color: "var(--ink-4)", letterSpacing: 1.3, textTransform: "uppercase" } }, label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 600, letterSpacing: -0.3, marginTop: 3 } }, main), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--ink-3)", marginTop: 1 } }, sub));
}
function DefiPane({ refreshTick }) {
  const STRATEGIES = window.STRATEGIES || globalThis.STRATEGIES || [];
  void refreshTick;
  const openPositionCount = STRATEGIES.filter((s) => s.status === "LIVE").length;
  const watchedCount = STRATEGIES.length;
  const candidateCount = STRATEGIES.filter((s) => s.status !== "LIVE").length;
  const byProtocol = STRATEGIES.reduce((acc, s) => {
    var _a;
    if (s.status !== "LIVE") return acc;
    (acc[_a = s.protocol] || (acc[_a] = [])).push(s);
    return acc;
  }, {});
  const entries = Object.entries(byProtocol).filter(([, list]) => list.length > 0);
  return /* @__PURE__ */ React.createElement("div", { className: "tabpane", style: { padding: "4px 12px 16px" } }, /* @__PURE__ */ React.createElement(LiveLaneCard, null), /* @__PURE__ */ React.createElement(OnchainRadarCard, null), /* @__PURE__ */ React.createElement(ResearchFunnelCard, null), /* @__PURE__ */ React.createElement(DevAgentQueueCard, null), /* @__PURE__ */ React.createElement(PnlBreakdownStrip, { inline: true }), /* @__PURE__ */ React.createElement("div", { style: {
    margin: "0 0 8px",
    padding: "7px 10px",
    background: "var(--card)",
    border: "0.5px solid var(--line)",
    borderRadius: 12,
    fontSize: 10,
    color: "var(--ink-3)",
    display: "flex",
    justifyContent: "space-between",
    gap: 8
  } }, /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, color: "var(--ink)" } }, "Strategy coverage"), /* @__PURE__ */ React.createElement("span", null, watchedCount, " watched \xB7 ", candidateCount, " candidate/review \xB7 ", openPositionCount, " open")), entries.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "40px 16px", textAlign: "center", fontSize: 13, color: "var(--ink-3)" } }, "No live strategies"), entries.map(([proto, list]) => {
    const protoRealized = list.reduce((sum, s) => sum + (s.realizedYieldUsd || 0), 0);
    const protoEstimated = list.reduce((sum, s) => sum + (s.estimatedYieldUsd || 0), 0);
    const protoYield = protoRealized > 0 ? protoRealized : protoEstimated;
    const protoYieldBasis = protoRealized > 0 ? "realized" : protoEstimated > 0 ? "estimated" : null;
    const protoCap = list.reduce((sum, s) => sum + (s.capUsd || 0), 0);
    const protoApy = weightedApyForStrategies(list);
    return /* @__PURE__ */ React.createElement("div", { key: proto, style: {
      marginBottom: 10,
      background: "var(--card)",
      borderRadius: 16,
      border: "0.5px solid var(--line)",
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
    } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "11px 12px 9px" } }, /* @__PURE__ */ React.createElement(ProtocolLogo, { id: proto, size: 30 }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, fontWeight: 700, letterSpacing: -0.2 } }, displayProtocolName(proto)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--ink-3)", marginTop: 1 } }, list.length, " live position", list.length > 1 ? "s" : "")), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right" } }, protoYield > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, fontWeight: 700, color: "var(--green)", letterSpacing: -0.2 } }, fmtYieldTag(protoYield, protoYieldBasis)), protoYieldBasis && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.5, color: "var(--ink-3)", marginTop: 1 } }, fmtYieldSubLabel(protoYieldBasis)), Number.isFinite(protoApy) && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.5, color: "var(--ink-3)", marginTop: 1 } }, "APR ", fmtPct(protoApy)), protoCap > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, fontWeight: 600, color: "var(--ink)", letterSpacing: -0.2 } }, "Cap $", protoCap.toLocaleString()))), /* @__PURE__ */ React.createElement("div", { style: { padding: "0 12px" } }, list.map((s, i) => /* @__PURE__ */ React.createElement(StrategyRow, { key: s.id, s, isLast: i === list.length - 1 }))));
  }));
}
function OnchainRadarCard() {
  const radar = window.RADAR || window.STATUS?.radar;
  if (!radar) return null;
  const counts = radar.stageCounts || {};
  const capReview = radar.capReview || {};
  const blocker = capReview.lossLockOn ? "Loss lock" : capReview.eligibleCount > 0 ? `${capReview.eligibleCount} cap raise` : radar.topBlocker?.code || "No signing path";
  return /* @__PURE__ */ React.createElement("div", { style: {
    marginBottom: 8,
    padding: "9px 10px",
    background: "var(--card)",
    borderRadius: 12,
    border: "0.5px solid var(--line)"
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 8.7, color: "var(--ink-4)", letterSpacing: 1.2, textTransform: "uppercase" } }, "Onchain radar"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--ink-3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "read-only \xB7 no signing \xB7 ", radar.headline || "Waiting for observations")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.5, color: "var(--ink-3)", textAlign: "right", whiteSpace: "nowrap" } }, fmtWhen(radar.generatedAt))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 7 } }, /* @__PURE__ */ React.createElement(TriCard, { compact: true, cells: [
    {
      label: "Observed",
      main: String(counts.observed ?? 0),
      sub: `${counts.hypothesis ?? 0} grouped`
    },
    {
      label: "Portable",
      main: String(counts.portable ?? 0),
      sub: `${counts.selfRealized ?? 0} self-realized`
    },
    {
      label: "Policy review",
      main: String(counts.executableReview ?? 0),
      sub: blocker
    }
  ] })));
}
function DevAgentQueueCard() {
  const bridge = window.STATUS?.strategy?.devAgentAutomationBridge;
  if (!bridge) return null;
  const policy = bridge.modelPolicy || {};
  const topTask = bridge.topTasks?.[0] || bridge.topTask || null;
  const topLabel = topTask?.title || topTask?.source?.opportunityId || topTask?.id || "No task";
  const runtimeAuthority = policy.runtimeAuthority || "none";
  return /* @__PURE__ */ React.createElement("div", { style: {
    marginBottom: 8,
    padding: "9px 10px",
    background: "var(--card)",
    borderRadius: 12,
    border: "0.5px solid var(--line)"
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 8.7, color: "var(--ink-4)", letterSpacing: 1.2, textTransform: "uppercase" } }, "LLM dev queue"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--ink-3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "code tasks \xB7 runtime ", runtimeAuthority, " \xB7 no signing")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.5, color: "var(--ink-3)", whiteSpace: "nowrap" } }, fmtWhen(bridge.generatedAt))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 7 } }, /* @__PURE__ */ React.createElement(TriCard, { compact: true, cells: [
    {
      label: "Ready",
      main: String(bridge.readyTaskCount ?? 0),
      sub: `${bridge.taskCount ?? 0} queued`
    },
    {
      label: "Live exec",
      main: String(bridge.liveExecutableTaskCount ?? 0),
      sub: policy.llmMaySign === false ? "signing blocked" : "review policy"
    },
    {
      label: "Top task",
      main: topTask?.kind ? titleCaseLabel(topTask.kind) : "\u2014",
      sub: topLabel
    }
  ] })));
}
function ResearchFunnelCard() {
  const funnel = window.STATUS?.researchFunnel;
  if (!funnel?.available) return null;
  return /* @__PURE__ */ React.createElement("div", { style: {
    marginBottom: 8,
    padding: "9px 10px",
    background: "var(--card)",
    borderRadius: 12,
    border: "0.5px solid var(--line)"
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 8.7, color: "var(--ink-4)", letterSpacing: 1.2, textTransform: "uppercase" } }, "Research funnel"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--ink-3)", marginTop: 1 } }, "read-only research queue")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.5, color: "var(--ink-3)", whiteSpace: "nowrap" } }, fmtWhen(funnel.summary?.latestRunAt))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 7 } }, /* @__PURE__ */ React.createElement(TriCard, { compact: true, cells: [
    {
      label: "Track A",
      main: String(funnel.tracks?.A?.candidateCount ?? 0),
      sub: `Ideas \xB7 ${funnel.tracks?.A?.promotionIntentCount ?? 0} requests`
    },
    {
      label: "Track B",
      main: String(funnel.tracks?.B?.candidateCount ?? 0),
      sub: `OOS ${funnel.tracks?.B?.oosEligibleCount ?? 0}`
    },
    {
      label: "Promotions",
      main: String(funnel.summary?.promotionIntentCount ?? 0),
      sub: funnel.summary?.latestBlocker || "clear"
    }
  ] })));
}
function pairTokens(s) {
  return (s.pair || []).filter(Boolean).map((p) => p.toUpperCase());
}
function strategyKind(s) {
  const t = s.type;
  if (t === "loop") return "Loop";
  if (t === "fold") return "Fold";
  if (t === "pt") return "PT";
  if (t === "cl_lp") return "CL LP";
  if (t === "lp" || t === "lp_bgt") return "LP";
  if (t === "basis") return "Basis";
  if (t === "bridge") return "Bridge";
  if (t === "payback") return "Payback";
  if (t === "arb") return "Arb";
  if (t === "swap") return "Swap";
  if (t === "canary") return "Canary";
  if (t === "reserve") return "Reserve";
  if (t === "refuel") return "Refuel";
  return titleCaseLabel(s.type || "\u2014");
}
function strategyMechanics(s) {
  const toks = pairTokens(s);
  const t = s.type;
  const cap = s.capUsd || 0;
  const apy = s.apyPct != null ? s.apyPct.toFixed(2) + "%" : "\u2014";
  if (t === "loop" || t === "fold") {
    const cycles = s.loops || 1;
    const collat = toks[0] || "\u2014";
    const borrow = toks[1] || "\u2014";
    return `${collat} supply \u2192 ${borrow} borrow \u2192 redeposit \xB7 ${cycles}x \xB7 APR ${apy}`;
  }
  if (t === "cl_lp" || t === "lp" || t === "lp_bgt") {
    if (toks.length >= 2) {
      const half = cap > 0 ? "$" + (cap / 2).toLocaleString(void 0, { maximumFractionDigits: 0 }) : "\u2014";
      return `${toks[0]} ${half} \u2194 ${toks[1]} ${half} \xB7 APR ${apy}`;
    }
    const tot = cap > 0 ? "$" + cap.toLocaleString(void 0, { maximumFractionDigits: 0 }) : "\u2014";
    return `${toks[0] || "asset"} single-sided ${tot} \xB7 APR ${apy}`;
  }
  if (t === "pt") return `${toks[0] || "PT"} hold to maturity \xB7 fixed APR ${apy}`;
  if (t === "basis") return `${toks[0] || "?"} spot long + perp short \xB7 funding ${apy}`;
  if (t === "bridge") return `${toks[0] || "?"} \u2192 ${toks[1] || "?"} transfer`;
  if (t === "payback") return `${toks[0] || "?"} \u2192 ${toks[1] || "?"} BTC payout`;
  if (t === "arb") return `${toks.join(" \u2194 ")} spread capture`;
  if (t === "reserve") return `${toks[0] || "?"} tokenized reserve`;
  if (t === "canary") return `${toks.join("/")} micro canary`;
  if (t === "swap") return `${toks.join(" \u2192 ")} route probe`;
  if (t === "refuel") return `${toks.join("/")} gas refill`;
  return toks.join(" / ");
}
function strategyDesc(s) {
  return strategyKind(s) + " \xB7 " + strategyMechanics(s);
}
function AssetPairMarks({ pair = [], size = 14 }) {
  const items = (pair || []).filter(Boolean).slice(0, 3);
  if (items.length === 0) return null;
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", flexShrink: 0 } }, items.map((asset, index) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: `${asset}-${index}`,
      style: {
        marginLeft: index === 0 ? 0 : -4,
        borderRadius: 999,
        boxShadow: "0 0 0 1px #fff",
        background: "#fff"
      }
    },
    /* @__PURE__ */ React.createElement(AssetLogo, { id: asset, size })
  )));
}
function StrategyRow({ s, isLast }) {
  const chain = CHAINS.find((c) => c.id === s.chain);
  const live = s.status === "LIVE";
  const riskLabel = leverageHintLabel(s.riskHint);
  return /* @__PURE__ */ React.createElement("div", { style: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 0",
    position: "relative"
  } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", width: 44, height: 30, flexShrink: 0 } }, /* @__PURE__ */ React.createElement(ChainLogo, { id: s.chain, size: 24, style: { position: "absolute", left: 0, top: 3 } }), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", right: 0, bottom: 0 } }, /* @__PURE__ */ React.createElement(AssetPairMarks, { pair: s.pair, size: 14 })), live && /* @__PURE__ */ React.createElement("span", { style: {
    position: "absolute",
    left: 16,
    top: 0,
    width: 8,
    height: 8,
    borderRadius: 8,
    background: "var(--green)",
    boxShadow: "0 0 0 1.5px #fff"
  } })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.1, fontWeight: 600, letterSpacing: -0.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, s.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.8, color: "var(--ink-3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, chain?.name || displayChainName(s.chain), " \xB7 ", strategyKind(s), s.apyPct != null ? ` \xB7 APR ${s.apyPct.toFixed(2)}%` : ""), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.6, color: "var(--ink-4)", marginTop: 2, lineHeight: 1.35, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, strategyMechanics(s)), riskLabel && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 8.8, color: "#8A520C", marginTop: 2, lineHeight: 1.35, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, riskLabel)), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right", flexShrink: 0 } }, s.earnedUsd > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.4, fontWeight: 700, color: "var(--green)", letterSpacing: -0.2 } }, fmtYieldTag(s.earnedUsd, s.yieldBasis)), s.yieldBasis && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 8.8, color: "var(--ink-3)", marginTop: 1 } }, fmtYieldSubLabel(s.yieldBasis)), s.capUsd != null && s.capUsd > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9.5, color: "var(--ink-3)", marginTop: 1 } }, "Cap $", s.capUsd.toLocaleString())), !isLast && /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 0.5,
    background: "var(--line)"
  } }));
}
function walletScanErrorBrief(error = {}) {
  const message = String(error.message || "").toLowerCase();
  if (error.provider && message.includes("429")) return `${error.provider} 429`;
  if (error.chain && message.includes("rpc")) return `${error.chain} RPC`;
  if (error.chain) return `${error.chain} scan`;
  if (error.provider) return String(error.provider);
  return error.kind || null;
}
function WalletBalanceChainLabel({ chainId, label }) {
  const normalized = normalizeChainId(chainId);
  return /* @__PURE__ */ React.createElement("div", { style: { display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0 } }, normalized && /* @__PURE__ */ React.createElement(ChainLogo, { id: normalized, size: 11 }), /* @__PURE__ */ React.createElement("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, label));
}
function statusChipStyle(tone = "neutral") {
  if (tone === "ok") {
    return { background: "#EAF6EE", color: "var(--green)", border: "0.5px solid rgba(21,128,61,0.16)" };
  }
  if (tone === "warning") {
    return { background: "#FFF6E8", color: "var(--orange)", border: "0.5px solid rgba(201,140,0,0.22)" };
  }
  if (tone === "critical") {
    return { background: "#FDECEC", color: "#B42318", border: "0.5px solid rgba(180,35,24,0.16)" };
  }
  return { background: "rgba(255,255,255,0.06)", color: "var(--ink-3)", border: "0.5px solid var(--line)" };
}
function protocolTrackingTone(position = {}) {
  if (position?.markFailureKind === "no_reader_no_adapter" || position?.markFailureKind === "missing_binding_kind") return "warning";
  if (position?.markFreshness === "failed") return "critical";
  if (position?.markFreshness === "expired" || position?.markFreshness === "stale") return "warning";
  if (position?.markSource === "protocol_position_mark" && (position?.markFreshness === "fresh" || position?.markFreshness === "recent")) {
    return "ok";
  }
  if (position?.markConfidence === "adapter_missing") return "warning";
  return "neutral";
}
function protocolTrackingLabel(position = {}) {
  if (position?.markFailureKind === "no_reader_no_adapter" || position?.markFailureKind === "missing_binding_kind") return "needs adapter";
  if (position?.markSource === "protocol_position_mark") {
    return `tracking ${position?.markFreshness || "marked"}`;
  }
  if (position?.markConfidence === "adapter_missing") return "needs adapter";
  return "entry only";
}
function AssetsPane({ refreshTick }) {
  const HOLDINGS = window.HOLDINGS || globalThis.HOLDINGS;
  const STRATEGIES = window.STRATEGIES || globalThis.STRATEGIES || [];
  const items = HOLDINGS?.all || [];
  const positions = HOLDINGS?.positions || [];
  const total = Number.isFinite(HOLDINGS?.totalUsd) ? HOLDINGS.totalUsd : items.reduce((s, a) => s + (a.usd || 0), 0) + positions.reduce((s, a) => s + (a.usd || 0), 0);
  const currentWalletUsd = Number.isFinite(HOLDINGS?.currentWalletUsd) ? HOLDINGS.currentWalletUsd : Number.isFinite(HOLDINGS?.displayWalletUsd) ? HOLDINGS.displayWalletUsd : Number(HOLDINGS?.walletUsd || 0);
  const protocolDeployedUsd = Number.isFinite(HOLDINGS?.protocolDeployedUsd) ? HOLDINGS.protocolDeployedUsd : Number(HOLDINGS?.deployedUsd || 0);
  const currentTotalUsd = Number.isFinite(HOLDINGS?.currentTotalUsd) ? HOLDINGS.currentTotalUsd : Number.isFinite(currentWalletUsd) && Number.isFinite(protocolDeployedUsd) ? currentWalletUsd + protocolDeployedUsd : total;
  const estimatedProtocolDeployedUsd = Number.isFinite(HOLDINGS?.estimatedProtocolDeployedUsd) ? HOLDINGS.estimatedProtocolDeployedUsd : protocolDeployedUsd;
  const estimatedCurrentTotalUsd = Number.isFinite(HOLDINGS?.estimatedCurrentTotalUsd) ? HOLDINGS.estimatedCurrentTotalUsd : currentTotalUsd;
  const verifiedMinimumUsd = Number.isFinite(HOLDINGS?.verifiedMinimumUsd) ? HOLDINGS.verifiedMinimumUsd : currentTotalUsd;
  const protocolTrackingGapUsd = Number.isFinite(HOLDINGS?.protocolTrackingGapUsd) ? HOLDINGS.protocolTrackingGapUsd : Number.isFinite(HOLDINGS?.trackingGapUsd) ? HOLDINGS.trackingGapUsd : Number(HOLDINGS?.planGapUsd || 0);
  const assetEstimateAvailable = Number.isFinite(estimatedCurrentTotalUsd) && Number.isFinite(currentTotalUsd) && estimatedCurrentTotalUsd > currentTotalUsd + 1;
  const displayAssetUsd = assetEstimateAvailable ? estimatedCurrentTotalUsd : currentTotalUsd;
  const pending = HOLDINGS?.pending;
  const walletSourceLabel = HOLDINGS?.walletSource === "whole_wallet_inventory" || HOLDINGS?.walletCoverage === "full_external" ? "supported-assets live" : HOLDINGS?.walletSource === "treasury_inventory" ? "policy inventory" : "wallet source pending";
  const walletObservedLabel = HOLDINGS?.walletObservedAt ? `wallet observed ${formatStatusAge(HOLDINGS.walletObservedAt) || fmtWhen(HOLDINGS.walletObservedAt)}` : "wallet observed pending";
  const walletScanErrorDetails = (HOLDINGS?.walletScanErrors || []).map(walletScanErrorBrief).filter(Boolean).slice(0, 2);
  const walletScanHealthLabel = HOLDINGS?.walletScanErrorCount > 0 ? `scan errors ${HOLDINGS.walletScanErrorCount}${walletScanErrorDetails.length ? ` \xB7 ${walletScanErrorDetails.join(" \xB7 ")}` : ""}` : "scan clean";
  const externalScanLabel = Number.isFinite(HOLDINGS?.externalWalletUsd) ? `external reference ${fmtUsd(HOLDINGS?.externalWalletUsd)}` : null;
  const fullWalletAgeLabel = HOLDINGS?.fullWalletObservedAt ? `external reference ${HOLDINGS.fullWalletStale ? "cached" : "observed"} ${formatStatusAge(HOLDINGS.fullWalletObservedAt) || fmtWhen(HOLDINGS.fullWalletObservedAt)}` : null;
  const unclassifiedLabel = Number.isFinite(HOLDINGS?.unclassifiedUsd) && HOLDINGS.unclassifiedUsd > 0 ? `unclassified ${fmtUsd(HOLDINGS.unclassifiedUsd)}` : null;
  const planEstimateLabel = Number.isFinite(HOLDINGS?.capitalPlanRefillRequiredUsd) ? `capital refill target ${fmtUsd(HOLDINGS.capitalPlanRefillRequiredUsd)} \xB7 not wallet assets` : null;
  const estimateGapLabel = Number.isFinite(HOLDINGS?.executorEstimateDeltaUsd) && Math.abs(HOLDINGS.executorEstimateDeltaUsd) >= 1 ? `plan need above verified ${HOLDINGS.executorEstimateDeltaUsd > 0 ? "+" : ""}${fmtUsd(HOLDINGS.executorEstimateDeltaUsd)}` : null;
  const systemConfidenceLabel = HOLDINGS?.systemConfidence ? `system confidence ${HOLDINGS.systemConfidence}` : null;
  const invariantAlertLabel = HOLDINGS?.invariantViolationCount > 0 ? `audit alerts ${HOLDINGS.invariantViolationCount}` : "audit clean";
  const protocolMarkHealthLabel = Number(HOLDINGS?.currentProtocolMarkCount || 0) > 0 || Number(HOLDINGS?.protocolMarkIssueCount || 0) > 0 ? `protocol marks current ${HOLDINGS?.currentProtocolMarkCount || 0} \xB7 issues ${HOLDINGS?.protocolMarkIssueCount || 0}` : null;
  const protocolMarkObservedLabel = HOLDINGS?.latestProtocolMarkObservedAt ? `protocol marks observed ${formatStatusAge(HOLDINGS.latestProtocolMarkObservedAt) || fmtWhen(HOLDINGS.latestProtocolMarkObservedAt)}` : null;
  const adapterCoverageLabel = HOLDINGS?.adapterCoverageGapCount > 0 ? `needs adapter ${HOLDINGS.adapterCoverageGapCount}` : null;
  const pendingSignerLabel = HOLDINGS?.pendingSignerActionCount > 0 ? `signer settling ${HOLDINGS.pendingSignerActionCount}` : null;
  const assetIsVerifiedFloor = HOLDINGS?.assetConfidence === "verified_minimum";
  const assetHasReconciliationGap = protocolTrackingGapUsd > 1 || Boolean(HOLDINGS?.accountingWarning);
  const assetHeadline = assetEstimateAvailable ? "Estimated total assets" : assetIsVerifiedFloor ? "Verified minimum assets" : assetHasReconciliationGap ? "Observed assets" : "Current total assets";
  const assetEquationTotalLabel = assetEstimateAvailable ? "estimated total" : assetIsVerifiedFloor || assetHasReconciliationGap ? "verified minimum" : "current total";
  const assetMain = pending ? "\u2014" : fmtUsd(displayAssetUsd);
  const planGapLabel = Number.isFinite(HOLDINGS?.planGapUsd) && HOLDINGS.planGapUsd > 0 && Number.isFinite(HOLDINGS?.executorEstimatedTotalUsd) ? `protocol estimate source \xB7 ${fmtUsd(HOLDINGS.executorEstimatedTotalUsd)} target` : null;
  const liveStrats = STRATEGIES.filter((s) => s.status === "LIVE");
  const stratsByAsset = {};
  liveStrats.forEach((s) => {
    (s.pair || []).filter(Boolean).forEach((tok) => {
      const k = tok.toLowerCase();
      (stratsByAsset[k] || (stratsByAsset[k] = [])).push(s);
    });
  });
  void refreshTick;
  return /* @__PURE__ */ React.createElement("div", { className: "tabpane", style: { padding: "4px 16px 16px" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "14px 16px", background: "var(--card)", borderRadius: 18, border: "0.5px solid var(--line)", marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--ink-4)", letterSpacing: 1.4, textTransform: "uppercase" } }, assetHeadline), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 28, fontWeight: 600, letterSpacing: -0.8 } }, pending ? "\u2014" : assetMain), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "var(--ink-3)" } }, "USD")), !pending && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--ink-3)", marginTop: 2 } }, assetEstimateAvailable ? "estimated live " : assetHasReconciliationGap ? "observed live " : "", "remaining ", fmtUsd(currentWalletUsd), " + ", assetEstimateAvailable ? "estimated" : "tracked", " protocols ", fmtUsd(assetEstimateAvailable ? estimatedProtocolDeployedUsd : protocolDeployedUsd), " = ", assetEquationTotalLabel, " ", fmtUsd(displayAssetUsd), assetEstimateAvailable && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", "verified minimum ", fmtUsd(verifiedMinimumUsd)), protocolTrackingGapUsd > 1 && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", "unreconciled protocol estimate ", fmtUsd(protocolTrackingGapUsd)), " \xB7 ", "live supported ", fmtUsd(HOLDINGS?.walletUsd), " \xB7 ", "open positions ", positions.length), !pending && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: "var(--ink-3)", border: "0.5px solid var(--line)" } }, walletSourceLabel), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: "var(--ink-3)", border: "0.5px solid var(--line)" } }, walletObservedLabel), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, background: HOLDINGS?.walletScanErrorCount > 0 ? "#FFF6E8" : "rgba(255,255,255,0.06)", color: HOLDINGS?.walletScanErrorCount > 0 ? "var(--orange)" : "var(--ink-3)", border: HOLDINGS?.walletScanErrorCount > 0 ? "0.5px solid rgba(201,140,0,0.22)" : "0.5px solid var(--line)" } }, walletScanHealthLabel), externalScanLabel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: "var(--ink-3)", border: "0.5px solid var(--line)" } }, externalScanLabel), fullWalletAgeLabel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, background: HOLDINGS?.fullWalletStale ? "#FFF6E8" : "rgba(255,255,255,0.06)", color: HOLDINGS?.fullWalletStale ? "var(--orange)" : "var(--ink-3)", border: HOLDINGS?.fullWalletStale ? "0.5px solid rgba(201,140,0,0.22)" : "0.5px solid var(--line)" } }, fullWalletAgeLabel), unclassifiedLabel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, background: "#FFF6E8", color: "var(--orange)", border: "0.5px solid rgba(201,140,0,0.22)" } }, unclassifiedLabel), assetIsVerifiedFloor && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, background: "#FFF6E8", color: "var(--orange)", border: "0.5px solid rgba(201,140,0,0.22)" } }, "verified minimum ", fmtUsd(verifiedMinimumUsd)), protocolTrackingGapUsd > 1 && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, background: "#FFF6E8", color: "var(--orange)", border: "0.5px solid rgba(201,140,0,0.22)" } }, "protocol tracking gap ", fmtUsd(protocolTrackingGapUsd)), planEstimateLabel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, background: HOLDINGS?.accountingWarning ? "#FFF6E8" : "rgba(255,255,255,0.06)", color: HOLDINGS?.accountingWarning ? "var(--orange)" : "var(--ink-3)", border: HOLDINGS?.accountingWarning ? "0.5px solid rgba(201,140,0,0.22)" : "0.5px solid var(--line)" } }, planEstimateLabel), planGapLabel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, background: "#FFF6E8", color: "var(--orange)", border: "0.5px solid rgba(201,140,0,0.22)" } }, planGapLabel), estimateGapLabel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, background: HOLDINGS?.accountingWarning ? "#FFF6E8" : "rgba(255,255,255,0.06)", color: HOLDINGS?.accountingWarning ? "var(--orange)" : "var(--ink-3)", border: HOLDINGS?.accountingWarning ? "0.5px solid rgba(201,140,0,0.22)" : "0.5px solid var(--line)" } }, estimateGapLabel), systemConfidenceLabel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, ...statusChipStyle(HOLDINGS?.systemConfidence === "high" ? "ok" : HOLDINGS?.systemConfidence === "medium" ? "warning" : "critical") } }, systemConfidenceLabel), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, ...statusChipStyle(HOLDINGS?.invariantViolationCount > 0 ? "warning" : "ok") } }, invariantAlertLabel), protocolMarkHealthLabel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, ...statusChipStyle(Number(HOLDINGS?.protocolMarkIssueCount || 0) > 0 ? "warning" : "ok") } }, protocolMarkHealthLabel), protocolMarkObservedLabel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, ...statusChipStyle("neutral") } }, protocolMarkObservedLabel), adapterCoverageLabel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, ...statusChipStyle("warning") } }, adapterCoverageLabel), pendingSignerLabel && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, padding: "3px 7px", borderRadius: 999, ...statusChipStyle("warning") } }, pendingSignerLabel)), pending && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--ink-4)", marginTop: 2 } }, "treasury snapshot pending")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.5, color: "var(--ink-4)", letterSpacing: 1.6, textTransform: "uppercase", padding: "0 4px 8px" } }, "Wallet balances"), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--card)", borderRadius: 18, border: "0.5px solid var(--line)", overflow: "hidden" } }, items.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 14px", fontSize: 12, color: "var(--ink-4)", textAlign: "center" } }, "no balance feed wired yet"), items.map((a, i, arr) => {
    const sym = String(a.sym || a.name || "").toLowerCase();
    const symBase = sym.split(".")[0];
    const isExternalDelta = symBase === "other" || a.family === "external_unclassified";
    const chainLabel = a.chain || (isExternalDelta ? "external address scan" : "unmapped");
    const aliases = /* @__PURE__ */ new Set([sym, symBase]);
    if (symBase === "wbtc" || symBase === "cbbtc" || symBase === "lbtc" || symBase === "btcb" || symBase === "btc.b") {
      aliases.add("wbtc");
      aliases.add("cbbtc");
      aliases.add("btc");
    }
    if (symBase === "usdc" || symBase === "usdt" || symBase === "dai") {
      aliases.add("usdc");
      aliases.add("usdt");
    }
    const tied = liveStrats.filter(
      (s) => (s.pair || []).some((tok) => aliases.has(String(tok || "").toLowerCase())) && (a.chain ? s.chain === a.chain : true)
    );
    return /* @__PURE__ */ React.createElement("div", { key: a.sym + i, style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 12,
      padding: "12px 14px",
      position: "relative"
    } }, /* @__PURE__ */ React.createElement(AssetLogo, { id: a.sym, size: 28 }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, fontWeight: 500 } }, a.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--ink-3)", marginTop: 1 } }, /* @__PURE__ */ React.createElement(WalletBalanceChainLabel, { chainId: a.chain, label: chainLabel })), tied.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 } }, tied.slice(0, 4).map((s) => /* @__PURE__ */ React.createElement("span", { key: s.id, style: {
      fontSize: 9.5,
      padding: "2px 6px",
      borderRadius: 5,
      background: "#EAF6EE",
      color: "var(--green)",
      fontWeight: 600,
      letterSpacing: 0.2,
      whiteSpace: "nowrap"
    }, title: s.label }, "\u25CF ", strategyKind(s), " \xB7 ", s.protocol)), tied.length > 4 && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9.5, color: "var(--ink-4)", padding: "2px 4px" } }, "+", tied.length - 4))), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 600, letterSpacing: -0.2 } }, "$", (a.usd || 0).toLocaleString()), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--ink-3)", marginTop: 1 } }, isExternalDelta ? "external scan delta" : `${(a.amount || 0).toLocaleString()} ${a.name}`)), i !== arr.length - 1 && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: 54, right: 0, bottom: 0, height: 0.5, background: "var(--line)" } }));
  })), positions.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.5, color: "var(--ink-4)", letterSpacing: 1.6, textTransform: "uppercase", padding: "16px 4px 8px" } }, "Deployed positions"), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--card)", borderRadius: 18, border: "0.5px solid var(--line)", overflow: "hidden" } }, positions.map((p, i, arr) => /* @__PURE__ */ React.createElement("div", { key: (p.opportunityId || p.name) + i, style: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    position: "relative"
  } }, /* @__PURE__ */ React.createElement(ProtocolLogo, { id: p.protocol, size: 28 }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, fontWeight: 500, lineHeight: 1.25 } }, p.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--ink-3)", marginTop: 2 } }, p.chain, " \xB7 ", p.protocol), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9.5, padding: "2px 6px", borderRadius: 999, ...statusChipStyle(protocolTrackingTone(p)) } }, protocolTrackingLabel(p)), p.markConfidence && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9.5, padding: "2px 6px", borderRadius: 999, ...statusChipStyle(p.markConfidence === "verified_current" ? "ok" : "warning") } }, String(p.markConfidence).replace(/_/g, " ")), p.markObservedAt && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9.5, padding: "2px 6px", borderRadius: 999, ...statusChipStyle("neutral") } }, "mark ", formatStatusAge(p.markObservedAt) || fmtWhen(p.markObservedAt)))), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 600, letterSpacing: -0.2 } }, fmtUsd(p.usd || 0)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.5, color: "var(--green)", marginTop: 1 } }, "deployed")), i !== arr.length - 1 && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", left: 54, right: 0, bottom: 0, height: 0.5, background: "var(--line)" } }))))));
}
function App() {
  const [tab, setTab] = useState("flow");
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const handler = () => setRefreshTick((t) => t + 1);
    window.addEventListener("dashboard:datarefresh", handler);
    return () => window.removeEventListener("dashboard:datarefresh", handler);
  }, []);
  return /* @__PURE__ */ React.createElement("div", { style: { position: "fixed", inset: 0, display: "flex", flexDirection: "column", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "6px 16px 2px", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { className: "title" }, "BOB CLAW\u{1F99E}")), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement(TabView, { tabs: TABS, active: tab, onChange: setTab }, /* @__PURE__ */ React.createElement(FlowPane, { refreshTick }), /* @__PURE__ */ React.createElement(DefiPane, { refreshTick }), /* @__PURE__ */ React.createElement(AssetsPane, { refreshTick }))));
}
(() => {
  const root = document.getElementById("root");
  root.innerHTML = "";
  ReactDOM.createRoot(root).render(/* @__PURE__ */ React.createElement(App, null));
})();
})();
