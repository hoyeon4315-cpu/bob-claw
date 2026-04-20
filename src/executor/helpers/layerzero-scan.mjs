function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDvnList(dvns = {}, predicate = () => true) {
  return Object.entries(dvns)
    .filter(([, item]) => predicate(item || {}))
    .map(([address, item]) => ({
      address,
      status: item?.status || null,
      optional: item?.optional ?? null,
    }));
}

export async function readLayerZeroMessageStatusByTxHash(txHash, { fetchImpl = fetch } = {}) {
  if (!txHash) return null;
  const response = await fetchImpl(`https://scan.layerzero-api.com/v1/messages/tx/${txHash}`);
  if (!response.ok) {
    throw new Error(`LayerZero scan request failed: ${response.status}`);
  }
  const body = await response.json();
  const message = asArray(body?.data)[0] || null;
  if (!message) return null;

  const dvns = message?.verification?.dvn?.dvns || {};
  return {
    guid: message?.guid || null,
    status: message?.status?.name || null,
    message: message?.status?.message || null,
    sourceStatus: message?.source?.status || null,
    destinationStatus: message?.destination?.status || null,
    verificationStatus: message?.verification?.dvn?.status || null,
    sealerStatus: message?.verification?.sealer?.status || null,
    pathway: {
      srcChain: message?.pathway?.sender?.chain || null,
      dstChain: message?.pathway?.receiver?.chain || null,
      nonce: message?.pathway?.nonce || null,
    },
    waitingRequiredDvns: normalizeDvnList(dvns, (item) => item?.optional === false && item?.status !== "SUCCEEDED"),
    waitingOptionalDvns: normalizeDvnList(dvns, (item) => item?.optional === true && item?.status !== "SUCCEEDED"),
    updatedAt: message?.updated || null,
    createdAt: message?.created || null,
  };
}
