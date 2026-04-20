// Flow map — Bitcoin L1 source on top, BOB Gateway center, 11 destinations around.
// Tap chain to zoom + hide others; tap background to reset. No manual close buttons.

const { useState, useEffect, useRef, useMemo } = React;

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const T_FAST = 220;

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

function BitcoinSource({ x, y, size, hidden }) {
  return (
    <g transform={`translate(${x}, ${y})`}
       style={{ opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : 'auto', transition: `opacity ${T_FAST}ms ${EASE}` }}>
      <circle r={size*0.62} fill="#FFFFFF" stroke="#1D1D1F" strokeWidth="0.6"/>
      <circle r={size*0.62} fill="none" stroke="#F2A33B" strokeWidth="1" opacity="0.5">
        <animate attributeName="r" values={`${size*0.62};${size*0.78};${size*0.62}`} dur="2.4s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.5;0;0.5" dur="2.4s" repeatCount="indefinite"/>
      </circle>
      <foreignObject x={-size*0.42} y={-size*0.42} width={size*0.84} height={size*0.84}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%' }}>
          <ChainLogo id="bitcoin" size={size*0.8}/>
        </div>
      </foreignObject>
      <text y={size*0.98} textAnchor="middle" fontSize="9" fontWeight="500" fill="#555" style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0.3 }}>Bitcoin L1</text>
    </g>
  );
}

function GatewayCore({ size }) {
  return (
    <g>
      <circle r={size*1.6} fill="url(#haloGrad)" opacity="0.55"/>
      <circle r={size*0.78} fill="#111113" stroke="#2A2A2E" strokeWidth="0.8"/>
      <g>
        <path d={`M 0 ${-size*0.42} L ${size*0.36} ${-size*0.21} L ${size*0.36} ${size*0.21} L 0 ${size*0.42} L ${-size*0.36} ${size*0.21} L ${-size*0.36} ${-size*0.21} Z`}
          fill="none" stroke="#F5F5F5" strokeWidth="1.6" strokeLinejoin="round"/>
        <circle r={size*0.14} fill="#F5F5F5"/>
      </g>
      <text y={size*1.15} textAnchor="middle" fontSize="9" fontWeight="600" fill="#333" style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 1.2 }}>BOB GATEWAY</text>
    </g>
  );
}

function ChainNode({ chain, x, y, size, hidden, active, onTap, labelBelow }) {
  return (
    <g transform={`translate(${x}, ${y})`} onClick={(e) => { e.stopPropagation?.(); onTap?.(); }}
       style={{ cursor:'pointer', opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : 'auto',
                transition: `opacity ${T_FAST}ms ${EASE}` }}>
      <circle r={size*0.56} fill="#FFFFFF" stroke={active ? '#111113' : '#DADADA'} strokeWidth={active ? 1 : 0.6}/>
      <foreignObject x={-size*0.42} y={-size*0.42} width={size*0.84} height={size*0.84}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%' }}>
          <ChainLogo id={chain.id} size={size*0.78}/>
        </div>
      </foreignObject>
      <text y={labelBelow ? size*0.94 : -size*0.72} textAnchor="middle" fontSize="8.5" fontWeight="500" fill="#555"
        style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0.2 }}>
        {chain.name}
      </text>
    </g>
  );
}

