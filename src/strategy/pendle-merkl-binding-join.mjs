const PENDLE_PROTOCOL_ID = "pendle";

function normalizeAddress(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("0x") && trimmed.length === 42) return trimmed;
  const m = trimmed.match(/^(\d+)-(0x[0-9a-f]{40})$/);
  return m ? m[2] : null;
}

function chainIdFromAddrField(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().toLowerCase().match(/^(\d+)-0x[0-9a-f]{40}$/);
  return m ? Number(m[1]) : null;
}

function tokenRef(value) {
  if (value && typeof value === "object") {
    return {
      address: normalizeAddress(value.address),
      symbol: value.symbol ?? null,
      decimals: Number.isFinite(value.decimals) ? Number(value.decimals) : null,
    };
  }
  return {
    address: normalizeAddress(value),
    symbol: null,
    decimals: null,
  };
}

function chainIdFromName(chain) {
  if (typeof chain === "number") return chain;
  const key = String(chain || "").trim().toLowerCase();
  const map = {
    ethereum: 1,
    base: 8453,
    bsc: 56,
    avalanche: 43114,
    arbitrum: 42161,
    optimism: 10,
    bera: 80094,
    berachain: 80094,
    sonic: 146,
    sei: 1329,
    soneium: 1868,
    unichain: 130,
    bob: 60808,
  };
  return map[key] ?? null;
}

function numericApyToPct(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value * 100;
}

function maturityMs(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function poolAddressFromDepositUrl(url) {
  if (typeof url !== "string") return null;
  const m = url.match(/\/pools\/(0x[0-9a-fA-F]{40})/);
  return m ? m[1].toLowerCase() : null;
}

export function findPendleMarket({ markets = [], opportunity = {} } = {}) {
  if (!Array.isArray(markets) || markets.length === 0) return null;
  const poolAddress = normalizeAddress(
    opportunity.poolAddress ??
      opportunity.address,
  )
    ?? poolAddressFromDepositUrl(opportunity.depositUrl)
    ?? poolAddressFromDepositUrl(opportunity.protocolBinding?.depositUrl)
    ?? normalizeAddress(opportunity.identifier ?? opportunity.opportunityIdentifier);
  const opportunityChainId = opportunity.chainId ?? chainIdFromName(opportunity.chain);
  const matches = markets.filter((market) => {
    if (!market || typeof market !== "object") return false;
    const marketChainId = market.chainId
      ?? chainIdFromAddrField(market.pt)
      ?? chainIdFromAddrField(market.yt)
      ?? chainIdFromAddrField(market.underlyingAsset);
    if (opportunityChainId != null && marketChainId != null && marketChainId !== opportunityChainId) return false;
    const marketAddress = normalizeAddress(market.address);
    if (poolAddress && marketAddress && marketAddress === poolAddress) return true;
    return false;
  });
  return matches[0] || null;
}

export function buildPendleBindingFromMarket(market, { now = Date.now(), minMaturityBufferHours = 24 } = {}) {
  if (!market || typeof market !== "object") return null;
  const expiry = market.expiry || market.maturity || null;
  const expiryMs = maturityMs(expiry);
  if (expiryMs == null) return null;
  const bufferMs = minMaturityBufferHours * 3_600_000;
  if (expiryMs - now <= bufferMs) return null;

  const yt = tokenRef(market.yt);
  const pt = tokenRef(market.pt);
  const underlying = tokenRef(market.underlyingAsset || market.underlying);
  const details = market.details || {};

  const binding = {
    instrument: "yt",
    marketAddress: normalizeAddress(market.address),
    ytTokenAddress: yt.address,
    ytTokenSymbol: yt.symbol,
    shareTokenAddress: pt.address,
    shareTokenSymbol: pt.symbol,
    assetAddress: underlying.address,
    assetSymbol: underlying.symbol,
    assetDecimals: underlying.decimals,
    maturity: new Date(expiryMs).toISOString(),
    ytExpiry: new Date(expiryMs).toISOString(),
    impliedAprPct: numericApyToPct(details.impliedApy),
    underlyingAprPct: numericApyToPct(details.underlyingApy),
    source: "pendle_markets_api",
  };

  if (!binding.marketAddress || !binding.ytTokenAddress || !binding.assetAddress) return null;
  return binding;
}

export function resolvePendleMerklBinding({ opportunity = {}, markets = [], now = Date.now() } = {}) {
  if (!opportunity || String(opportunity.protocolId || "").toLowerCase() !== PENDLE_PROTOCOL_ID) return null;
  if (opportunity.executionSurface && opportunity.executionSurface !== "fixedYield") return null;
  const market = findPendleMarket({ markets, opportunity });
  if (!market) return null;
  return buildPendleBindingFromMarket(market, { now });
}
