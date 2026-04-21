function observedAtOf(item) {
  return new Date(item?.observedAt || 0).getTime();
}

function latestRecord(records, predicate = () => true) {
  let best = null;
  for (const record of records || []) {
    if (!predicate(record)) continue;
    if (!best || observedAtOf(record) > observedAtOf(best)) {
      best = record;
    }
  }
  return best;
}

function latestByChain(records, chainOf, predicate = () => true) {
  const latest = new Map();
  for (const record of records || []) {
    if (!predicate(record)) continue;
    const chain = String(chainOf(record) || "").trim().toLowerCase();
    if (!chain) continue;
    const existing = latest.get(chain);
    if (!existing || observedAtOf(record) > observedAtOf(existing)) {
      latest.set(chain, record);
    }
  }
  return latest;
}

function normalizeAddress(value) {
  const text = String(value || "").trim();
  return text ? text.toLowerCase() : null;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function usdToWei(targetUsd, nativeUsd) {
  if (!Number.isFinite(targetUsd) || !(targetUsd > 0)) return null;
  if (!Number.isFinite(nativeUsd) || !(nativeUsd > 0)) return null;
  const wei = Math.ceil((targetUsd / nativeUsd) * 1e18);
  return wei > 0 ? String(BigInt(wei)) : null;
}

function resolveOperatorAddress({ treasuryInventory = [], walletReadiness = [] } = {}) {
  const inventory = latestRecord(treasuryInventory, (record) => normalizeAddress(record?.address));
  if (inventory) return normalizeAddress(inventory.address);
  const readiness = latestRecord(walletReadiness, (record) => normalizeAddress(record?.address));
  return readiness ? normalizeAddress(readiness.address) : null;
}

function selectLatestInventoryRecord(treasuryInventory, address) {
  return latestRecord(
    treasuryInventory,
    (record) => !address || normalizeAddress(record?.address) === address,
  );
}

export function buildObservedGasFloats({
  strategyCaps = null,
  gasSnapshots = [],
  walletReadiness = [],
  treasuryInventory = [],
} = {}) {
  const gasFloatConfig = strategyCaps?.gasFloat || {};
  const operatorAddress = resolveOperatorAddress({ treasuryInventory, walletReadiness });
  const inventoryRecord = selectLatestInventoryRecord(treasuryInventory, operatorAddress);
  const readinessByChain = latestByChain(
    walletReadiness,
    (record) => record?.srcChain,
    (record) => !operatorAddress || normalizeAddress(record?.address) === operatorAddress,
  );
  const gasSnapshotByChain = latestByChain(gasSnapshots, (record) => record?.chain);
  const inventoryNativeByChain = new Map(
    ((inventoryRecord?.native || [])).map((entry) => [String(entry?.chain || "").trim().toLowerCase(), entry]),
  );

  const gasFloats = {};
  const chains = [];

  for (const [chainName, gasFloat] of Object.entries(gasFloatConfig)) {
    const chain = String(chainName || "").trim().toLowerCase();
    if (!chain) continue;

    const inventoryNative = inventoryNativeByChain.get(chain) || null;
    const readiness = readinessByChain.get(chain) || null;
    const gasSnapshot = gasSnapshotByChain.get(chain) || null;

    const actualWei =
      inventoryNative?.actual != null
        ? String(inventoryNative.actual)
        : readiness?.native?.balanceWei != null
          ? String(readiness.native.balanceWei)
          : null;
    const actualSource = inventoryNative?.actual != null
      ? "treasury_inventory"
      : readiness?.native?.balanceWei != null
        ? "wallet_readiness"
        : null;

    const targetUsd = finiteNumber(gasFloat?.targetUsd);
    const nativeUsd =
      finiteNumber(gasSnapshot?.nativeUsd) ??
      finiteNumber(inventoryNative?.priceUsd) ??
      null;
    const targetWeiFromUsd = usdToWei(targetUsd, nativeUsd);
    const targetWei =
      targetWeiFromUsd ??
      (inventoryNative?.targetBalance != null ? String(inventoryNative.targetBalance) : null);
    const targetSource =
      targetWeiFromUsd != null
        ? "strategy_caps_usd"
        : inventoryNative?.targetBalance != null
          ? "treasury_inventory_target"
          : null;

    const entry = {
      chain,
      actualWei,
      actualSource,
      targetWei,
      targetSource,
      targetUsd,
      nativeUsd,
      observedAt: inventoryNative?.observedAt || readiness?.observedAt || gasSnapshot?.observedAt || inventoryRecord?.observedAt || null,
      snapshotObservedAt: gasSnapshot?.observedAt || null,
      inventoryObservedAt: inventoryRecord?.observedAt || null,
      missingReason:
        !actualWei
          ? "actual_balance_unobserved"
          : !targetWei
            ? "target_balance_unresolved"
            : null,
    };
    chains.push(entry);
    if (actualWei != null && targetWei != null) {
      gasFloats[chain] = Object.freeze({
        actualWei,
        targetWei,
      });
    }
  }

  return Object.freeze({
    operatorAddress,
    gasFloats: Object.freeze(gasFloats),
    summary: Object.freeze({
      configuredChainCount: Object.keys(gasFloatConfig).length,
      observedChainCount: Object.keys(gasFloats).length,
      chains: Object.freeze(chains.map((entry) => Object.freeze(entry))),
    }),
  });
}
