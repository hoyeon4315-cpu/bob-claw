// Flow map — Bitcoin L1 source on top, BOB Gateway (cross-chain platform) center, 11 L2 destinations around.
// Tap chain to zoom + hide others; tap background to reset. No manual close buttons.
// Layout invariants (mirrored from src/dashboard/mindmap-layout.mjs, unit-tested
// in test/mindmap-layout.test.mjs): viewport 375x812, label fontSize >=10,
// readable copy fontSize >=12, protocol bloom radius adapted to chip count to
// guarantee chord >= 2*chipR + 6 between adjacent chips (no overlap up to 8).

const { useState, useEffect, useRef, useMemo } = React;

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const T_FAST = 220;
const PROTOCOL_BLOOM_SPREAD = Math.PI * 0.8;

function bloomRadiusForCount(count, chipR, minR = 62, padding = 6) {
  if (!Number.isFinite(count) || count <= 1) return minR;
  const gap = PROTOCOL_BLOOM_SPREAD / (count - 1);
  const requiredChord = 2 * chipR + padding;
  const required = requiredChord / (2 * Math.sin(gap / 2));
  return Math.max(minR, required);
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

function bezierAt(x1, y1, cx, cy, x2, y2, t) {
  const u = 1 - t;
  return { x: u*u*x1 + 2*u*t*cx + t*t*x2, y: u*u*y1 + 2*u*t*cy + t*t*y2 };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function BitcoinSource({ x, y, size, hidden }) {
  return (
    <g transform={`translate(${x}, ${y})`}
       style={{ opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : 'auto', transition: `opacity ${T_FAST}ms ${EASE}` }}>
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

function GatewayCore({ size }) {
  const w = size * 1.8;
  const h = size * 1.1;
  return (
    <g>
      <circle r={size*1.6} fill="url(#haloGrad)" opacity="0.35"/>
      <rect x={-w/2} y={-h/2} width={w} height={h} rx={size*0.26}
        fill="#FFFFFF" stroke="#DADADA" strokeWidth="0.6"/>
      <foreignObject x={-w/2 + 2} y={-h/2 + 2} width={w - 4} height={h - 4} style={{ pointerEvents:'none' }}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
          <ProtocolLogo id="gateway" size={h*0.8}/>
        </div>
      </foreignObject>
      <text y={h/2 + 10} textAnchor="middle" fontSize="10" fontWeight="600" fill="#8A8A8D" style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 1 }}>CROSS-CHAIN</text>
    </g>
  );
}

function ChainNode({ chain, x, y, size, hidden, active, onTap, labelBelow }) {
  const handleTap = (event) => {
    event.stopPropagation?.();
    onTap?.();
  };
  const hitSize = size * 1.95;
  return (
    <g data-chain-id={chain.id} transform={`translate(${x}, ${y})`}
       style={{ cursor:'pointer', opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : 'auto',
                 transition: `opacity ${T_FAST}ms ${EASE}` }}>
      <g style={{ pointerEvents:'none' }}>
        <circle r={size*0.56} fill="#FFFFFF" stroke={active ? '#111113' : '#DADADA'} strokeWidth={active ? 1 : 0.6}/>
        <foreignObject x={-size*0.42} y={-size*0.42} width={size*0.84} height={size*0.84} style={{ pointerEvents:'none' }}>
          <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
            <ChainLogo id={chain.id} size={size*0.78}/>
          </div>
        </foreignObject>
        <text y={labelBelow ? size*0.94 : -size*0.72} textAnchor="middle" fontSize="11" fontWeight="500" fill="#555"
          style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0.2 }}>
          {chain.name}
        </text>
      </g>
      <foreignObject x={-hitSize / 2} y={-hitSize / 2} width={hitSize} height={hitSize}>
        <button
          xmlns="http://www.w3.org/1999/xhtml"
          type="button"
          aria-label={`${chain.name} chain`}
          onPointerDown={handleTap}
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

function TokenBubble({ x, y, assetId, size = 14, sourceChainId }) {
  const badge = size * 0.62;
  return (
    <g transform={`translate(${x}, ${y})`} style={{ pointerEvents:'none' }}>
      <circle r={size/2 + 1.8} fill="#FFFFFF" stroke="#E4E4E6" strokeWidth="0.5"/>
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

function FlowToken({ curve, progress, assetId, swapAt, swapTo, size = 14, sourceChainId, sourceChainAfterSwap }) {
  const p = bezierAt(curve.x1, curve.y1, curve.cx, curve.cy, curve.x2, curve.y2, progress);
  const swapped = (swapAt != null && progress >= swapAt && swapTo);
  const id = swapped ? swapTo : assetId;
  const src = swapped ? (sourceChainAfterSwap || sourceChainId) : sourceChainId;
  return <TokenBubble x={p.x} y={p.y} assetId={id} size={size} sourceChainId={src}/>;
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
    dots.push(<TokenBubble key={'orb-'+i} x={x} y={y} assetId={asset} size={10}/>);
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

function ProtocolMark({ x, y, protocol, size = 14 }) {
  return (
    <g transform={`translate(${x}, ${y})`} style={{ pointerEvents:'none' }}>
      <circle r={size/2 + 1.4} fill="#FFFFFF" stroke="#E4E4E6" strokeWidth="0.5"/>
      <foreignObject x={-size/2} y={-size/2} width={size} height={size} style={{ pointerEvents:'none' }}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
          <ProtocolLogo id={protocol} size={size}/>
        </div>
      </foreignObject>
    </g>
  );
}

function EndpointProtocols({ chainId, chainX, chainY, strategies, chainSize }) {
  const seen = new Set();
  const protos = [];
  for (const s of strategies) {
    if (!s.protocol || seen.has(s.protocol)) continue;
    seen.add(s.protocol);
    protos.push(s);
  }
  if (protos.length === 0) return null;
  const baseA = Math.atan2(chainY, chainX);
  const R = chainSize * 0.9;
  const spread = Math.min(Math.PI * 0.55, (protos.length - 1) * 0.42 + 0.3);
  return (
    <g>
      {protos.map((s, i) => {
        const t = protos.length === 1 ? 0 : (i / (protos.length - 1)) - 0.5;
        const a = baseA + t * spread;
        const x = chainX + Math.cos(a) * R;
        const y = chainY + Math.sin(a) * R;
        const mark = <ProtocolMark key={'ep-'+chainId+'-'+s.protocol} x={x} y={y} protocol={s.protocol} size={11}/>;
        if (s.type === 'loop') {
          return (
            <g key={'epg-'+chainId+'-'+s.protocol}>
              <circle cx={x} cy={y} r={9.5} fill="none" stroke="#B8B8BC" strokeWidth="0.5" strokeDasharray="2 2">
                <animateTransform attributeName="transform" type="rotate" from={`0 ${x} ${y}`} to={`360 ${x} ${y}`} dur="6s" repeatCount="indefinite"/>
              </circle>
              {mark}
            </g>
          );
        }
        return mark;
      })}
    </g>
  );
}

const TYPE_LABEL = { loop: 'LOOP', bridge: 'BRIDGE', payback: 'PAYBACK', arb: 'ARB', swap: 'DEX', refuel: 'REFUEL', lp: 'VAULT' };
const TYPE_INK   = { loop: '#1C7A3E', bridge: '#3A3A3D', payback: '#7A5C0D', arb: '#5B3DBF', swap: '#0A84FF', refuel: '#8A5C0D', lp: '#0A84FF' };

function prettifyProtocolLabel(protocol) {
  return String(protocol || '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function dominantType(strategies = []) {
  const priority = ['loop', 'lp', 'payback', 'bridge', 'arb', 'swap', 'refuel'];
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

function groupStrategiesByProtocol(strategies = []) {
  const grouped = {};
  for (const strategy of strategies) {
    (grouped[strategy.protocol] ||= []).push(strategy);
  }
  return Object.values(grouped).map((items) => {
    const first = items[0];
    const apyDenominator = items.reduce((sum, item) => sum + (Number.isFinite(item.apyPct) && Number.isFinite(item.capUsd) ? item.capUsd : 0), 0);
    const apyNumerator = items.reduce((sum, item) => sum + (Number.isFinite(item.apyPct) && Number.isFinite(item.capUsd) ? item.capUsd * item.apyPct : 0), 0);
    const liveCount = items.filter((item) => item.status === 'LIVE').length;
    return {
      ...first,
      id: `${first.chain}:${first.protocol}`,
      label: prettifyProtocolLabel(first.protocol),
      type: dominantType(items),
      status: summarizedStatus(items),
      strategies: items,
      strategyCount: items.length,
      liveCount,
      earnedUsd: items.reduce((sum, item) => sum + (item.earnedUsd || 0), 0),
      capUsd: items.reduce((sum, item) => sum + (item.capUsd || 0), 0),
      loops: Math.max(...items.map((item) => item.loops || 0), 0) || null,
      apyPct: apyDenominator > 0 ? apyNumerator / apyDenominator : null,
      desc: items.length === 1
        ? first.desc
        : `${items.length} strategies mapped to ${prettifyProtocolLabel(first.protocol)}.`,
    };
  });
}

function ProtocolChip({ strategy, x, y, size, onTap, selected }) {
  const R = size * 1.1;
  const typeLabel = TYPE_LABEL[strategy.type] || strategy.type.toUpperCase();
  const typeInk = TYPE_INK[strategy.type] || '#555';
  const handleTap = (event) => {
    event.stopPropagation?.();
    onTap?.();
  };
  const hitSize = strategy.loops ? size * 4.1 : size * 3.2;
  return (
    <g data-protocol-id={strategy.id} transform={`translate(${x}, ${y})`}
        style={{ cursor:'pointer', animation: `chipIn 220ms ${EASE} both` }}>
      <g style={{ pointerEvents:'none' }}>
        <circle r={R} fill="#FFFFFF" stroke={selected ? '#111113' : '#DADADA'} strokeWidth={selected ? 1.2 : 0.6}/>
        <foreignObject x={-R*0.82} y={-R*0.82} width={R*1.64} height={R*1.64} style={{ pointerEvents:'none' }}>
          <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', pointerEvents:'none' }}>
            <ProtocolLogo id={strategy.protocol} size={R*1.18}/>
          </div>
        </foreignObject>
        {selected && (
          <>
            <text y={R + 14} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1D1D1F"
              style={{ fontFamily:'-apple-system, system-ui', textTransform:'capitalize' }}>
              {strategy.label || strategy.protocol}
            </text>
            <text y={R + 26} textAnchor="middle" fontSize="10" fontWeight="600" fill={typeInk}
              style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0.8 }}>
              {typeLabel}
            </text>
          </>
        )}
        {strategy.loops && (
          <g transform={`translate(${R*0.78}, ${-R*0.78})`}>
            <rect x="-12" y="-8" width="24" height="16" rx="8" fill="#111113"/>
            <text textAnchor="middle" y="4" fontSize="10" fontWeight="600" fill="#fff" style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0.2 }}>×{strategy.loops}</text>
          </g>
        )}
        {selected && strategy.earnedUsd > 0 && (
          <text y={R + 34} textAnchor="middle" fontSize="9" fontWeight="600" fill="#1C7A3E" style={{ fontFamily:'-apple-system, system-ui' }}>
            +${strategy.earnedUsd.toFixed(0)}
          </text>
        )}
      </g>
      <foreignObject x={-hitSize / 2} y={-hitSize / 2} width={hitSize} height={hitSize}>
        <button
          xmlns="http://www.w3.org/1999/xhtml"
          type="button"
          aria-label={`${strategy.label || strategy.protocol} protocol`}
          onPointerDown={handleTap}
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

function Mindmap({ motionSpeed = 1.4 }) {
  const [selectedChain, setSelectedChain] = useState(null);
  const [selectedProtocolId, setSelectedProtocolId] = useState(null);
  const [time, setTime] = useState(0);
  const rafRef = useRef();

  useEffect(() => {
    let last = performance.now();
    const tick = (now) => {
      setTime(t => t + (now - last) * 0.001 * motionSpeed);
      last = now;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [motionSpeed]);

  const VB = 380;
  const cx0 = VB / 2;
  const cy0 = VB / 2 + 34;
  const ringR = 120;
  const chainSize = 34;
  const gatewaySize = 22;

  const ringPos = useMemo(() => placeRing(CHAINS, ringR), [ringR]);
  const destChains = CHAINS.filter(c => c.role === 'destination');

  const strategiesByChain = useMemo(() => {
    const m = {};
    for (const s of STRATEGIES) (m[s.chain] ||= []).push(s);
    return m;
  }, []);

  const protocolsByChain = useMemo(() => {
    const mapped = {};
    Object.entries(strategiesByChain).forEach(([chainId, strategies]) => {
      mapped[chainId] = groupStrategiesByProtocol(strategies);
    });
    return mapped;
  }, [strategiesByChain]);

  const liveChains = new Set(STRATEGIES.filter(s => s.status === 'LIVE').map(s => s.chain));

  const btcPos = { x: 0, y: -(ringR + chainSize*1.5) };

  const srcCurve = useMemo(() => ({
    ...curvePath(btcPos.x, btcPos.y, 0, 0, 0),
    x1: btcPos.x, y1: btcPos.y, x2: 0, y2: 0,
  }), [btcPos.x, btcPos.y]);

  const destCurves = useMemo(() => {
    const m = {};
    destChains.forEach(c => {
      const p = ringPos[c.id];
      const cp = curvePath(0, 0, p.x, p.y, 0.1);
      m[c.id] = { ...cp, x1: 0, y1: 0, x2: p.x, y2: p.y };
    });
    return m;
  }, [ringPos]);

  const protocolBloom = useMemo(() => {
    if (!selectedChain) return {};
    const p = ringPos[selectedChain];
    if (!p) return {};
    const strats = protocolsByChain[selectedChain] || [];
    const baseA = Math.atan2(p.y, p.x);
    const chipR = 28 * 1.1;
    const R = bloomRadiusForCount(strats.length, chipR, 62, 6);
    const out = {};
    strats.forEach((s, i) => {
      const t = strats.length === 1 ? 0 : (i / (strats.length - 1)) - 0.5;
      const a = baseA + t * PROTOCOL_BLOOM_SPREAD;
      out[s.id] = { x: p.x + Math.cos(a)*R, y: p.y + Math.sin(a)*R };
    });
    return out;
  }, [protocolsByChain, selectedChain, ringPos]);

  const selectionTransform = useMemo(() => {
    if (!selectedChain) {
      return { zoom: 1, tx: cx0, ty: cy0 };
    }
    const chain = ringPos[selectedChain] || { x: 0, y: 0 };
    const strategies = (protocolsByChain[selectedChain] || []);
    const focusStrategies = selectedProtocolId
      ? strategies.filter((strategy) => strategy.id === selectedProtocolId)
      : strategies;
    const bounds = createBounds();

    includeCircle(bounds, chain.x, chain.y, chainSize * 0.9);
    includeRect(bounds, chain.x, chain.y + chainSize * 0.95, 72, 18);

    focusStrategies.forEach((strategy) => {
      const point = protocolBloom[strategy.id];
      if (!point) return;
      const chipSize = 28;
      const chipRadius = chipSize * 1.1;
      includeCircle(bounds, point.x, point.y, chipRadius + 4);
      includeRect(bounds, point.x, point.y + chipRadius + 18, 112, 38);

      if (strategy.loops) {
        includeCircle(bounds, point.x, point.y, chipSize * 1.8 + 12);
        includeCircle(bounds, point.x + chipRadius * 0.78, point.y - chipRadius * 0.78, 14);
      }
      if (strategy.pair?.length > 1) {
        includeRect(bounds, point.x, point.y - chipSize * 1.55, 42, 18);
      }
    });

    const finalBounds = finalizeBounds(bounds);
    if (!finalBounds) {
      return { zoom: 1, tx: cx0 - chain.x, ty: cy0 - chain.y };
    }

    const width = Math.max(120, finalBounds.maxX - finalBounds.minX);
    const height = Math.max(120, finalBounds.maxY - finalBounds.minY);
    const padding = selectedProtocolId ? 74 : 54;
    const fitZoom = Math.min((VB - padding * 2) / width, (VB - padding * 2) / height);
    const zoom = clamp(fitZoom, 1, selectedProtocolId ? 1.48 : 1.12);
    const focus = {
      x: (finalBounds.minX + finalBounds.maxX) / 2,
      y: (finalBounds.minY + finalBounds.maxY) / 2,
    };

    let tx = cx0 - focus.x * zoom;
    let ty = cy0 - focus.y * zoom;

    const minLeft = 24;
    const maxRight = VB - 24;
    const minTop = 22;
    const maxBottom = VB - (selectedProtocolId ? 116 : 92);

    const left = finalBounds.minX * zoom + tx;
    const right = finalBounds.maxX * zoom + tx;
    const top = finalBounds.minY * zoom + ty;
    const bottom = finalBounds.maxY * zoom + ty;

    if (left < minLeft) tx += minLeft - left;
    if (right > maxRight) tx -= right - maxRight;
    if (top < minTop) ty += minTop - top;
    if (bottom > maxBottom) ty -= bottom - maxBottom;

    return { zoom, tx, ty };
  }, [VB, chainSize, cx0, cy0, protocolBloom, protocolsByChain, ringPos, selectedChain, selectedProtocolId]);

  const { zoom, tx, ty } = selectionTransform;

  const resetAll = () => { setSelectedChain(null); setSelectedProtocolId(null); };

  return (
    <div
      data-selected-chain={selectedChain || ''}
      data-selected-protocol={selectedProtocolId || ''}
      style={{
      position:'relative', width:'100%', height:'100%',
      background: 'linear-gradient(180deg, #FAFAFA 0%, #F3F3F4 100%)',
      borderRadius: 20, overflow:'hidden',
    }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="dotgrid" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.7" fill="#E0E0E2"/>
          </pattern>
          <radialGradient id="haloGrad" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#242428" stopOpacity="0.12"/>
            <stop offset="100%" stopColor="#242428" stopOpacity="0"/>
          </radialGradient>
        </defs>

        <rect width={VB} height={VB} fill="url(#dotgrid)" onClick={resetAll}/>

        <g transform={`translate(${tx}, ${ty}) scale(${zoom})`}
           style={{ transition: `transform ${T_FAST}ms ${EASE}` }}>
          <line x1={btcPos.x} y1={btcPos.y} x2="0" y2="0"
            stroke="#CFCFD2" strokeWidth="1.1"
            opacity={selectedChain ? 0 : 0.9}
            style={{ transition: `opacity ${T_FAST}ms ${EASE}` }}/>

          {destChains.map((c) => {
            const curve = destCurves[c.id];
            const hasLive = liveChains.has(c.id);
            const hidden = selectedChain && selectedChain !== c.id;
            return (
              <path key={'lane-'+c.id} d={curve.d}
                fill="none"
                stroke={hasLive ? '#9C9CA0' : '#D8D8DA'}
                strokeWidth={hasLive ? 1.1 : 0.8}
                strokeDasharray={hasLive ? '0' : '2 3'}
                opacity={hidden ? 0 : 1}
                style={{ transition: `opacity ${T_FAST}ms ${EASE}` }}/>
            );
          })}

          {!selectedChain && [0, 0.5].map((o, i) => {
            const dur = 3.0 / motionSpeed;
            const t = ((time + o * dur) % dur) / dur;
            return <FlowToken key={'src-'+i} curve={srcCurve} progress={t} assetId="btc" size={14}/>;
          })}

          {destChains.filter(c => liveChains.has(c.id)).map((c, idx) => {
            const hidden = selectedChain && selectedChain !== c.id;
            if (hidden) return null;
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

          {destChains.map((c) => {
            const p = ringPos[c.id];
            const active = selectedChain === c.id;
            const hidden = selectedChain && !active;
            return (
              <ChainNode
                key={c.id} chain={c} x={p.x} y={p.y} size={chainSize}
                hidden={hidden} active={active}
                labelBelow={p.y >= 0}
                onTap={() => { setSelectedProtocolId(null); setSelectedChain(prev => prev === c.id ? null : c.id); }}
              />
            );
          })}

          {!selectedChain && destChains.map((c) => {
            const p = ringPos[c.id];
            return (
              <EndpointProtocols
                key={`endpoint-${c.id}`}
                chainId={c.id}
                chainX={p.x}
                chainY={p.y}
                strategies={strategiesByChain[c.id] || []}
                chainSize={chainSize}
              />
            );
          })}


          {selectedChain && (protocolsByChain[selectedChain] || []).map((s) => {
            const pp = protocolBloom[s.id];
            if (!pp) return null;
            const chain = ringPos[selectedChain];
            const isSel = selectedProtocolId === s.id;
            const chipSize = 28;
            const connector = {
              x1: chain.x, y1: chain.y,
              x2: pp.x, y2: pp.y,
              cx: (chain.x + pp.x)/2, cy: (chain.y + pp.y)/2,
            };
            const flowDur = 2.4 / motionSpeed;
            const tFlow = ((time) % flowDur) / flowDur;
            const isSwap = s.type === 'bridge' || s.type === 'payback' || s.type === 'swap' || s.type === 'arb';
            return (
              <g key={'proto-'+s.id}>
                <line x1={chain.x} y1={chain.y} x2={pp.x} y2={pp.y}
                  stroke="#B0B0B3" strokeWidth="0.8"
                  style={{ animation: `fadeIn 180ms ${EASE} both` }}/>
                <FlowToken curve={connector} progress={tFlow}
                  assetId={s.pair[0]}
                  swapAt={isSwap ? 0.5 : null}
                  swapTo={s.pair[1]}
                  sourceChainId={selectedChain}
                  sourceChainAfterSwap={s.type === 'payback' ? 'bitcoin' : 'bob'}
                  size={11}/>
                <ProtocolChip strategy={s} x={pp.x} y={pp.y} size={chipSize}
                  selected={isSel}
                  onTap={() => setSelectedProtocolId(prev => prev === s.id ? null : s.id)}/>
                {s.type === 'loop' && (
                  <OrbitTokens cx={pp.x} cy={pp.y}
                    radius={chipSize * 1.8}
                    assets={s.pair}
                    loops={s.loops}
                    time={time} speed={0.55}/>
                )}
                {(s.type === 'lp' || s.type === 'swap' || s.type === 'arb') && s.pair.length > 1 && (
                  <PairBadge x={pp.x} y={pp.y - chipSize * 1.55} pair={s.pair} size={12}/>
                )}
                {(s.type === 'bridge' || s.type === 'payback' || s.type === 'refuel') && s.pair.length > 1 && (
                  <PairBadge x={pp.x} y={pp.y - chipSize * 1.55} pair={s.pair} size={12}/>
                )}
              </g>
            );
          })}

          <BitcoinSource x={btcPos.x} y={btcPos.y} size={chainSize*0.95} hidden={Boolean(selectedChain)}/>
          <GatewayCore size={gatewaySize}/>
        </g>
      </svg>

      {selectedProtocolId && (
        <ProtocolCard protocolNode={(protocolsByChain[selectedChain] || []).find((item) => item.id === selectedProtocolId)}/>
      )}

      {selectedChain && !selectedProtocolId && (
        <ChainCard chainId={selectedChain} strategies={strategiesByChain[selectedChain] || []}/>
      )}

      {!selectedChain && (
        <div style={{
          position:'absolute', bottom:10, left:0, right:0, textAlign:'center',
          fontSize:11, color:'#8A8A8D', letterSpacing: 0.3,
          fontFamily:'-apple-system, system-ui', pointerEvents:'none',
        }}>
          tap a chain to zoom · tap background to reset
        </div>
      )}
    </div>
  );
}

function ProtocolCard({ protocolNode }) {
  if (!protocolNode) return null;
  const chain = CHAINS.find(c => c.id === protocolNode.chain);
  const statusInk = { 'LIVE':'#1C7A3E','DRY RUN':'#7A5C0D','CANDIDATE':'#6B6B6E','BLOCKED':'#8A1F1F' }[protocolNode.status] || '#555';
  const typeLabel = TYPE_LABEL[protocolNode.type] || protocolNode.type.toUpperCase();
  const typeInk = TYPE_INK[protocolNode.type] || '#555';
  return (
    <div data-card-type="protocol" style={{
      position:'absolute', left:8, right:8, bottom:8,
      background:'rgba(255,255,255,0.95)', backdropFilter:'blur(16px)', WebkitBackdropFilter:'blur(16px)',
      borderRadius:14, padding:'10px 12px',
      boxShadow:'0 4px 16px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.08)',
      fontFamily:'-apple-system, system-ui',
      animation:`cardIn 200ms ${EASE} both`,
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
          <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:1 }}>
            <span style={{ fontSize:11, color:'#6B6B6E' }}>{chain?.name}</span>
            <span style={{ fontSize:10, fontWeight:600, padding:'1px 5px', borderRadius:3, border:`0.5px solid ${typeInk}`, color:typeInk, letterSpacing:0.4 }}>{typeLabel}</span>
          </div>
        </div>
        <div style={{
          fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:4,
          border: `0.5px solid ${statusInk}`,
          color: statusInk, letterSpacing:0.4,
        }}>{protocolNode.status}</div>
      </div>
      <div style={{ marginTop:8, display:'flex', gap:12, flexWrap:'wrap' }}>
        <Metric label="Mapped" value={`${protocolNode.strategyCount}`}/>
        <Metric label="Live" value={`${protocolNode.liveCount}/${protocolNode.strategyCount}`}/>
        <Metric label="Earned" value={protocolNode.earnedUsd > 0 ? `$${protocolNode.earnedUsd.toFixed(2)}` : '—'} accent={protocolNode.earnedUsd > 0}/>
        {protocolNode.apyPct != null && <Metric label="APY" value={`${protocolNode.apyPct.toFixed(1)}%`}/>}
        <Metric label="Cap" value={`$${protocolNode.capUsd}`}/>
        {protocolNode.loops && <Metric label="Loops" value={`×${protocolNode.loops}`}/>}
      </div>
      <div style={{ marginTop:6, display:'flex', alignItems:'center', gap:5, padding:'5px 8px', background:'#F5F5F6', borderRadius:8 }}>
        <span style={{ fontSize:10, color:'#8A8A8D', textTransform:'uppercase', letterSpacing:0.5, fontWeight:600 }}>Pair</span>
        {protocolNode.pair.map(p => <AssetLogo key={p} id={p} size={14}/>)}
        <span style={{ fontSize:12, fontWeight:500, color:'#1D1D1F' }}>{protocolNode.pair.map(p => p.toUpperCase()).join(' → ')}</span>
      </div>
      <div style={{
        marginTop:7, fontSize:12, lineHeight:1.45, color:'#3A3A3D',
        display:'-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient:'vertical', overflow:'hidden',
      }}>
        {protocolNode.desc}
      </div>
      <div style={{ marginTop:7, display:'flex', gap:6, flexWrap:'wrap' }}>
        {protocolNode.strategies.map((strategy) => (
          <div key={strategy.id} style={{
            padding:'4px 7px', borderRadius:999, background:'#F5F5F6',
            fontSize:11, color:'#3A3A3D', lineHeight:1.2,
          }}>
            {strategy.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChainCard({ chainId, strategies }) {
  const chain = CHAINS.find(c => c.id === chainId);
  if (!chain) return null;
  const live = strategies.filter(s => s.status === 'LIVE').length;
  const totalCap = strategies.reduce((s, x) => s + (x.capUsd || 0), 0);
  const totalEarned = strategies.reduce((s, x) => s + (x.earnedUsd || 0), 0);
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
            +${totalEarned.toFixed(2)}
          </div>
        )}
      </div>
      <div style={{ marginTop:8, display:'flex', gap:14, flexWrap:'wrap' }}>
        <Metric label="Live" value={`${live}/${strategies.length}`}/>
        <Metric label="Cap" value={`$${totalCap}`}/>
        <Metric label="Earned" value={totalEarned > 0 ? `$${totalEarned.toFixed(2)}` : '—'} accent={totalEarned > 0}/>
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
