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

async function readExchangeRate({ readContract, chain, cTokenAddress, allowStateChangingExchangeRate }) {
  try {
    return BigInt(
      await readContract({
        chain,
        address: cTokenAddress,
        functionName: "exchangeRateStored",
        args: [],
      }),
    );
  } catch (error) {
    if (!allowStateChangingExchangeRate) throw error;
    return BigInt(
      await readContract({
        chain,
        address: cTokenAddress,
        functionName: "exchangeRateCurrent",
        args: [],
      }),
    );
  }
}

function shouldReadBorrow(position = {}) {
  return Boolean(
    position.isBorrowingLoop ||
    position.borrowMarketAddress ||
    position.borrowBalanceAddress ||
    position.borrowBalanceFunction,
  );
}

function sameAddress(left, right) {
  if (!left || !right) return false;
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function assertSameAssetBorrow(position = {}, assetAddress) {
  if (position.borrowAssetAddress && !sameAddress(position.borrowAssetAddress, assetAddress)) {
    throw new Error("cross-asset borrow metadata is unsupported for compound-v2 marks");
  }
}

function borrowMarketAddress(position = {}, cTokenAddress, assetAddress) {
  if (position.borrowMarketAddress) return position.borrowMarketAddress;
  if (position.borrowBalanceAddress) return position.borrowBalanceAddress;
  if (position.borrowTokenAddress && sameAddress(position.borrowAssetAddress, assetAddress)) {
    return position.borrowTokenAddress;
  }
  if (position.isBorrowingLoop) return cTokenAddress;
  return null;
}

async function readBorrowRaw({ readContract, chain, cTokenAddress, walletAddress, position }) {
  if (!shouldReadBorrow(position)) return 0n;
  const address = borrowMarketAddress(position, cTokenAddress, position.assetAddress);
  if (!address) return 0n;
  const functionName = position.borrowBalanceFunction || "borrowBalanceStored";
  return BigInt(
    (await readContract({
      chain,
      address,
      functionName,
      args: [walletAddress],
    })) || 0,
  );
}

function compoundExchangeRateScale(position = {}) {
  if (position.exchangeRateScale !== undefined) return BigInt(position.exchangeRateScale);
  if (position.exchangeRateDecimals !== undefined) {
    const decimals = Number(position.exchangeRateDecimals);
    if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 36) return 10n ** BigInt(decimals);
  }
  return 1_000_000_000_000_000_000n;
}

export async function markCompoundV2Position({
  position,
  walletAddress,
  contractReader,
  priceReader,
  btcPriceUsd,
  observedAt = new Date().toISOString(),
  allowStateChangingExchangeRate = false,
} = {}) {
  requireNonEmpty(position, "position");
  requireNonEmpty(walletAddress, "walletAddress");
  const readContract = requiredFunction(contractReader, "contractReader");
  const readPrice = requiredFunction(priceReader, "priceReader");

  const cTokenAddress = requireNonEmpty(position.cTokenAddress, "cTokenAddress");
  const assetAddress = requireNonEmpty(position.assetAddress, "assetAddress");
  const assetDecimals = Number(requireNonEmpty(position.assetDecimals, "assetDecimals"));
  const assetSymbol = requireNonEmpty(position.assetSymbol, "assetSymbol");
  const chain = position.chain;
  assertSameAssetBorrow(position, assetAddress);

  const cTokenBalance = BigInt(
    (await readContract({
      chain,
      address: cTokenAddress,
      functionName: "balanceOf",
      args: [walletAddress],
    })) || 0,
  );
  const exchangeRate = await readExchangeRate({
    readContract,
    chain,
    cTokenAddress,
    allowStateChangingExchangeRate,
  });
  const suppliedUnderlyingRaw = (cTokenBalance * exchangeRate) / compoundExchangeRateScale(position);
  const borrowRaw = await readBorrowRaw({
    readContract,
    chain,
    cTokenAddress,
    walletAddress,
    position,
  });
  const netRaw = suppliedUnderlyingRaw > borrowRaw ? suppliedUnderlyingRaw - borrowRaw : 0n;
  const assetAmount = decimalAmount(netRaw, assetDecimals);
  const assetPriceUsd =
    netRaw === 0n
      ? null
      : await readPrice({
          chain,
          token: assetAddress,
          symbol: assetSymbol,
        });

  return normalizeProtocolPositionMark(
    {
      event: "position_marked",
      observedAt,
      positionId: position.positionId,
      opportunityId: position.opportunityId,
      strategyId: position.strategyId,
      chain,
      protocolId: position.protocolId,
      bindingKind: position.bindingKind,
      adapterId: "compound-v2",
      walletAddress,
      assetAddress,
      assetSymbol,
      assetDecimals,
      shareTokenAddress: cTokenAddress,
      shareBalance: String(cTokenBalance),
      assetBalance: String(netRaw),
      assetAmount,
      assetPriceUsd,
      valuationKind: "priced",
      valuationProvenance: "current_position_onchain",
      debtBalance: String(borrowRaw),
      debtAmount: decimalAmount(borrowRaw, assetDecimals),
      valueUsd: netRaw === 0n ? 0 : undefined,
      btcPriceUsd,
      markSource: "onchain_compound_exchange_rate",
      rpcUrl: position.rpcUrl || null,
    },
    { now: observedAt },
  );
}
