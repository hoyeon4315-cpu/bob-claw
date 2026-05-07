import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildForkSignerIntent, buildForkSubmissionPreflight } from "../src/cli/submit-prelive-fork-execution.mjs";
import { evaluateIntentPolicies } from "../src/executor/policy/index.mjs";
import { buildForkExecutionPlan } from "../src/prelive/fork-execution.mjs";

const WBTC = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";

test("prelive fork submitter does not broadcast raw signed transactions directly", async () => {
  const source = await readFile(new URL("../src/cli/submit-prelive-fork-execution.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("sendRawTransaction"), false);
  assert.equal(source.includes('command: "sign_and_broadcast"'), true);
});

test("fork signer intent is derived from the fork plan transaction payload", () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `avalanche:${WBTC}->bob:${WBTC}`,
      amount: "50000",
      label: "avalanche->bob wBTC.OFT->wBTC.OFT",
      score: {
        routeKey: `avalanche:${WBTC}->bob:${WBTC}`,
        amount: "50000",
        srcChain: "avalanche",
        dstChain: "bob",
        inputUsd: 37.93,
        tradeReadiness: "insufficient_data",
        srcAsset: { chain: "avalanche", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "bob", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `avalanche:${WBTC}->bob:${WBTC}`,
        amount: "50000",
        route: { srcChain: "avalanche", dstChain: "bob" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "42",
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    now: "2026-04-19T00:00:00.000Z",
  });

  const intent = buildForkSignerIntent(plan, { observedAt: "2026-04-19T00:00:01.000Z" });

  assert.equal(intent.strategyId, "prelive_fork_execution");
  assert.equal(intent.chain, "avalanche");
  assert.equal(intent.mode, "fork");
  assert.equal(intent.intentType, "prelive_fork_execution");
  assert.equal(intent.amountUsd, 37.93);
  assert.deepEqual(intent.tx, {
    to: "0x1111111111111111111111111111111111111111",
    data: "0x1234",
    value: "42",
  });
  assert.equal(intent.metadata.preliveForkPlanId, plan.planId);
  assert.equal(intent.metadata.preliveForkRouteKey, plan.routeKey);
  assert.equal(intent.metadata.preliveForkAmount, "50000");
});

test("fork signer intent can carry an explicit gas limit override", () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `bob:${WBTC}->soneium:${WBTC}`,
      amount: "1000",
      label: "bob->soneium",
      score: {
        routeKey: `bob:${WBTC}->soneium:${WBTC}`,
        amount: "1000",
        srcChain: "bob",
        dstChain: "soneium",
        inputUsd: 0.76,
        tradeReadiness: "reject_no_net_edge",
        srcAsset: { chain: "bob", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "soneium", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `bob:${WBTC}->soneium:${WBTC}`,
        amount: "1000",
        route: { srcChain: "bob", dstChain: "soneium" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "42",
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    now: "2026-04-19T00:00:00.000Z",
  });

  const intent = buildForkSignerIntent(plan, {
    observedAt: "2026-04-19T00:00:01.000Z",
    gasLimit: "500000",
    nonce: 17,
  });

  assert.equal(intent.tx.gasLimit, "500000");
  assert.equal(intent.tx.nonce, 17);
});

test("fork execution plan submit command prefers signer daemon plus fork rpc", () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `ethereum:${WBTC}->base:${WBTC}`,
      amount: "10000",
      label: "ethereum->base",
      score: {
        routeKey: `ethereum:${WBTC}->base:${WBTC}`,
        amount: "10000",
        srcChain: "ethereum",
        dstChain: "base",
        inputUsd: 7.3,
        tradeReadiness: "shadow_candidate_review_only",
        srcAsset: { chain: "ethereum", token: WBTC, ticker: "WBTC", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "base", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `ethereum:${WBTC}->base:${WBTC}`,
        amount: "10000",
        route: { srcChain: "ethereum", dstChain: "base" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "0",
      },
    },
    address: "0x000000000000000000000000000000000000dEaD",
    now: "2026-04-19T00:00:00.000Z",
  });

  assert.match(plan.commands.submit, /--use-signer-daemon/);
  assert.match(plan.commands.submit, /--rpc-url="<forkRpcUrl>"/);
});

