// v2 2026-04-24 — smoother zoom, Gateway hides on focus, LP PairBadge closer to chip
// Flow map — Bitcoin L1 source on top, BOB Gateway (cross-chain platform) center, 11 L2 destinations around.
// Tap chain to zoom + hide others; tap background to reset. No manual close buttons.
// Layout invariants (mirrored from src/dashboard/mindmap-layout.mjs, unit-tested
// in test/mindmap-layout.test.mjs): viewport 375x812, label fontSize >=10,
// readable copy fontSize >=12, protocol bloom radius adapted to chip count to
// keep a visible chain gap and guarantee adjacent protocol chips do not overlap.

const { useState, useEffect, useRef, useMemo } = React;

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const T_FAST = 450;
const T_MED = 320;
const PROTOCOL_BLOOM_SPREAD = Math.PI * 0.92;
const PROTOCOL_CHIP_SIZE = 30;
const PROTOCOL_CHIP_RADIUS = PROTOCOL_CHIP_SIZE * 1.12;
const PROTOCOL_BLOOM_MIN_RADIUS = 112;
const PROTOCOL_BLOOM_PADDING = 22;

const PHYS = {
  REPULSION_K: 0.3,
  SPRING_K: 0.10,
  DAMPING: 0.94,
  SUBSTEPS: 2,
  PAD: 6,
};

const PROTOCOL_CARD_MAX_HEIGHT = 132;
const PROTOCOL_CARD_SAFE_BOTTOM = 188;
const PROTOCOL_CARD_STRATEGY_PREVIEW_COUNT = 2;
const MINDMAP_RECENT_ACTIVITY_TTL_MS = 6 * 60 * 60 * 1000;
const MINDMAP_RECENT_MOVEMENT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ROOT_MOVEMENT_TRACKS = 2;
const MAX_FOCUSED_MOVEMENT_TRACKS = 12;
const MOVEMENT_NODE_GAP = 28;
const MOVEMENT_GATEWAY_GAP = 22;
const MOVEMENT_ROUTE_COLORS = Object.freeze([
  '#0057FF',
  '#00A86B',
  '#FFB000',
  '#7A3CFF',
  '#00B8D9',
  '#111827',
  '#FF4D00',
  '#A100FF',
  '#009E73',
  '#D81B60',
  '#7C4D00',
  '#0EA5E9',
]);

function screenToLocal(svg, clientX, clientY, zoom, tx, ty) {
  if (!svg) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { x: (svgPt.x - tx) / zoom, y: (svgPt.y - ty) / zoom };
}

// Mindmap shows protocols where user capital is parked or very recent signer
// activity proves the protocol was touched. Activity-only nodes do not light up
// chain lanes as live capital.
// Hidden: pure swap/refuel/arb routing (odos, gaszip). Kept: lending, loops, LPs,
// payback, and BOB Gateway as the BTC <-> EVM entrypoint.
const MINDMAP_HIDDEN_PROTOCOLS = new Set(['odos', 'gaszip']);
const MINDMAP_HIDDEN_TYPES = new Set(['refuel']);

function isMindmapActiveStrategy(strategy) {
  if (strategy.status === 'LIVE') return strategy.status === 'LIVE';
  if (strategy.activeStrategyState === 'live_position') return true;
  return Number(strategy.actualProtocolCapitalUsd || 0) > 0;
}

function hasRecentMindmapActivity(strategy) {
  if (!strategy) return false;
  const count = Number(strategy.recentActivityCount || strategy.activitySurfaceCount || 0);
  const surfaceOnly = strategy.surfaceOnly === 'mindmap';
  if (count <= 0 && !surfaceOnly) return false;
  const latestAt = strategy.latestActivityAt || strategy.lastTickAt || null;
  if (!latestAt) return false;
  const observedMs = new Date(latestAt).getTime();
  if (!Number.isFinite(observedMs)) return false;
  const ageMs = Date.now() - observedMs;
  return ageMs >= 0 && ageMs <= MINDMAP_RECENT_ACTIVITY_TTL_MS;
}

function isRecentMovement(movement, nowMs = Date.now()) {
  const observedMs = new Date(movement?.observedAt || 0).getTime();
  if (!Number.isFinite(observedMs)) return false;
  const ageMs = nowMs - observedMs;
  return ageMs >= 0 && ageMs <= MINDMAP_RECENT_MOVEMENT_TTL_MS;
}

function movementFreshness(movement, nowMs = Date.now()) {
  const observedMs = new Date(movement?.observedAt || 0).getTime();
  if (!Number.isFinite(observedMs)) return 0;
  const ageMs = Math.max(0, nowMs - observedMs);
  return clamp(1 - ageMs / MINDMAP_RECENT_MOVEMENT_TTL_MS, 0, 1);
}

function dedupeRecentMovements(movements = []) {
  const byKey = new Map();
  for (const movement of movements || []) {
    const key = movementDedupeKey(movement);
    const existing = byKey.get(key);
    if (!existing || new Date(movement.observedAt || 0) > new Date(existing.observedAt || 0)) {
      byKey.set(key, movement);
    }
  }
  return [...byKey.values()];
}

function movementDedupeKey(movement = {}) {
  const provider = movement.routeProvider || movement.kind || 'movement';
  return movement.routeKey
    ? `${provider}:${movement.routeKey}`
    : `${provider}:${movement.fromChainId}->${movement.toChainId}:${movement.assetId || 'asset'}`;
}

function chainName(chainId) {
  return CHAINS.find((chain) => chain.id === chainId)?.name || String(chainId || '').toUpperCase();
}

function shortChainName(chainId) {
  const names = {
    bitcoin: 'BTC L1',
    bob_gateway: 'Gateway',
    ethereum: 'ETH',
    avalanche: 'Avax',
    optimism: 'OP',
    berachain: 'Bera',
    unichain: 'Uni',
    soneium: 'Soneium',
    sonic: 'Sonic',
    bsc: 'BNB',
    base: 'Base',
    bob: 'BOB',
    sei: 'Sei',
  };
  return names[chainId] || chainName(chainId);
}

function normalizeAssetDisplayId(assetId) {
  const raw = String(assetId || '').trim().toLowerCase();
  if (!raw) return 'asset';
  if (raw === 'wbtc.oft' || raw === 'btcb' || raw === 'btc.b') return 'wbtc';
  if (raw.startsWith('0x0555e30')) return 'wbtc';
  if (raw.startsWith('0xcbb7c000')) return 'cbbtc';
  return raw.replace(/\.oft$/u, '');
}

function assetLabel(assetId) {
  const id = normalizeAssetDisplayId(assetId);
  const labels = {
    btc: 'BTC',
    wbtc: 'wBTC',
    cbbtc: 'cbBTC',
    lbtc: 'LBTC',
    eth: 'ETH',
    weth: 'WETH',
    usdc: 'USDC',
    usdt: 'USDT',
    honey: 'HONEY',
    avax: 'AVAX',
  };
  return labels[id] || id.toUpperCase();
}

function movementUsesGateway(movement = {}) {
  if (movement.viaGateway === false) return false;
  if (movement.viaGateway === true) return true;
  const provider = String(movement.routeProvider || '').toLowerCase();
  if (provider) return provider === 'gateway' || provider === 'bob_gateway';
  return movement.kind === 'gateway_bridge' || String(movement.strategyId || '').includes('gateway');
}

function isGatewayProtocolGroup(strategy = {}) {
  return strategy.protocol === 'gateway';
}

function movementColor(movement = {}, index = 0) {
  return MOVEMENT_ROUTE_COLORS[index % MOVEMENT_ROUTE_COLORS.length] || MOVEMENT_ROUTE_COLORS[0];
}

function movementLaneOffset(laneIndex = 0, totalTracks = 1, segmentIndex = 0) {
  const total = Math.max(1, Number(totalTracks || 1));
  const centered = laneIndex - (total - 1) / 2;
  const laneGap = total > 9 ? 5.1 : total > 6 ? 6.1 : 7.8;
  const segmentNudge = segmentIndex === 1 ? 2.4 : -2.4;
  return centered * laneGap + segmentNudge;
}

function isMindmapVisible(strategy) {
  if (!strategy) return false;
  if (!strategy.protocol) return false;
  if (MINDMAP_HIDDEN_PROTOCOLS.has(strategy.protocol)) return false;
  if (MINDMAP_HIDDEN_TYPES.has(strategy.type)) return false;
  if (strategy.type === 'payback') {
    const paybackUsd = Number(window?.FLOW?.metrics?.pendingCarryUsd || 0) + Number(window?.FLOW?.metrics?.paidBackUsdLifetime || 0);
    return paybackUsd > 0;
  }
  if (isMindmapActiveStrategy(strategy)) return true;
  return hasRecentMindmapActivity(strategy);
}

function bloomRadiusForCount(count, chipR, minR = 78, padding = 8) {
  if (!Number.isFinite(count) || count <= 1) return minR;
  const gap = PROTOCOL_BLOOM_SPREAD / (count - 1);
  const requiredChord = 2 * chipR + padding;
  const required = requiredChord / (2 * Math.sin(gap / 2));
  return Math.max(minR, required);
}

