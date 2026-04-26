function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function zerionBasicAuthHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey || ""}:`).toString("base64")}`;
}

export function parseZerionWalletPortfolioResponse(payload = {}, { observedAt = new Date().toISOString() } = {}) {
  const attributes = payload?.data?.attributes || {};
  const byType = attributes.positions_distribution_by_type || {};
  const byChain = attributes.positions_distribution_by_chain || {};
  return {
    provider: "zerion",
    observedAt,
    walletUsd: finiteNumber(byType.wallet),
    totalPortfolioUsd: finiteNumber(attributes?.total?.positions),
    chainTotals: Object.entries(byChain)
      .map(([chain, usd]) => ({
        chain,
        usd: finiteNumber(usd),
      }))
      .filter((item) => Number.isFinite(item.usd)),
    change1dAbsoluteUsd: finiteNumber(attributes?.changes?.absolute_1d),
    change1dPct: finiteNumber(attributes?.changes?.percent_1d),
  };
}

export async function readZerionWalletPortfolio({
  address,
  apiKey,
  apiBase = "https://api.zerion.io/v1",
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  if (!apiKey) return null;
  const response = await fetchImpl(`${apiBase.replace(/\/$/u, "")}/wallets/${address}/portfolio`, {
    headers: {
      accept: "application/json",
      authorization: zerionBasicAuthHeader(apiKey),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Zerion wallet portfolio request failed: ${response.status}`);
  }
  const body = await response.json();
  return parseZerionWalletPortfolioResponse(body);
}

function normalizedProviderName(value) {
  return String(value || "").trim().toLowerCase();
}

export function configuredAddressScanProviders(options = {}) {
  return (options.providers || [])
    .map(normalizedProviderName)
    .filter((provider) => provider && provider !== "none" && provider !== "disabled");
}

export function resolveAddressScanPortfolioReader(
  options = {},
  {
    zerionReader = readZerionWalletPortfolio,
  } = {},
) {
  const providers = configuredAddressScanProviders(options);
  if (!providers.length) return null;
  const readers = [];

  for (const provider of providers) {
    if (provider === "zerion") {
      if (!options.zerionApiKey) continue;
      readers.push(async ({ address, fetchImpl }) =>
        zerionReader({
          address,
          apiKey: options.zerionApiKey,
          apiBase: options.zerionApiBase,
          fetchImpl,
        }),
      );
      continue;
    }
  }

  if (!readers.length) return null;

  return async ({ address, fetchImpl }) => {
    let lastError = null;
    for (const reader of readers) {
      try {
        const portfolio = await reader({ address, fetchImpl });
        if (portfolio) return portfolio;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return null;
  };
}
