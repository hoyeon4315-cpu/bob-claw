// Generated from logos.jsx by src/cli/build-dashboard-public.mjs.

(() => {
const LLAMA_CHAIN = (slug, s) => `https://icons.llamao.fi/icons/chains/rsz_${slug}?w=${s * 2}&h=${s * 2}`;
const TOKEN_SVG = (sym) => `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${sym}.svg`;
const LOCAL_CHAIN = (id) => `assets/logos/chains/${id}.svg`;
const LOCAL_PROTOCOL = (id) => `assets/logos/protocols/${id}.svg`;
const LOCAL_FIRST_PROTOCOL_IDS = /* @__PURE__ */ new Set(["euler"]);
const CHAIN_SLUG = {
  bitcoin: "bitcoin",
  ethereum: "ethereum",
  base: "base",
  bsc: "bsc",
  avalanche: "avalanche",
  unichain: "unichain",
  bera: "berachain",
  optimism: "optimism",
  soneium: "soneium",
  sei: "sei",
  sonic: "sonic",
  bob: "bob"
};
function wsrv(url, size) {
  const bare = url.replace(/^https?:\/\//, "");
  return `https://images.weserv.nl/?url=${encodeURIComponent(bare)}&w=${size * 2}&h=${size * 2}&output=png`;
}
function protoSources(id, size) {
  const s = size * 2;
  const llama = (slug) => `https://icons.llamao.fi/icons/protocols/${slug}?w=${s}&h=${s}`;
  const cgRaw = (path) => `https://assets.coingecko.com/coins/images/${path}`;
  const cg = (path) => wsrv(cgRaw(path), size);
  const tw = (domain) => wsrv(`https://raw.githubusercontent.com/trustwallet/assets/master/dapps/${domain}.png`, size);
  const prox = (url) => wsrv(url, size);
  const map = {
    moonwell: [prox("https://moonwell.fi/moonwell.png"), llama("moonwell"), cg("18246/standard/Moonwell_Logo.png")],
    aave: [llama("aave-v3"), llama("aave"), cg("12645/standard/aave-token-round.png")],
    compound: [llama("compound-v3"), llama("compound"), cg("10775/standard/COMP.png")],
    uniswap: [llama("uniswap-v3"), llama("uniswap"), cg("12504/standard/uniswap-logo.png")],
    curve: [llama("curve-dex"), cg("12124/standard/Curve.png")],
    odos: [llama("odos"), prox("https://assets.odos.xyz/odos-icon.svg")],
    oku: [prox("https://oku.trade/favicon.ico")],
    gateway: [llama("bob-gateway"), prox("https://www.gobob.xyz/favicon.ico")],
    gaszip: [prox("https://www.gas.zip/favicon.ico")],
    morpho: [llama("morpho-blue"), llama("morpho")],
    euler: [prox("https://www.euler.finance/branding/euler-symbol-color.svg"), prox("https://app.euler.finance/favicon.ico")],
    yo: [prox("https://yo.xyz/images/logo-green.svg"), prox("https://www.yo.xyz/images/logo.svg"), prox("https://www.yo.xyz/icon.svg"), prox("https://www.yo.xyz/favicon.ico")],
    pendle: [llama("pendle")],
    aerodrome: [llama("aerodrome-v1"), llama("aerodrome")],
    beefy: [llama("beefy")],
    gmx: [llama("gmx-v2"), llama("gmx")],
    bend: [llama("bend")],
    bex: [llama("bex")],
    k3capital: [],
    babylon: [llama("babylon")],
    solv: [llama("solv-protocol"), llama("solv")]
  };
  return map[id] || [llama(id)];
}
function MultiImgMark({ sources, size, rounded = true, bg = "transparent", fallback }) {
  const [idx, setIdx] = React.useState(0);
  const [dead, setDead] = React.useState(false);
  if (dead || !sources || sources.length === 0) return fallback || null;
  return /* @__PURE__ */ React.createElement(
    "img",
    {
      src: sources[idx],
      width: size,
      height: size,
      alt: "",
      draggable: false,
      onError: () => {
        if (idx + 1 < sources.length) setIdx(idx + 1);
        else setDead(true);
      },
      style: {
        width: size,
        height: size,
        borderRadius: rounded ? size / 2 : Math.max(5, size * 0.26),
        background: bg,
        display: "block",
        objectFit: "cover",
        flexShrink: 0
      }
    }
  );
}
function ImgMark({ src, size, rounded = true, bg = "transparent", fallback }) {
  return /* @__PURE__ */ React.createElement(MultiImgMark, { sources: src ? [src] : [], size, rounded, bg, fallback });
}
function LetterFallback({ size, label, tone = "light" }) {
  const bg = tone === "dark" ? "#2A2A2E" : "#EDEDED";
  const fg = tone === "dark" ? "#F4F4F4" : "#111113";
  return /* @__PURE__ */ React.createElement("div", { style: {
    width: size,
    height: size,
    borderRadius: size / 2,
    background: bg,
    color: fg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: size * 0.48,
    fontWeight: 600,
    fontFamily: "-apple-system, SF Pro, system-ui",
    letterSpacing: -0.3,
    flexShrink: 0
  } }, label);
}
function ChainLogo({ id, size = 28, style = {} }) {
  const slug = CHAIN_SLUG[id];
  const label = (id || "?").slice(0, 1).toUpperCase();
  const sources = [];
  if (slug) sources.push(LLAMA_CHAIN(slug, size));
  if (id) sources.push(LOCAL_CHAIN(id));
  return /* @__PURE__ */ React.createElement("div", { style: { width: size, height: size, flexShrink: 0, ...style }, "data-chain-logo": id }, /* @__PURE__ */ React.createElement(
    MultiImgMark,
    {
      sources,
      size,
      rounded: true,
      bg: "#fff",
      fallback: /* @__PURE__ */ React.createElement(LetterFallback, { size, label })
    }
  ));
}
function ProtocolLogo({ id, size = 22, style = {} }) {
  const remote = protoSources(id, size);
  const sources = id ? LOCAL_FIRST_PROTOCOL_IDS.has(id) ? [LOCAL_PROTOCOL(id), ...remote] : [...remote, LOCAL_PROTOCOL(id)] : remote;
  const label = (id || "?").slice(0, 1).toUpperCase();
  return /* @__PURE__ */ React.createElement("div", { style: { width: size, height: size, flexShrink: 0, ...style }, "data-protocol-logo": id }, /* @__PURE__ */ React.createElement(
    MultiImgMark,
    {
      sources,
      size,
      rounded: false,
      bg: "#fff",
      fallback: /* @__PURE__ */ React.createElement("div", { style: {
        width: size,
        height: size,
        borderRadius: Math.max(5, size * 0.26),
        background: "#EDEDED",
        color: "#111113",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 600,
        fontFamily: "-apple-system, system-ui"
      } }, label)
    }
  ));
}
function normalizeAssetId(id = "") {
  const raw = String(id || "").trim().toLowerCase();
  const mapped = {
    "wbtc.oft": "wbtc",
    "btc.b": "wbtc",
    btcb: "wbtc",
    wbnb: "bnb",
    "pt-solvbtc": "solvbtc",
    "pt-lbtc": "lbtc",
    rlusd: "rlusd",
    honey: "honey",
    s: "sonic_native"
  }[raw];
  if (mapped) return mapped;
  if (raw.startsWith("pt-")) return raw.slice(3);
  if (raw.endsWith(".oft")) return raw.replace(/\.oft$/u, "");
  return raw;
}
function assetSources(id, size = 32) {
  const assetId = normalizeAssetId(id);
  const cg = (path) => `https://images.weserv.nl/?url=${encodeURIComponent("assets.coingecko.com/coins/images/" + path)}&w=${size * 2}&h=${size * 2}&output=png`;
  const spot = (sym) => `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color/${sym}.svg`;
  const twErc20 = (address) => wsrv(`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${address}/logo.png`, size);
  const prox = (url) => wsrv(url, size);
  const map = {
    btc: [cg("1/standard/bitcoin.png"), spot("btc")],
    wbtc: [cg("7598/standard/wrapped_bitcoin_wbtc.png"), spot("wbtc")],
    cbbtc: [cg("40143/standard/cbbtc.webp"), cg("40143/standard/cbbtc.png"), spot("btc")],
    tbtc: [cg("11224/standard/0x18084fba666a33d37592fa2633fd49a74dd93a88.png"), spot("btc")],
    eth: [cg("279/standard/ethereum.png"), spot("eth")],
    weth: [cg("2518/standard/weth.png"), spot("eth")],
    usdc: [cg("6319/standard/usdc.png"), spot("usdc")],
    usdt: [cg("325/standard/Tether.png"), spot("usdt")],
    dai: [cg("9956/standard/Badge_Dai.png"), spot("dai")],
    avax: [cg("12559/standard/Avalanche_Circle_RedWhite_Trademark.png"), spot("avax")],
    bnb: [cg("825/standard/bnb-icon2_2x.png"), spot("bnb")],
    sol: [cg("4128/standard/solana.png"), spot("sol")],
    rlusd: [twErc20("0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD"), prox("https://ripple.com/favicon.ico")],
    lbtc: [prox("https://app.lombard.finance/favicon.ico"), spot("btc")],
    solvbtc: [prox("https://solv.finance/favicon.ico"), spot("btc")],
    honey: [prox("https://www.berachain.com/favicon.ico")],
    sonic_native: [LLAMA_CHAIN("sonic", size), LOCAL_CHAIN("sonic")]
  };
  return map[assetId] || [];
}
function AssetLogo({ id, size = 16, style = {} }) {
  const sources = assetSources(id, size);
  const label = normalizeAssetId(id || "?").slice(0, 1).toUpperCase();
  return /* @__PURE__ */ React.createElement("div", { style: { width: size, height: size, flexShrink: 0, ...style } }, /* @__PURE__ */ React.createElement(
    MultiImgMark,
    {
      sources,
      size,
      rounded: true,
      bg: "#fff",
      fallback: /* @__PURE__ */ React.createElement(LetterFallback, { size, label })
    }
  ));
}
Object.assign(window, { ChainLogo, ProtocolLogo, AssetLogo });
})();
