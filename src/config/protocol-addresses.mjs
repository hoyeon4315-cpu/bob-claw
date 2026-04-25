/** Central protocol contract address registry.
 *
 *  Sources:
 *    - Moonwell Base: https://docs.moonwell.fi/moonwell/protocol-information/contracts
 *    - Beefy: https://app.beefy.com/ (per-vault)
 *    - Pendle: https://docs.pendle.finance/Developers/Contracts/ContractAddresses
 *    - Aerodrome: https://aerodrome.finance/ + Aerodrome docs
 *    - GMX V2: https://docs.gmx.io/docs/api/contracts/v2/
 *    - Berachain Bend: https://docs.benddao.xyz/ (Berachain deployment)
 *
 *  All addresses must be verified on-chain before live execution.
 *  Placeholder addresses are prefixed with 0xDEAD and marked `verified: false`.
 */

const MOONWELL_BASE = Object.freeze({
  chain: "base",
  comptroller: "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C",
  markets: Object.freeze({
    cbBTC: Object.freeze({
      asset: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      mToken: "0xF877ACaFA28c19b96727966690b2f44d35aD5976",
      decimals: 8,
    }),
    USDC: Object.freeze({
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      mToken: "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
      decimals: 6,
    }),
  }),
  odosRouter: "0x19cEeAdf19cE33CcB5cE224E3c5eE39BAa739a67",
});

const BEEFY_BASE = Object.freeze({
  chain: "base",
  // Morpho Seamless cbBTC vault (Beefy wrapper)
  // Source: https://app.beefy.com/vault/morpho-seamless-cbbtc
  // Verified on Base mainnet 2025-04-24
  vault: Object.freeze({
    address: "0x0887463E77194e94F68C2670026F44F14055da10",
    verified: true,
    asset: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals: 18,
    vaultId: "morpho-seamless-cbbtc",
    underlyingProtocol: "morpho",
  }),
});

const PENDLE_BASE = Object.freeze({
  chain: "base",
  // TODO: verify Pendle PT LBTC pool/router addresses
  router: Object.freeze({
    address: "0xDEAD0000000000000000000000000000000000PT",
    verified: false,
  }),
  ptMarket: Object.freeze({
    address: "0xDEAD0000000000000000000000000000000000PT",
    verified: false,
    ptToken: "0xDEAD0000000000000000000000000000000000PT",
    underlying: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  }),
});

const AERODROME_BASE = Object.freeze({
  chain: "base",
  // TODO: verify Aerodrome CLAMM factory/router/pool addresses
  factory: Object.freeze({
    address: "0xDEAD0000000000000000000000000000000000Aero",
    verified: false,
  }),
  router: Object.freeze({
    address: "0xDEAD0000000000000000000000000000000000Aero",
    verified: false,
  }),
  pool: Object.freeze({
    address: "0xDEAD0000000000000000000000000000000000Aero",
    verified: false,
    token0: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    token1: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  }),
});

const GMX_AVAX = Object.freeze({
  chain: "avalanche",
  // TODO: verify GMX V2 perp vault/router addresses on Avalanche
  exchangeRouter: Object.freeze({
    address: "0xDEAD0000000000000000000000000000000000GMX",
    verified: false,
  }),
  dataStore: Object.freeze({
    address: "0xDEAD0000000000000000000000000000000000GMX",
    verified: false,
  }),
});

const BEND_BERA = Object.freeze({
  chain: "bera",
  // TODO: verify BendDAO/BEX addresses on Berachain
  bendPool: Object.freeze({
    address: "0xDEAD0000000000000000000000000000000000Bend",
    verified: false,
  }),
  bexRouter: Object.freeze({
    address: "0xDEAD0000000000000000000000000000000000Bex",
    verified: false,
  }),
});

export const PROTOCOL_ADDRESSES = Object.freeze({
  moonwell: Object.freeze({ base: MOONWELL_BASE }),
  beefy: Object.freeze({ base: BEEFY_BASE }),
  pendle: Object.freeze({ base: PENDLE_BASE }),
  aerodrome: Object.freeze({ base: AERODROME_BASE }),
  gmx: Object.freeze({ avalanche: GMX_AVAX }),
  bend: Object.freeze({ bera: BEND_BERA }),
});

export function getProtocolAddress(protocol, chain, key = null) {
  const proto = PROTOCOL_ADDRESSES[protocol];
  if (!proto) return null;
  const entry = proto[chain];
  if (!entry) return null;
  if (!key) return entry;
  const parts = key.split(".");
  let cur = entry;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur ?? null;
}
