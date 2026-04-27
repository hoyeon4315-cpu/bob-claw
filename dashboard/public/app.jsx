// Prebuilt dashboard app source extracted from index.html.

const { useState, useEffect, useRef } = React;

const TABS = [
  { id: 'flow',   label: 'Flow'   },
  { id: 'defi',   label: 'DeFi'   },
  { id: 'assets', label: 'Assets' },
];

function TabView({ tabs, active, onChange, children }) {
  const trackRef = useRef(null);
  const programmaticRef = useRef(false);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const idx = tabs.findIndex(t => t.id === active);
    const target = idx * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) < 2) return;
    programmaticRef.current = true;
    el.scrollTo({ left: target, behavior: 'smooth' });
    clearTimeout(programmaticRef.timer);
    programmaticRef.timer = setTimeout(() => { programmaticRef.current = false; }, 500);
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
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); clearTimeout(settleTimer); };
  }, [tabs, active, onChange]);
  return (
    <>
      <div className="tabbar" role="tablist">
        {tabs.map(t => (
          <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onChange(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tabtrack" ref={trackRef}>
        {children}
      </div>
    </>
  );
}

function fmtSats(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e8) return (n/1e8).toFixed(4) + ' BTC';
  return n.toLocaleString() + ' sats';
}
function fmtUsd(n) {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toFixed(2);
}
function fmtUsdCompact(n) {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs > 0 && abs < 1) return sign + '<$1';
  return sign + '$' + abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtPct(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits) + '%';
}
function fmtYieldTag(value, basis) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = value >= 10
    ? `$${value.toFixed(0)}`
    : value >= 1
      ? `$${value.toFixed(2)}`
      : value >= 0.01
        ? `$${value.toFixed(3)}`
        : '<$0.01';
  return basis === 'estimated' ? `~${rounded}` : `+${rounded}`;
}
function fmtYieldSubLabel(basis) {
  if (basis === 'estimated') return 'Est. yield';
  if (basis === 'realized') return 'Realized';
  return null;
}
function fmtWhen(value) {
  if (!value) return '시간 미확인';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '시간 미확인';
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function pnlKindLabel(kind) {
  return ({
    gas_zip_native_refuel: 'Gas refuel',
    erc4626_protocol_canary: 'ERC4626 canary',
    lifi_bridge: 'LI.FI bridge',
    token_dex_experiment: 'Token DEX probe',
    native_dex_experiment: 'Native DEX probe',
    gateway_btc_consolidation: 'Gateway consolidation',
    across_bridge: 'Across bridge',
  })[kind] || titleCaseLabel(kind || 'activity');
}
function formatStatusAge(value) {
  if (!value) return null;
  const observedAtMs = new Date(value).getTime();
  if (!Number.isFinite(observedAtMs)) return null;
  const ageMs = Date.now() - observedAtMs;
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  if (ageMs < 15000) return 'just now';
  if (ageMs < 60000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 3600000) return `${Math.round(ageMs / 60000)}m ago`;
  return `${Math.round(ageMs / 3600000)}h ago`;
}
const HISTORY_FILTER_STORAGE_KEY = 'bob-claw:history-filter';
const HISTORY_EXPANDED_STORAGE_KEY = 'bob-claw:history-expanded';
function readPersistedHistoryFilter() {
  try {
    const value = window.localStorage.getItem(HISTORY_FILTER_STORAGE_KEY);
    return value || 'all';
  } catch {
    return 'all';
  }
}
function writePersistedHistoryFilter(value) {
  try {
    window.localStorage.setItem(HISTORY_FILTER_STORAGE_KEY, value);
  } catch {}
}
function readPersistedHistoryExpanded() {
  try {
    return window.localStorage.getItem(HISTORY_EXPANDED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}
function writePersistedHistoryExpanded(value) {
  try {
    window.localStorage.setItem(HISTORY_EXPANDED_STORAGE_KEY, value ? 'true' : 'false');
  } catch {}
}
function normalizeUiStrategyId(id) {
  return String(id || '').replace(/-/g, '_');
}
function findStrategyById(id) {
  const key = normalizeUiStrategyId(id);
  return (window.STRATEGIES || []).find((item) => normalizeUiStrategyId(item.id) === key) || null;
}
function titleCaseLabel(value) {
  return String(value || '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
function normalizeChainId(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const alias = {
    btc: 'bitcoin',
    bitcoin: 'bitcoin',
    eth: 'ethereum',
    ethereum: 'ethereum',
    avalanche: 'avalanche',
    base: 'base',
    berachain: 'bera',
    bnb: 'bsc',
    bsc: 'bsc',
    bob: 'bob',
    optimism: 'optimism',
    sei: 'sei',
    soneium: 'soneium',
    sonic: 'sonic',
    unichain: 'unichain',
  }[raw];
  if (alias) return alias;
  const hit = (window.CHAINS || []).find((chain) => {
    const chainName = String(chain?.name || '').trim().toLowerCase();
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
    yo: 'YO',
    gmx: 'GMX',
  };
  return id ? (known[String(id).toLowerCase()] || titleCaseLabel(id)) : null;
}
function parseRouteHint(label) {
  const parts = String(label || '').split(/\s*→\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? { source: parts[0], target: parts[1] } : null;
}

function StatCard({ label, main, sub, accent, onTap, tappable }) {
  return (
    <div onClick={onTap} style={{
      padding: '8px 12px', background: 'var(--card)', borderRadius: 12,
      border: '0.5px solid var(--line)', cursor: tappable ? 'pointer' : 'default',
      transition: `transform 180ms ${'cubic-bezier(0.22, 1, 0.36, 1)'}`,
    }}>
      <div style={{ fontSize: 8.5, color: 'var(--ink-4)', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.3, marginTop: 2, color: accent || 'var(--ink)' }}>{main}</div>
      <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 0 }}>{sub}</div>
    </div>
  );
}

function TriCard({ cells }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'stretch',
      padding: '10px 4px', background: 'var(--card)', borderRadius: 14,
      border: '0.5px solid var(--line)',
    }}>
      {cells.map((c, i) => (
        <React.Fragment key={c.label}>
          <div onClick={c.onTap} style={{
            flex: 1, padding: '0 10px', textAlign: 'center',
            cursor: c.onTap ? 'pointer' : 'default', minWidth: 0,
          }}>
            <div style={{ fontSize: 8.5, color: 'var(--ink-4)', letterSpacing: 1, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</div>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.3, marginTop: 2, color: c.accent || 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.main}</div>
            {c.sub && <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sub}</div>}
          </div>
          {i < cells.length - 1 && <div style={{ width: 0.5, background: 'var(--line)' }}/>}
        </React.Fragment>
      ))}
    </div>
  );
}

function statusLabel(status) {
  if (status === 'completed') return '완료';
  if (status === 'completed_with_blockers') return '부분 완료';
  if (status === 'error') return '점검';
  if (status === 'missing') return '대기';
  return status || '대기';
}

function blockerLabel(item) {
  if (!item) return null;
  const prefix = item.chain && item.asset ? `${item.chain} ${item.asset}` : item.source;
  return [prefix, item.reason].filter(Boolean).join(' · ');
}

function activityStatusLabel(activity) {
  const status = activity?.status;
  if (status === 'delivered') return 'Delivered';
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'broadcasted') return 'Broadcasted';
  if (status === 'signed') return 'Signed';
  if (status === 'rejected') return 'Rejected';
  if (status === 'error') return 'Error';
  if (status === 'open') return 'Open';
  if (status === 'settled') return 'Settled';
  return status ? titleCaseLabel(status) : 'Logged';
}

function activityStatusTone(activity) {
  if (activity?.kind === 'payback') return { bg: '#FFF4E2', fg: '#8A520C' };
  if (activity?.status === 'rejected' || activity?.status === 'error') return { bg: '#FDECEC', fg: '#B42318' };
  if (activity?.status === 'signed' || activity?.status === 'broadcasted') return { bg: '#FFF6E8', fg: '#8A520C' };
  if (activity?.status === 'delivered' || activity?.status === 'confirmed' || activity?.status === 'open') {
    return { bg: '#EAF6EE', fg: 'var(--green)' };
  }
  return { bg: '#ECECEE', fg: 'var(--ink-3)' };
}

function activityAmount(activity) {
  if (Number.isFinite(activity?.amountUsd) && activity.amountUsd > 0) return fmtUsdCompact(activity.amountUsd);
  if (Number.isFinite(activity?.amountSats) && activity.amountSats > 0) return fmtSats(activity.amountSats);
  if (Number.isFinite(activity?.realizedNetPnlUsd) && activity.realizedNetPnlUsd !== 0) return fmtUsd(activity.realizedNetPnlUsd);
  const detail = String(activity?.detail || '').toLowerCase();
  if (detail.includes('approve')) return 'Approve';
  if (detail.includes('erc4626_deposit')) return 'Deposit';
  if (detail.includes('erc4626_redeem')) return 'Redeem';
  if (activity?.kind === 'transaction') return 'TX';
  return '—';
}

function assetDisplayLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.length <= 12 ? raw.toUpperCase() : raw;
}

