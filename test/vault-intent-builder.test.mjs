import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface } from "ethers";
import { buildVaultDepositIntent } from "../src/executor/helpers/vault-intent-builder.mjs";

const ERC20 = new Interface(["function approve(address spender,uint256 amount)"]);
const ERC4626 = new Interface(["function deposit(uint256 assets,address receiver) returns (uint256 shares)"]);

test("buildVaultDepositIntent honors explicit assetAmount when clamping to wallet balance", async () => {
  const plan = await buildVaultDepositIntent({
    strategyId: "beefy-folding-vault",
    chain: "base",
    amountUsd: 24.83,
    vaultAddress: "0x0887463E77194e94F68C2670026F44F14055da10",
    assetAddress: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    assetDecimals: 8,
    assetPriceUsd: 60_000,
    assetAmount: "41386",
    senderAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    estimateGasImpl: () => ({ gasUnits: 21_000 }),
    now: "2026-04-24T00:00:00.000Z",
  });

  assert.equal(plan.amount, "41386");
  assert.equal(plan.steps.length, 2);

  const approve = ERC20.decodeFunctionData("approve", plan.steps[0].intent.tx.data);
  assert.equal(approve[1].toString(), "41386");

  const deposit = ERC4626.decodeFunctionData("deposit", plan.steps[1].intent.tx.data);
  assert.equal(deposit[0].toString(), "41386");
  assert.equal(deposit[1], "0x96262bE63AA687563789225c2fE898c27a3b0AE4");
});
