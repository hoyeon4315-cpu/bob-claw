function sourceRecord({
  status,
  proves,
  cannotProve,
  freshnessFields,
  reconciliationRequired,
}) {
  return Object.freeze({
    status,
    proves: Object.freeze(proves),
    cannotProve: Object.freeze(cannotProve),
    freshnessFields: Object.freeze(freshnessFields),
    reconciliationRequired: Object.freeze(reconciliationRequired),
  });
}

export const RADAR_SOURCE_ALLOWLIST = Object.freeze({
  raw_evm_rpc: sourceRecord({
    status: "enabled",
    proves: ["transaction_receipts", "logs", "calldata", "gas_fields", "block_context"],
    cannotProve: ["strategy_profitability", "wallet_identity", "offchain_terms", "bob_claw_portability"],
    freshnessFields: ["observedHead", "providerHead", "blockHash", "observedAt"],
    reconciliationRequired: ["independent_indexer_or_protocol_api"],
  }),
  bitcoin_core_rpc: sourceRecord({
    status: "enabled",
    proves: ["bitcoin_tx", "confirmations", "vin_vout", "block_context"],
    cannotProve: ["destination_chain_position_state", "wrapped_btc_profitability", "offchain_terms"],
    freshnessFields: ["blockHash", "confirmations", "observedAt"],
    reconciliationRequired: ["gateway_order_or_destination_balance_delta"],
  }),
  etherscan_v2: sourceRecord({
    status: "enabled",
    proves: ["indexed_logs", "verified_abi", "address_activity"],
    cannotProve: ["complete_chain_state", "strategy_profitability", "current_executable_quote"],
    freshnessFields: ["chainId", "blockNumber", "observedAt"],
    reconciliationRequired: ["raw_evm_rpc"],
  }),
  blockscout: sourceRecord({
    status: "enabled",
    proves: ["indexed_logs", "decoded_event_fields", "contract_metadata"],
    cannotProve: ["universal_chain_coverage", "decode_correctness_for_unverified_contracts"],
    freshnessFields: ["instanceUrl", "blockNumber", "observedAt"],
    reconciliationRequired: ["raw_evm_rpc"],
  }),
  dune: sourceRecord({
    status: "enabled",
    proves: ["historical_cohorts", "query_reproducibility", "cross_chain_analytics"],
    cannotProve: ["fresh_execution_state", "mempool_state", "current_executable_quote"],
    freshnessFields: ["queryId", "executionId", "executedAt"],
    reconciliationRequired: ["raw_evm_rpc"],
  }),
  defillama: sourceRecord({
    status: "enabled",
    proves: ["protocol_tvl_context", "yield_context", "fee_volume_context"],
    cannotProve: ["user_level_receipts", "claimability", "executable_apr", "bob_claw_portability"],
    freshnessFields: ["endpoint", "observedAt"],
    reconciliationRequired: ["protocol_api_or_raw_receipts"],
  }),
  merkl: sourceRecord({
    status: "enabled",
    proves: ["campaign_configuration", "opportunity_metadata", "reward_context"],
    cannotProve: ["realized_reward_conversion", "bob_claw_net_pnl"],
    freshnessFields: ["campaignId", "opportunityId", "observedAt"],
    reconciliationRequired: ["claim_receipt_and_reward_swap_receipt"],
  }),
  nansen: sourceRecord({
    status: "unverified_provider_access",
    proves: ["wallet_labels_if_access_confirmed", "cluster_hints_if_access_confirmed"],
    cannotProve: ["strategy_profitability", "bob_claw_portability", "public_replayability"],
    freshnessFields: ["providerTimestamp", "observedAt"],
    reconciliationRequired: ["raw_receipts_and_self_replay"],
  }),
  arkham: sourceRecord({
    status: "unverified_provider_access",
    proves: ["entity_labels_if_access_confirmed", "cluster_hints_if_access_confirmed"],
    cannotProve: ["strategy_profitability", "bob_claw_portability", "public_replayability"],
    freshnessFields: ["providerTimestamp", "observedAt"],
    reconciliationRequired: ["raw_receipts_and_self_replay"],
  }),
  cielo: sourceRecord({
    status: "unverified_provider_access",
    proves: ["wallet_activity_alerts_if_access_confirmed"],
    cannotProve: ["strategy_profitability", "bob_claw_portability", "complete_position_closure"],
    freshnessFields: ["providerTimestamp", "observedAt"],
    reconciliationRequired: ["raw_receipts_and_self_replay"],
  }),
});
