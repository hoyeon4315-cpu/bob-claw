export const MEMPOOL_API_BASE = "https://mempool.space/api";
export const DEFAULT_BTC_TX_VBYTES = 180;

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
