export function featureEnabled(profile = {}) {
  if (profile.nonceMonitor === false) return false;
  if (profile.nonceMonitor && profile.nonceMonitor.enabled === false) return false;
  return true;
}

export function detectNonceGap({ onChainNonce, pendingNonces, profile }) {
  if (!featureEnabled(profile)) {
    return { gaps: [], needsRepair: false };
  }

  const sorted = [...pendingNonces].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { gaps: [], needsRepair: false };
  }

  const gaps = [];
  const maxNonce = sorted[sorted.length - 1];
  const expectedSet = new Set(sorted);

  for (let n = onChainNonce; n < maxNonce; n++) {
    if (!expectedSet.has(n)) {
      gaps.push(n);
    }
  }

  return { gaps, needsRepair: gaps.length > 0 };
}

export function buildRbfTransaction({ originalTx, newGasPrice }) {
  const tx = { ...originalTx };
  if (tx.maxFeePerGas !== undefined) {
    tx.maxFeePerGas = newGasPrice;
  } else {
    tx.gasPrice = newGasPrice;
  }
  return tx;
}

export function buildEmptySelfTx({ from, nonce, gasPrice, maxFeePerGas, maxPriorityFeePerGas, chainId }) {
  const tx = {
    to: from,
    from,
    value: 0n,
    data: "0x",
    gasLimit: 21000n,
    nonce,
    chainId,
  };

  if (maxFeePerGas !== undefined) {
    tx.maxFeePerGas = maxFeePerGas;
    tx.maxPriorityFeePerGas = maxPriorityFeePerGas ?? 0n;
  } else {
    tx.gasPrice = gasPrice;
  }

  return tx;
}