function clampBloomToViewport(p, R, chipR, vbW, vbH) {
  const minR = 78;
  const minX = chipR + 10;
  const maxX = vbW - chipR - 10;
  const minY = chipR + 10;
  const maxY = vbH - chipR - 10;
  const candidates = [
    { dx: 0, dy: R },
    { dx: R * 0.71, dy: R * 0.71 },
    { dx: R, dy: 0 },
    { dx: R * 0.71, dy: -R * 0.71 },
    { dx: 0, dy: -R },
    { dx: -R * 0.71, dy: -R * 0.71 },
    { dx: -R, dy: 0 },
    { dx: -R * 0.71, dy: R * 0.71 },
  ];
  const cx = vbW / 2;
  const cy = vbH / 2 + 50;
  const localX = cx + p.x;
  const localY = cy + p.y;
  let worst = Infinity;
  for (const c of candidates) {
    const x = localX + c.dx;
    const y = localY + c.dy;
    const dLeft = x - minX;
    const dRight = maxX - x;
    const dTop = y - minY;
    const dBottom = maxY - y;
    worst = Math.min(worst, dLeft, dRight, dTop, dBottom);
  }
  if (worst < 0) {
    return Math.max(minR, R + worst);
  }
  return R;
}

function placeRing(chains, radius) {
  const dest = chains.filter(c => c.role === 'destination');
  const step = (2 * Math.PI) / dest.length;
  const startA = -Math.PI / 2 + step / 2;
  const out = {};
  dest.forEach((c, i) => {
    const a = startA + i * step;
    out[c.id] = { x: Math.cos(a) * radius, y: Math.sin(a) * radius, angle: a };
  });
  return out;
}

function curvePath(x1, y1, x2, y2, bow = 0.12) {
  const mx = (x1+x2)/2, my = (y1+y2)/2;
  const dx = x2-x1, dy = y2-y1;
  const nx = -dy, ny = dx;
  const cx = mx + nx*bow, cy = my + ny*bow;
  return { d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`, cx, cy };
}

function trimSegmentEndpoints(from, to, startGap = 0, endGap = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / length;
  const uy = dy / length;
  const cappedStart = Math.min(Math.max(0, startGap), length * 0.42);
  const cappedEnd = Math.min(Math.max(0, endGap), Math.max(0, length - cappedStart - 8));
  return {
    from: { x: from.x + ux * cappedStart, y: from.y + uy * cappedStart },
    to: { x: to.x - ux * cappedEnd, y: to.y - uy * cappedEnd },
  };
}

function movementLinePath(from, to, startGap = MOVEMENT_NODE_GAP, endGap = MOVEMENT_NODE_GAP, laneIndex = 0, segmentIndex = 0, totalTracks = 1) {
  const trimmed = trimSegmentEndpoints(from, to, startGap, endGap);
  const dx = trimmed.to.x - trimmed.from.x;
  const dy = trimmed.to.y - trimmed.from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / length;
  const ny = dx / length;
  const offset = movementLaneOffset(laneIndex, totalTracks, segmentIndex);
  const cx = (trimmed.from.x + trimmed.to.x) / 2 + nx * offset;
  const cy = (trimmed.from.y + trimmed.to.y) / 2 + ny * offset;
  return {
    d: `M ${trimmed.from.x} ${trimmed.from.y} Q ${cx} ${cy} ${trimmed.to.x} ${trimmed.to.y}`,
    x1: trimmed.from.x,
    y1: trimmed.from.y,
    cx,
    cy,
    x2: trimmed.to.x,
    y2: trimmed.to.y,
  };
}

function bezierAt(x1, y1, cx, cy, x2, y2, t) {
  const u = 1 - t;
  return { x: u*u*x1 + 2*u*t*cx + t*t*x2, y: u*u*y1 + 2*u*t*cy + t*t*y2 };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatCompactUsdLabel(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 1000) return `$${Math.round(value).toLocaleString()}`;
  if (value >= 100) return `$${Math.round(value)}`;
  if (value >= 10) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${value.toFixed(1)}`;
  return `<$1`;
}

function formatYieldDisplay(value, basis) {
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

function yieldMetricLabel(basis) {
  return basis === 'estimated' ? 'Est. yield' : 'Yield';
}

function StatPill({ x, y, label, scale = 1, tone = 'light' }) {
  if (!label) return null;
  const width = Math.max(28, label.length * 5.6 * scale + 10 * scale);
  const height = 14 * scale;
  const fill = tone === 'dark' ? '#111113' : 'rgba(255,255,255,0.94)';
  const stroke = tone === 'dark' ? '#111113' : '#DADADA';
  const color = tone === 'dark' ? '#F5F5F6' : '#555';
  return (
    <g transform={`translate(${x}, ${y})`} style={{ pointerEvents: 'none' }}>
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={height / 2}
        fill={fill} stroke={stroke} strokeWidth="0.5"/>
      <text textAnchor="middle" y={3.2 * scale} fontSize={8.2 * scale} fontWeight="700" fill={color}
        style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0.2 }}>
        {label}
      </text>
    </g>
  );
}

function createBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function includeCircle(bounds, x, y, radius) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) return;
  bounds.minX = Math.min(bounds.minX, x - radius);
  bounds.minY = Math.min(bounds.minY, y - radius);
  bounds.maxX = Math.max(bounds.maxX, x + radius);
  bounds.maxY = Math.max(bounds.maxY, y + radius);
}

function includeRect(bounds, x, y, width, height) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return;
  bounds.minX = Math.min(bounds.minX, x - width / 2);
  bounds.minY = Math.min(bounds.minY, y - height / 2);
  bounds.maxX = Math.max(bounds.maxX, x + width / 2);
  bounds.maxY = Math.max(bounds.maxY, y + height / 2);
}

function finalizeBounds(bounds) {
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY)) {
    return null;
  }
  return bounds;
}

function padBounds(bounds, x = 0, y = x) {
  if (!bounds) return null;
  return {
    minX: bounds.minX - x,
    minY: bounds.minY - y,
    maxX: bounds.maxX + x,
    maxY: bounds.maxY + y,
  };
}

function fitBoundsInViewBox({ bounds, viewBox, safeArea, focus, minZoom, maxZoom }) {
  if (!bounds) return null;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(1, viewBox.width - safeArea.left - safeArea.right);
  const availH = Math.max(1, viewBox.height - safeArea.top - safeArea.bottom);
  const fitZoom = Math.min(availW / width, availH / height);
  const zoom = clamp(fitZoom, minZoom, maxZoom);
  const targetTx = viewBox.width / 2 - focus.x * zoom;
  const targetTy = safeArea.top + availH / 2 - focus.y * zoom;
  const minTx = safeArea.left - bounds.minX * zoom;
  const maxTx = viewBox.width - safeArea.right - bounds.maxX * zoom;
  const minTy = safeArea.top - bounds.minY * zoom;
  const maxTy = viewBox.height - safeArea.bottom - bounds.maxY * zoom;
  const tx = minTx <= maxTx ? clamp(targetTx, minTx, maxTx) : (minTx + maxTx) / 2;
  const ty = minTy <= maxTy ? clamp(targetTy, minTy, maxTy) : (minTy + maxTy) / 2;
  return { zoom, tx, ty };
}

function BitcoinSource({ x, y, size, hidden, dimmed = false }) {
  return (
    <g transform={`translate(${x}, ${y})`}
       style={{ opacity: hidden ? 0 : dimmed ? 0.22 : 1, pointerEvents: hidden ? 'none' : 'auto', transition: `opacity ${T_FAST}ms ${EASE}` }}>
      <circle r={size*0.62} fill="#FFFFFF" stroke="#1D1D1F" strokeWidth="0.6"/>
      <circle r={size*0.62} fill="none" stroke="#F2A33B" strokeWidth="1" opacity="0.5">
        <animate attributeName="r" values={`${size*0.62};${size*0.78};${size*0.62}`} dur="2.4s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.5;0;0.5" dur="2.4s" repeatCount="indefinite"/>
      </circle>
      <foreignObject x={-size*0.42} y={-size*0.42} width={size*0.84} height={size*0.84} style={{ pointerEvents:'none' }}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
          <ChainLogo id="bitcoin" size={size*0.8}/>
        </div>
      </foreignObject>
      <text y={-size*0.94} textAnchor="middle" fontSize="11" fontWeight="500" fill="#555" style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0.3 }}>Bitcoin L1</text>
    </g>
  );
}

function GatewayCore({ size, hidden, compact = false }) {
  const visualSize = compact ? size * 0.58 : size;
  const w = visualSize * 1.8;
  const h = visualSize * 1.1;
  return (
    <g style={{ opacity: hidden ? 0 : compact ? 0.78 : 1, pointerEvents: hidden ? 'none' : 'auto', transition: `opacity ${T_FAST}ms ${EASE}` }}>
      <circle r={visualSize*1.25} fill="url(#haloGrad)" opacity={compact ? 0.18 : 0.35}/>
      <rect x={-w/2} y={-h/2} width={w} height={h} rx={visualSize*0.26}
        fill="#FFFFFF" stroke="#DADADA" strokeWidth="0.6"/>
      <foreignObject x={-w/2 + 2} y={-h/2 + 2} width={w - 4} height={h - 4} style={{ pointerEvents:'none' }}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
          <ProtocolLogo id="gateway" size={h*0.8}/>
        </div>
      </foreignObject>
      {!compact && (
        <text y={h/2 + 10} textAnchor="middle" fontSize="10" fontWeight="600" fill="#8A8A8D" style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 1 }}>BOB GATEWAY</text>
      )}
    </g>
  );
}