function isCompactAssetSymbol(value) {
  return /^[A-Za-z0-9./_-]{1,16}$/u.test(String(value || '').trim());
}

function deriveActivityFinalAsset(activity, strategy) {
  if (activity?.finalAssetId || activity?.finalAssetLabel) {
    return {
      id: activity.finalAssetId || activity.finalAssetLabel,
      label: assetDisplayLabel(activity.finalAssetLabel || activity.finalAssetId),
    };
  }
  if (activity?.kind === 'payback') return { id: 'btc', label: 'BTC' };
  const detail = String(activity?.detail || '').trim();
  if (isCompactAssetSymbol(detail)) {
    return { id: detail, label: assetDisplayLabel(detail) };
  }
  const pair = Array.isArray(strategy?.pair) ? strategy.pair.filter(Boolean) : [];
  if (activity?.kind === 'position' && pair[0]) {
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
  return bits.length ? bits.join(' · ') : null;
}

function FlowMetricGrid({ cards }) {
  return (
    <div style={{
      margin: '8px 12px 0',
      display: 'flex',
      alignItems: 'stretch',
      padding: '10px 4px',
      background: 'var(--card)',
      borderRadius: 14,
      border: '0.5px solid var(--line)',
      flexShrink: 0,
    }}>
      {cards.map((card, index) => (
        <React.Fragment key={card.label}>
          <div
            onClick={card.onTap}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '0 6px',
              textAlign: 'center',
              cursor: card.onTap ? 'pointer' : 'default',
            }}
          >
            <div style={{
              fontSize: 7.8,
              color: 'var(--ink-4)',
              letterSpacing: 0.9,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {card.label}
            </div>
            <div style={{
              fontSize: 12.6,
              fontWeight: 700,
              letterSpacing: -0.25,
              marginTop: 2,
              color: card.accent || 'var(--ink)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {card.main}
            </div>
            <div style={{
              fontSize: 8.8,
              color: 'var(--ink-3)',
              marginTop: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {card.sub}
            </div>
          </div>
          {index < cards.length - 1 && <div style={{ width: 0.5, background: 'var(--line)' }}/>}
        </React.Fragment>
      ))}
    </div>
  );
}

function RouteNode({ kind = 'text', id, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, flexShrink: 1 }}>
      {kind === 'chain' && id ? <ChainLogo id={id} size={16}/> : null}
      {kind === 'protocol' && id ? <ProtocolLogo id={id} size={16}/> : null}
      <span style={{
        minWidth: 0,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {label}
      </span>
    </span>
  );
}

function activityRouteSummary(activity, strategy) {
  const hint = parseRouteHint(strategy?.sub || activity?.detail || '');
  const sourceChainId = activity?.kind === 'payback'
    ? normalizeChainId(strategy?.chain) || normalizeChainId(hint?.source) || normalizeChainId(activity?.chain)
    : normalizeChainId(hint?.source) || normalizeChainId(activity?.chain) || normalizeChainId(strategy?.chain);
  const source = sourceChainId
    ? { kind: 'chain', id: sourceChainId, label: displayChainName(sourceChainId) }
    : { kind: 'text', id: null, label: 'Capital' };
  const hintedTargetChainId = activity?.kind === 'payback' ? 'bitcoin' : normalizeChainId(hint?.target);
  const protocolId = activity?.protocol || strategy?.protocol || null;
  const target = hintedTargetChainId && hintedTargetChainId !== sourceChainId
    ? { kind: 'chain', id: hintedTargetChainId, label: displayChainName(hintedTargetChainId) }
    : protocolId
      ? { kind: 'protocol', id: protocolId, label: displayProtocolName(protocolId) }
      : hintedTargetChainId
        ? { kind: 'chain', id: hintedTargetChainId, label: displayChainName(hintedTargetChainId) }
        : { kind: 'text', id: null, label: strategy?.label || activity?.detail || 'Recent move' };
  return {
    source,
    target,
    title: strategy?.label || activity?.detail || target.label,
  };
}

function FlowActivityRow({ activity, isLast }) {
  const strategy = findStrategyById(activity?.strategyId);
  const tone = activityStatusTone(activity);
  const riskLabel = leverageHintLabel(leverageHintForActivity(activity));
  const route = activityRouteSummary(activity, strategy);
  const finalAsset = deriveActivityFinalAsset(activity, strategy);

  return (
    <div style={{
      padding: '9px 0',
      position: 'relative',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      minWidth: 0,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
          fontSize: 10.3,
          fontWeight: 600,
          letterSpacing: -0.15,
        }}>
          <RouteNode kind={route.source.kind} id={route.source.id} label={route.source.label}/>
          <span style={{ color: 'var(--ink-4)', flexShrink: 0 }}>→</span>
          <RouteNode kind={route.target.kind} id={route.target.id} label={route.target.label}/>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, marginTop: 4 }}>
          <div style={{
            fontSize: 10.4,
            fontWeight: 600,
            letterSpacing: -0.15,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}>
            {route.title}
          </div>
          <span style={{
            fontSize: 8.3,
            padding: '1px 5px',
            borderRadius: 999,
            background: tone.bg,
            color: tone.fg,
            fontWeight: 700,
            letterSpacing: 0.15,
            flexShrink: 0,
          }}>
            {activityStatusLabel(activity)}
          </span>
        </div>
        {riskLabel && (
          <div style={{
            fontSize: 8.9,
            color: '#8A520C',
            marginTop: 2,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {riskLabel}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 0 }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
          maxWidth: 148,
        }}>
          {finalAsset && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              minWidth: 0,
              color: 'var(--ink-3)',
            }}>
              <AssetLogo id={finalAsset.id} size={11}/>
              <span style={{
                fontSize: 9.1,
                fontWeight: 600,
                color: 'var(--ink-3)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 54,
              }}>
                {finalAsset.label}
              </span>
            </div>
          )}
          <div style={{ fontSize: 10.6, fontWeight: 700, letterSpacing: -0.15 }}>
            {activityAmount(activity)}
          </div>
        </div>
        <div style={{ fontSize: 9.2, color: 'var(--ink-3)', marginTop: 1 }}>
          {fmtWhen(activity?.observedAt)}
        </div>
      </div>
      {!isLast && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 0.5, background: 'var(--line)' }}/>}
    </div>
  );
}