test("fork submission preflight blocks insufficient source token balance on the fork", async () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `base:${WBTC}->bob:${WBTC}`,
      amount: "300",
      label: "base->bob",
      score: {
        routeKey: `base:${WBTC}->bob:${WBTC}`,
        amount: "300",
        srcChain: "base",
        dstChain: "bob",
        inputUsd: 0.23,
        tradeReadiness: "insufficient_data",
        srcAsset: { chain: "base", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "bob", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `base:${WBTC}->bob:${WBTC}`,
        amount: "300",
        route: { srcChain: "base", dstChain: "bob" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "42",
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    now: "2026-04-19T00:00:00.000Z",
  });

  await assert.rejects(
    () =>
      buildForkSubmissionPreflight(
        plan,
        { rpcUrl: "http://127.0.0.1:8549" },
        {
          readLatestBlockImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", blockNumber: 123, blockTimestamp: 456 }),
          readLiveLatestBlockImpl: async () => ({ rpcUrl: "https://mainnet.base.org", blockNumber: 123, blockTimestamp: 456 }),
          readPendingNonceImpl: async () => 9,
          readErc20BalanceImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", balance: 299n }),
          readNativeBalanceImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", balanceWei: 10n ** 18n }),
        },
      ),
    (error) => error?.name === "ForkSourceBalanceError" && /required=300/.test(error.message),
  );
});

test("fork submission preflight blocks insufficient native gas funding for the signed tx", async () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `base:${WBTC}->bob:${WBTC}`,
      amount: "300",
      label: "base->bob",
      score: {
        routeKey: `base:${WBTC}->bob:${WBTC}`,
        amount: "300",
        srcChain: "base",
        dstChain: "bob",
        inputUsd: 0.23,
        tradeReadiness: "insufficient_data",
        srcAsset: { chain: "base", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "bob", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `base:${WBTC}->bob:${WBTC}`,
        amount: "300",
        route: { srcChain: "base", dstChain: "bob" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "42",
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    now: "2026-04-19T00:00:00.000Z",
  });

  await assert.rejects(
    () =>
      buildForkSubmissionPreflight(
        plan,
        { rpcUrl: "http://127.0.0.1:8549", signedTx: "0xdeadbeef" },
        {
          readLatestBlockImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", blockNumber: 123, blockTimestamp: 456 }),
          readLiveLatestBlockImpl: async () => ({ rpcUrl: "https://mainnet.base.org", blockNumber: 123, blockTimestamp: 456 }),
          readPendingNonceImpl: async () => 9,
          readErc20BalanceImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", balance: 300n }),
          readNativeBalanceImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", balanceWei: 100n }),
          decodeSignedTxImpl: () => ({ value: 42n, gasLimit: 10n, maxFeePerGas: 11n }),
        },
      ),
    (error) => error?.name === "ForkNativeBalanceError" && /required=152/.test(error.message),
  );
});

