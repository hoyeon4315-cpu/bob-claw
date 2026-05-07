import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildApprovalExposureSlice,
  buildApprovalReaperReport,
  buildApprovalRevokeIntent,
  extractApprovalWatchlist,
  redactApprovalExposure,
  runApprovalReaper,
} from "../src/executor/approval-reaper.mjs";

const OWNER = "0x96262bE63AA687563789225c2fE898c27a3b0AE4";
const TOKEN = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const SPENDER = "0x0D05d05D05d05D05d05D05d05d05d05D05D05D05";

test("approval reaper marks idle nonzero allowance stale and builds exact zero revoke intent", () => {
  const report = buildApprovalReaperReport({
    owner: OWNER,
    now: "2026-05-07T10:00:00.000Z",
    idleTtlMs: 3_600_000,
    watchlist: [
      {
        chain: "base",
        token: TOKEN,
        spender: SPENDER,
        strategyId: "wrapped-btc-loop-base-moonwell",
        symbol: "wBTC.OFT",
        decimals: 8,
        source: "wrapped_btc_loop_handoff",
        lastActiveAt: "2026-05-07T08:00:00.000Z",
      },
    ],
    allowanceState: {
      [`base:${TOKEN.toLowerCase()}:${SPENDER.toLowerCase()}`]: {
        allowanceRaw: "28027",
        balanceRaw: "4891",
      },
    },
  });

  assert.equal(report.summary.staleNonzeroCount, 1);
  assert.equal(report.items[0].status, "stale_nonzero");
  assert.equal(report.items[0].exposureRaw, "4891");
  assert.equal(report.revocationIntents.length, 1);

  const intent = report.revocationIntents[0];
  assert.equal(intent.strategyId, "wrapped-btc-loop-base-moonwell");
  assert.equal(intent.intentType, "approve_exact");
  assert.equal(intent.amountUsd, 0);
  assert.equal(intent.approval.amount, "0");
  assert.equal(intent.approval.mode, "per_tx");
  assert.equal(intent.tx.to, TOKEN.toLowerCase());
  assert.match(intent.tx.data, /^0x095ea7b3/u);
  assert.equal(intent.metadata.approvalReaper, true);
});

test("approval reaper reports but does not revoke active or unknown-source allowances", () => {
  const report = buildApprovalReaperReport({
    owner: OWNER,
    now: "2026-05-07T10:00:00.000Z",
    idleTtlMs: 3_600_000,
    watchlist: [
      {
        chain: "base",
        token: TOKEN,
        spender: SPENDER,
        strategyId: "wrapped-btc-loop-base-moonwell",
        source: "wrapped_btc_loop_handoff",
        lastActiveAt: "2026-05-07T09:45:00.000Z",
        activeExecution: true,
      },
      {
        chain: "ethereum",
        token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        spender: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        source: "unknown_scan",
      },
    ],
    allowanceState: {
      [`base:${TOKEN.toLowerCase()}:${SPENDER.toLowerCase()}`]: {
        allowanceRaw: "28027",
        balanceRaw: "4891",
      },
      "ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7:0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": {
        allowanceRaw: "40925455",
        balanceRaw: "33108495",
      },
    },
  });

  assert.deepEqual(report.items.map((item) => item.status), ["active_in_flight", "unknown_source"]);
  assert.equal(report.summary.revocableCount, 0);
  assert.deepEqual(report.revocationIntents, []);
});

test("approval reaper extracts unique approval watchlist entries from nested plan artifacts", () => {
  const watchlist = extractApprovalWatchlist([
    {
      strategyId: "lifi-bridge",
      chain: "ethereum",
      plan: {
        steps: [
          {
            intent: {
              strategyId: "lifi-bridge",
              chain: "ethereum",
              approval: {
                token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
                spender: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
                amount: "40925455",
              },
              observedAt: "2026-05-07T08:00:00.000Z",
            },
          },
          {
            intent: {
              strategyId: "lifi-bridge",
              chain: "ethereum",
              approval: {
                token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
                spender: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
                amount: "40925455",
              },
            },
          },
        ],
      },
    },
  ]);

  assert.equal(watchlist.length, 1);
  assert.equal(watchlist[0].strategyId, "lifi-bridge");
  assert.equal(watchlist[0].chain, "ethereum");
  assert.equal(watchlist[0].source, "plan_artifact");
  assert.equal(watchlist[0].lastActiveAt, "2026-05-07T08:00:00.000Z");
});

