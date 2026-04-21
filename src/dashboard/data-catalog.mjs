// Mirror of dashboard/public/data.jsx STRATEGY_CATALOG and CHAINS for use by
// the visual-regression test (T26). The browser bundle is Babel-in-browser
// with no module resolver, so data.jsx cannot import this module directly.
// test/dashboard-visual-regression.test.mjs verifies the two catalogs stay
// in sync by reading data.jsx and asserting every id below is present in it.

export const CHAINS = Object.freeze([
  { id: "bitcoin",   name: "Bitcoin",   role: "source"      },
  { id: "bob",       name: "BOB",       role: "destination" },
  { id: "base",      name: "Base",      role: "destination" },
  { id: "ethereum",  name: "Ethereum",  role: "destination" },
  { id: "bsc",       name: "BNB",       role: "destination" },
  { id: "avalanche", name: "Avalanche", role: "destination" },
  { id: "unichain",  name: "Unichain",  role: "destination" },
  { id: "bera",      name: "Berachain", role: "destination" },
  { id: "optimism",  name: "Optimism",  role: "destination" },
  { id: "soneium",   name: "Soneium",   role: "destination" },
  { id: "sei",       name: "Sei",       role: "destination" },
  { id: "sonic",     name: "Sonic",     role: "destination" },
]);

export const STRATEGY_CATALOG_IDS = Object.freeze([
  "wrapped-btc-loop-base-moonwell",
  "recursive_wrapped_btc_lending_loop",
  "gateway-btc-onramp",
  "gateway-btc-offramp",
  "gateway-btc-funding-transfer",
  "proxy-spread-experiment",
  "token-dex-experiment",
  "native-dex-experiment",
  "gas-zip-native-refuel",
  "wrapper-btc-arbitrage",
]);

export const STRATEGY_CATALOG_PROTOCOLS = Object.freeze([
  { id: "wrapped-btc-loop-base-moonwell",      chain: "base",      protocol: "moonwell" },
  { id: "recursive_wrapped_btc_lending_loop",  chain: "base",      protocol: "moonwell" },
  { id: "gateway-btc-onramp",                  chain: "base",      protocol: "gateway"  },
  { id: "gateway-btc-offramp",                 chain: "bob",       protocol: "gateway"  },
  { id: "gateway-btc-funding-transfer",        chain: "bob",       protocol: "gateway"  },
  { id: "proxy-spread-experiment",             chain: "ethereum",  protocol: "odos"     },
  { id: "token-dex-experiment",                chain: "bsc",       protocol: "odos"     },
  { id: "native-dex-experiment",               chain: "unichain",  protocol: "odos"     },
  { id: "gas-zip-native-refuel",               chain: "avalanche", protocol: "gaszip"   },
  { id: "wrapper-btc-arbitrage",               chain: "bob",       protocol: "gateway"  },
]);
