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

test("merkl normalizer extracts YO vault binding from raw opportunity", () => {
  const item = normalizeMerklOpportunity({
    id: "13747891056392346282",
    chainId: 8453,
    chain: { name: "Base" },
    protocol: { id: "yo", name: "yo" },
    type: "ERC20LOGPROCESSOR",
    action: "HOLD",
    name: "Deposit USDC to YO",
    description: "Earn rewards by depositing USDC to YO on Base",
    status: "LIVE",
    liveCampaigns: 1,
    explorerAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
    depositUrl: "https://app.yo.xyz/vault/base/0x0000000f2eB9f69274678c76222B35eEc7588a65",
    tokens: [
      {
        displaySymbol: "USDC",
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
        verified: true,
        type: "TOKEN",
      },
    ],
  }, { now: "2026-04-23T13:11:00.000Z" });

  assert.equal(item.chain, "base");
  assert.equal(item.protocolBinding.vaultAddress, "0x0000000f2eB9f69274678c76222B35eEc7588a65");
  assert.equal(item.protocolBinding.assetAddress, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(item.protocolBinding.shareTokenAddress, "0x0000000f2eB9f69274678c76222B35eEc7588a65");
  assert.equal(item.protocolBinding.assetSymbol, "USDC");
});

test("merkl normalizer extracts Summer Finance vault binding from raw opportunity", () => {
  const item = normalizeMerklOpportunity({
    id: "7759132104627022749",
    chainId: 1,
    chain: { name: "Ethereum" },
    protocol: { id: "summerfinance", name: "Summer Finance" },
    type: "ERC20LOGPROCESSOR",
    action: "LEND",
    name: "Deposit wETH on Summer Finance (lower risk)",
    description: "Earn rewards by depositing wETH on Summer Finance",
    status: "LIVE",
    liveCampaigns: 1,
    explorerAddress: "0x67e536797570b3d8919Df052484273815A0aB506",
    depositUrl: "https://summer.fi/earn/mainnet/position/0x67e536797570b3d8919df052484273815a0ab506",
    tokens: [
      {
        displaySymbol: "LVWETH",
        address: "0x67e536797570b3d8919Df052484273815A0aB506",
        decimals: 18,
        verified: false,
        type: "TOKEN",
      },
      {
        displaySymbol: "wETH",
        address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        decimals: 18,
        verified: true,
        type: "TOKEN",
      },
    ],
  }, { now: "2026-04-23T13:11:00.000Z" });

  assert.equal(item.protocolBinding.vaultAddress, "0x67e536797570b3d8919Df052484273815A0aB506");
  assert.equal(item.protocolBinding.assetAddress, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  assert.equal(item.protocolBinding.shareTokenAddress, "0x67e536797570b3d8919Df052484273815A0aB506");
  assert.equal(item.protocolBinding.assetSymbol, "wETH");
  assert.equal(item.protocolBinding.shareTokenSymbol, "LVWETH");
});

test("merkl normalizer extracts Yei Aave-style asset and aToken binding but leaves pool unresolved", () => {
  const item = normalizeMerklOpportunity({
    id: "3178084911286839159",
    chainId: 1329,
    chain: { name: "Sei" },
    protocol: { id: "yei", name: "yei" },
    type: "AAVE_SUPPLY",
    action: "LEND",
    name: "Lend USDC on Yei",
    description: "Earn rewards by lending USDC on Yei.",
    status: "LIVE",
    liveCampaigns: 1,
    explorerAddress: "0x817B3C191092694C65f25B4d38D4935a8aB65616",
    depositUrl: "https://app.yei.finance/reserve-overview/?underlyingAsset=0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
    tokens: [
      {
        displaySymbol: "aYeiNativeUSDC",
        address: "0x817B3C191092694C65f25B4d38D4935a8aB65616",
        decimals: 6,
        verified: false,
        type: "TOKEN",
      },
      {
        displaySymbol: "USDC",
        address: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
        decimals: 6,
        verified: true,
        type: "TOKEN",
      },
    ],
  }, { now: "2026-04-23T13:11:00.000Z" });

  assert.equal(item.protocolBinding.assetAddress, "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392");
  assert.equal(item.protocolBinding.aTokenAddress, "0x817B3C191092694C65f25B4d38D4935a8aB65616");
  assert.equal(item.protocolBinding.poolAddress, null);
  assert.equal(item.protocolBinding.poolAddressProviderAddress, null);
});

test("merkl normalizer does not classify reward tokens as entry exposure", () => {
  const item = normalizeMerklOpportunity({
    id: "10493052639122543771",
    chainId: 8453,
    chain: { name: "Base" },
    protocol: { id: "zyfai", name: "ZyFAI" },
    type: "ENCOMPASSING",
    action: "DROP",
    name: "Stakers Rewards ZFI",
    description: "Visit your dashboard to check if you've earned rewards from this airdrop",
    status: "LIVE",
    liveCampaigns: 1,
    rewardsRecord: {
      breakdowns: [{ token: { displaySymbol: "USDC", symbol: "USDC", type: "TOKEN" } }],
    },
    tokens: [
      {
        displaySymbol: "ZFI",
        address: "0xD080eD3c74a20250a2c9821885203034ACD2D5ae",
        decimals: 18,
        verified: true,
        type: "TOKEN",
      },
    ],
  }, { now: "2026-04-23T13:11:00.000Z" });

  assert.deepEqual(item.tokenSymbols, ["ZFI", "USDC"]);
  assert.deepEqual(item.entryTokenSymbols, ["ZFI"]);
  assert.equal(item.hasStableExposure, false);
  assert.equal(item.family, "non_core_asset");
  assert.equal(item.mappedStrategyId, null);
});

test("merkl normalizer keeps sSTRAT out of ETH-family deployment without an ETH-like entry token", () => {
  const item = normalizeMerklOpportunity({
    id: "5223009618040121985",
    chainId: 1,
    chain: { name: "Ethereum" },
    protocol: { id: "ethstrat", name: "Eth Strat" },
    type: "ERC20LOGPROCESSOR",
    action: "HOLD",
    name: "Hold Staked STRAT (sSTRAT)",
    description: "Earn rewards by holding sSTRAT",
    status: "LIVE",
    liveCampaigns: 1,
    rewardsRecord: {
      breakdowns: [{ token: { displaySymbol: "wETH", symbol: "wETH", type: "TOKEN" } }],
    },
    tokens: [
      {
        displaySymbol: "sSTRAT",
        address: "0xD6664390E0485Cd609d4D04b430e84e945a51994",
        decimals: 18,
        verified: true,
        type: "TOKEN",
      },
    ],
  }, { now: "2026-04-23T13:11:00.000Z" });

  assert.deepEqual(item.tokenSymbols, ["sSTRAT", "wETH"]);
  assert.deepEqual(item.entryTokenSymbols, ["sSTRAT"]);
  assert.equal(item.hasEthExposure, false);
  assert.equal(item.family, "non_core_asset");
  assert.equal(item.mappedStrategyId, null);
});

test("merkl normalizer keeps LP pool campaigns off the stable carry executor surface", () => {
  const item = normalizeMerklOpportunity({
    id: "6207461710940594551",
    chainId: 10,
    chain: { name: "Optimism" },
    protocol: { id: "uniswap", name: "Uniswap" },
    type: "UNISWAP_V3",
    action: "POOL",
    name: "Provide liquidity through Arcadia to Uniswap USDC-WETH 0.3%",
    description: "Earn rewards by providing liquidity to the Uniswap USDC-WETH pool on Optimism",
    status: "LIVE",
    liveCampaigns: 1,
    tokens: [
      {
        displaySymbol: "USDC",
        address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
        decimals: 6,
        verified: true,
        type: "TOKEN",
      },
      {
        displaySymbol: "wETH",
        address: "0x4200000000000000000000000000000000000006",
        decimals: 18,
        verified: true,
        type: "TOKEN",
      },
    ],
  }, { now: "2026-04-23T13:11:00.000Z" });

  assert.equal(item.family, "stable_eth_lp");
  assert.equal(item.executionSurface, "clLp");
  assert.equal(item.mappedStrategyId, null);
});
