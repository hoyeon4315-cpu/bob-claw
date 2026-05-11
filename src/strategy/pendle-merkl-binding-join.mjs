const PENDLE_PROTOCOL_ID = "pendle";

function normalizeAddress(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("0x") && trimmed.length === 42 ? trimmed : null;
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

export function findPendleMarket({ markets = [], opportunity = {} } = {}) {
  if (!Array.isArray(markets) || markets.length === 0) return null;
  const poolAddress = normalizeAddress(
    opportunity.poolAddress ??
      opportunity.identifier ??
      opportunity.opportunityIdentifier ??
      opportunity.address,
  );
  const opportunityChainId = opportunity.chainId ?? chainIdFromName(opportunity.chain);
  const matches = markets.filter((market) => {
    if (!market || typeof market !== "object") return false;
    if (opportunityChainId != null && market.chainId != null && market.chainId !== opportunityChainId) return false;
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

  const yt = market.yt || {};
  const pt = market.pt || {};
  const underlying = market.underlyingAsset || market.underlying || {};
  const details = market.details || {};

  const binding = {
    instrument: "yt",
    marketAddress: normalizeAddress(market.address),
    ytTokenAddress: normalizeAddress(yt.address),
    ytTokenSymbol: yt.symbol || null,
    shareTokenAddress: normalizeAddress(pt.address),
    shareTokenSymbol: pt.symbol || null,
    assetAddress: normalizeAddress(underlying.address),
    assetSymbol: underlying.symbol || null,
    assetDecimals: Number.isFinite(underlying.decimals) ? Number(underlying.decimals) : null,
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
