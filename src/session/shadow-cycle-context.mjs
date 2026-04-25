import { readJsonl } from "../lib/jsonl-read.mjs";

function normalizedAddress(value) {
  return String(value || "").toLowerCase();
}

function sameAddress(left, right) {
  return normalizedAddress(left) !== "" && normalizedAddress(left) === normalizedAddress(right);
}

function latest(items = []) {
  return [...items].sort((left, right) => new Date(right.observedAt || 0) - new Date(left.observedAt || 0))[0] || null;
}

function estimatedWalletUsdFromInventory(inventory) {
  return [...(inventory?.native || []), ...(inventory?.tokens || [])]
    .map((item) => item.estimatedUsd)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
}

export function buildInventoryConsistencyAudit({ inventory = null, expectedAddress = null, source = null } = {}) {
  const recomputedEstimatedWalletUsd = inventory ? estimatedWalletUsdFromInventory(inventory) : null;
  const summaryEstimatedWalletUsd = inventory?.summary?.estimatedWalletUsd ?? null;
  const differenceUsd =
    Number.isFinite(summaryEstimatedWalletUsd) && Number.isFinite(recomputedEstimatedWalletUsd)
      ? summaryEstimatedWalletUsd - recomputedEstimatedWalletUsd
      : null;
  const issues = [];

  if (!inventory) {
    issues.push("inventory_snapshot_missing");
  } else {
    if (expectedAddress && inventory.address && !sameAddress(expectedAddress, inventory.address)) {
      issues.push("inventory_snapshot_address_mismatch");
    }
    if (Number.isFinite(differenceUsd) && Math.abs(differenceUsd) > 1e-9) {
      issues.push("inventory_summary_value_mismatch");
    }
  }

  return {
    source,
    observedAt: inventory?.observedAt || null,
    address: inventory?.address || null,
    expectedAddress,
    consistent: issues.length === 0,
    issues,
    summaryEstimatedWalletUsd,
    recomputedEstimatedWalletUsd,
    differenceUsd,
  };
}

export function buildShadowCycleAddressAudit({
  explicitAddress = null,
  configuredAddress = null,
  resolvedAddress = null,
  addressSource = null,
  latestInventoryAddress = null,
  latestReadinessAddress = null,
  latestFailureAddress = null,
} = {}) {
  const issues = [];

  if (configuredAddress && resolvedAddress && !sameAddress(configuredAddress, resolvedAddress)) {
    issues.push("configured_address_stale_vs_resolved_cycle_address");
  }
  if (explicitAddress && latestInventoryAddress && !sameAddress(explicitAddress, latestInventoryAddress)) {
    issues.push("explicit_address_differs_from_latest_inventory");
  }
  if (latestInventoryAddress && latestReadinessAddress && !sameAddress(latestInventoryAddress, latestReadinessAddress)) {
    issues.push("latest_inventory_and_wallet_readiness_addresses_differ");
  }
  if (resolvedAddress && latestInventoryAddress && !sameAddress(resolvedAddress, latestInventoryAddress)) {
    issues.push("resolved_address_differs_from_latest_inventory");
  }
  if (resolvedAddress && latestReadinessAddress && !sameAddress(resolvedAddress, latestReadinessAddress)) {
    issues.push("resolved_address_differs_from_latest_wallet_readiness");
  }

  return {
    explicitAddress,
    configuredAddress,
    resolvedAddress,
    addressSource,
    consistent: issues.length === 0,
    issues,
    latestInventoryAddress,
    latestReadinessAddress,
    latestFailureAddress,
  };
}

export async function resolveShadowCycleContext({
  dataDir,
  explicitAddress = null,
  configuredAddress = null,
  readJsonlImpl = readJsonl,
} = {}) {
  const [inventoryRecords, readinessRecords, readinessFailures] = await Promise.all([
    readJsonlImpl(dataDir, "treasury-inventory"),
    readJsonlImpl(dataDir, "estimator-wallet-readiness"),
    readJsonlImpl(dataDir, "estimator-wallet-readiness-failures"),
  ]);

  const latestInventory = latest(inventoryRecords);
  const latestReadiness = latest(readinessRecords);
  const latestFailure = latest(readinessFailures);

  const address =
    explicitAddress ||
    latestInventory?.address ||
    latestReadiness?.address ||
    latestFailure?.address ||
    configuredAddress ||
    null;

  const addressSource = explicitAddress
    ? "explicit_argument"
    : latestInventory?.address
      ? "latest_treasury_inventory"
      : latestReadiness?.address
        ? "latest_wallet_readiness"
        : latestFailure?.address
          ? "latest_wallet_readiness_failure"
          : "configured_default";

  const inventorySnapshot = latest(inventoryRecords.filter((item) => sameAddress(item.address, address)));
  const addressAudit = buildShadowCycleAddressAudit({
    explicitAddress,
    configuredAddress,
    resolvedAddress: address,
    addressSource,
    latestInventoryAddress: latestInventory?.address || null,
    latestReadinessAddress: latestReadiness?.address || null,
    latestFailureAddress: latestFailure?.address || null,
  });

  return {
    address,
    addressSource,
    addressAudit,
    inventorySnapshot,
    inventoryAudit: buildInventoryConsistencyAudit({
      inventory: inventorySnapshot,
      expectedAddress: address,
      source: inventorySnapshot ? "stored_snapshot" : null,
    }),
  };
}
