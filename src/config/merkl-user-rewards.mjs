import { EVM_CHAIN_CONFIGS } from "./chains.mjs";

export const MERKL_USER_REWARD_CHAIN_IDS = Object.freeze(
  Object.values(EVM_CHAIN_CONFIGS)
    .map((chain) => chain.chainId)
    .filter((chainId) => Number.isInteger(chainId)),
);

export const MERKL_USER_REWARD_POLICY = Object.freeze({
  chainIds: MERKL_USER_REWARD_CHAIN_IDS,
  reloadChainId: EVM_CHAIN_CONFIGS.base.chainId,
  minClaimUsd: 1,
  maxClaimCostUsdByChainId: Object.freeze({
    1: 8,
    10: 0.05,
    56: 0.1,
    130: 0.04,
    146: 0.04,
    1329: 0.04,
    1868: 0.04,
    8453: 0.02,
    43114: 0.12,
    60808: 0.04,
    80094: 0.08,
  }),
  distributorsByChainId: Object.freeze({}),
});

export function merklUserRewardPolicy(overrides = {}) {
  return {
    ...MERKL_USER_REWARD_POLICY,
    ...overrides,
    chainIds: overrides.chainIds || MERKL_USER_REWARD_POLICY.chainIds,
    maxClaimCostUsdByChainId: {
      ...MERKL_USER_REWARD_POLICY.maxClaimCostUsdByChainId,
      ...(overrides.maxClaimCostUsdByChainId || {}),
    },
    distributorsByChainId: {
      ...MERKL_USER_REWARD_POLICY.distributorsByChainId,
      ...(overrides.distributorsByChainId || {}),
    },
  };
}