function ChainNode({ chain, x, y, size, hidden, active, dimmed = false, compact = false, onTap, labelBelow, onDragStart }) {
  const handleTap = (event) => {
    event.stopPropagation?.();
    onTap?.();
  };
  const visualSize = compact ? size * 0.5 : size;
  const hitSize = visualSize * 1.95;
  const capitalLabel = formatCompactUsdLabel(Number(chain.capitalUsd || 0));
  const nameY = labelBelow ? visualSize * 0.98 : -visualSize * 0.82;
  const capitalY = labelBelow ? visualSize * 1.46 : -visualSize * 1.34;
  const opacity = hidden ? 0 : compact ? 0.24 : dimmed ? 0.34 : 1;
  return (
    <g data-chain-id={chain.id} transform={`translate(${x}, ${y})`}
       style={{ cursor:'pointer', opacity, pointerEvents: hidden ? 'none' : 'auto',
                   transition: `opacity ${T_FAST}ms ${EASE}` }}>
      <g style={{ pointerEvents:'none' }}>
        <circle r={visualSize*0.56} fill="#FFFFFF" stroke={active ? '#111113' : '#DADADA'} strokeWidth={active ? 1 : 0.6}/>
        <foreignObject x={-visualSize*0.42} y={-visualSize*0.42} width={visualSize*0.84} height={visualSize*0.84} style={{ pointerEvents:'none' }}>
          <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
            <ChainLogo id={chain.id} size={visualSize*0.78}/>
          </div>
        </foreignObject>
        {!compact && (
          <>
            <text y={nameY} textAnchor="middle" fontSize="11" fontWeight="500" fill={dimmed ? '#8A8A8D' : '#555'}
              style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0.2 }}>
              {chain.name}
            </text>
            <g style={{ opacity: dimmed ? 0.72 : 1 }}>
              <StatPill x={0} y={capitalY} label={capitalLabel} scale={0.9}/>
            </g>
          </>
        )}
      </g>
      <foreignObject x={-hitSize / 2} y={-hitSize / 2} width={hitSize} height={hitSize}>
        <button
          xmlns="http://www.w3.org/1999/xhtml"
          type="button"
          aria-label={`${chain.name} chain`}
          onPointerDown={(e) => { onDragStart?.(e); }}
          onClick={(event) => event.stopPropagation?.()}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: 'transparent',
            borderRadius: 999,
            margin: 0,
            padding: 0,
            cursor: 'pointer',
          }}
        />
      </foreignObject>
    </g>
  );
}

function TokenBubble({ x, y, assetId, size = 14, sourceChainId, accentColor = null, accentOpacity = 1 }) {
  const badge = size * 0.62;
  return (
    <g transform={`translate(${x}, ${y})`} style={{ pointerEvents:'none' }}>
      <circle
        r={size/2 + (accentColor ? 1.25 : 1.8)}
        fill="#FFFFFF"
        stroke={accentColor || '#E4E4E6'}
        strokeWidth={accentColor ? 1.45 : 0.5}
        strokeOpacity={accentColor ? accentOpacity : 1}
      />
      <foreignObject x={-size/2} y={-size/2} width={size} height={size} style={{ pointerEvents:'none' }}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
          <AssetLogo id={assetId} size={size}/>
        </div>
      </foreignObject>
      {sourceChainId && (
        <g transform={`translate(${size*0.42}, ${size*0.42})`}>
          <circle r={badge/2 + 0.8} fill="#FFFFFF" stroke="#E4E4E6" strokeWidth="0.4"/>
          <foreignObject x={-badge/2} y={-badge/2} width={badge} height={badge} style={{ pointerEvents:'none' }}>
            <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
              <ChainLogo id={sourceChainId} size={badge}/>
            </div>
          </foreignObject>
        </g>
      )}
    </g>
  );
}

function FlowToken({ curve, progress, assetId, swapAt, swapTo, size = 14, sourceChainId, sourceChainAfterSwap, accentColor = null }) {
  const p = bezierAt(curve.x1, curve.y1, curve.cx, curve.cy, curve.x2, curve.y2, progress);
  const swapped = (swapAt != null && progress >= swapAt && swapTo);
  const id = swapped ? swapTo : assetId;
  const src = swapped ? (sourceChainAfterSwap || sourceChainId) : sourceChainId;
  return <TokenBubble x={p.x} y={p.y} assetId={id} size={size} sourceChainId={src} accentColor={accentColor}/>;
}

function MovementTrail({ track, selectedChain }) {
  const freshness = Number.isFinite(track.freshness) ? track.freshness : 0;
  const selected = Boolean(selectedChain);
  const projectedOpacityScale = track.projected ? (selected ? 0.22 : 0.42) : 1;
  const projectedStrokeScale = track.projected ? 0.62 : 1;
  const opacity = (selected ? 0.24 + freshness * 0.42 : 0.12 + freshness * 0.42) * projectedOpacityScale;
  const crowdedStrokeScale = selected ? Math.max(0.58, 1 - Math.max(0, (track.total || 1) - 4) * 0.045) : 1;
  const strokeWidth = (selected ? 0.92 + freshness * 0.28 : 0.72 + freshness * 0.3) * crowdedStrokeScale * projectedStrokeScale;
  const arrowId = `movement-arrow-${track.index}`;
  return (
    <g data-movement-route={track.key} style={{ pointerEvents: 'none', opacity, transition: `opacity ${T_FAST}ms ${EASE}` }}>
      <defs>
        <marker id={arrowId} markerWidth="5.6" markerHeight="5.6" refX="5.1" refY="2.8" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 0 L 5.6 2.8 L 0 5.6 z" fill={track.color} stroke="#FFFFFF" strokeWidth="0.35"/>
        </marker>
      </defs>
      {track.segments.map((segment, segmentIndex) => (
        <path
          key={`${track.key}-seg-${segmentIndex}`}
          id={`movement-path-${track.index}-${segmentIndex}`}
          d={segment.d}
          fill="none"
          stroke={track.color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={track.viaGateway ? '3 5' : '3 6'}
          markerEnd={segmentIndex === track.segments.length - 1 ? `url(#${arrowId})` : undefined}
        />
      ))}
      <path id={`movement-motion-${track.index}`} d={track.motionD} fill="none" stroke="none"/>
    </g>
  );
}

function OrbitTokens({ cx, cy, radius, assets, loops, time, speed = 0.55 }) {
  const count = Math.max(loops || assets.length, 2);
  const rotation = (time * speed * 360) % 360;
  const dots = [];
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 - Math.PI/2;
    const x = Math.cos(ang) * radius;
    const y = Math.sin(ang) * radius;
    const asset = assets[i % assets.length];
    dots.push(<TokenBubble key={'orb-'+i} x={x} y={y} assetId={asset} size={12}/>);
  }
  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <circle r={radius} fill="none" stroke="#D4D4D6" strokeWidth="0.5" strokeDasharray="2 2"/>
      <g transform={`rotate(${rotation})`}>
        {dots}
      </g>
    </g>
  );
}

function uniqueProtocolAssets(strategy) {
  return Array.from(new Set((strategy?.pair || []).filter(Boolean))).slice(0, 4);
}

function uniqueProtocolAssetsForStrategies(strategies = []) {
  return Array.from(new Set(
    (strategies || []).flatMap((strategy) => Array.isArray(strategy?.pair) ? strategy.pair : []).filter(Boolean),
  )).slice(0, 4);
}

function AssetLogoTag({ x, y, assetId, size = 17 }) {
  return (
    <g transform={`translate(${x}, ${y})`} style={{ pointerEvents: 'none' }}>
      <circle
        r={size / 2 + 2.4}
        fill="rgba(255,255,255,0.94)"
        stroke="#DADADA"
        strokeWidth="0.5"
      />
      <foreignObject x={-size / 2} y={-size / 2} width={size} height={size} style={{ pointerEvents: 'none' }}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', pointerEvents: 'none' }}>
          <AssetLogo id={assetId} size={size}/>
        </div>
      </foreignObject>
    </g>
  );
}

function ProtocolAssetMotion({ strategy, x, y, time, dimmed }) {
  const assets = uniqueProtocolAssets(strategy);
  if (!assets.length) return null;
  const orbitRadius = strategy?.type === 'loop' ? 52 : strategy?.type === 'payback' ? 50 : 46;
  const orbitLoops = Math.max(strategy?.loops || 0, assets.length + 1, 3);
  const orbitSpeed = strategy?.type === 'payback'
    ? 0.34
    : strategy?.type === 'bridge'
      ? 0.4
      : strategy?.type === 'swap' || strategy?.type === 'arb'
        ? 0.58
        : 0.48;
  const gap = 52;
  const startX = x - ((assets.length - 1) * gap) / 2;
  return (
    <g style={{ opacity: dimmed ? 0.16 : 1, transition: `opacity ${T_FAST}ms ${EASE}` }}>
      <OrbitTokens
        cx={x}
        cy={y}
        radius={orbitRadius}
        assets={assets}
        loops={orbitLoops}
        time={time}
        speed={orbitSpeed}
      />
      {assets.map((assetId, index) => (
        <AssetLogoTag
          key={`${strategy.id}-${assetId}-${index}`}
          x={startX + index * gap}
          y={y + orbitRadius + 19}
          assetId={assetId}
        />
      ))}
    </g>
  );
}

function PairBadge({ x, y, pair, size = 14 }) {
  return (
    <g transform={`translate(${x}, ${y})`} style={{ pointerEvents:'none' }}>
      <rect x={-size*1.15} y={-size*0.65} width={size*2.3} height={size*1.3} rx={size*0.65}
        fill="#FFFFFF" stroke="#E4E4E6" strokeWidth="0.5"/>
      <foreignObject x={-size*0.95} y={-size*0.45} width={size*0.9} height={size*0.9} style={{ pointerEvents:'none' }}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
          <AssetLogo id={pair[0]} size={size*0.9}/>
        </div>
      </foreignObject>
      <foreignObject x={-size*0.1} y={-size*0.45} width={size*0.9} height={size*0.9} style={{ pointerEvents:'none' }}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
          <AssetLogo id={pair[1] || pair[0]} size={size*0.9}/>
        </div>
      </foreignObject>
    </g>
  );
}

