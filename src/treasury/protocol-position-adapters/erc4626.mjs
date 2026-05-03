import { normalizeProtocolPositionMark } from "../protocol-position-mark-schema.mjs";

function requiredFunction(value, label) {
  if (typeof value !== "function") throw new Error(`${label} is required`);
  return value;
}

function requireNonEmpty(value, label) {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function decimalAmount(raw, decimals) {
  const parsedDecimals = Number(decimals);
  if (!Number.isInteger(parsedDecimals) || parsedDecimals < 0 || parsedDecimals > 36) return null;
  const rawBigInt = BigInt(raw || 0);
  const sign = rawBigInt < 0n ? "-" : "";
  const digits = (rawBigInt < 0n ? -rawBigInt : rawBigInt).toString();
  if (parsedDecimals === 0) return Number(`${sign}${digits}`);

  const padded = digits.padStart(parsedDecimals + 1, "0");
  const whole = padded.slice(0, -parsedDecimals);
  const fraction = padded.slice(-parsedDecimals).replace(/0+$/u, "");
  return Number(`${sign}${whole}${fraction ? `.${fraction}` : ""}`);
}

export async function markErc4626Position({
  position,
  walletAddress,
  contractReader,
  priceReader,
  btcPriceUsd,
  observedAt = new Date().toISOString(),
} = {}) {
  requireNonEmpty(position, "position");
  requireNonEmpty(walletAddress, "walletAddress");
  const readContract = requiredFunction(contractReader, "contractReader");
  const readPrice = requiredFunction(priceReader, "priceReader");

  const shareTokenAddress = requireNonEmpty(
    position.shareTokenAddress || position.vaultAddress,
    "shareTokenAddress or vaultAddress",
  );
  const chain = position.chain;

  const shareBalance = BigInt(await readContract({
    chain,
    address: shareTokenAddress,
    functionName: "balanceOf",
    args: [walletAddress],
  }) || 0);

  const assetAddress = position.assetAddress || await readContract({
    chain,
    address: shareTokenAddress,
    functionName: "asset",
    args: [],
  });

  const assetDecimals = Number(position.assetDecimals ?? await readContract({
    chain,
    address: assetAddress,
    functionName: "decimals",
    args: [],
  }));

  const assetSymbol = position.assetSymbol || await readContract({
    chain,
    address: assetAddress,
    functionName: "symbol",
    args: [],
  });

  const assetBalance = shareBalance === 0n
    ? 0n
    : BigInt(await readContract({
      chain,
      address: shareTokenAddress,
      functionName: "convertToAssets",
      args: [shareBalance],
    }));

  const assetAmount = decimalAmount(assetBalance, assetDecimals);
  const assetPriceUsd = await readPrice({
    chain,
    token: assetAddress,
    symbol: assetSymbol,
  });
  const valueUsd = assetBalance === 0n ? 0 : undefined;

  return normalizeProtocolPositionMark({
    event: "position_marked",
    observedAt,
    positionId: position.positionId,
    opportunityId: position.opportunityId,
    strategyId: position.strategyId,
    chain,
    protocolId: position.protocolId,
    bindingKind: position.bindingKind,
    adapterId: "erc4626",
    walletAddress,
    assetAddress,
    assetSymbol,
    assetDecimals,
    shareTokenAddress,
    shareBalance: String(shareBalance),
    assetBalance: String(assetBalance),
    assetAmount,
    assetPriceUsd,
    ...(valueUsd === undefined ? {} : { valueUsd }),
    btcPriceUsd,
    markSource: "onchain_erc4626_convert_to_assets",
    rpcUrl: position.rpcUrl || null,
  }, { now: observedAt });
}
