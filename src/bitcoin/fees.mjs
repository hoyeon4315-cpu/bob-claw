export const MEMPOOL_API_BASE = "https://mempool.space/api";
export const DEFAULT_BTC_TX_VBYTES = 180;

function normalizeBitcoinTxHex(txHex) {
  const normalized = String(txHex || "").trim().replace(/^0x/i, "");
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error("Signed BTC transaction must be a hex string");
  }
  return normalized;
}

export class MempoolClient {
  constructor({ baseUrl = MEMPOOL_API_BASE, fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
  }

  async getRecommendedFees() {
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}/v1/fees/recommended`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.message || `mempool fee request failed with ${response.status}`);
    }
    return { body, latencyMs: Date.now() - startedAt, status: response.status };
  }

  async getAddressSummary(address) {
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}/address/${encodeURIComponent(address)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.message || `mempool address request failed with ${response.status}`);
    }
    return { body, latencyMs: Date.now() - startedAt, status: response.status, source: this.baseUrl };
  }

  async getAddressBalance(address) {
    const summary = await this.getAddressSummary(address);
    const chainStats = summary.body?.chain_stats || {};
    const mempoolStats = summary.body?.mempool_stats || {};
    const confirmedBalanceSats = Number(chainStats.funded_txo_sum || 0) - Number(chainStats.spent_txo_sum || 0);
    const mempoolBalanceSats = Number(mempoolStats.funded_txo_sum || 0) - Number(mempoolStats.spent_txo_sum || 0);
    return {
      address,
      balanceSats: confirmedBalanceSats + mempoolBalanceSats,
      confirmedBalanceSats,
      mempoolBalanceSats,
      latencyMs: summary.latencyMs,
      status: summary.status,
      source: summary.source,
    };
  }

  async getAddressTransactions(address) {
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}/address/${encodeURIComponent(address)}/txs`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.message || `mempool address tx request failed with ${response.status}`);
    }
    return {
      address,
      transactions: body,
      latencyMs: Date.now() - startedAt,
      status: response.status,
      source: this.baseUrl,
    };
  }

  async getAddressUtxos(address) {
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}/address/${encodeURIComponent(address)}/utxo`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.message || `mempool address utxo request failed with ${response.status}`);
    }
    return {
      address,
      utxos: body,
      latencyMs: Date.now() - startedAt,
      status: response.status,
      source: this.baseUrl,
    };
  }

  async getTransactionHex(txid) {
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}/tx/${encodeURIComponent(txid)}/hex`, {
      headers: { accept: "text/plain" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.text()).trim();
    if (!response.ok) {
      throw new Error(body || `mempool tx hex request failed with ${response.status}`);
    }
    return {
      txid,
      txHex: body,
      latencyMs: Date.now() - startedAt,
      status: response.status,
      source: this.baseUrl,
    };
  }

  async broadcastTransaction(txHex) {
    const normalizedTxHex = normalizeBitcoinTxHex(txHex);
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}/tx`, {
      method: "POST",
      headers: {
        accept: "text/plain",
        "content-type": "text/plain",
      },
      body: normalizedTxHex,
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.text()).trim();
    if (!response.ok) {
      throw new Error(body || `mempool tx broadcast failed with ${response.status}`);
    }
    if (!/^[0-9a-fA-F]{64}$/.test(body)) {
      throw new Error("mempool tx broadcast returned invalid tx hash");
    }
    return {
      body,
      latencyMs: Date.now() - startedAt,
      signedTxBytes: normalizedTxHex.length / 2,
      source: this.baseUrl,
      status: response.status,
      txHash: body,
    };
  }
}

export function bitcoinFeeSats({ feeRateSatVb, vbytes = DEFAULT_BTC_TX_VBYTES }) {
  if (!Number.isFinite(feeRateSatVb) || !Number.isFinite(vbytes)) return null;
  return Math.ceil(feeRateSatVb * vbytes);
}

export function bitcoinFeeUsd({ feeRateSatVb, vbytes = DEFAULT_BTC_TX_VBYTES, btcUsd }) {
  const sats = bitcoinFeeSats({ feeRateSatVb, vbytes });
  if (!Number.isFinite(sats) || !Number.isFinite(btcUsd)) return null;
  return (sats / 1e8) * btcUsd;
}

export function buildBitcoinFeeSnapshot({ fees, btcUsd, latencyMs, source = MEMPOOL_API_BASE, vbytes = DEFAULT_BTC_TX_VBYTES }) {
  const rate = Number(fees.halfHourFee ?? fees.fastestFee ?? fees.hourFee);
  return {
    observedAt: new Date().toISOString(),
    source,
    btcUsd,
    vbytes,
    fastestFeeSatVb: fees.fastestFee ?? null,
    halfHourFeeSatVb: fees.halfHourFee ?? null,
    hourFeeSatVb: fees.hourFee ?? null,
    economyFeeSatVb: fees.economyFee ?? null,
    minimumFeeSatVb: fees.minimumFee ?? null,
    selectedFeeRateSatVb: rate,
    estimatedFeeSats: bitcoinFeeSats({ feeRateSatVb: rate, vbytes }),
    estimatedFeeUsd: bitcoinFeeUsd({ feeRateSatVb: rate, vbytes, btcUsd }),
    latencyMs,
    model: "estimated_single_input_single_output",
  };
}