const TYPE_LABEL = { loop: 'LOOP', bridge: 'BRIDGE', payback: 'PAYBACK', arb: 'ARB', swap: 'DEX', refuel: 'REFUEL', lp: 'LP', cl_lp: 'LP', lp_bgt: 'LP', canary: 'CANARY', fold: 'FOLD', pt: 'PT', basis: 'BASIS', reserve: 'RESERVE' };
const TYPE_INK   = { loop: '#1C7A3E', bridge: '#3A3A3D', payback: '#7A5C0D', arb: '#5B3DBF', swap: '#0A84FF', refuel: '#8A5C0D', lp: '#0A84FF', cl_lp: '#0A84FF', lp_bgt: '#0A84FF', canary: '#7A5C0D', fold: '#1C7A3E', pt: '#5B3DBF', basis: '#0A84FF', reserve: '#3A3A3D' };

function prettifyProtocolLabel(protocol) {
  const acronyms = { gmx: 'GMX', yo: 'YO', bob: 'BOB' };
  return String(protocol || '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => acronyms[part.toLowerCase()] || (part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

function dominantType(strategies = []) {
  const priority = ['loop', 'cl_lp', 'lp_bgt', 'lp', 'payback', 'bridge', 'arb', 'swap', 'refuel'];
  for (const type of priority) {
    if (strategies.some((strategy) => strategy.type === type)) return type;
  }
  return strategies[0]?.type || 'bridge';
}

function summarizedStatus(strategies = []) {
  if (strategies.some((strategy) => strategy.status === 'LIVE')) return 'LIVE';
  if (strategies.some((strategy) => strategy.status === 'DRY RUN')) return 'DRY RUN';
  if (strategies.some((strategy) => strategy.status === 'BLOCKED')) return 'BLOCKED';
  return strategies[0]?.status || 'CANDIDATE';
}

function aprWeightUsd(strategy) {
  if (Number.isFinite(strategy?.capUsd) && strategy.capUsd > 0) return strategy.capUsd;
  if (Number.isFinite(strategy?.actualProtocolCapitalUsd) && strategy.actualProtocolCapitalUsd > 0) {
    return strategy.actualProtocolCapitalUsd;
  }
  return 0;
}

function weightedProtocolApr(strategies = []) {
  const rows = strategies.filter((strategy) => Number.isFinite(strategy?.apyPct));
  const weightedRows = rows.filter((strategy) => aprWeightUsd(strategy) > 0);
  const weightedDenominator = weightedRows.reduce((sum, strategy) => sum + aprWeightUsd(strategy), 0);
  if (weightedDenominator > 0) {
    const weightedNumerator = weightedRows.reduce((sum, strategy) => sum + aprWeightUsd(strategy) * strategy.apyPct, 0);
    return weightedNumerator / weightedDenominator;
  }
  if (rows.length > 0) {
    return rows.reduce((sum, strategy) => sum + strategy.apyPct, 0) / rows.length;
  }
  return null;
}

function groupStrategiesByProtocol(strategies = []) {
  const grouped = {};
  for (const strategy of strategies) {
    (grouped[strategy.protocol] ||= []).push(strategy);
  }
  return Object.values(grouped).map((items) => {
    const first = items[0];
    const liveCount = items.filter((item) => item.status === 'LIVE').length;
    const realizedYieldUsd = items.reduce((sum, item) => sum + (item.realizedYieldUsd || 0), 0);
    const estimatedYieldUsd = items.reduce((sum, item) => sum + (item.estimatedYieldUsd || 0), 0);
    const recentActivityCount = items.reduce((sum, item) => sum + (Number(item.recentActivityCount || 0)), 0);
    const recentActivityUsd = items.reduce((sum, item) => sum + (Number(item.recentActivityUsd || 0)), 0);
    const recentActivityAssets = Array.from(new Set(items.flatMap((item) => item.recentActivityAssets || []))).slice(0, 4);
    const latestActivityAt = items
      .map((item) => item.latestActivityAt || null)
      .filter(Boolean)
      .sort((left, right) => new Date(right) - new Date(left))[0] || null;
    return {
      ...first,
      id: `${first.chain}:${first.protocol}`,
      label: prettifyProtocolLabel(first.protocol),
      type: dominantType(items),
      status: summarizedStatus(items),
      strategies: items,
      strategyCount: items.length,
      liveCount,
      earnedUsd: realizedYieldUsd > 0 ? realizedYieldUsd : estimatedYieldUsd,
      realizedYieldUsd,
      estimatedYieldUsd,
      yieldBasis: realizedYieldUsd > 0 ? 'realized' : (estimatedYieldUsd > 0 ? 'estimated' : null),
      capUsd: items.every((item) => item.capUsd == null) ? null : items.reduce((sum, item) => sum + (item.capUsd || 0), 0),
      capitalUsd: Math.max(
        ...items.map((item) => Number(item.actualProtocolCapitalUsd || 0)),
        0,
      ),
      loops: Math.max(...items.map((item) => item.loops || 0), 0) || null,
      apyPct: weightedProtocolApr(items),
      recentActivityCount,
      recentActivityUsd,
      recentActivityAssets,
      latestActivityAt,
      desc: items.length === 1
        ? first.desc
        : `${items.length} strategies mapped to ${prettifyProtocolLabel(first.protocol)}.`,
    };
  });
}

function ProtocolChip({ strategy, x, y, size, onTap, selected, dimmed, onDragStart }) {
  const R = size * 1.12;
  const capitalLabel = formatCompactUsdLabel(Number(strategy.capitalUsd || 0));
  const handleTap = (event) => {
    event.stopPropagation?.();
    onTap?.();
  };
  const hitSize = strategy.loops ? size * 4.1 : size * 3.2;
  return (
    <g data-protocol-id={strategy.id} transform={`translate(${x}, ${y})`}
        style={{ cursor:'pointer', opacity: dimmed ? 0.22 : 1, transition: `opacity ${T_FAST}ms ${EASE}` }}>
      <g style={{ pointerEvents:'none', animation: `chipIn 220ms ${EASE} both` }}>
        <circle r={R} fill="#FFFFFF" stroke={selected ? '#111113' : '#DADADA'} strokeWidth={selected ? 1.2 : 0.6}/>
        <foreignObject x={-R*0.82} y={-R*0.82} width={R*1.64} height={R*1.64} style={{ pointerEvents:'none' }}>
          <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
            <ProtocolLogo id={strategy.protocol} size={R*1.18}/>
          </div>
        </foreignObject>
        <StatPill x={0} y={-R - 19} label={capitalLabel} scale={0.76} tone={selected ? 'dark' : 'light'}/>
        {!selected && (
          <text y={R + 13} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#555"
            stroke="#FFFFFF" strokeWidth="2.5" paintOrder="stroke"
            style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0.2, textTransform:'capitalize' }}>
            {strategy.label || strategy.protocol}
          </text>
        )}
        {strategy.loops && (
          <g transform={`translate(${R*0.78}, ${-R*0.78})`}>
            <rect x="-12" y="-8" width="24" height="16" rx="8" fill="#111113"/>
            <text textAnchor="middle" y="4" fontSize="10" fontWeight="600" fill="#fff" style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0.2 }}>×{strategy.loops}</text>
          </g>
        )}
      </g>
      <foreignObject x={-hitSize / 2} y={-hitSize / 2} width={hitSize} height={hitSize}>
        <button
          xmlns="http://www.w3.org/1999/xhtml"
          type="button"
          aria-label={`${strategy.label || strategy.protocol} protocol`}
          onPointerDown={(e) => { onDragStart?.(e); }}
          onClick={(event) => event.stopPropagation?.()}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: 'transparent',
            borderRadius: 999,
            margin: 0,
            padding: 0,
            cursor: 'pointer',
          }}
        />
      </foreignObject>
    </g>
  );
}

function RootProtocolHint({ hint, time, motionSpeed }) {
  const size = 18;
  const connector = curvePath(hint.chainX, hint.chainY, hint.x, hint.y, 0.08);
  const flowDur = 2.2 / motionSpeed;
  const tFlow = ((time + hint.index * 0.28) % flowDur) / flowDur;
  const assetId = hint.assetId || 'usdc';
  return (
    <g data-root-protocol={hint.id} style={{ pointerEvents: 'none', opacity: 0.96, transition: `opacity ${T_FAST}ms ${EASE}` }}>
      <path d={connector.d} fill="none" stroke="#A8A8AD" strokeWidth="0.65" strokeDasharray="2 3" opacity="0.7"/>
      <FlowToken curve={{ ...connector, x1: hint.chainX, y1: hint.chainY, x2: hint.x, y2: hint.y }}
        progress={tFlow}
        assetId={assetId}
        size={9}
        sourceChainId={hint.chainId}/>
      <circle r={size * 0.62} cx={hint.x} cy={hint.y} fill="#FFFFFF" stroke="#D0D0D4" strokeWidth="0.55"/>
      <foreignObject x={hint.x - size * 0.42} y={hint.y - size * 0.42} width={size * 0.84} height={size * 0.84} style={{ pointerEvents: 'none' }}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
          <ProtocolLogo id={hint.protocol} size={size * 0.72}/>
        </div>
      </foreignObject>
      <text x={hint.x} y={hint.y + 17} textAnchor="middle" fontSize="7.6" fontWeight="700" fill="#555"
        stroke="#FFFFFF" strokeWidth="2" paintOrder="stroke"
        style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0 }}>
        {hint.label}
      </text>
    </g>
  );
}

