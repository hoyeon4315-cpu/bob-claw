// Official logos via public CDNs.
// Chains + protocols: DeFiLlama icons CDN. Tokens: spothq/cryptocurrency-icons.
// Protocol logos cycle through alternate URLs on error before falling back to letter.

const LLAMA_CHAIN = (slug, s) => `https://icons.llamao.fi/icons/chains/rsz_${slug}?w=${s*2}&h=${s*2}`;
const TOKEN_SVG   = (sym) => `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${sym}.svg`;

const CHAIN_SLUG = {
  bitcoin: 'bitcoin', ethereum: 'ethereum', base: 'base', bsc: 'bsc',
  avalanche: 'avalanche', unichain: 'unichain', bera: 'berachain',
  optimism: 'optimism', soneium: 'soneium', sei: 'sei', sonic: 'sonic',
  bob: 'bob',
};

function protoSources(id, size) {
  const s = size * 2;
  const llama = (slug) => `https://icons.llamao.fi/icons/protocols/${slug}?w=${s}&h=${s}`;
  const chain = (slug) => `https://icons.llamao.fi/icons/chains/rsz_${slug}?w=${s}&h=${s}`;
  const map = {
    moonwell: [llama('moonwell'), llama('moonwell-apollo')],
    odos:     [llama('odos'), llama('odos-v2')],
    gateway:  [llama('bob-gateway'), chain('bob')],
    gaszip:   [llama('gas.zip'), llama('gas-zip'), llama('gaszip')],
  };
  return map[id] || [];
}

function MultiImgMark({ sources, size, rounded = true, bg = 'transparent', fallback }) {
  const [idx, setIdx] = React.useState(0);
  const [dead, setDead] = React.useState(false);
  if (dead || !sources || sources.length === 0) return fallback || null;
  return (
    <img
      src={sources[idx]}
      width={size} height={size} alt="" draggable={false}
      onError={() => { if (idx + 1 < sources.length) setIdx(idx + 1); else setDead(true); }}
      style={{
        width: size, height: size,
        borderRadius: rounded ? size/2 : Math.max(5, size*0.26),
        background: bg, display:'block', objectFit:'cover', flexShrink: 0,
      }}
    />
  );
}

function ImgMark({ src, size, rounded = true, bg = 'transparent', fallback }) {
  return <MultiImgMark sources={src ? [src] : []} size={size} rounded={rounded} bg={bg} fallback={fallback}/>;
}

function LetterFallback({ size, label, tone = 'light' }) {
  const bg = tone === 'dark' ? '#2A2A2E' : '#EDEDED';
  const fg = tone === 'dark' ? '#F4F4F4' : '#111113';
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 2,
      background: bg, color: fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.48, fontWeight: 600,
      fontFamily: '-apple-system, SF Pro, system-ui',
      letterSpacing: -0.3, flexShrink: 0,
    }}>{label}</div>
  );
}

function ChainLogo({ id, size = 28, style = {} }) {
  const slug = CHAIN_SLUG[id];
  const label = (id || '?').slice(0, 1).toUpperCase();
  return (
    <div style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <ImgMark
        src={slug ? LLAMA_CHAIN(slug, size) : null}
        size={size} rounded={true} bg="#fff"
        fallback={<LetterFallback size={size} label={label}/>}
      />
    </div>
  );
}

function ProtocolLogo({ id, size = 22, style = {} }) {
  const sources = protoSources(id, size);
  const label = (id || '?').slice(0, 1).toUpperCase();
  return (
    <div style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <MultiImgMark
        sources={sources}
        size={size} rounded={false} bg="#fff"
        fallback={
          <div style={{
            width: size, height: size, borderRadius: Math.max(5, size * 0.26),
            background: '#EDEDED', color: '#111113',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: size * 0.42, fontWeight: 600,
            fontFamily: '-apple-system, system-ui',
          }}>{label}</div>
        }
      />
    </div>
  );
}

const TOKEN_SLUG = {
  btc: 'btc', wbtc: 'wbtc', cbbtc: 'btc', tbtc: 'btc',
  eth: 'eth', weth: 'eth',
  usdc: 'usdc', usdt: 'usdt', dai: 'dai',
  avax: 'avax', bnb: 'bnb', sol: 'sol',
};

function AssetLogo({ id, size = 16, style = {} }) {
  const slug = TOKEN_SLUG[id];
  const label = (id || '?').slice(0, 1).toUpperCase();
  return (
    <div style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <ImgMark
        src={slug ? TOKEN_SVG(slug) : null}
        size={size} rounded={true} bg="#fff"
        fallback={<LetterFallback size={size} label={label}/>}
      />
    </div>
  );
}

Object.assign(window, { ChainLogo, ProtocolLogo, AssetLogo });