function TokenBubble({ x, y, assetId, size = 14, sourceChainId }) {
  const badge = size * 0.62;
  return (
    <g transform={`translate(${x}, ${y})`} style={{ pointerEvents:'none' }}>
      <circle r={size/2 + 1.8} fill="#FFFFFF" stroke="#E4E4E6" strokeWidth="0.5"/>
      <foreignObject x={-size/2} y={-size/2} width={size} height={size}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%' }}>
          <AssetLogo id={assetId} size={size}/>
        </div>
      </foreignObject>
      {sourceChainId && (
        <g transform={`translate(${size*0.42}, ${size*0.42})`}>
          <circle r={badge/2 + 0.8} fill="#FFFFFF" stroke="#E4E4E6" strokeWidth="0.4"/>
          <foreignObject x={-badge/2} y={-badge/2} width={badge} height={badge}>
            <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%' }}>
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
      <foreignObject x={-size*0.95} y={-size*0.45} width={size*0.9} height={size*0.9}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%' }}>
          <AssetLogo id={pair[0]} size={size*0.9}/>
        </div>
      </foreignObject>
      <foreignObject x={-size*0.1} y={-size*0.45} width={size*0.9} height={size*0.9}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%' }}>
          <AssetLogo id={pair[1] || pair[0]} size={size*0.9}/>
        </div>
      </foreignObject>
    </g>
  );
}

function ProtocolChip({ strategy, x, y, size, onTap, selected }) {
  return (
    <g transform={`translate(${x}, ${y})`} onClick={(e) => { e.stopPropagation?.(); onTap?.(); }}
       style={{ cursor:'pointer', animation: `chipIn 220ms ${EASE} both` }}>
      <rect x={-size*0.9} y={-size*0.55} width={size*1.8} height={size*1.1} rx={size*0.5}
        fill="#FFFFFF" stroke={selected ? '#111113' : '#DADADA'} strokeWidth={selected ? 1 : 0.6}/>
      <foreignObject x={-size*0.8} y={-size*0.4} width={size*0.8} height={size*0.8}>
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%' }}>
          <ProtocolLogo id={strategy.protocol} size={size*0.72}/>
        </div>
      </foreignObject>
      <text x={size*0.05} y="3" fontSize="9" fontWeight="500" fill="#1D1D1F" style={{ fontFamily:'-apple-system, system-ui' }}>
        {strategy.protocol}
      </text>
      {strategy.loops && (
        <g transform={`translate(${size*0.82}, ${-size*0.4})`}>
          <rect x="-11" y="-7" width="22" height="14" rx="7" fill="#111113"/>
          <text textAnchor="middle" y="3.5" fontSize="8.5" fontWeight="600" fill="#fff" style={{ fontFamily:'-apple-system, system-ui', letterSpacing: 0.2 }}>×{strategy.loops}</text>
        </g>
      )}
      {strategy.earnedUsd > 0 && (
        <g transform={`translate(0, ${size*0.95})`}>
          <text textAnchor="middle" fontSize="9" fontWeight="600" fill="#1C7A3E" style={{ fontFamily:'-apple-system, system-ui' }}>
            +${strategy.earnedUsd.toFixed(0)}
          </text>
        </g>
      )}
    </g>
  );
}

function Mindmap({ motionSpeed = 1.4 }) {
  const [selectedChain, setSelectedChain] = useState(null);
  const [selectedStrategy, setSelectedStrategy] = useState(null);
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
    const strats = strategiesByChain[selectedChain] || [];
    const baseA = Math.atan2(p.y, p.x);
    const spread = Math.PI * 0.8;
    const R = 62;
    const out = {};
    strats.forEach((s, i) => {
      const t = strats.length === 1 ? 0 : (i / (strats.length - 1)) - 0.5;
      const a = baseA + t * spread;
      out[s.id] = { x: p.x + Math.cos(a)*R, y: p.y + Math.sin(a)*R };
    });
    return out;
  }, [selectedChain, ringPos, strategiesByChain]);

  const zoom = selectedChain ? 1.9 : 1;
  const focus = selectedChain ? ringPos[selectedChain] || {x:0,y:0} : {x:0, y:0};
  const tx = cx0 - focus.x * zoom;
  const ty = cy0 - focus.y * zoom;

  const resetAll = () => { setSelectedChain(null); setSelectedStrategy(null); };

  return (
    <div style={{
      position:'relative', width:'100%', height:'100%',
      background: 'linear-gradient(180deg, #FAFAFA 0%, #F3F3F4 100%)',
      borderRadius: 20, overflow:'hidden',
    }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="xMidYMid meet"
           onClick={resetAll}>
        <defs>
          <pattern id="dotgrid" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.7" fill="#E0E0E2"/>
          </pattern>
          <radialGradient id="haloGrad" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#242428" stopOpacity="0.12"/>
            <stop offset="100%" stopColor="#242428" stopOpacity="0"/>
          </radialGradient>
        </defs>

        <rect width={VB} height={VB} fill="url(#dotgrid)"/>

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
            const carry = c.id === 'base' ? 'cbbtc' : 'wbtc';
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
                onTap={() => { setSelectedStrategy(null); setSelectedChain(prev => prev === c.id ? null : c.id); }}
              />
            );
          })}

          {selectedChain && (strategiesByChain[selectedChain] || []).map((s) => {
            const pp = protocolBloom[s.id];
            if (!pp) return null;
            const chain = ringPos[selectedChain];
            const isSel = selectedStrategy === s.id;
            const chipSize = 20;
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
                  onTap={() => setSelectedStrategy(prev => prev === s.id ? null : s.id)}/>
                {s.type === 'loop' && (
                  <OrbitTokens cx={pp.x} cy={pp.y}
                    radius={chipSize * 1.6}
                    assets={s.pair}
                    loops={s.loops}
                    time={time} speed={0.55}/>
                )}
                {(s.type === 'lp' || s.type === 'swap' || s.type === 'arb') && s.pair.length > 1 && (
                  <PairBadge x={pp.x} y={pp.y - chipSize * 1.45} pair={s.pair} size={11}/>
                )}
              </g>
            );
          })}

          <BitcoinSource x={btcPos.x} y={btcPos.y} size={chainSize*0.95} hidden={Boolean(selectedChain)}/>
          <GatewayCore size={gatewaySize}/>
        </g>
      </svg>

      {selectedStrategy && (
        <StrategyCard strategy={STRATEGIES.find(s => s.id === selectedStrategy)}/>
      )}

      {!selectedChain && (
        <div style={{
          position:'absolute', bottom:10, left:0, right:0, textAlign:'center',
          fontSize:10, color:'#8A8A8D', letterSpacing: 0.3,
          fontFamily:'-apple-system, system-ui', pointerEvents:'none',
        }}>
          tap a chain to zoom · tap background to reset
        </div>
      )}
    </div>
  );
}

