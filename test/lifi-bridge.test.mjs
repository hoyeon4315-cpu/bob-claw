import assert from "node:assert/strict";
import { test } from "node:test";
import { executeLifiBridgePlan } from "../src/executor/helpers/lifi-bridge.mjs";

test("LI.FI bridge execution preserves signer rejection details", async () => {
  const plan = {
    srcChain: "avalanche",
    dstChain: "ethereum",
    srcToken: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    dstToken: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    senderAddress: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
    amount: "25739",
    minimumOutputAmount: "8334268562454854",
    srcAsset: {
      chain: "avalanche",
      token: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
      ticker: "wBTC.OFT",
      decimals: 8,
      isNative: false,
    },
    dstAsset: {
      chain: "ethereum",
      token: "0x0000000000000000000000000000000000000000",
      ticker: "ETH",
      decimals: 18,
      isNative: true,
    },
    steps: [
      {
        id: "approve_lifi_spender",
        intent: {
          strategyId: "lifi-bridge",
          chain: "avalanche",
          family: "evm",
          intentType: "approve_exact",
          tx: {
            to: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
            data: "0x1234",
            value: "0",
            gasLimit: "210000",
          },
        },
      },
    ],
  };

  const execution = await executeLifiBridgePlan({
    plan,
    awaitDestinationSettlement: false,
    receiptIngest: async () => ({ appended: false, reason: "test_stub" }),
    readErc20BalanceImpl: async () => ({
      rpcUrl: "https://rpc.example",
      balance: "25739",
    }),
    readNativeBalanceImpl: async () => ({
      rpcUrl: "https://rpc.example",
      balanceWei: "269494169760980",
    }),
    sendCommand: async () => ({
      status: "rejected",
      policy: {
        blockers: ["strategy_per_day_cap_exceeded"],
      },
      notification: {
        channel: "telegram",
      },
    }),
  });

  assert.equal(execution.settlementStatus, "signer_rejected");
  assert.equal(execution.signerResult.status, "rejected");
  assert.equal(execution.signerResult.policy.blockers[0], "strategy_per_day_cap_exceeded");
  assert.equal(execution.error.name, "SignerRejected");
  assert.equal(execution.error.policy.blockers[0], "strategy_per_day_cap_exceeded");
});
