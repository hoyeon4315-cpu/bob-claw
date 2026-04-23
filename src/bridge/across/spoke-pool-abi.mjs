// Across v3 SpokePool ABI fragment — deposit entrypoint only.
//
// The full SpokePool exposes many functions, but for the signer intent
// builder we only need depositV3 (source-side deposit) and fillStatuses
// (destination lookup after relay). Restricting the ABI here keeps the
// bundle small and the surface auditable.

export const SPOKE_POOL_DEPOSIT_ABI = Object.freeze([
  {
    name: "depositV3",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "depositor", type: "address" },
      { name: "recipient", type: "address" },
      { name: "inputToken", type: "address" },
      { name: "outputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      { name: "outputAmount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "exclusiveRelayer", type: "address" },
      { name: "quoteTimestamp", type: "uint32" },
      { name: "fillDeadline", type: "uint32" },
      { name: "exclusivityDeadline", type: "uint32" },
      { name: "message", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "FundsDeposited",
    type: "event",
    anonymous: false,
    inputs: [
      { indexed: false, name: "inputToken", type: "address" },
      { indexed: false, name: "outputToken", type: "address" },
      { indexed: false, name: "inputAmount", type: "uint256" },
      { indexed: false, name: "outputAmount", type: "uint256" },
      { indexed: true, name: "destinationChainId", type: "uint256" },
      { indexed: true, name: "depositId", type: "uint32" },
      { indexed: false, name: "quoteTimestamp", type: "uint32" },
      { indexed: false, name: "fillDeadline", type: "uint32" },
      { indexed: false, name: "exclusivityDeadline", type: "uint32" },
      { indexed: true, name: "depositor", type: "address" },
      { indexed: false, name: "recipient", type: "address" },
      { indexed: false, name: "exclusiveRelayer", type: "address" },
      { indexed: false, name: "message", type: "bytes" },
    ],
  },
]);

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