function OpsStrip({ fill = false }) {
  const flow = window.FLOW || {};
  const activities = flow?.recentActivities || [];
  const txActivities = activities.filter((activity) => activity?.kind === 'transaction');
  const positionActivities = activities.filter((activity) => activity?.kind === 'position');
  const paybackActivities = activities.filter((activity) => activity?.kind === 'payback');
  const inFlightTxCount = txActivities.filter((activity) => activity?.status === 'signed' || activity?.status === 'broadcasted').length;
  const confirmedTxCount = txActivities.filter((activity) => activity?.status === 'confirmed').length;
  const [expanded, setExpanded] = useState(() => readPersistedHistoryExpanded());
  const [filter, setFilter] = useState(() => readPersistedHistoryFilter());
  const filteredActivities = activities.filter((activity) => {
    if (filter === 'in_flight') return activity?.kind === 'transaction' && (activity?.status === 'signed' || activity?.status === 'broadcasted');
    if (filter === 'confirmed') return activity?.kind === 'transaction' && activity?.status === 'confirmed';
    if (filter === 'tx') return activity?.kind === 'transaction';
    if (filter === 'position') return activity?.kind === 'position';
    if (filter === 'payback') return activity?.kind === 'payback';
    return true;
  });
  const visibleActivities = expanded ? filteredActivities : filteredActivities.slice(0, 3);
  const filterChips = [
    { id: 'all', label: `All ${activities.length}`, tone: { bg: '#111113', fg: '#F4F4F4' } },
    { id: 'in_flight', label: `In flight ${inFlightTxCount}`, tone: { bg: '#FFF4E2', fg: '#8A520C' }, hidden: inFlightTxCount === 0 },
    { id: 'confirmed', label: `Confirmed ${confirmedTxCount}`, tone: { bg: '#EAF6EE', fg: 'var(--green)' }, hidden: confirmedTxCount === 0 },
    { id: 'tx', label: `TX ${txActivities.length}`, tone: { bg: '#ECECEE', fg: 'var(--ink-3)' }, hidden: txActivities.length === 0 },
    { id: 'position', label: `Position ${positionActivities.length}`, tone: { bg: '#EEF2FF', fg: '#3256D7' }, hidden: positionActivities.length === 0 },
    { id: 'payback', label: `Payback ${paybackActivities.length}`, tone: { bg: '#FFF4E2', fg: '#8A520C' }, hidden: paybackActivities.length === 0 },
  ].filter((item) => !item.hidden);
  useEffect(() => {
    const allowed = new Set(filterChips.map((item) => item.id));
    if (!allowed.has(filter)) {
      setFilter('all');
      return;
    }
    writePersistedHistoryFilter(filter);
  }, [filter, filterChips]);
  useEffect(() => {
    writePersistedHistoryExpanded(expanded);
  }, [expanded]);
  return (
    <div style={{
      margin: fill ? '0 12px' : '6px 12px 0', padding:'10px 12px 8px',
      background:'var(--card)', border:'0.5px solid var(--line)', borderRadius:14,
      flexShrink:0, animation:`slideUp 220ms cubic-bezier(0.22,1,0.36,1) both`,
      display: 'flex', flexDirection: 'column',
      minHeight: fill ? 0 : undefined,
      flex: fill ? '1 1 auto' : '0 0 auto',
      overflow: 'hidden',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
        <div style={{
          width: 24, height: 24, borderRadius: 12,
          background: '#FFF4E2',
          color: '#8A520C',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>H</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:0.2 }}>History</div>
          <div style={{ fontSize:9.6, color:'var(--ink-3)', marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            Latest capital moves across chains and protocols
          </div>
          {filterChips.length > 0 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:4 }}>
              {filterChips.map((chip) => {
                const active = filter === chip.id;
                return (
                  <button
                    key={chip.id}
                    onClick={() => {
                      setExpanded(false);
                      setFilter(chip.id);
                    }}
                    style={{
                      display:'inline-flex', alignItems:'center', padding:'1px 6px',
                      borderRadius:999, border:'none',
                      background: active ? chip.tone.bg : '#F5F5F6',
                      color: active ? chip.tone.fg : 'var(--ink-3)',
                      fontSize:8.4, fontWeight:700, letterSpacing:0.15,
                      cursor:'pointer',
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {filteredActivities.length > 3 && (
          <button
            onClick={() => setExpanded((value) => !value)}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--ink-3)',
              fontSize: 10.5,
              fontWeight: 600,
              padding: 0,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {expanded ? 'Show less' : `Show more · ${filteredActivities.length}`}
          </button>
        )}
      </div>
      <div style={{
        marginTop: 8,
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        paddingRight: 4,
        overscrollBehavior: 'contain',
      }}>
        {filteredActivities.length === 0 && (
          <div style={{ fontSize: 10, color: 'var(--ink-4)', padding: '4px 0 2px' }}>
            No matching capital move yet.
          </div>
        )}
        {visibleActivities.map((activity, index) => (
          <FlowActivityRow
            key={activity.id || `${activity.kind}-${index}`}
            activity={activity}
            isLast={index === visibleActivities.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function PnlBreakdownStrip() {
  const flow = window.FLOW || {};
  const metrics = flow?.metrics || {};
  const strategyUsd = metrics.realizedStrategyUsd;
  const evidenceUsd = metrics.realizedEvidenceCostUsd;
  const totalUsd = metrics.realizedTotalUsd;
  const strategyCount = metrics.realizedStrategyTradeCount || 0;
  const evidenceCount = metrics.realizedEvidenceCount || 0;
  const topKinds = Array.isArray(metrics.realizedByKind)
    ? metrics.realizedByKind
        .filter((item) => Number.isFinite(item?.realizedNetPnlUsd) && item.realizedNetPnlUsd < 0)
        .slice(0, 3)
    : [];
  if (!Number.isFinite(strategyUsd) && !Number.isFinite(evidenceUsd) && !Number.isFinite(totalUsd)) return null;
  return (
    <div style={{
      margin: '0 12px',
      padding: '10px 12px 8px',
      background: 'var(--card)',
      border: '0.5px solid var(--line)',
      borderRadius: 14,
      flexShrink: 0,
      animation: `slideUp 220ms cubic-bezier(0.22,1,0.36,1) both`,
    }}>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:8 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:0.2 }}>Realized split</div>
          <div style={{ fontSize:9.6, color:'var(--ink-3)', marginTop:1 }}>
            strategy vs transport / probe cost
          </div>
        </div>
        <div style={{ fontSize:10, color:'var(--ink-3)' }}>
          {strategyCount} strategy · {evidenceCount} probe
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <TriCard cells={[
          {
            label: 'Strategy',
            main: fmtUsd(strategyUsd),
            sub: `${strategyCount} receipts`,
            accent: Number.isFinite(strategyUsd) && strategyUsd < 0 ? '#B42318' : 'var(--green)',
          },
          {
            label: 'Probe cost',
            main: fmtUsd(evidenceUsd),
            sub: `${evidenceCount} receipts`,
            accent: Number.isFinite(evidenceUsd) && evidenceUsd < 0 ? '#8A520C' : 'var(--ink)',
          },
          {
            label: 'Total',
            main: fmtUsd(totalUsd),
            sub: 'combined impact',
            accent: Number.isFinite(totalUsd) && totalUsd < 0 ? '#B42318' : 'var(--green)',
          },
        ]}/>
      </div>
      {topKinds.length > 0 && (
        <div style={{ fontSize:10, color:'var(--ink-3)', marginTop:8, lineHeight:1.45 }}>
          Top drags: {topKinds.map((item) => `${pnlKindLabel(item.kind)} ${fmtUsd(item.realizedNetPnlUsd)}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

function FlowPane({ refreshTick }) {
  const flow = window.FLOW || {};
  const items = HOLDINGS?.all || [];
  const pending = HOLDINGS?.pending;
  const positions = HOLDINGS?.positions || [];
  const [mindmapFocus, setMindmapFocus] = useState({ layer: 'root' });
  const overlayActive = mindmapFocus?.layer === 'chain' || mindmapFocus?.layer === 'protocol';
  const totalUsd = HOLDINGS?.totalUsd != null
    ? HOLDINGS.totalUsd
    : items.reduce((s, a) => s + (a.usd || 0), 0) + positions.reduce((s, a) => s + (a.usd || 0), 0);
  const assetValueUsd = Number.isFinite(totalUsd)
    ? totalUsd
    : (Number.isFinite(flow?.metrics?.assetValueUsd) ? flow.metrics.assetValueUsd : 0);
  const paidSats = flow?.metrics?.paidBackSatsLifetime ?? KPI?.paidBack?.sats ?? 0;
  const paidUsd  = flow?.metrics?.paidBackUsdLifetime ?? KPI?.paidBack?.usd;
  const carrySats = flow?.metrics?.pendingCarrySats ?? KPI?.pendingCarry?.sats ?? 0;
  const carryUsd = flow?.metrics?.pendingCarryUsd ?? KPI?.pendingCarry?.usd;
  const grossYieldUsd = flow?.metrics?.grossProfitUsdPeriod ?? KPI?.totalEarning?.usd;
  const grossYieldSats = flow?.metrics?.grossProfitSatsPeriod ?? KPI?.totalEarning?.sats ?? 0;
  const yieldMain = grossYieldSats > 0
    ? fmtSats(grossYieldSats)
    : (Number.isFinite(grossYieldUsd) && grossYieldUsd > 0 ? fmtUsdCompact(grossYieldUsd) : '—');
  const yieldSub = Number.isFinite(grossYieldUsd) && grossYieldUsd > 0
    ? `${fmtUsdCompact(grossYieldUsd)} · all protocols`
    : 'all protocols';
  const aprStrats = STRATEGIES.filter(s => s.apyPct != null && s.capUsd);
  const aprDen = aprStrats.reduce((s, x) => s + x.capUsd, 0);
  const aprNum = aprStrats.reduce((s, x) => s + x.capUsd * x.apyPct, 0);
  const totalApr = aprDen > 0 ? aprNum / aprDen : null;
  const [aprOpen, setAprOpen] = useState(false);
  const assetSub = pending
    ? 'pending'
    : (positions.length > 0 ? `wallet + ${positions.length} open position${positions.length > 1 ? 's' : ''}` : 'wallet only · 0 open positions');
  return (
    <div className="tabpane" style={{ position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute',
        left: 12,
        right: 12,
        top: 4,
        height: overlayActive ? 'calc(100% - 12px)' : 'calc(56% - 4px)',
        zIndex: 4,
        transition: 'height 450ms var(--ease), transform 450ms var(--ease)',
      }}>
        <div style={{
          height: '100%', borderRadius: overlayActive ? 22 : 18, overflow: 'hidden',
          background: 'var(--card)', border: '0.5px solid var(--line)',
          boxShadow: overlayActive ? '0 18px 48px rgba(17,17,19,0.16)' : '0 0 0 rgba(17,17,19,0)',
          transition: 'border-radius 450ms var(--ease), box-shadow 450ms var(--ease)',
        }}>
          <Mindmap motionSpeed={1.4} refreshTick={refreshTick} onFocusChange={setMindmapFocus}/>
        </div>
      </div>

      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 'calc(56% + 4px)',
        bottom: 0,
        zIndex: 1,
        opacity: overlayActive ? 0.28 : 1,
        transform: overlayActive ? 'translateY(18px) scale(0.985)' : 'translateY(0) scale(1)',
        filter: overlayActive ? 'saturate(0.72)' : 'none',
        pointerEvents: overlayActive ? 'none' : 'auto',
        transition: 'opacity 450ms var(--ease), transform 450ms var(--ease), filter 450ms var(--ease)',
      }}>
        <div style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          paddingBottom: 8,
          overflow: 'hidden',
        }}>
          <FlowMetricGrid cards={[
            {
              label: 'Assets',
              main: pending ? '—' : fmtUsdCompact(assetValueUsd || 0),
              sub: assetSub,
            },
            {
              label: 'APR',
              main: totalApr != null ? fmtPct(totalApr) : '—',
              sub: aprOpen ? 'cap-weighted' : 'tap for note',
              onTap: () => setAprOpen(o => !o),
              accent: aprOpen ? 'var(--ink)' : undefined,
            },
            {
              label: 'Paid back',
              main: fmtSats(paidSats),
              sub: paidUsd != null ? fmtUsdCompact(paidUsd) : '—',
            },
            {
              label: 'Carry',
              main: fmtSats(carrySats),
              sub: carryUsd != null ? fmtUsdCompact(carryUsd) : 'unpaid',
            },
            {
              label: 'Yield',
              main: yieldMain,
              sub: yieldSub,
            },
          ]}/>
          {aprOpen && (
            <div style={{
              margin:'0 12px', padding:'8px 12px',
              background:'#111113', color:'#F4F4F4', borderRadius:12,
              fontSize:11, lineHeight:1.45, flexShrink: 0,
              animation:`slideUp 200ms cubic-bezier(0.22,1,0.36,1) both`,
            }}>
              Cap-weighted average APY across strategies with published yield. BTC-denominated first; USD is a projection at the last observed BTC price.
            </div>
          )}
          <PnlBreakdownStrip/>
          <OpsStrip fill={true}/>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, main, sub }) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--card)', borderRadius: 16, border: '0.5px solid var(--line)' }}>
      <div style={{ fontSize: 9.5, color: 'var(--ink-4)', letterSpacing: 1.3, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.3, marginTop: 3 }}>{main}</div>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{sub}</div>
    </div>
  );
}

function DefiPane({ refreshTick }) {
  void refreshTick;
  const byProtocol = STRATEGIES.reduce((acc, s) => {
    if (s.status !== 'LIVE') return acc;
    (acc[s.protocol] ||= []).push(s);
    return acc;
  }, {});
  const entries = Object.entries(byProtocol).filter(([, list]) => list.length > 0);
  return (
    <div className="tabpane" style={{ padding: '4px 12px 16px' }}>
      <ResearchFunnelCard/>
      {entries.length === 0 && (
        <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'var(--ink-3)' }}>
          No live strategies
        </div>
      )}
      {entries.map(([proto, list]) => {
        const protoRealized = list.reduce((sum, s) => sum + (s.realizedYieldUsd || 0), 0);
        const protoEstimated = list.reduce((sum, s) => sum + (s.estimatedYieldUsd || 0), 0);
        const protoYield = protoRealized > 0 ? protoRealized : protoEstimated;
        const protoYieldBasis = protoRealized > 0 ? 'realized' : (protoEstimated > 0 ? 'estimated' : null);
        const protoCap = list.reduce((sum, s) => sum + (s.capUsd || 0), 0);
        return (
          <div key={proto} style={{
            marginBottom: 10,
            background: 'var(--card)',
            borderRadius: 16,
            border: '0.5px solid var(--line)',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, padding: '11px 12px 9px' }}>
              <ProtocolLogo id={proto} size={30}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: -0.2 }}>{displayProtocolName(proto)}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 1 }}>
                  {list.length} live position{list.length > 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {protoYield > 0 && (
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--green)', letterSpacing: -0.2 }}>
                    {fmtYieldTag(protoYield, protoYieldBasis)}
                  </div>
                )}
                {protoYieldBasis && (
                  <div style={{ fontSize: 9.5, color: 'var(--ink-3)', marginTop: 1 }}>
                    {fmtYieldSubLabel(protoYieldBasis)}
                  </div>
                )}
                {protoCap > 0 && (
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink)', letterSpacing: -0.2 }}>
                    Cap ${protoCap.toLocaleString()}
                  </div>
                )}
              </div>
            </div>
            <div style={{ padding: '0 12px' }}>
              {list.map((s, i) => <StrategyRow key={s.id} s={s} isLast={i === list.length - 1}/>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResearchFunnelCard() {
  const funnel = window.STATUS?.researchFunnel;
  if (!funnel?.available) return null;
  return (
    <div style={{
      marginBottom: 10,
      padding: '12px',
      background: 'var(--card)',
      borderRadius: 16,
      border: '0.5px solid var(--line)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div>
          <div style={{ fontSize: 9.5, color: 'var(--ink-4)', letterSpacing: 1.3, textTransform: 'uppercase' }}>
            Research funnel
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
            read-only research queue
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {fmtWhen(funnel.summary?.latestRunAt)}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <TriCard cells={[
          {
            label: 'Track A',
            main: String(funnel.tracks?.A?.candidateCount ?? 0),
            sub: `Ideas · ${funnel.tracks?.A?.promotionIntentCount ?? 0} requests`,
          },
          {
            label: 'Track B',
            main: String(funnel.tracks?.B?.candidateCount ?? 0),
            sub: `OOS ${funnel.tracks?.B?.oosEligibleCount ?? 0}`,
          },
          {
            label: 'Promotions',
            main: String(funnel.summary?.promotionIntentCount ?? 0),
            sub: funnel.summary?.latestBlocker || 'clear',
          },
        ]}/>
      </div>
    </div>
  );
}

function pairTokens(s) {
  return (s.pair || []).filter(Boolean).map(p => p.toUpperCase());
}
function strategyKind(s) {
  const t = s.type;
  if (t === 'loop') return 'Loop';
  if (t === 'fold') return 'Fold';
  if (t === 'pt') return 'PT';
  if (t === 'cl_lp') return 'CL LP';
  if (t === 'lp' || t === 'lp_bgt') return 'LP';
  if (t === 'basis') return 'Basis';
  if (t === 'bridge') return 'Bridge';
  if (t === 'payback') return 'Payback';
  if (t === 'arb') return 'Arb';
  if (t === 'swap') return 'Swap';
  if (t === 'canary') return 'Canary';
  if (t === 'reserve') return 'Reserve';
  if (t === 'refuel') return 'Refuel';
  return titleCaseLabel(s.type || '—');
}
function strategyMechanics(s) {
  const toks = pairTokens(s);
  const t = s.type;
  const cap = s.capUsd || 0;
  const apr = s.apyPct != null ? s.apyPct.toFixed(2) + '%' : '—';
  if (t === 'loop' || t === 'fold') {
    const cycles = s.loops || 1;
    const collat = toks[0] || '—';
    const borrow = toks[1] || '—';
    return `${collat} supply → ${borrow} borrow → redeposit · ${cycles}x · APR ${apr}`;
  }
  if (t === 'cl_lp' || t === 'lp' || t === 'lp_bgt') {
    if (toks.length >= 2) {
      const half = cap > 0 ? '$' + (cap/2).toLocaleString(undefined,{maximumFractionDigits:0}) : '—';
      return `${toks[0]} ${half} ↔ ${toks[1]} ${half} · APR ${apr}`;
    }
    const tot = cap > 0 ? '$' + cap.toLocaleString(undefined,{maximumFractionDigits:0}) : '—';
    return `${toks[0]||'asset'} single-sided ${tot} · APR ${apr}`;
  }
  if (t === 'pt') return `${toks[0]||'PT'} hold to maturity · fixed APR ${apr}`;
  if (t === 'basis') return `${toks[0]||'?'} spot long + perp short · funding ${apr}`;
  if (t === 'bridge') return `${toks[0]||'?'} → ${toks[1]||'?'} transfer`;
  if (t === 'payback') return `${toks[0]||'?'} → ${toks[1]||'?'} BTC payout`;
  if (t === 'arb') return `${toks.join(' ↔ ')} spread capture`;
  if (t === 'reserve') return `${toks[0]||'?'} tokenized reserve`;
  if (t === 'canary') return `${toks.join('/')} micro canary`;
  if (t === 'swap') return `${toks.join(' → ')} route probe`;
  if (t === 'refuel') return `${toks.join('/')} gas refill`;
  return toks.join(' / ');
}
function strategyDesc(s) {
  return strategyKind(s) + ' · ' + strategyMechanics(s);
}

function AssetPairMarks({ pair = [], size = 14 }) {
  const items = (pair || []).filter(Boolean).slice(0, 3);
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      {items.map((asset, index) => (
        <div
          key={`${asset}-${index}`}
          style={{
            marginLeft: index === 0 ? 0 : -4,
            borderRadius: 999,
            boxShadow: '0 0 0 1px #fff',
            background: '#fff',
          }}
        >
          <AssetLogo id={asset} size={size}/>
        </div>
      ))}
    </div>
  );
}

function StrategyRow({ s, isLast }) {
  const chain = CHAINS.find(c => c.id === s.chain);
  const live = s.status === 'LIVE';
  const riskLabel = leverageHintLabel(s.riskHint);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 0', position: 'relative',
    }}>
      <div style={{ position:'relative', width:44, height:30, flexShrink:0 }}>
        <ChainLogo id={s.chain} size={24} style={{ position: 'absolute', left: 0, top: 3 }}/>
        <div style={{ position: 'absolute', right: 0, bottom: 0 }}>
          <AssetPairMarks pair={s.pair} size={14}/>
        </div>
        {live && <span style={{
          position:'absolute', left:16, top:0, width:8, height:8, borderRadius:8,
          background:'var(--green)', boxShadow:'0 0 0 1.5px #fff',
        }}/>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.1, fontWeight: 600, letterSpacing: -0.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s.label}
        </div>
        <div style={{ fontSize: 9.8, color: 'var(--ink-3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {chain?.name || displayChainName(s.chain)} · {strategyKind(s)}
          {s.apyPct != null ? ` · APR ${s.apyPct.toFixed(2)}%` : ''}
        </div>
        <div style={{ fontSize: 9.6, color: 'var(--ink-4)', marginTop: 2, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {strategyMechanics(s)}
        </div>
        {riskLabel && (
          <div style={{ fontSize: 8.8, color: '#8A520C', marginTop: 2, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {riskLabel}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {s.earnedUsd > 0 && (
          <div style={{ fontSize: 11.4, fontWeight: 700, color: 'var(--green)', letterSpacing: -0.2 }}>
            {fmtYieldTag(s.earnedUsd, s.yieldBasis)}
          </div>
        )}
        {s.yieldBasis && (
          <div style={{ fontSize: 8.8, color: 'var(--ink-3)', marginTop: 1 }}>
            {fmtYieldSubLabel(s.yieldBasis)}
          </div>
        )}
        {s.capUsd != null && s.capUsd > 0 && (
          <div style={{ fontSize: 9.5, color: 'var(--ink-3)', marginTop: 1 }}>
            Cap ${s.capUsd.toLocaleString()}
          </div>
        )}
      </div>
      {!isLast && <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: 0.5,
        background: 'var(--line)',
      }}/>}
    </div>
  );
}

function AssetsPane({ refreshTick }) {
  const items = HOLDINGS?.all || [];
  const positions = HOLDINGS?.positions || [];
  const total = Number.isFinite(HOLDINGS?.totalUsd)
    ? HOLDINGS.totalUsd
    : items.reduce((s, a) => s + (a.usd || 0), 0) + positions.reduce((s, a) => s + (a.usd || 0), 0);
  const pending = HOLDINGS?.pending;
  const walletSourceLabel = HOLDINGS?.walletSource === 'whole_wallet_inventory'
    ? 'whole-wallet live'
    : HOLDINGS?.walletSource === 'treasury_inventory'
      ? 'policy inventory'
      : 'wallet source pending';
  const walletObservedLabel = HOLDINGS?.walletObservedAt
    ? `wallet observed ${formatStatusAge(HOLDINGS.walletObservedAt) || fmtWhen(HOLDINGS.walletObservedAt)}`
    : 'wallet observed pending';
  const walletScanHealthLabel = HOLDINGS?.walletScanErrorCount > 0
    ? `scan errors ${HOLDINGS.walletScanErrorCount}`
    : 'scan clean';
  const externalScanLabel = Number.isFinite(HOLDINGS?.externalWalletUsd)
    ? `external address scan ${fmtUsd(HOLDINGS?.externalWalletUsd)}`
    : 'external address scan inactive';
  const unclassifiedLabel = Number.isFinite(HOLDINGS?.unclassifiedUsd) && HOLDINGS.unclassifiedUsd > 0
    ? `unclassified ${fmtUsd(HOLDINGS.unclassifiedUsd)}`
    : null;
  const liveStrats = STRATEGIES.filter(s => s.status === 'LIVE');
  const stratsByAsset = {};
  liveStrats.forEach(s => {
    (s.pair || []).filter(Boolean).forEach(tok => {
      const k = tok.toLowerCase();
      (stratsByAsset[k] ||= []).push(s);
    });
  });
  void refreshTick;
  return (
    <div className="tabpane" style={{ padding: '4px 16px 16px' }}>
      <div style={{ padding: '14px 16px', background: 'var(--card)', borderRadius: 18, border: '0.5px solid var(--line)', marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: 1.4, textTransform: 'uppercase' }}>Total holdings</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.8 }}>
            {pending ? '—' : '$' + total.toLocaleString()}
          </span>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>USD</span>
        </div>
        {!pending && (
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
            wallet {fmtUsd(HOLDINGS?.walletUsd)} · deployed {fmtUsd(HOLDINGS?.deployedUsd)} · open positions {positions.length}
          </div>
        )}
        {!pending && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
            <span style={{ fontSize:10, padding:'3px 7px', borderRadius:999, background:'rgba(255,255,255,0.06)', color:'var(--ink-3)', border:'0.5px solid var(--line)' }}>
              {walletSourceLabel}
            </span>
            <span style={{ fontSize:10, padding:'3px 7px', borderRadius:999, background:'rgba(255,255,255,0.06)', color:'var(--ink-3)', border:'0.5px solid var(--line)' }}>
              {walletObservedLabel}
            </span>
            <span style={{ fontSize:10, padding:'3px 7px', borderRadius:999, background:HOLDINGS?.walletScanErrorCount > 0 ? '#FFF6E8' : 'rgba(255,255,255,0.06)', color:HOLDINGS?.walletScanErrorCount > 0 ? 'var(--orange)' : 'var(--ink-3)', border:HOLDINGS?.walletScanErrorCount > 0 ? '0.5px solid rgba(201,140,0,0.22)' : '0.5px solid var(--line)' }}>
              {walletScanHealthLabel}
            </span>
            <span style={{ fontSize:10, padding:'3px 7px', borderRadius:999, background:'rgba(255,255,255,0.06)', color:'var(--ink-3)', border:'0.5px solid var(--line)' }}>
              {externalScanLabel}
            </span>
            {unclassifiedLabel && (
              <span style={{ fontSize:10, padding:'3px 7px', borderRadius:999, background:'#FFF6E8', color:'var(--orange)', border:'0.5px solid rgba(201,140,0,0.22)' }}>
                {unclassifiedLabel}
              </span>
            )}
          </div>
        )}
        {pending && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>treasury snapshot pending</div>}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: 1.6, textTransform: 'uppercase', padding: '0 4px 8px' }}>Wallet balances</div>
      <div style={{ background: 'var(--card)', borderRadius: 18, border: '0.5px solid var(--line)', overflow: 'hidden' }}>
        {items.length === 0 && (
          <div style={{ padding: '18px 14px', fontSize: 12, color: 'var(--ink-4)', textAlign: 'center' }}>
            no balance feed wired yet
          </div>
        )}
        {items.map((a, i, arr) => {
          const sym = String(a.sym || a.name || '').toLowerCase();
          const symBase = sym.split('.')[0];
          const isExternalDelta = symBase === 'other' || a.family === 'external_unclassified';
          const chainLabel = a.chain || (isExternalDelta ? 'external address scan' : 'unmapped');
          const aliases = new Set([sym, symBase]);
          if (symBase === 'wbtc' || symBase === 'cbbtc' || symBase === 'lbtc' || symBase === 'btcb' || symBase === 'btc.b') {
            aliases.add('wbtc'); aliases.add('cbbtc'); aliases.add('btc');
          }
          if (symBase === 'usdc' || symBase === 'usdt' || symBase === 'dai') {
            aliases.add('usdc'); aliases.add('usdt');
          }
          const tied = liveStrats.filter(s =>
            (s.pair || []).some(tok => aliases.has(String(tok || '').toLowerCase()))
            && (a.chain ? s.chain === a.chain : true)
          );
          return (
          <div key={a.sym + i} style={{
            display:'flex', alignItems:'flex-start', gap:12,
            padding:'12px 14px', position:'relative',
          }}>
            <AssetLogo id={a.sym} size={28}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13.5, fontWeight:500 }}>{a.name}</div>
              <div style={{ fontSize:11, color:'var(--ink-3)', marginTop:1 }}>{chainLabel}</div>
              {tied.length > 0 && (
                <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:6 }}>
                  {tied.slice(0, 4).map(s => (
                    <span key={s.id} style={{
                      fontSize:9.5, padding:'2px 6px', borderRadius:5,
                      background:'#EAF6EE', color:'var(--green)', fontWeight:600,
                      letterSpacing:0.2, whiteSpace:'nowrap',
                    }} title={s.label}>
                      ● {strategyKind(s)} · {s.protocol}
                    </span>
                  ))}
                  {tied.length > 4 && (
                    <span style={{ fontSize:9.5, color:'var(--ink-4)', padding:'2px 4px' }}>+{tied.length-4}</span>
                  )}
                </div>
              )}
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:13, fontWeight:600, letterSpacing:-0.2 }}>${(a.usd||0).toLocaleString()}</div>
              <div style={{ fontSize:11, color:'var(--ink-3)', marginTop:1 }}>
                {isExternalDelta ? 'external scan delta' : `${(a.amount||0).toLocaleString()} ${a.name}`}
              </div>
            </div>
            {i !== arr.length-1 && <div style={{ position:'absolute', left:54, right:0, bottom:0, height:0.5, background:'var(--line)' }}/>}
          </div>
        );})}
      </div>
      {positions.length > 0 && (
        <>
          <div style={{ fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: 1.6, textTransform: 'uppercase', padding: '16px 4px 8px' }}>Deployed positions</div>
          <div style={{ background: 'var(--card)', borderRadius: 18, border: '0.5px solid var(--line)', overflow: 'hidden' }}>
            {positions.map((p, i, arr) => (
              <div key={(p.opportunityId || p.name) + i} style={{
                display:'flex', alignItems:'flex-start', gap:12,
                padding:'12px 14px', position:'relative',
              }}>
                <ProtocolLogo id={p.protocol} size={28}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13.5, fontWeight:500, lineHeight:1.25 }}>{p.name}</div>
                  <div style={{ fontSize:11, color:'var(--ink-3)', marginTop:2 }}>{p.chain} · {p.protocol}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:13, fontWeight:600, letterSpacing:-0.2 }}>{fmtUsd(p.usd || 0)}</div>
                  <div style={{ fontSize:10.5, color:'var(--green)', marginTop:1 }}>deployed</div>
                </div>
                {i !== arr.length-1 && <div style={{ position:'absolute', left:54, right:0, bottom:0, height:0.5, background:'var(--line)' }}/>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function App() {
  const [tab, setTab] = useState('flow');
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    const handler = () => setRefreshTick(t => t + 1);
    window.addEventListener('dashboard:datarefresh', handler);
    return () => window.removeEventListener('dashboard:datarefresh', handler);
  }, []);
  const liveStatus = window.LIVE_STATUS || {};
  const statusAt = liveStatus.generatedAt || KPI?.generatedAt || null;
  const ageLabel = formatStatusAge(statusAt);
  const sourceLabel = liveStatus.live
    ? (liveStatus.remote ? 'public live' : 'local live')
    : liveStatus.source === 'static-snapshot'
      ? 'snapshot fallback'
      : 'status pending';
  return (
    <div style={{ position:'fixed', inset:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'6px 16px 2px', flexShrink:0 }}>
        <div className="title">BOB Claw</div>
        <div className="sub">
          {ageLabel
            ? `${sourceLabel} · ${ageLabel}`
            : `${sourceLabel} · waiting for status`}
        </div>
      </div>
      <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
        <TabView tabs={TABS} active={tab} onChange={setTab}>
          <FlowPane refreshTick={refreshTick}/>
          <DefiPane refreshTick={refreshTick}/>
          <AssetsPane refreshTick={refreshTick}/>
        </TabView>
      </div>
    </div>
  );
}

(() => {
  const root = document.getElementById('root');
  root.innerHTML = '';
  ReactDOM.createRoot(root).render(<App/>);
})();
