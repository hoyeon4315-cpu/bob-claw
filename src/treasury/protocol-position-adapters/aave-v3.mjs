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

async function readTokenBalance({ readContract, chain, address, walletAddress }) {
  if (!address) return 0n;
  return BigInt(
    (await readContract({
      chain,
      address,
      functionName: "balanceOf",
      args: [walletAddress],
    })) || 0,
  );
}

export async function markAaveV3Position({
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

  const aTokenAddress = requireNonEmpty(position.aTokenAddress, "aTokenAddress");
  const assetAddress = requireNonEmpty(position.assetAddress, "assetAddress");
  const assetDecimals = Number(requireNonEmpty(position.assetDecimals, "assetDecimals"));
  const assetSymbol = requireNonEmpty(position.assetSymbol, "assetSymbol");
  const chain = position.chain;

  const suppliedRaw = await readTokenBalance({
    readContract,
    chain,
    address: aTokenAddress,
    walletAddress,
  });
  const variableDebtRaw = await readTokenBalance({
    readContract,
    chain,
    address: position.variableDebtTokenAddress,
    walletAddress,
  });
  const stableDebtRaw = await readTokenBalance({
    readContract,
    chain,
    address: position.stableDebtTokenAddress,
    walletAddress,
  });
  const debtRaw = variableDebtRaw + stableDebtRaw;
  const netRaw = suppliedRaw > debtRaw ? suppliedRaw - debtRaw : 0n;
  const assetAmount = decimalAmount(netRaw, assetDecimals);
  const assetPriceUsd =
    netRaw === 0n
      ? null
      : await requiredFunction(
          priceReader,
          "priceReader",
        )({
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
      adapterId: "aave-v3",
      walletAddress,
      assetAddress,
      assetSymbol,
      assetDecimals,
      shareTokenAddress: aTokenAddress,
      shareBalance: String(suppliedRaw),
      assetBalance: String(netRaw),
      assetAmount,
      assetPriceUsd,
      valuationKind: "priced",
      valuationProvenance: "current_position_onchain",
      debtBalance: String(debtRaw),
      debtAmount: decimalAmount(debtRaw, assetDecimals),
      valueUsd: netRaw === 0n ? 0 : undefined,
      btcPriceUsd,
      markSource: "onchain_aave_token_balances",
      rpcUrl: position.rpcUrl || null,
    },
    { now: observedAt },
  );
}