test("fork submission preflight blocks stale fork snapshots compared with live chain state", async () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `base:${WBTC}->bob:${WBTC}`,
      amount: "300",
      label: "base->bob",
      score: {
        routeKey: `base:${WBTC}->bob:${WBTC}`,
        amount: "300",
        srcChain: "base",
        dstChain: "bob",
        inputUsd: 0.23,
        tradeReadiness: "insufficient_data",
        srcAsset: { chain: "base", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "bob", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `base:${WBTC}->bob:${WBTC}`,
        amount: "300",
        route: { srcChain: "base", dstChain: "bob" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "42",
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    now: "2026-04-19T00:00:00.000Z",
  });

  await assert.rejects(
    () =>
      buildForkSubmissionPreflight(
        plan,
        { rpcUrl: "http://127.0.0.1:8549" },
        {
          readLatestBlockImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", blockNumber: 100, blockTimestamp: 1_000 }),
          readLiveLatestBlockImpl: async () => ({ rpcUrl: "https://mainnet.base.org", blockNumber: 500, blockTimestamp: 3_000 }),
          readPendingNonceImpl: async () => 9,
          readErc20BalanceImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", balance: 300n }),
          readNativeBalanceImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", balanceWei: 10n ** 18n }),
        },
      ),
    (error) => error?.name === "StaleForkSnapshotError" && /blockLag=400/.test(error.message),
  );
});

test("fork submission preflight records freshness when fork is still close to live", async () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `base:${WBTC}->bob:${WBTC}`,
      amount: "300",
      label: "base->bob",
      score: {
        routeKey: `base:${WBTC}->bob:${WBTC}`,
        amount: "300",
        srcChain: "base",
        dstChain: "bob",
        inputUsd: 0.23,
        tradeReadiness: "insufficient_data",
        srcAsset: { chain: "base", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "bob", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `base:${WBTC}->bob:${WBTC}`,
        amount: "300",
        route: { srcChain: "base", dstChain: "bob" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "42",
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    now: "2026-04-19T00:00:00.000Z",
  });

  const preflight = await buildForkSubmissionPreflight(
    plan,
    { rpcUrl: "http://127.0.0.1:8549" },
    {
      readLatestBlockImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", blockNumber: 490, blockTimestamp: 2_950 }),
      readLiveLatestBlockImpl: async () => ({ rpcUrl: "https://mainnet.base.org", blockNumber: 500, blockTimestamp: 3_000 }),
      readPendingNonceImpl: async () => 9,
      readErc20BalanceImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", balance: 300n }),
      readNativeBalanceImpl: async () => ({ rpcUrl: "http://127.0.0.1:8549", balanceWei: 10n ** 18n }),
    },
  );

  assert.equal(preflight.freshness?.stale, false);
  assert.equal(preflight.freshness?.blockLag, 10);
  assert.equal(preflight.freshness?.timeLagSeconds, 50);
});

test("fork signer intent is blocked when expected net is unmeasured", async () => {
  const plan = buildForkExecutionPlan({
    selection: {
      routeKey: `sonic:${WBTC}->bob:${WBTC}`,
      amount: "25000",
      label: "sonic->bob",
      score: {
        routeKey: `sonic:${WBTC}->bob:${WBTC}`,
        amount: "25000",
        srcChain: "sonic",
        dstChain: "bob",
        inputUsd: 18.96,
        tradeReadiness: "insufficient_data",
        srcAsset: { chain: "sonic", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
        dstAsset: { chain: "bob", token: WBTC, ticker: "wBTC.OFT", decimals: 8, isNative: false, priceKey: "btc" },
      },
      quote: {
        routeKey: `sonic:${WBTC}->bob:${WBTC}`,
        amount: "25000",
        route: { srcChain: "sonic", dstChain: "bob" },
        txTo: "0x1111111111111111111111111111111111111111",
        txData: "0x1234",
        txValueWei: "1",
      },
    },
    address: "0x96262be63aa687563789225c2fe898c27a3b0ae4",
    now: "2026-04-19T00:00:00.000Z",
  });

  const policy = await evaluateIntentPolicies({
    intent: buildForkSignerIntent(plan, { observedAt: "2026-04-19T00:00:01.000Z" }),
    auditRecords: [],
    now: "2026-04-19T00:00:02.000Z",
    killSwitchPath: null,
  });

  assert.equal(policy.decision, "BLOCK");
  assert.equal(policy.strategyId, "prelive_fork_execution");
  assert.ok(policy.blockers.includes("expected_net_unmeasured"));
});
