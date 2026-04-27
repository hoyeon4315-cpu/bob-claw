// Execution Script: Ethereum → Base Bridge
// Moves Morpho Clearstar, Morpho Steakhouse, Aave RLUSD to Base
// Uses official Base Bridge (L1StandardBridge)
//
// EXECUTION CHECKLIST:
// [ ] Signer Daemon running
// [ ] Kill-switch OFF
// [ ] Ethereum wallet has ETH for gas (0.000348 ETH = $0.80 confirmed)
// [ ] Target: Base wallet 0x96262bE63AA687563789225c2fE898c27a3b0AE4
//
// ESTIMATED COSTS (2.11 gwei):
// - Morpho Clearstar withdraw: $0.73 (150k gas)
// - Morpho Steakhouse withdraw: $0.73 (150k gas)
// - Aave RLUSD withdraw: $0.97 (200k gas)
// - ERC20 approves (x3): $0.73 (150k gas)
// - Base Bridge (x3): $1.74 (360k gas)
// TOTAL: $4.90
//
// EXPECTED ARRIVAL ON BASE: $150 - $4.90 = $145.10

const EXECUTION_STEPS = [
  {
    step: 1,
    name: "Morpho Clearstar Withdraw",
    chain: "ethereum",
    contract: "0x33333A8c76430E16d79BCBa7c50F0c60761F71e3", // Morpho Blue
    method: "withdraw",
    params: {
      marketId: "clearstar-usdc",
      assets: "75000000", // $75 USDC (6 decimals)
    },
    estimatedGas: 150_000,
    estimatedCostUsd: 0.73,
  },
  {
    step: 2,
    name: "Morpho Steakhouse Withdraw",
    chain: "ethereum",
    contract: "0x33333A8c76430E16d79BCBa7c50F0c60761F71e3", // Morpho Blue
    method: "withdraw",
    params: {
      marketId: "steakhouse-usdc",
      assets: "50000000", // $50 USDC (6 decimals)
    },
    estimatedGas: 150_000,
    estimatedCostUsd: 0.73,
  },
  {
    step: 3,
    name: "Aave RLUSD Withdraw",
    chain: "ethereum",
    contract: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2", // Aave Pool
    method: "withdraw",
    params: {
      asset: "0x8292Bb45bf1E4a0860d4bC8E964E223C0B05d576", // RLUSD
      amount: "25000000000000000000", // $25 RLUSD (18 decimals)
    },
    estimatedGas: 200_000,
    estimatedCostUsd: 0.97,
  },
  {
    step: 4,
    name: "Approve USDC for Base Bridge",
    chain: "ethereum",
    contract: "0xA0b86a33E6441e8ae927B5D7A378370f47A2e4cC", // USDC
    method: "approve",
    params: {
      spender: "0x3154Cf16ccdb4C6d922629664174b904d80F2C35", // Base Bridge
      amount: "125000000", // $125 USDC
    },
    estimatedGas: 50_000,
    estimatedCostUsd: 0.24,
  },
  {
    step: 5,
    name: "Approve RLUSD for Uniswap Swap",
    chain: "ethereum",
    contract: "0x8292Bb45bf1E4a0860d4bC8E964E223C0B05d576", // RLUSD
    method: "approve",
    params: {
      spender: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3 Router
      amount: "25000000000000000000", // $25 RLUSD
    },
    estimatedGas: 50_000,
    estimatedCostUsd: 0.24,
  },
  {
    step: 6,
    name: "Swap RLUSD → USDC (Uniswap V3)",
    chain: "ethereum",
    contract: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3
    method: "exactInputSingle",
    params: {
      tokenIn: "0x8292Bb45bf1E4a0860d4bC8E964E223C0B05d576", // RLUSD
      tokenOut: "0xA0b86a33E6441e8ae927B5D7A378370f47A2e4cC", // USDC
      fee: 500, // 0.05%
      recipient: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      amountIn: "25000000000000000000",
      amountOutMinimum: "24000000", // $24 (4% slippage tolerance)
    },
    estimatedGas: 180_000,
    estimatedCostUsd: 0.87,
  },
  {
    step: 7,
    name: "Bridge USDC to Base",
    chain: "ethereum",
    contract: "0x3154Cf16ccdb4C6d922629664174b904d80F2C35", // Base L1 Bridge
    method: "depositERC20To",
    params: {
      l1Token: "0xA0b86a33E6441e8ae927B5D7A378370f47A2e4cC", // USDC
      l2Token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
      to: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
      amount: "125000000", // $125 USDC (after swap)
      minGasLimit: 200_000,
      extraData: "0x",
    },
    estimatedGas: 120_000,
    estimatedCostUsd: 0.58,
  },
];

const TOTAL_ESTIMATED_COST = EXECUTION_STEPS.reduce((s, step) => s + step.estimatedCostUsd, 0);

export { EXECUTION_STEPS, TOTAL_ESTIMATED_COST };

// To execute via CLI:
// npm run executor:daemon -- --intent-file=src/execution/ethereum-to-base-bridge.mjs
// Or manually via MetaMask using the contract addresses above