test("approval exposure redaction keeps dashboard-safe fields only", () => {
  const redacted = redactApprovalExposure({
    chain: "base",
    token: TOKEN,
    spender: SPENDER,
    symbol: "wBTC.OFT",
    status: "stale_nonzero",
    allowanceRaw: "28027",
    exposureRaw: "4891",
    revocable: true,
    tx: { data: "0xdeadbeef" },
  });

  assert.deepEqual(Object.keys(redacted).sort(), [
    "allowanceRaw",
    "chain",
    "exposureRaw",
    "revocable",
    "spender",
    "status",
    "symbol",
    "token",
  ]);
  assert.equal(redacted.spender, "0x0d05...d05");
  assert.equal(redacted.tx, undefined);
});

test("approval exposure slice compacts owner address for dashboard output", () => {
  const slice = buildApprovalExposureSlice({
    observedAt: "2026-05-07T10:00:00.000Z",
    summary: {
      owner: OWNER,
      nonzeroCount: 1,
    },
    items: [],
  });

  assert.equal(slice.summary.owner, "0x9626...ae4");
  assert.equal(slice.summary.nonzeroCount, 1);
});

test("buildApprovalRevokeIntent rejects missing source strategy", () => {
  assert.throws(
    () => buildApprovalRevokeIntent({ chain: "base", token: TOKEN, spender: SPENDER }),
    /approval_revoke_strategy_missing/u,
  );
});

test("approval reaper dry-run reads allowances but sends no signer commands", async () => {
  let allowanceReads = 0;
  let signerCalls = 0;
  const report = await runApprovalReaper({
    owner: OWNER,
    execute: false,
    now: "2026-05-07T10:00:00.000Z",
    watchlist: [
      {
        chain: "base",
        token: TOKEN,
        spender: SPENDER,
        strategyId: "wrapped-btc-loop-base-moonwell",
        lastActiveAt: "2026-05-07T08:00:00.000Z",
      },
    ],
    readAllowance: async () => {
      allowanceReads += 1;
      return { allowanceRaw: "28027" };
    },
    readBalance: async () => ({ balanceRaw: "4891" }),
    sendSignerCommandImpl: async () => {
      signerCalls += 1;
      return { status: "approved" };
    },
  });

  assert.equal(allowanceReads, 1);
  assert.equal(signerCalls, 0);
  assert.equal(report.summary.revocableCount, 1);
  assert.equal(report.execution.mode, "dry_run");
  assert.deepEqual(report.execution.results, []);
});

test("approval reaper execute sends only revocable zero-approval intents", async () => {
  const signerMessages = [];
  const report = await runApprovalReaper({
    owner: OWNER,
    execute: true,
    now: "2026-05-07T10:00:00.000Z",
    watchlist: [
      {
        chain: "base",
        token: TOKEN,
        spender: SPENDER,
        strategyId: "wrapped-btc-loop-base-moonwell",
        lastActiveAt: "2026-05-07T08:00:00.000Z",
      },
      {
        chain: "ethereum",
        token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        spender: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        lastActiveAt: "2026-05-07T08:00:00.000Z",
      },
    ],
    readAllowance: async (item) => ({
      allowanceRaw: item.chain === "base" ? "28027" : "40925455",
    }),
    readBalance: async (item) => ({
      balanceRaw: item.chain === "base" ? "4891" : "33108495",
    }),
    sendSignerCommandImpl: async ({ message }) => {
      signerMessages.push(message);
      return { status: "approved", intentHash: "0xintent" };
    },
  });

  assert.equal(report.summary.revocableCount, 1);
  assert.equal(signerMessages.length, 1);
  assert.equal(signerMessages[0].command, "sign_and_broadcast");
  assert.equal(signerMessages[0].intent.approval.amount, "0");
  assert.equal(report.execution.results[0].status, "approved");
});
