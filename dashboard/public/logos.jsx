// Logo loader.
//
// Source priority:
//   1. Local self-hosted SVG at /assets/logos/{chains|protocols}/<id>.svg
//      (T25 — see ./assets/logos/LICENSES.md for license/attribution per id).
//   2. Remote CDN fallback (DeFiLlama / CoinGecko / weserv proxy) for assets
//      that are not yet shipped locally, or for asset-token icons (BTC, USDC,
//      etc) that ride on the CDNs by design.
//   3. Letter fallback if every source fails (offline, blocked, etc).
//
// The local SVG is loaded as an <img src> so the browser can cache it across
// chain taps and so a missing file degrades gracefully via onError.

const LLAMA_CHAIN = (slug, s) => `https://icons.llamao.fi/icons/chains/rsz_${slug}?w=${s*2}&h=${s*2}`;
const TOKEN_SVG   = (sym) => `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${sym}.svg`;
const LOCAL_CHAIN = (id) => `assets/logos/chains/${id}.svg`;
const LOCAL_PROTOCOL = (id) => `assets/logos/protocols/${id}.svg`;

const CHAIN_SLUG = {
  bitcoin: 'bitcoin', ethereum: 'ethereum', base: 'base', bsc: 'bsc',
  avalanche: 'avalanche', unichain: 'unichain', bera: 'berachain',
  optimism: 'optimism', soneium: 'soneium', sei: 'sei', sonic: 'sonic',
  bob: 'bob',
};

// Proxy through images.weserv.nl to bypass ORB on some CDNs.
function wsrv(url, size) {
  const bare = url.replace(/^https?:\/\//, '');
  return `https://images.weserv.nl/?url=${encodeURIComponent(bare)}&w=${size*2}&h=${size*2}&output=png`;
}

function protoSources(id, size) {
  const s = size * 2;
  const llama = (slug) => `https://icons.llamao.fi/icons/protocols/${slug}?w=${s}&h=${s}`;
  const cgRaw = (path) => `https://assets.coingecko.com/coins/images/${path}`;
  const cg = (path) => wsrv(cgRaw(path), size);
  const tw = (domain) => wsrv(`https://raw.githubusercontent.com/trustwallet/assets/master/dapps/${domain}.png`, size);
  const prox = (url) => wsrv(url, size);
  const map = {
    moonwell: [llama('moonwell'), cg('18246/standard/Moonwell_Logo.png')],
    aave:     [llama('aave-v3'), llama('aave'), cg('12645/standard/aave-token-round.png')],
    compound: [llama('compound-v3'), llama('compound'), cg('10775/standard/COMP.png')],
    uniswap:  [llama('uniswap-v3'), llama('uniswap'), cg('12504/standard/uniswap-logo.png')],
    curve:    [llama('curve-dex'), cg('12124/standard/Curve.png')],
    odos:     [llama('odos'), prox('https://assets.odos.xyz/odos-icon.svg')],
    oku:      [prox('https://oku.trade/favicon.ico')],
    gateway:  [llama('bob-gateway'), prox('https://www.gobob.xyz/favicon.ico')],
    gaszip:   [prox('https://www.gas.zip/favicon.ico')],
    morpho:    [llama('morpho-blue'), llama('morpho')],
    pendle:    [llama('pendle')],
    aerodrome: [llama('aerodrome-v1'), llama('aerodrome')],
    beefy:     [llama('beefy')],
    gmx:       [llama('gmx-v2'), llama('gmx')],
    bend:      [llama('bend')],
    bex:       [llama('bex')],
    k3capital: [],
    babylon:   [llama('babylon')],
    solv:      [llama('solv-protocol'), llama('solv')],
  };
  return map[id] || [llama(id)];
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
  const sources = [];
  if (slug) sources.push(LLAMA_CHAIN(slug, size));
  if (id) sources.push(LOCAL_CHAIN(id));
  return (
    <div style={{ width: size, height: size, flexShrink: 0, ...style }} data-chain-logo={id}>
      <MultiImgMark
        sources={sources}
        size={size} rounded={true} bg="#fff"
        fallback={<LetterFallback size={size} label={label}/>}
      />
    </div>
  );
}

function ProtocolLogo({ id, size = 22, style = {} }) {
  const remote = protoSources(id, size);
  const sources = id ? [LOCAL_PROTOCOL(id), ...remote] : remote;
  const label = (id || '?').slice(0, 1).toUpperCase();
  return (
    <div style={{ width: size, height: size, flexShrink: 0, ...style }} data-protocol-logo={id}>
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

function assetSources(id) {
  const size = 32;
  const cg = (path) => `https://images.weserv.nl/?url=${encodeURIComponent('assets.coingecko.com/coins/images/' + path)}&w=${size*2}&h=${size*2}&output=png`;
  const spot = (sym) => `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${sym}.svg`;
  const map = {
    btc:   [cg('1/standard/bitcoin.png'), spot('btc')],
    wbtc:  [cg('7598/standard/wrapped_bitcoin_wbtc.png'), spot('wbtc')],
    cbbtc: [cg('40143/standard/cbbtc.webp'), cg('40143/standard/cbbtc.png'), spot('btc')],
    tbtc:  [cg('11224/standard/0x18084fba666a33d37592fa2633fd49a74dd93a88.png'), spot('btc')],
    eth:   [cg('279/standard/ethereum.png'), spot('eth')],
    weth:  [cg('2518/standard/weth.png'), spot('eth')],
    usdc:  [cg('6319/standard/usdc.png'), spot('usdc')],
    usdt:  [cg('325/standard/Tether.png'), spot('usdt')],
    dai:   [cg('9956/standard/Badge_Dai.png'), spot('dai')],
    avax:  [cg('12559/standard/Avalanche_Circle_RedWhite_Trademark.png'), spot('avax')],
    bnb:   [cg('825/standard/bnb-icon2_2x.png'), spot('bnb')],
    sol:   [cg('4128/standard/solana.png'), spot('sol')],
  };
  return map[id] || [];
}

function AssetLogo({ id, size = 16, style = {} }) {
  const sources = assetSources(id);
  const label = (id || '?').slice(0, 1).toUpperCase();
  return (
    <div style={{ width: size, height: size, flexShrink: 0, ...style }}>
      <MultiImgMark
        sources={sources}
        size={size} rounded={true} bg="#fff"
        fallback={<LetterFallback size={size} label={label}/>}
      />
    </div>
  );
}

Object.assign(window, { ChainLogo, ProtocolLogo, AssetLogo });