function Mindmap({ motionSpeed = 1.4, refreshTick = 0, onFocusChange = null }) {
  const [selectedChain, setSelectedChain] = useState(null);
  const [selectedProtocolId, setSelectedProtocolId] = useState(null);
  const [time, setTime] = useState(0);
  const rafRef = useRef();
  const physicsRef = useRef(new Map());
  const dragRef = useRef(null);
  const svgRef = useRef(null);
  const focusLayer = selectedProtocolId ? 'protocol' : selectedChain ? 'chain' : 'root';

  useEffect(() => {
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) * 0.001;
      last = now;
      const focusMotionScale = selectedProtocolId ? 0.16 : selectedChain ? 0.34 : 1;
      const repulsionK = PHYS.REPULSION_K * focusMotionScale;
      const springK = PHYS.SPRING_K * (selectedProtocolId ? 0.2 : selectedChain ? 0.42 : 1);
      const damping = selectedProtocolId ? 0.7 : selectedChain ? 0.82 : PHYS.DAMPING;
      const settlePull = selectedProtocolId ? 0.18 : selectedChain ? 0.08 : 0;

      // Physics solver (substeps for stability)
      const bodies = physicsRef.current;
      const list = Array.from(bodies.values());
      for (let step = 0; step < PHYS.SUBSTEPS; step++) {
        // Spring + damping
        for (const b of list) {
          if (b.isDragging) { b.vx = 0; b.vy = 0; continue; }
          const fx = (b.anchorX - b.x) * springK;
          const fy = (b.anchorY - b.y) * springK;
          b.vx += fx / b.mass;
          b.vy += fy / b.mass;
        }
        // Pairwise repulsion
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i];
            const b = list[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              const minDist = a.radius + b.radius + PHYS.PAD;
              if (dist < minDist) {
                const overlap = minDist - dist;
                const nx = dx / dist;
                const ny = dy / dist;
                const force = repulsionK * overlap;
                const aDrag = a.isDragging;
                const bDrag = b.isDragging;
              if (aDrag && !bDrag) {
                a.vx -= (force * nx) / a.mass; a.vy -= (force * ny) / a.mass;
              } else if (!aDrag && bDrag) {
                b.vx += (force * nx) / b.mass; b.vy += (force * ny) / b.mass;
              } else {
                if (!aDrag) { a.vx -= (force * nx) / a.mass; a.vy -= (force * ny) / a.mass; }
                if (!bDrag) { b.vx += (force * nx) / b.mass; b.vy += (force * ny) / b.mass; }
              }
            }
          }
        }
        // Orbit exclusion: loop rings push other bodies away
        for (const b of list) {
          if (!b.orbitRadius) continue;
          for (const other of list) {
            if (other === b) continue;
            const dx = other.x - b.x;
            const dy = other.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              const minDist = b.orbitRadius + other.radius + PHYS.PAD;
              if (dist < minDist) {
                const overlap = minDist - dist;
                const nx = dx / dist;
                const ny = dy / dist;
                const force = repulsionK * overlap * 1.5;
                const otherDrag = other.isDragging;
                const bDrag2 = b.isDragging;
              if (otherDrag && !bDrag2) {
                other.vx += (force * nx) / other.mass; other.vy += (force * ny) / other.mass;
              } else if (!otherDrag && bDrag2) {
                b.vx -= (force * nx) / b.mass; b.vy -= (force * ny) / b.mass;
              } else {
                if (!otherDrag) { other.vx += (force * nx) / other.mass; other.vy += (force * ny) / other.mass; }
                if (!bDrag2) { b.vx -= (force * nx) / b.mass; b.vy -= (force * ny) / b.mass; }
              }
            }
          }
        }
        // Integrate
        for (const b of list) {
          if (b.isDragging) continue;
          b.x += b.vx;
          b.y += b.vy;
          if (settlePull > 0) {
            b.x += (b.anchorX - b.x) * settlePull;
            b.y += (b.anchorY - b.y) * settlePull;
          }
          b.vx *= damping;
          b.vy *= damping;
        }
      }

      setTime(t => t + dt * motionSpeed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [motionSpeed, selectedChain, selectedProtocolId]);

  useEffect(() => {
    onFocusChange?.({
      layer: selectedProtocolId ? 'protocol' : selectedChain ? 'chain' : 'root',
      selectedChain,
      selectedProtocolId,
    });
  }, [onFocusChange, selectedChain, selectedProtocolId]);

  const VB_W = 360;
  const VB_H = 520;
  const cx0 = VB_W / 2;
  const cy0 = VB_H / 2 + 40;
  const ringR = 138;
  const chainSize = 34;
  const gatewaySize = 22;

  const ringPos = useMemo(() => placeRing(CHAINS, ringR), [ringR]);
  const destChains = CHAINS.filter(c => c.role === 'destination');

  const strategiesByChain = useMemo(() => {
    const m = {};
    for (const s of STRATEGIES) {
      if (!isMindmapVisible(s)) continue;
      (m[s.chain] ||= []).push(s);
    }
    return m;
  }, [refreshTick]);

  const protocolsByChain = useMemo(() => {
    const mapped = {};
    Object.entries(strategiesByChain).forEach(([chainId, strategies]) => {
      mapped[chainId] = groupStrategiesByProtocol(strategies).filter((group) => !isGatewayProtocolGroup(group));
    });
    return mapped;
  }, [strategiesByChain]);

  const btcPos = { x: 0, y: -(ringR + chainSize * 1.7) };

  const protocolBloom = useMemo(() => {
    if (!selectedChain) return {};
    const p = ringPos[selectedChain];
    if (!p) return {};
    const strats = protocolsByChain[selectedChain] || [];
    const chipR = PROTOCOL_CHIP_RADIUS;
    const rawR = bloomRadiusForCount(strats.length, chipR, PROTOCOL_BLOOM_MIN_RADIUS, PROTOCOL_BLOOM_PADDING);
    const R = rawR;
    const out = {};
    const baseA = p.angle ?? Math.atan2(p.y, p.x);
    const step = strats.length <= 1 ? 0 : PROTOCOL_BLOOM_SPREAD / (strats.length - 1);
    const startA = baseA - PROTOCOL_BLOOM_SPREAD / 2;
    strats.forEach((s, i) => {
      const a = strats.length <= 1 ? baseA : startA + i * step;
      out[s.id] = { x: p.x + Math.cos(a)*R, y: p.y + Math.sin(a)*R };
    });
    return out;
  }, [protocolsByChain, selectedChain, ringPos]);

  // Sync physics bodies when layout changes
  useEffect(() => {
    const bodies = physicsRef.current;
    const ensure = (id, anchorX, anchorY, radius, mass, opts = {}) => {
      if (!bodies.has(id)) {
        bodies.set(id, { id, x: anchorX, y: anchorY, anchorX, anchorY, vx: 0, vy: 0, radius, mass, isDragging: false, ...opts });
      } else {
        const b = bodies.get(id);
        b.anchorX = anchorX; b.anchorY = anchorY;
        b.radius = radius; b.mass = mass;
        Object.assign(b, opts);
      }
    };

    destChains.forEach(c => {
      const p = ringPos[c.id];
      ensure(`chain:${c.id}`, p.x, p.y, chainSize * 0.9, 3);
    });
    ensure('chain:bitcoin', btcPos.x, btcPos.y, chainSize * 0.95 * 0.9, 3);
    ensure('gateway:center', 0, 0, gatewaySize * 1.6, 5, { draggable: false });

    if (selectedChain) {
      const strats = protocolsByChain[selectedChain] || [];
      strats.forEach(s => {
        const pp = protocolBloom[s.id];
        if (!pp) return;
        const chipR = PROTOCOL_CHIP_RADIUS;
        ensure(`proto:${s.id}`, pp.x, pp.y, chipR + 4, 1, { orbitRadius: s.type === 'loop' ? chipR * 1.8 + 6 : 0 });
      });
    }

    // Remove stale protocol bodies
    for (const [id] of bodies) {
      if (id.startsWith('proto:')) {
        const sid = id.slice(6);
        const still = selectedChain && (protocolsByChain[selectedChain] || []).some(s => s.id === sid);
        if (!still) bodies.delete(id);
      }
    }
  }, [ringPos, selectedChain, protocolsByChain, protocolBloom, chainSize, gatewaySize, destChains, btcPos.x, btcPos.y]);

  // Snap all bodies to anchors on selection change so zoom transition does
  // not visually fight the spring solver (eliminates "튕김" jitter).
  useEffect(() => {
    const bodies = physicsRef.current;
    for (const b of bodies.values()) {
      if (b.isDragging) continue;
      b.x = b.anchorX;
      b.y = b.anchorY;
      b.vx = 0;
      b.vy = 0;
    }
  }, [selectedChain, selectedProtocolId]);

  const liveChains = new Set(
    STRATEGIES
      .filter((strategy) => isMindmapActiveStrategy(strategy))
      .map((strategy) => strategy.chain)
      .filter(Boolean),
  );
  const rootProtocolHints = useMemo(() => {
    if (selectedChain) return [];
    const hints = [];
    for (const chain of destChains) {
      const groups = (protocolsByChain[chain.id] || [])
        .filter((group) => isMindmapActiveStrategy(group))
        .slice(0, 2);
      const ring = ringPos[chain.id];
      if (!ring || groups.length === 0) continue;
      const chainBody = physicsRef.current.get(`chain:${chain.id}`);
      const chainX = chainBody ? chainBody.x : ring.x;
      const chainY = chainBody ? chainBody.y : ring.y;
      const angle = ring.angle ?? Math.atan2(ring.y, ring.x);
      const spread = groups.length === 1 ? [0] : [-0.18, 0.18];
      groups.forEach((group, groupIndex) => {
        const a = angle + spread[groupIndex];
        const offset = 32 + groupIndex * 8;
        hints.push({
          id: `${chain.id}:${group.protocol}:${groupIndex}`,
          chainId: chain.id,
          chainX,
          chainY,
          x: chainX + Math.cos(a) * offset,
          y: chainY + Math.sin(a) * offset,
          protocol: group.protocol,
          label: prettifyProtocolLabel(group.protocol),
          assetId: uniqueProtocolAssets(group)[0] || 'usdc',
          index: hints.length,
        });
      });
    }
    return hints;
  }, [destChains, protocolsByChain, ringPos, selectedChain, time]);
  const movementNowMs = Date.now();
  const recentMovements = dedupeRecentMovements(
    Array.isArray(window.FLOW?.recentMovements)
      ? window.FLOW.recentMovements.filter((movement) => movement?.fromChainId && movement?.toChainId && isRecentMovement(movement, movementNowMs))
      : [],
  ).sort((left, right) => new Date(right.observedAt || 0) - new Date(left.observedAt || 0));
  const movementChains = new Set(
    recentMovements.flatMap((movement) => [movement.fromChainId, movement.toChainId]).filter(Boolean),
  );
  const focusedMovements = selectedChain
    ? recentMovements
      .filter((movement) => movement.fromChainId === selectedChain || movement.toChainId === selectedChain)
      .slice(0, MAX_FOCUSED_MOVEMENT_TRACKS)
    : [];
  const focusedMovementChainIds = new Set(
    focusedMovements
      .flatMap((movement) => [movement.fromChainId, movement.toChainId])
      .filter((chainId) => chainId && chainId !== selectedChain && chainId !== 'bob_gateway'),
  );
  const focusedMovementUsesGateway = focusedMovements.some((movement) => movementUsesGateway(movement));
  const selectedChainUsesGatewayProtocol = Boolean(selectedChain)
    && (strategiesByChain[selectedChain] || []).some((strategy) => isGatewayProtocolGroup(strategy));
  const focusedGatewayVisible = focusedMovementUsesGateway || selectedChainUsesGatewayProtocol;

  const srcCurve = useMemo(() => {
    const b = physicsRef.current.get('chain:bitcoin');
    const g = physicsRef.current.get('gateway:center');
    const bx = b ? b.x : btcPos.x;
    const by = b ? b.y : btcPos.y;
    const gx = g ? g.x : 0;
    const gy = g ? g.y : 0;
    return { ...curvePath(bx, by, gx, gy, 0), x1: bx, y1: by, x2: gx, y2: gy };
  }, [btcPos.x, btcPos.y, time]);

  const destCurves = useMemo(() => {
    const m = {};
    const g = physicsRef.current.get('gateway:center');
    const gx = g ? g.x : 0;
    const gy = g ? g.y : 0;
    destChains.forEach(c => {
      const body = physicsRef.current.get(`chain:${c.id}`);
      const px = body ? body.x : ringPos[c.id].x;
      const py = body ? body.y : ringPos[c.id].y;
      const cp = curvePath(gx, gy, px, py, 0.1);
      m[c.id] = { ...cp, x1: gx, y1: gy, x2: px, y2: py };
    });
    return m;
  }, [ringPos, time]);

  const selectionTransform = useMemo(() => {
    if (!selectedChain) {
      return { zoom: 1, tx: cx0, ty: cy0 };
    }
    const chain = ringPos[selectedChain] || { x: 0, y: 0 };
    const focusPoint = selectedProtocolId ? (protocolBloom[selectedProtocolId] || null) : null;
    const strategies = (protocolsByChain[selectedChain] || []);
    const focusStrategies = selectedProtocolId
      ? strategies.filter((strategy) => strategy.id === selectedProtocolId)
      : strategies;
    const bounds = createBounds();
    const chainLabelBelow = (ringPos[selectedChain]?.y ?? 0) >= 0;

    includeCircle(bounds, chain.x, chain.y, chainSize * 0.9);
    includeRect(bounds, chain.x, chain.y + (chainLabelBelow ? chainSize * 0.98 : -(chainSize * 0.82)), 82, 18);
    includeRect(bounds, chain.x, chain.y + (chainLabelBelow ? chainSize * 1.46 : -(chainSize * 1.34)), 76, 16);

    const hasPayback = focusStrategies.some(s => s.type === 'payback');
    if (hasPayback) {
      includeCircle(bounds, btcPos.x, btcPos.y, chainSize * 0.9);
      includeRect(bounds, btcPos.x, btcPos.y - chainSize * 0.94, 72, 18);
    }
    if (focusedGatewayVisible) {
      includeCircle(bounds, 0, 0, gatewaySize * 0.95);
    }
    focusedMovementChainIds.forEach((chainId) => {
      const point = chainId === 'bitcoin' ? btcPos : ringPos[chainId];
      if (!point) return;
      includeCircle(bounds, point.x, point.y, chainSize * 0.46);
    });

    focusStrategies.forEach((strategy) => {
      const point = protocolBloom[strategy.id];
      if (!point) return;
      const chipSize = PROTOCOL_CHIP_SIZE;
      const chipRadius = PROTOCOL_CHIP_RADIUS;
      includeCircle(bounds, point.x, point.y, chipRadius + 4);
      includeRect(bounds, point.x, point.y - chipRadius - 19, 62, 16);
      includeRect(bounds, point.x, point.y + chipRadius + 13, 88, 16);
      includeRect(bounds, point.x, point.y + chipRadius + 24, 120, 42);

      if (strategy.loops) {
        includeCircle(bounds, point.x, point.y, chipSize * 1.8 + 14);
        includeCircle(bounds, point.x + chipRadius * 0.78, point.y - chipRadius * 0.78, 14);
      }
      if (strategy.pair?.length > 1) {
        includeRect(bounds, point.x, point.y - chipSize * 2.48, 48, 18);
      }
    });

    const finalBounds = finalizeBounds(bounds);
    if (!finalBounds) {
      return { zoom: 1, tx: cx0 - chain.x, ty: cy0 - chain.y };
    }

    const paddedBounds = padBounds(
      finalBounds,
      selectedProtocolId ? 16 : 12,
      selectedProtocolId ? 18 : 14
    );
    const safeArea = selectedProtocolId
      ? { top: 18, right: 18, bottom: PROTOCOL_CARD_SAFE_BOTTOM, left: 18 }
      : { top: 16, right: 12, bottom: 82, left: 12 };
    const focus = focusPoint
      ? { x: focusPoint.x, y: focusPoint.y - 4 }
      : {
          x: (paddedBounds.minX + paddedBounds.maxX) / 2,
          y: (paddedBounds.minY + paddedBounds.maxY) / 2,
        };
    return fitBoundsInViewBox({
      bounds: paddedBounds,
      viewBox: { width: VB_W, height: VB_H },
      safeArea,
      focus,
      minZoom: selectedProtocolId ? 0.78 : 0.92,
      maxZoom: selectedProtocolId ? 1.46 : 1.12,
    });
  }, [VB_W, VB_H, chainSize, cx0, cy0, focusedGatewayVisible, focusedMovementChainIds, gatewaySize, protocolBloom, protocolsByChain, ringPos, selectedChain, selectedProtocolId]);

  const { zoom, tx, ty } = selectionTransform;

  function getNodePos(id, fallbackX, fallbackY) {
    const body = physicsRef.current.get(id);
    if (body) return { x: body.x, y: body.y };
    return { x: fallbackX, y: fallbackY };
  }

  function getChainPos(chainId) {
    if (chainId === 'bitcoin') return getNodePos('chain:bitcoin', btcPos.x, btcPos.y);
    if (chainId === 'bob_gateway') return getNodePos('gateway:center', 0, 0);
    const ring = ringPos[chainId];
    if (!ring) return null;
    return getNodePos(`chain:${chainId}`, ring.x, ring.y);
  }

  function buildMovementTrack(movement, index, totalTracks = 1) {
    const from = getChainPos(movement.fromChainId);
    const to = getChainPos(movement.toChainId);
    if (!from || !to) return null;
    const viaGateway = movementUsesGateway(movement);
    const color = movementColor(movement, index);
    const key = movementDedupeKey(movement);
    const segments = [];
    let motionD = '';
    if (viaGateway) {
      const gateway = getChainPos('bob_gateway');
      if (!gateway) return null;
      const inbound = movementLinePath(from, gateway, MOVEMENT_NODE_GAP, MOVEMENT_GATEWAY_GAP, index, 0, totalTracks);
      const outbound = movementLinePath(gateway, to, MOVEMENT_GATEWAY_GAP, MOVEMENT_NODE_GAP, index, 1, totalTracks);
      segments.push(inbound, outbound);
      motionD = `${inbound.d} L ${outbound.x1} ${outbound.y1} Q ${outbound.cx} ${outbound.cy} ${outbound.x2} ${outbound.y2}`;
    } else {
      const direct = movementLinePath(from, to, MOVEMENT_NODE_GAP, MOVEMENT_NODE_GAP, index, 0, totalTracks);
      segments.push(direct);
      motionD = direct.d;
    }
    return {
      key,
      index,
      movement,
      viaGateway,
      color,
      freshness: movementFreshness(movement, movementNowMs),
      projected: movement.projected === true,
      segments,
      motionD,
      total: totalTracks,
    };
  }

  const visibleMovementSeeds = (selectedChain
    ? recentMovements.filter((movement) => movement.fromChainId === selectedChain || movement.toChainId === selectedChain)
    : recentMovements
  ).slice(0, selectedChain ? MAX_FOCUSED_MOVEMENT_TRACKS : MAX_ROOT_MOVEMENT_TRACKS);
  const visibleMovementTracks = visibleMovementSeeds
    .map((movement, index) => buildMovementTrack(movement, index, visibleMovementSeeds.length))
    .filter(Boolean);

  function handleDragStart(e, bodyId, onTap) {
    const body = physicsRef.current.get(bodyId);
    if (!body) return;
    if (body.draggable === false) return;
    e.stopPropagation?.();
    e.preventDefault?.();
    const startX = e.clientX;
    const startY = e.clientY;
    const downAt = performance.now();
    let moved = false;
    const svg = svgRef.current;

    const move = (ev) => {
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (!moved && dist > 3) {
        moved = true;
        body.isDragging = true;
        dragRef.current = bodyId;
      }
      if (moved) {
        const local = screenToLocal(svg, ev.clientX, ev.clientY, zoom, tx, ty);
        body.x = local.x;
        body.y = local.y;
        body.vx = 0;
        body.vy = 0;
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      body.isDragging = false;
      dragRef.current = null;
      if (!moved && performance.now() - downAt < 250) {
        onTap?.();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const stepBack = () => {
    if (selectedProtocolId) {
      setSelectedProtocolId(null);
      return;
    }
    if (selectedChain) {
      setSelectedChain(null);
    }
  };

  return (
    <div
      data-selected-chain={selectedChain || ''}
      data-selected-protocol={selectedProtocolId || ''}
      style={{
      position:'relative', width:'100%', height:'100%',
      background: 'linear-gradient(180deg, #FAFAFA 0%, #F3F3F4 100%)',
      borderRadius: 20, overflow:'hidden',
    }}>
      <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet" onClick={stepBack}>
        <defs>
          <pattern id="dotgrid" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.7" fill="#E0E0E2"/>
          </pattern>
          <radialGradient id="haloGrad" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#242428" stopOpacity="0.12"/>
            <stop offset="100%" stopColor="#242428" stopOpacity="0"/>
          </radialGradient>
        </defs>

        <rect width={VB_W} height={VB_H} fill="url(#dotgrid)" onClick={stepBack}/>

        <g transform={`translate(${tx}, ${ty}) scale(${zoom})`}
           style={{ transition: `transform ${T_FAST}ms ${EASE}`, willChange: 'transform' }}>
          {(() => {
            const btc = getNodePos('chain:bitcoin', btcPos.x, btcPos.y);
            const g = getNodePos('gateway:center', 0, 0);
            return (
              <line x1={btc.x} y1={btc.y} x2={g.x} y2={g.y}
                stroke="#CFCFD2" strokeWidth="1.1"
                opacity={selectedChain ? (focusedGatewayVisible && focusedMovementChainIds.has('bitcoin') ? 0.42 : 0) : 0.9}
                style={{ transition: `opacity ${T_FAST}ms ${EASE}` }}/>
            );
          })()}

          {destChains.map((c) => {
            const curve = destCurves[c.id];
            const hasLive = liveChains.has(c.id);
            const hasMovement = movementChains.has(c.id);
            const focusedMovementPeer = selectedChain && focusedMovementChainIds.has(c.id);
            const hidden = selectedChain && selectedChain !== c.id && !focusedMovementPeer;
            const dimmed = Boolean(selectedProtocolId) && selectedChain === c.id;
            return (
              <path key={'lane-'+c.id} d={curve.d}
                fill="none"
                stroke={hasLive ? '#9C9CA0' : hasMovement ? '#C9C9CE' : '#D8D8DA'}
                strokeWidth={dimmed ? 0.9 : hasLive || hasMovement ? 1 : 0.8}
                strokeDasharray={hasLive ? '0' : '2 3'}
                opacity={hidden ? 0 : dimmed ? 0.2 : focusedMovementPeer ? 0.44 : 1}
                style={{ transition: `opacity ${T_FAST}ms ${EASE}` }}/>
            );
          })}

          {!selectedChain && [0, 0.5].map((o, i) => {
            const dur = 3.0 / motionSpeed;
            const t = ((time + o * dur) % dur) / dur;
            return <FlowToken key={'src-'+i} curve={srcCurve} progress={t} assetId="btc" size={14}/>;
          })}

          {!selectedChain && destChains.filter(c => liveChains.has(c.id)).map((c, idx) => {
            const curve = destCurves[c.id];
            const dur = 4.0 / motionSpeed;
            const t = ((time + idx * 0.42) % dur) / dur;
            const carry = c.id === 'base' ? 'cbbtc' : c.id === 'bob' ? 'cbbtc' : 'wbtc';
            return (
              <g key={'p-'+c.id}>
                <FlowToken curve={curve} progress={t} assetId={carry} size={12} sourceChainId="bitcoin"/>
              </g>
            );
          })}

          {visibleMovementTracks.map((track) => (
            <MovementTrail
              key={`movement-trail-${track.key}`}
              track={track}
              selectedChain={selectedChain}
            />
          ))}

          {!selectedChain && rootProtocolHints.map((hint) => (
            <RootProtocolHint
              key={`root-protocol-${hint.id}`}
              hint={hint}
              time={time}
              motionSpeed={motionSpeed}
            />
          ))}

          {destChains.map((c) => {
            const pos = getNodePos(`chain:${c.id}`, ringPos[c.id].x, ringPos[c.id].y);
            const active = selectedChain === c.id;
            const focusedMovementPeer = selectedChain && focusedMovementChainIds.has(c.id);
            const hidden = selectedChain && !active && !focusedMovementPeer;
            const chainDimmed = (Boolean(selectedProtocolId) && active) || Boolean(focusedMovementPeer);
            return (
              <ChainNode
                key={c.id} chain={c} x={pos.x} y={pos.y} size={chainSize}
                hidden={hidden} active={active} dimmed={chainDimmed}
                compact={Boolean(focusedMovementPeer && !active)}
                labelBelow={ringPos[c.id].y >= 0}
                onDragStart={(e) => handleDragStart(e, `chain:${c.id}`, () => { setSelectedProtocolId(null); setSelectedChain(prev => prev === c.id ? null : c.id); })}
              />
            );
          })}

          {/* Protocols are intentionally hidden at the default view.
              They only render after a chain is tapped (selectedChain set), as
              ProtocolChip + connector / orbit further below. */}


          {selectedChain && (protocolsByChain[selectedChain] || []).map((s) => {
            const pp = getNodePos(`proto:${s.id}`, protocolBloom[s.id]?.x ?? 0, protocolBloom[s.id]?.y ?? 0);
            const chain = getNodePos(`chain:${selectedChain}`, ringPos[selectedChain].x, ringPos[selectedChain].y);
            if (!protocolBloom[s.id]) return null;
            const isSel = selectedProtocolId === s.id;
            const dimmed = Boolean(selectedProtocolId) && !isSel;
            const chipSize = PROTOCOL_CHIP_SIZE;
            const connector = {
              x1: chain.x, y1: chain.y,
              x2: pp.x, y2: pp.y,
              cx: (chain.x + pp.x)/2, cy: (chain.y + pp.y)/2,
            };
            const flowDur = 2.4 / motionSpeed;
            const tFlow = ((time) % flowDur) / flowDur;
            const isSwap = s.type === 'bridge' || s.type === 'payback' || s.type === 'swap' || s.type === 'arb';
            const btc = getNodePos('chain:bitcoin', btcPos.x, btcPos.y);
            return (
              <g key={'proto-'+s.id}>
                <line x1={chain.x} y1={chain.y} x2={pp.x} y2={pp.y}
                  stroke="#B0B0B3" strokeWidth="0.8"
                  opacity={selectedProtocolId ? (isSel ? 0.32 : 0.12) : dimmed ? 0.2 : 1}
                  style={{ animation: `fadeIn 180ms ${EASE} both` }}/>
                <g style={{ opacity: selectedProtocolId ? (isSel ? 0.54 : 0.1) : dimmed ? 0.18 : 1, transition: `opacity ${T_FAST}ms ${EASE}` }}>
                  <FlowToken curve={connector} progress={tFlow}
                    assetId={s.pair[0]}
                    swapAt={isSwap ? 0.5 : null}
                    swapTo={s.pair[1]}
                    sourceChainId={selectedChain}
                    sourceChainAfterSwap={s.type === 'payback' ? 'bitcoin' : 'bob'}
                    size={11}/>
                </g>
                {isSel && (
                  <ProtocolAssetMotion
                    strategy={s}
                    x={pp.x}
                    y={pp.y}
                    time={time}
                    dimmed={dimmed}
                  />
                )}
                {s.type === 'payback' && (
                  <g style={{ animation: `fadeIn 180ms ${EASE} both`, opacity: selectedProtocolId ? (isSel ? 0.44 : 0.1) : dimmed ? 0.18 : 1, transition: `opacity ${T_FAST}ms ${EASE}` }}>
                    {/* Return path from protocol back toward Bitcoin */}
                    {(() => {
                      const ret = curvePath(pp.x, pp.y, btc.x, btc.y, -0.18);
                      const dur = 3.2 / motionSpeed;
                      const t = ((time + 0.5) % dur) / dur;
                      return (
                        <>
                          <path d={ret.d} fill="none" stroke="#F2A33B" strokeWidth="1" strokeDasharray="3 3" opacity="0.6"/>
                          <FlowToken curve={{ ...ret, x1: pp.x, y1: pp.y, x2: btc.x, y2: btc.y }}
                            progress={t} assetId="btc" size={12} sourceChainId="bitcoin"/>
                        </>
                      );
                    })()}
                  </g>
                )}
                {s.type === 'loop' && !isSel && (
                  <g style={{ opacity: selectedProtocolId ? (isSel ? 0.48 : 0.1) : dimmed ? 0.18 : 1, transition: `opacity ${T_FAST}ms ${EASE}` }}>
                    <OrbitTokens cx={pp.x} cy={pp.y}
                      radius={chipSize * 1.8}
                      assets={s.pair}
                      loops={s.loops}
                      time={time} speed={0.55}/>
                  </g>
                )}
                <ProtocolChip strategy={s} x={pp.x} y={pp.y} size={chipSize}
                  selected={isSel}
                  dimmed={dimmed}
                  onTap={() => setSelectedProtocolId(prev => prev === s.id ? null : s.id)}
                  onDragStart={(e) => handleDragStart(e, `proto:${s.id}`, () => setSelectedProtocolId(prev => prev === s.id ? null : s.id))}/>
                {(s.type === 'lp' || s.type === 'cl_lp' || s.type === 'lp_bgt') && s.pair.length > 1 && (
                  <g style={{ opacity: selectedProtocolId ? (isSel ? 0.44 : 0.1) : dimmed ? 0.18 : 1, transition: `opacity ${T_FAST}ms ${EASE}` }}>
                    <PairBadge x={pp.x} y={pp.y - chipSize * 2.48} pair={s.pair} size={12}/>
                  </g>
                )}
                {(s.type === 'swap' || s.type === 'arb') && s.pair.length > 1 && (
                  <g style={{ opacity: selectedProtocolId ? (isSel ? 0.44 : 0.1) : dimmed ? 0.18 : 1, transition: `opacity ${T_FAST}ms ${EASE}` }}>
                    <PairBadge x={pp.x} y={pp.y - chipSize * 2.48} pair={s.pair} size={12}/>
                  </g>
                )}
                {(s.type === 'bridge' || s.type === 'payback' || s.type === 'refuel') && s.pair.length > 1 && (
                  <g style={{ opacity: selectedProtocolId ? (isSel ? 0.44 : 0.1) : dimmed ? 0.18 : 1, transition: `opacity ${T_FAST}ms ${EASE}` }}>
                    <PairBadge x={pp.x} y={pp.y - chipSize * 2.48} pair={s.pair} size={12}/>
                  </g>
                )}
              </g>
            );
          })}

          {(() => {
            const btcNeededForPayback = Boolean(selectedChain) && (protocolsByChain[selectedChain] || []).some(s => s.type === 'payback');
            const btcHidden = Boolean(selectedChain) && !btcNeededForPayback && !focusedMovementChainIds.has('bitcoin');
            const btc = getNodePos('chain:bitcoin', btcPos.x, btcPos.y);
            return <BitcoinSource x={btc.x} y={btc.y} size={chainSize*0.95} hidden={btcHidden} dimmed={focusLayer === 'protocol'}/>;
          })()}
          <GatewayCore size={gatewaySize} hidden={Boolean(selectedChain) && !focusedGatewayVisible} compact={Boolean(selectedChain)}/>
        </g>
      </svg>

      {selectedProtocolId && (
        <ProtocolCard protocolNode={(protocolsByChain[selectedChain] || []).find((item) => item.id === selectedProtocolId)}/>
      )}

      {selectedChain && !selectedProtocolId && (
        <ChainCard chainId={selectedChain} strategies={strategiesByChain[selectedChain] || []}/>
      )}

      {!selectedChain && null}
    </div>
  );
}

function ProtocolCard({ protocolNode }) {
  if (!protocolNode) return null;
  const chain = CHAINS.find(c => c.id === protocolNode.chain);
  const capitalLabel = formatCompactUsdLabel(protocolNode.capitalUsd);
  const yieldValue = formatYieldDisplay(protocolNode.earnedUsd, protocolNode.yieldBasis);
  const protocolAssets = Array.from(new Set([
    ...uniqueProtocolAssetsForStrategies(protocolNode.strategies || []),
    ...(protocolNode.recentActivityAssets || []),
  ])).slice(0, 4);
  return (
    <div data-card-type="protocol" style={{
      position:'absolute', left:8, right:8, bottom:8,
      background:'rgba(255,255,255,0.95)', backdropFilter:'blur(16px)', WebkitBackdropFilter:'blur(16px)',
      borderRadius:14, padding:'9px 10px',
      boxShadow:'0 4px 16px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.08)',
      fontFamily:'-apple-system, system-ui',
      animation:`cardIn 200ms ${EASE} both`,
      maxHeight: PROTOCOL_CARD_MAX_HEIGHT,
      overflow:'hidden',
      pointerEvents:'none',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ position:'relative', width:30, height:30 }}>
          <ProtocolLogo id={protocolNode.protocol} size={30}/>
          <div style={{ position:'absolute', bottom:-1, right:-1, background:'#fff', borderRadius:'50%', padding:1, border:'0.5px solid var(--line)' }}>
            <ChainLogo id={protocolNode.chain} size={13}/>
          </div>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#111113', letterSpacing:-0.1 }}>{protocolNode.label}</div>
          <div style={{ fontSize:11, color:'#6B6B6E', marginTop:1 }}>{chain?.name}</div>
        </div>
        {capitalLabel && (
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:13, fontWeight:700, color:'#111113', letterSpacing:-0.2 }}>{capitalLabel}</div>
            <div style={{ fontSize:9.5, color:'#6B6B6E', marginTop:1 }}>capital</div>
          </div>
        )}
      </div>
      <div style={{ marginTop:7, display:'flex', gap:8, flexWrap:'wrap' }}>
        <Metric label="Live" value={`${protocolNode.liveCount}/${protocolNode.strategyCount}`}/>
        <Metric label="Capital" value={capitalLabel || '—'}/>
        <Metric label={yieldMetricLabel(protocolNode.yieldBasis)} value={yieldValue || '—'} accent={protocolNode.earnedUsd > 0}/>
        {protocolNode.apyPct != null && <Metric label="APR" value={`${protocolNode.apyPct.toFixed(1)}%`}/>}
        {protocolNode.recentActivityCount > 0 && <Metric label="Activity" value={`${protocolNode.recentActivityCount} tx`}/>}
      </div>
      {protocolAssets.length > 0 && (
        <div style={{ marginTop:6, display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
          {protocolAssets.map((assetId) => (
            <div key={assetId} style={{ width:16, height:16, borderRadius:999, overflow:'hidden' }}>
              <AssetLogo id={assetId} size={16}/>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChainCard({ chainId, strategies }) {
  const chain = CHAINS.find(c => c.id === chainId);
  if (!chain) return null;
  const live = strategies.filter(s => s.status === 'LIVE').length;
  const realizedYield = strategies.reduce((sum, item) => sum + (item.realizedYieldUsd || 0), 0);
  const estimatedYield = strategies.reduce((sum, item) => sum + (item.estimatedYieldUsd || 0), 0);
  const totalEarned = realizedYield > 0 ? realizedYield : estimatedYield;
  const totalYieldBasis = realizedYield > 0 ? 'realized' : (estimatedYield > 0 ? 'estimated' : null);
  const chainAvailableUsd = Number(window.CAPITAL?.walletByChain?.[chainId] || 0);
  const chainDeployedUsd = Number(window.CAPITAL?.deployedByChain?.[chainId] || 0);
  const chainTotalUsd = chainAvailableUsd + chainDeployedUsd;
  const capitalLabel = formatCompactUsdLabel(chainTotalUsd);
  const totalYieldLabel = formatYieldDisplay(totalEarned, totalYieldBasis);
  return (
    <div data-card-type="chain" style={{
      position:'absolute', left:8, right:8, bottom:8,
      background:'rgba(255,255,255,0.95)', backdropFilter:'blur(16px)', WebkitBackdropFilter:'blur(16px)',
      borderRadius:14, padding:'10px 12px',
      boxShadow:'0 4px 16px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.08)',
      fontFamily:'-apple-system, system-ui', pointerEvents:'none',
      animation:`cardIn 200ms ${EASE} both`,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <ChainLogo id={chainId} size={28}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:600, letterSpacing:-0.1 }}>{chain.name}</div>
          <div style={{ fontSize:11, color:'#6B6B6E', marginTop:1 }}>
            {strategies.length} strategies · {live} live
          </div>
        </div>
        {totalEarned > 0 && (
          <div style={{ fontSize:13, fontWeight:600, color:'#1C7A3E', letterSpacing:-0.2 }}>
            {totalYieldLabel}
          </div>
        )}
      </div>
      <div style={{ marginTop:8, display:'flex', gap:14, flexWrap:'wrap' }}>
        <Metric label="Live" value={`${live}/${strategies.length}`}/>
        <Metric label="Free" value={formatCompactUsdLabel(chainAvailableUsd) || '—'}/>
        <Metric label="Deployed" value={formatCompactUsdLabel(chainDeployedUsd) || '—'}/>
        <Metric label="Total" value={capitalLabel || '—'}/>
        <Metric label={yieldMetricLabel(totalYieldBasis)} value={totalYieldLabel || '—'} accent={totalEarned > 0}/>
        {chain?.recentMovementCount > 0 && <Metric label="Moved 6h" value={formatCompactUsdLabel(chain.recentMovementUsd) || `${chain.recentMovementCount} tx`}/>}
        {chain?.recentActivityCount > 0 && <Metric label="Activity" value={`${chain.recentActivityCount} tx`}/>}
      </div>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize:10, color:'#8A8A8D', textTransform:'uppercase', letterSpacing:0.5 }}>{label}</div>
      <div style={{ fontSize:13, fontWeight:600, color: accent ? '#1C7A3E' : '#111113', marginTop:1, letterSpacing:-0.2 }}>{value}</div>
    </div>
  );
}

Object.assign(window, { Mindmap });
