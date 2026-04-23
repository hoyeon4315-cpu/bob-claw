import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeMerklOpportunity } from "../src/strategy/merkl-opportunity-normalizer.mjs";

test("merkl normalizer extracts Morpho ERC-4626 vault binding from raw opportunity", () => {
  const item = normalizeMerklOpportunity({
    id: "13599851929364274522",
    chainId: 1,
    chain: { name: "Ethereum" },
    protocol: { id: "morpho", name: "Morpho" },
    type: "ERC20LOGPROCESSOR",
    action: "LEND",
    name: "Supply to Alpha USDC Forex V2 vault on Morpho on Ethereum",
    description: "Earn rewards by supplying to the Alpha USDC Forex V2 vault on Morpho on Ethereum",
    status: "LIVE",
    liveCampaigns: 2,
    explorerAddress: "0x153Bd1abE60104Bd46aa05a27fA12D1346D64A57",
    depositUrl: "https://app.morpho.org/ethereum/vault/0x153Bd1abE60104Bd46aa05a27fA12D1346D64A57",
    latestCampaignEnd: "1777568400",
    tokens: [
      {
        displaySymbol: "alphaForexV2",
        address: "0x153Bd1abE60104Bd46aa05a27fA12D1346D64A57",
        decimals: 18,
        verified: false,
        type: "TOKEN",
      },
      {
        displaySymbol: "USDC",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        decimals: 6,
        verified: true,
        type: "TOKEN",
      },
    ],
  }, { now: "2026-04-23T13:11:00.000Z" });

  assert.equal(item.chain, "ethereum");
  assert.equal(item.protocolBinding.vaultAddress, "0x153Bd1abE60104Bd46aa05a27fA12D1346D64A57");
  assert.equal(item.protocolBinding.assetAddress, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  assert.equal(item.protocolBinding.assetSymbol, "USDC");
  assert.equal(item.protocolBinding.shareTokenSymbol, "alphaForexV2");
});

test("merkl normalizer keeps Aave pool binding explicit while extracting asset and aToken", () => {
  const item = normalizeMerklOpportunity({
    id: "2052473411633500913",
    chainId: 1,
    chain: { name: "Ethereum" },
    protocol: { id: "aave", name: "Aave" },
    type: "MULTILOG_DUTCH",
    action: "LEND",
    name: "Lend RLUSD on Aave Horizon",
    status: "LIVE",
    liveCampaigns: 1,
    explorerAddress: "0xE3190143Eb552456F88464662f0c0C4aC67A77eB",
    tokens: [
      {
        displaySymbol: "aHorRwaRLUSD",
        address: "0xE3190143Eb552456F88464662f0c0C4aC67A77eB",
        decimals: 18,
        verified: true,
      },
      {
        displaySymbol: "RLUSD",
        address: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
        decimals: 18,
        verified: true,
      },
    ],
  }, { now: "2026-04-23T13:11:00.000Z" });

  assert.equal(item.protocolBinding.assetAddress, "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD");
  assert.equal(item.protocolBinding.aTokenAddress, "0xE3190143Eb552456F88464662f0c0C4aC67A77eB");
  assert.equal(item.protocolBinding.marketName, null);
  assert.equal(item.protocolBinding.poolAddressProviderAddress, null);

  const mainnetItem = normalizeMerklOpportunity({
    id: "10132453683713477765",
    chainId: 1,
    chain: { name: "Ethereum" },
    protocol: { id: "aave", name: "Aave" },
    type: "AAVE_SUPPLY",
    action: "LEND",
    name: "Lend rsETH on Aave",
    status: "LIVE",
    liveCampaigns: 1,
    explorerAddress: "0x2D62109243b87C4bA3EE7bA1D91B0dD0A074d7b1",
    depositUrl: "https://app.aave.com/reserve-overview/?underlyingAsset=0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7&marketName=proto_mainnet_v3",
    tokens: [
      {
        displaySymbol: "aEthrsETH",
        address: "0x2D62109243b87C4bA3EE7bA1D91B0dD0A074d7b1",
        decimals: 18,
        verified: true,
      },
      {
        displaySymbol: "rsETH",
        address: "0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7",
        decimals: 18,
        verified: true,
      },
    ],
  }, { now: "2026-04-23T13:11:00.000Z" });

  assert.equal(mainnetItem.protocolBinding.marketName, "proto_mainnet_v3");
  assert.equal(mainnetItem.protocolBinding.poolAddressProviderAddress, "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e");
  assert.equal(mainnetItem.protocolBinding.poolAddress, "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2");
});