function StrategyCard({ strategy }) {
  if (!strategy) return null;
  const chain = CHAINS.find(c => c.id === strategy.chain);
  const statusInk = { 'LIVE':'#1C7A3E','DRY RUN':'#7A5C0D','CANDIDATE':'#6B6B6E','BLOCKED':'#8A1F1F' }[strategy.status] || '#555';
  return (
    <div style={{
      position:'absolute', left:10, right:10, bottom:10,
      background:'rgba(255,255,255,0.97)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
      borderRadius:18, padding:'14px 16px',
      boxShadow:'0 10px 28px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(0,0,0,0.08)',
      fontFamily:'-apple-system, system-ui',
      animation:`cardIn 200ms ${EASE} both`,
      pointerEvents:'none',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <ProtocolLogo id={strategy.protocol} size={28}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#111113', letterSpacing:-0.1 }}>{strategy.label}</div>
          <div style={{ fontSize:11, color:'#6B6B6E', marginTop:1 }}>{strategy.sub} · {chain?.name}</div>
        </div>
        <div style={{
          fontSize:9, fontWeight:600, padding:'3px 7px', borderRadius:5,
          border: `0.5px solid ${statusInk}`,
          color: statusInk, letterSpacing:0.5,
        }}>{strategy.status}</div>
      </div>
      <div style={{ marginTop:10, fontSize:11.5, color:'#4A4A4D', lineHeight:1.45 }}>{strategy.desc}</div>
      <div style={{ marginTop:12, display:'flex', gap:14, flexWrap:'wrap' }}>
        <Metric label="Earned" value={strategy.earnedUsd > 0 ? `$${strategy.earnedUsd.toFixed(2)}` : '—'} accent={strategy.earnedUsd > 0}/>
        {strategy.apyPct != null && <Metric label="APY" value={`${strategy.apyPct.toFixed(1)}%`}/>}
        <Metric label="Per-tx cap" value={`$${strategy.capUsd}`}/>
        {strategy.loops && <Metric label="Loops" value={`×${strategy.loops}`}/>}
        <Metric label="Auto" value={strategy.autoExecute ? 'on' : 'off'}/>
      </div>
      <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ fontSize:9.5, color:'#8A8A8D', textTransform:'uppercase', letterSpacing:0.6 }}>Pair</span>
        {strategy.pair.map(p => <AssetLogo key={p} id={p} size={16}/>)}
        <span style={{ fontSize:11, color:'#4A4A4D' }}>{strategy.pair.map(p => p.toUpperCase()).join(' · ')}</span>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize:9, color:'#8A8A8D', textTransform:'uppercase', letterSpacing:0.6 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:600, color: accent ? '#1C7A3E' : '#111113', marginTop:2, letterSpacing:-0.2 }}>{value}</div>
    </div>
  );
}

Object.assign(window, { Mindmap });
