# Protocol Asset Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BOB Claw display exact current assets as `remaining wallet assets + marked protocol positions = current total assets`, without depending on Zerion or any single external portfolio API for realtime truth.

**Architecture:** Add a protocol-position marking layer between execution receipts and dashboard status. The wallet scanner remains responsible for free wallet balances, while protocol adapters read share/debt/LP state from contracts and emit normalized marks that dashboard slices can reconcile.

**Tech Stack:** Node.js ESM, `node:test`, ethers v6 read-only RPC calls, existing JSONL ledgers, existing dashboard status slices.

---

## Research Summary

### Is this genuinely hard?

Yes. A CEX trading bot usually has one ledger, one authenticated account API, and usually a websocket balance stream. DeFi is different: every chain has separate RPC/indexing lag, every protocol represents ownership differently, and the wallet balance can go down even when net worth has not changed because the asset moved into a vault, lending market, LP NFT, or reward contract.

The dashboard problem in BOB Claw is not that the operator lost assets when a strategy enters. The likely current failure mode is accounting visibility:

- `src/treasury/whole-wallet-scan.mjs` sees native tokens and a curated set of ERC-20 balances.
- Open protocol positions are in `data/merkl-portfolio-positions.jsonl`, but open positions do not yet get re-marked from live protocol share balances every dashboard tick.
- `src/status/merkl-active-slice.mjs` can use `valueUsd`, `markUsd`, `currentValueUsd`, or `principalUsd` if they exist, but most open ledger events only carry entry `amountUsd` and share metadata.
- `src/status/capital-summary-slice.mjs` now separates current wallet assets from protocol assets, but it can only be exact when protocol marks exist.
- Zerion full-wallet data has already produced `429` scan errors in tests and local snapshots. It should be a cross-check, not the realtime source of truth.

### How other wallet products measure portfolio value

This is the common pattern across wallet/portfolio vendors:

1. **Simple wallet balances:** Native coin, ERC-20, NFT ownership, metadata, and prices.
2. **Complex protocol positions:** Lending deposits/debts, staking, vault shares, LP shares, locked balances, and rewards.
3. **Indexers and adapters:** Providers normalize protocol-specific contract reads into one position schema.
4. **Pricing layer:** Prices come from market data providers and sometimes onchain liquidity when normal price feeds are missing.
5. **Freshness labels:** Data can be cached, synced, stale, unsupported, or failed. Serious products separate these states instead of presenting one unexplained number.
6. **Double-count prevention:** Receipt tokens and nested deposits can make the same underlying asset appear twice unless explicitly reconciled.

Primary research references:

- Zerion says portfolio, DeFi positions, transactions, PnL, and NFTs are separate wallet-scoped endpoint categories; the portfolio endpoint can filter simple wallet positions versus complex DeFi positions and `sync=true` may wait up to 30 seconds for refresh: https://developers.zerion.io/api-reference/wallets/get-wallet-portfolio
- Zerion's DeFi recipe fetches `filter[positions]=only_complex` and supports position categories such as deposits, staked assets, rewards, locked positions, and wallet assets: https://developers.zerion.io/recipes/defi-positions
- Zerion's public API page advertises active DeFi positions, rewards, liquidity pools, transaction webhooks, and pricing tiers with low free/developer quotas, so it is useful but not suitable as the only rapid polling source: https://zerion.io/api
- DeBank exposes simple and complex protocol lists. Their docs explicitly say complex protocol data is often near realtime within one minute, but the worst case update guarantee is 12 hours: https://docs.cloud.debank.com/en/readme/api-pro-reference/user
- 1inch Portfolio API separates current total value, token snapshots, protocol snapshots, PnL, and protocol metrics: https://business.1inch.com/portal/documentation/apis/portfolio/quick-start
- Moralis DeFi detailed positions expose protocol-level totals, unclaimed rewards, position labels, token roles, `syncedAt`, unsupported chains, and failed chains: https://docs.moralis.com/data-api/evm/defi/wallet-positions-detailed
- Zapper describes portfolio net worth as tokens plus NFTs plus assets in supported DeFi apps, and its developer page describes one GraphQL API covering tokens, NFTs, DeFi, transactions, social data, and portfolio breakdowns across many chains: https://help.zapper.xyz/hc/en-us/articles/7762759610641-How-do-I-view-my-balances-on-Zapper and https://protocol.zapper.xyz/
- Alchemy Portfolio APIs cover multichain token balances, metadata, prices, NFTs, and transactions, which is useful for wallet inventory but not a full protocol-position adapter layer by itself: https://www.alchemy.com/docs/reference/portfolio-apis
- DefiLlama's methodology is adapter-first. They use open-source adapters, warn about double-counting receipt tokens, and price most tokens with CoinGecko while using onchain methods when needed: https://docs.llama.fi/ and https://docs.llama.fi/faqs/frequently-asked-questions
- ERC-4626 exists because vault shares lacked standardization. It defines `balanceOf` shares and `convertToAssets` for estimating underlying assets: https://eips.ethereum.org/EIPS/eip-4626
- Uniswap V3 positions are NFTs. The official guide fetches token IDs and calls the `positions` function on `NonfungiblePositionManager`: https://developers.uniswap.org/docs/sdks/v3/guides/managing-liquidity/position-fetching
- Compound cTokens represent supplied balances and accrue value through an exchange rate against the underlying asset: https://docs.compound.finance/v2/ctokens

## Product Decision

BOB Claw should not try to become a full Zerion clone immediately. It only needs exact current accounting for positions the system itself opened or recognizes as approved operator inventory.

The correct model is:

```text
currentTotalUsd =
  currentWalletUsd
  + liveMarkedProtocolPositionUsd
  + optionally confirmed pending-claim rewardUsd
```

For BTC-first reporting:

```text
currentTotalBtc =
  currentWalletBtcEquivalent
  + liveMarkedProtocolPositionBtcEquivalent
  + confirmed pending-claim rewardBtcEquivalent
```

External portfolio providers are allowed only as reference fields:

- `externalReferenceUsd`
- `externalReferenceProvider`
- `externalReferenceObservedAt`
- `externalReferenceGapUsd`

They must not override the dashboard headline unless the local read stack is down and the UI labels the number as external reference, not current assets.

## File Structure

Create these focused files:

- `src/treasury/protocol-position-mark-schema.mjs`
  - Normalizes and validates protocol mark events.
  - Provides freshness and confidence helpers.
- `src/treasury/protocol-position-ledger.mjs`
  - Reads `data/merkl-portfolio-positions.jsonl`.
  - Returns active open records by `positionId`.
  - Merges latest marks from `data/protocol-position-marks.jsonl`.
- `src/treasury/protocol-position-adapters/erc4626.mjs`
  - Marks ERC-4626 and Euler eVault style share positions with `balanceOf`, `asset`, `decimals`, and `convertToAssets`.
- `src/treasury/protocol-position-adapters/aave-v3.mjs`
  - Marks Aave-style supply/debt positions from known reserve token addresses or `getUserAccountData`.
- `src/treasury/protocol-position-adapters/compound-v2.mjs`
  - Marks Compound/Moonwell-style cToken positions with `balanceOf`, `exchangeRateStored` or `exchangeRateCurrent`, and underlying metadata.
- `src/treasury/protocol-position-adapters/uniswap-v3.mjs`
  - Marks CL NFT positions from `NonfungiblePositionManager.positions(tokenId)` and pool price/tick data.
- `src/treasury/protocol-position-adapter-registry.mjs`
  - Maps `bindingKind`, `protocolId`, chain, and ledger metadata to adapter functions.
- `src/treasury/protocol-position-marker.mjs`
  - Runs read-only protocol marks for active positions.
  - Writes append-only `data/protocol-position-marks.jsonl`.
- `src/cli/mark-protocol-positions.mjs`
  - CLI entry point for one-shot marking.
- `src/status/protocol-position-marks-slice.mjs`
  - Emits dashboard-ready mark summary.

Modify these existing files:

- `package.json`
  - Add `status:protocol-position-marks`.
- `src/status/current-dashboard-context.mjs`
  - Load the protocol mark slice into dashboard context.
- `src/status/merkl-active-slice.mjs`
  - Prefer latest live protocol marks over entry amount.
  - Show current APR only when sourced from current opportunity/protocol data; otherwise label it entry APR.
- `src/status/capital-summary-slice.mjs`
  - Compute totals from wallet + live marked protocols.
  - Expose explicit confidence and gap reasons.
- `src/status/treasury-holdings-slice.mjs`
  - Keep free wallet holdings separate from protocol positions.
- `dashboard/public/data.jsx`
  - Consume exact current total fields when available.
- `dashboard/public/app.jsx`
  - Display exact current total, formula, and freshness without `+` shorthand.
- `dashboard/public/mindmap.jsx`
  - Reflect chain cards using wallet free assets plus protocol marks by chain.

Add and update tests:

- `test/protocol-position-mark-schema.test.mjs`
- `test/protocol-position-ledger.test.mjs`
- `test/protocol-position-erc4626-adapter.test.mjs`
- `test/protocol-position-aave-v3-adapter.test.mjs`
- `test/protocol-position-compound-v2-adapter.test.mjs`
- `test/protocol-position-marker.test.mjs`
- `test/protocol-position-marks-slice.test.mjs`
- Update `test/dashboard-live-slices.test.mjs`
- Update `test/dashboard-app.test.mjs`
- Update `test/mindmap-ui-source.test.mjs`

## Data Contracts

### Protocol mark JSONL event

Every successful mark writes one append-only event:

```json
{
  "schemaVersion": 1,
  "event": "position_marked",
  "status": "open",
  "observedAt": "2026-05-03T12:00:00.000Z",
  "positionId": "merkl:base:13747891056392346282:0x7e1c...",
  "opportunityId": "13747891056392346282",
  "strategyId": "gateway_native_asset_conversion_sleeve",
  "chain": "base",
  "protocolId": "yo",
  "bindingKind": "erc4626_vault_supply_withdraw",
  "adapterId": "erc4626",
  "walletAddress": "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
  "assetAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "assetSymbol": "USDC",
  "assetDecimals": 6,
  "shareTokenAddress": "0x0000000f2eB9f69274678c76222B35eEc7588a65",
  "shareBalance": "4792900",
  "assetBalance": "5015801",
  "assetAmount": 5.015801,
  "assetPriceUsd": 1,
  "valueUsd": 5.015801,
  "valueBtc": 0.00004871,
  "markSource": "onchain_erc4626_convert_to_assets",
  "freshness": "fresh",
  "confidence": "verified_current",
  "rpcUrl": "https://mainnet.base.org"
}
```

Every failed mark writes a diagnostic event:

```json
{
  "schemaVersion": 1,
  "event": "position_mark_failed",
  "status": "open",
  "observedAt": "2026-05-03T12:00:02.000Z",
  "positionId": "merkl:base:13747891056392346282:0x7e1c...",
  "opportunityId": "13747891056392346282",
  "chain": "base",
  "protocolId": "yo",
  "adapterId": "erc4626",
  "failureKind": "rpc_call_failed",
  "message": "convertToAssets reverted on vault 0x0000000f2eB9f69274678c76222B35eEc7588a65",
  "confidence": "adapter_missing"
}
```

### Freshness policy

Use fixed freshness labels:

- `fresh`: mark age <= 90 seconds.
- `recent`: mark age <= 10 minutes.
- `stale`: mark age <= 60 minutes.
- `expired`: mark age > 60 minutes.
- `failed`: latest event is `position_mark_failed`.

Dashboard confidence:

- `verified_current`: wallet scan is recent and every open protocol position has a fresh/recent mark.
- `verified_minimum`: wallet scan is recent but one or more protocol marks are stale, missing, or failed.
- `external_reference_only`: local wallet or protocol reads are missing and only an external provider number exists.
- `adapter_missing`: at least one open position has no local adapter.

## Task 1: Protocol Mark Schema

**Files:**
- Create: `src/treasury/protocol-position-mark-schema.mjs`
- Test: `test/protocol-position-mark-schema.test.mjs`

- [ ] **Step 1: Write failing tests for successful marks**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freshnessForObservedAt,
  normalizeProtocolPositionMark,
  protocolMarkKey,
} from "../src/treasury/protocol-position-mark-schema.mjs";

test("normalizes a successful protocol mark with exact USD and BTC values", () => {
  const mark = normalizeProtocolPositionMark({
    event: "position_marked",
    observedAt: "2026-05-03T12:00:00.000Z",
    positionId: "merkl:base:op:tx",
    opportunityId: "op",
    chain: "base",
    protocolId: "yo",
    bindingKind: "erc4626_vault_supply_withdraw",
    adapterId: "erc4626",
    assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    assetSymbol: "USDC",
    assetDecimals: 6,
    assetBalance: "5015801",
    assetAmount: 5.015801,
    assetPriceUsd: 1,
    btcPriceUsd: 103000,
    walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    markSource: "onchain_erc4626_convert_to_assets",
  });

  assert.equal(mark.schemaVersion, 1);
  assert.equal(mark.event, "position_marked");
  assert.equal(mark.positionId, "merkl:base:op:tx");
  assert.equal(mark.valueUsd, 5.015801);
  assert.equal(mark.valueBtc, 5.015801 / 103000);
  assert.equal(mark.confidence, "verified_current");
  assert.equal(protocolMarkKey(mark), "merkl:base:op:tx");
});
```

- [ ] **Step 2: Write failing tests for freshness**

```js
test("classifies protocol mark freshness deterministically", () => {
  const now = "2026-05-03T12:10:00.000Z";
  assert.equal(freshnessForObservedAt("2026-05-03T12:09:00.000Z", now), "fresh");
  assert.equal(freshnessForObservedAt("2026-05-03T12:01:00.000Z", now), "recent");
  assert.equal(freshnessForObservedAt("2026-05-03T11:20:00.000Z", now), "stale");
  assert.equal(freshnessForObservedAt("2026-05-03T10:59:59.000Z", now), "expired");
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
node --test test/protocol-position-mark-schema.test.mjs
```

Expected: fails because `src/treasury/protocol-position-mark-schema.mjs` does not exist.

- [ ] **Step 4: Implement schema helpers**

Create `src/treasury/protocol-position-mark-schema.mjs` with exported functions:

```js
const FRESH_MS = 90_000;
const RECENT_MS = 10 * 60_000;
const STALE_MS = 60 * 60_000;

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function freshnessForObservedAt(observedAt, now = new Date().toISOString()) {
  const observedMs = Date.parse(observedAt || "");
  const nowMs = Date.parse(now || "");
  if (!Number.isFinite(observedMs) || !Number.isFinite(nowMs)) return "failed";
  const ageMs = Math.max(0, nowMs - observedMs);
  if (ageMs <= FRESH_MS) return "fresh";
  if (ageMs <= RECENT_MS) return "recent";
  if (ageMs <= STALE_MS) return "stale";
  return "expired";
}

export function protocolMarkKey(mark = {}) {
  return String(mark.positionId || `${mark.chain || "unknown"}:${mark.opportunityId || "unknown"}:${mark.shareTokenAddress || mark.assetAddress || "unknown"}`);
}

export function normalizeProtocolPositionMark(input = {}, { now = input.observedAt } = {}) {
  const event = input.event || "position_marked";
  const observedAt = input.observedAt || new Date().toISOString();
  const assetAmount = finiteNumber(input.assetAmount);
  const assetPriceUsd = finiteNumber(input.assetPriceUsd);
  const explicitValueUsd = finiteNumber(input.valueUsd);
  const valueUsd = explicitValueUsd ?? (assetAmount != null && assetPriceUsd != null ? assetAmount * assetPriceUsd : null);
  const btcPriceUsd = finiteNumber(input.btcPriceUsd);
  const valueBtc = finiteNumber(input.valueBtc) ?? (valueUsd != null && btcPriceUsd && btcPriceUsd > 0 ? valueUsd / btcPriceUsd : null);
  const freshness = event === "position_mark_failed" ? "failed" : freshnessForObservedAt(observedAt, now);
  const confidence = event === "position_mark_failed"
    ? "adapter_missing"
    : freshness === "fresh" || freshness === "recent"
      ? "verified_current"
      : "verified_minimum";

  return {
    schemaVersion: 1,
    event,
    status: input.status || "open",
    observedAt,
    positionId: input.positionId || null,
    opportunityId: input.opportunityId || null,
    strategyId: input.strategyId || null,
    chain: input.chain || null,
    protocolId: input.protocolId || null,
    bindingKind: input.bindingKind || null,
    adapterId: input.adapterId || null,
    walletAddress: input.walletAddress || null,
    assetAddress: input.assetAddress || null,
    assetSymbol: input.assetSymbol || null,
    assetDecimals: finiteNumber(input.assetDecimals),
    shareTokenAddress: input.shareTokenAddress || null,
    shareBalance: input.shareBalance != null ? String(input.shareBalance) : null,
    assetBalance: input.assetBalance != null ? String(input.assetBalance) : null,
    assetAmount,
    assetPriceUsd,
    valueUsd,
    valueBtc,
    markSource: input.markSource || null,
    freshness,
    confidence,
    rpcUrl: input.rpcUrl || null,
    failureKind: input.failureKind || null,
    message: input.message || null,
  };
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
node --test test/protocol-position-mark-schema.test.mjs
```

Expected: all tests pass.

Commit:

```bash
git add src/treasury/protocol-position-mark-schema.mjs test/protocol-position-mark-schema.test.mjs
git commit -m "feat: add protocol position mark schema"
```

## Task 2: Protocol Position Ledger

**Files:**
- Create: `src/treasury/protocol-position-ledger.mjs`
- Test: `test/protocol-position-ledger.test.mjs`

- [ ] **Step 1: Write failing tests for active record selection**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeProtocolPositions,
  latestProtocolMarksByPosition,
  mergeProtocolMarksIntoPositions,
} from "../src/treasury/protocol-position-ledger.mjs";

test("activeProtocolPositions returns open entries not subsequently closed by positionId", () => {
  const events = [
    { event: "position_opened", status: "open", positionId: "p1", observedAt: "2026-05-03T10:00:00.000Z", amountUsd: 5 },
    { event: "position_opened", status: "open", positionId: "p2", observedAt: "2026-05-03T10:01:00.000Z", amountUsd: 7 },
    { event: "position_exit_confirmed", status: "closed", positionId: "p1", observedAt: "2026-05-03T10:02:00.000Z" },
  ];

  assert.deepEqual(activeProtocolPositions(events).map((event) => event.positionId), ["p2"]);
});
```

- [ ] **Step 2: Write failing tests for mark merge**

```js
test("mergeProtocolMarksIntoPositions attaches latest mark and mark freshness", () => {
  const positions = [
    { positionId: "p2", opportunityId: "op", chain: "base", protocolId: "yo", amountUsd: 7 },
  ];
  const marks = latestProtocolMarksByPosition([
    { event: "position_marked", positionId: "p2", observedAt: "2026-05-03T10:00:00.000Z", valueUsd: 7.01 },
    { event: "position_marked", positionId: "p2", observedAt: "2026-05-03T10:03:00.000Z", valueUsd: 7.04 },
  ]);

  const merged = mergeProtocolMarksIntoPositions(positions, marks);
  assert.equal(merged[0].markUsd, 7.04);
  assert.equal(merged[0].markObservedAt, "2026-05-03T10:03:00.000Z");
  assert.equal(merged[0].markSource, "protocol_position_mark");
});
```

- [ ] **Step 3: Implement ledger helpers**

Create helpers that are pure and do not read the filesystem yet:

```js
function observedAtMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

export function activeProtocolPositions(events = []) {
  const latestByPosition = new Map();
  for (const event of events) {
    const positionId = event?.positionId;
    if (!positionId) continue;
    const current = latestByPosition.get(positionId);
    if (!current || observedAtMs(event.observedAt) >= observedAtMs(current.observedAt)) {
      latestByPosition.set(positionId, event);
    }
  }
  return [...latestByPosition.values()]
    .filter((event) => event.status === "open" || event.event === "position_opened")
    .sort((left, right) => observedAtMs(left.observedAt) - observedAtMs(right.observedAt));
}

export function latestProtocolMarksByPosition(marks = []) {
  const latest = new Map();
  for (const mark of marks) {
    if (!mark?.positionId) continue;
    const current = latest.get(mark.positionId);
    if (!current || observedAtMs(mark.observedAt) >= observedAtMs(current.observedAt)) {
      latest.set(mark.positionId, mark);
    }
  }
  return latest;
}

export function mergeProtocolMarksIntoPositions(positions = [], marksByPosition = new Map()) {
  return positions.map((position) => {
    const mark = marksByPosition.get(position.positionId);
    if (!mark || mark.event === "position_mark_failed") {
      return { ...position, markFailure: mark || null };
    }
    return {
      ...position,
      markUsd: Number.isFinite(Number(mark.valueUsd)) ? Number(mark.valueUsd) : null,
      valueUsd: Number.isFinite(Number(mark.valueUsd)) ? Number(mark.valueUsd) : position.valueUsd,
      currentValueUsd: Number.isFinite(Number(mark.valueUsd)) ? Number(mark.valueUsd) : position.currentValueUsd,
      valueBtc: Number.isFinite(Number(mark.valueBtc)) ? Number(mark.valueBtc) : position.valueBtc,
      markObservedAt: mark.observedAt || null,
      markSource: "protocol_position_mark",
      markFreshness: mark.freshness || null,
      markConfidence: mark.confidence || null,
      mark,
    };
  });
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node --test test/protocol-position-ledger.test.mjs
```

Expected: all tests pass.

Commit:

```bash
git add src/treasury/protocol-position-ledger.mjs test/protocol-position-ledger.test.mjs
git commit -m "feat: track active protocol position marks"
```

## Task 3: ERC-4626 Position Adapter

**Files:**
- Create: `src/treasury/protocol-position-adapters/erc4626.mjs`
- Test: `test/protocol-position-erc4626-adapter.test.mjs`

- [ ] **Step 1: Write failing test for YO/Morpho/Euler-style share marking**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { markErc4626Position } from "../src/treasury/protocol-position-adapters/erc4626.mjs";

test("markErc4626Position converts vault shares into current underlying USD", async () => {
  const calls = [];
  const contractReader = async ({ address, functionName, args }) => {
    calls.push({ address, functionName, args });
    if (functionName === "balanceOf") return 4_792_900n;
    if (functionName === "convertToAssets") return 5_015_801n;
    if (functionName === "asset") return "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    if (functionName === "decimals") return 6;
    if (functionName === "symbol") return "USDC";
    throw new Error(`unexpected call ${functionName}`);
  };

  const mark = await markErc4626Position({
    position: {
      positionId: "merkl:base:137:0x7e",
      opportunityId: "137",
      strategyId: "gateway_native_asset_conversion_sleeve",
      chain: "base",
      protocolId: "yo",
      bindingKind: "erc4626_vault_supply_withdraw",
      shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
    walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    contractReader,
    priceReader: async ({ symbol }) => (symbol === "USDC" ? 1 : null),
    btcPriceUsd: 103000,
    observedAt: "2026-05-03T12:00:00.000Z",
  });

  assert.equal(mark.event, "position_marked");
  assert.equal(mark.assetBalance, "5015801");
  assert.equal(mark.assetAmount, 5.015801);
  assert.equal(mark.valueUsd, 5.015801);
  assert.equal(mark.markSource, "onchain_erc4626_convert_to_assets");
  assert.equal(calls.some((call) => call.functionName === "convertToAssets"), true);
});
```

- [ ] **Step 2: Write failing test for zero share balance**

```js
test("markErc4626Position returns zero mark when the vault share balance is zero", async () => {
  const mark = await markErc4626Position({
    position: {
      positionId: "p-zero",
      chain: "base",
      protocolId: "yo",
      bindingKind: "erc4626_vault_supply_withdraw",
      shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
    walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 0n;
      if (functionName === "asset") return "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      if (functionName === "decimals") return 6;
      if (functionName === "symbol") return "USDC";
      return 0n;
    },
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: "2026-05-03T12:00:00.000Z",
  });

  assert.equal(mark.valueUsd, 0);
  assert.equal(mark.assetAmount, 0);
});
```

- [ ] **Step 3: Implement adapter**

Create `src/treasury/protocol-position-adapters/erc4626.mjs` using ethers interfaces in production, but keep `contractReader` injectable for tests:

```js
import { normalizeProtocolPositionMark } from "../protocol-position-mark-schema.mjs";

function decimalAmount(raw, decimals) {
  const denominator = 10 ** Number(decimals || 18);
  return Number(raw) / denominator;
}

export async function markErc4626Position({
  position,
  walletAddress,
  contractReader,
  priceReader,
  btcPriceUsd,
  observedAt = new Date().toISOString(),
} = {}) {
  const shareTokenAddress = position.shareTokenAddress || position.vaultAddress;
  const shareBalance = await contractReader({
    chain: position.chain,
    address: shareTokenAddress,
    functionName: "balanceOf",
    args: [walletAddress],
  });
  const assetAddress = position.assetAddress || await contractReader({
    chain: position.chain,
    address: shareTokenAddress,
    functionName: "asset",
    args: [],
  });
  const assetDecimals = Number(position.assetDecimals ?? await contractReader({
    chain: position.chain,
    address: assetAddress,
    functionName: "decimals",
    args: [],
  }));
  const assetSymbol = position.assetSymbol || await contractReader({
    chain: position.chain,
    address: assetAddress,
    functionName: "symbol",
    args: [],
  });
  const assetBalance = BigInt(shareBalance || 0) === 0n
    ? 0n
    : BigInt(await contractReader({
        chain: position.chain,
        address: shareTokenAddress,
        functionName: "convertToAssets",
        args: [shareBalance],
      }));
  const assetAmount = decimalAmount(assetBalance, assetDecimals);
  const assetPriceUsd = await priceReader({
    chain: position.chain,
    token: assetAddress,
    symbol: assetSymbol,
  });

  return normalizeProtocolPositionMark({
    event: "position_marked",
    observedAt,
    positionId: position.positionId,
    opportunityId: position.opportunityId,
    strategyId: position.strategyId,
    chain: position.chain,
    protocolId: position.protocolId,
    bindingKind: position.bindingKind,
    adapterId: "erc4626",
    walletAddress,
    assetAddress,
    assetSymbol,
    assetDecimals,
    shareTokenAddress,
    shareBalance: String(shareBalance ?? "0"),
    assetBalance: String(assetBalance),
    assetAmount,
    assetPriceUsd,
    btcPriceUsd,
    markSource: "onchain_erc4626_convert_to_assets",
    rpcUrl: position.rpcUrl || null,
  }, { now: observedAt });
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node --test test/protocol-position-erc4626-adapter.test.mjs
```

Expected: all tests pass.

Commit:

```bash
git add src/treasury/protocol-position-adapters/erc4626.mjs test/protocol-position-erc4626-adapter.test.mjs
git commit -m "feat: mark erc4626 protocol positions"
```

## Task 4: Aave And Compound-Style Lending Adapters

**Files:**
- Create: `src/treasury/protocol-position-adapters/aave-v3.mjs`
- Create: `src/treasury/protocol-position-adapters/compound-v2.mjs`
- Test: `test/protocol-position-aave-v3-adapter.test.mjs`
- Test: `test/protocol-position-compound-v2-adapter.test.mjs`

- [ ] **Step 1: Write failing Aave supply/debt mark test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { markAaveV3Position } from "../src/treasury/protocol-position-adapters/aave-v3.mjs";

test("markAaveV3Position subtracts debt from supplied value when debt token exists", async () => {
  const mark = await markAaveV3Position({
    position: {
      positionId: "aave-pos",
      opportunityId: "aave-op",
      chain: "ethereum",
      protocolId: "aave-v3",
      bindingKind: "aave_v3_supply_withdraw",
      assetAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      aTokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48-atoken",
      variableDebtTokenAddress: "0xDebt",
      assetDecimals: 6,
      assetSymbol: "USDC",
    },
    walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    contractReader: async ({ address, functionName }) => {
      if (functionName !== "balanceOf") throw new Error("unexpected function");
      if (address === "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48-atoken") return 20_000_000n;
      if (address === "0xDebt") return 5_000_000n;
      return 0n;
    },
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: "2026-05-03T12:00:00.000Z",
  });

  assert.equal(mark.assetAmount, 15);
  assert.equal(mark.valueUsd, 15);
  assert.equal(mark.markSource, "onchain_aave_token_balances");
});
```

- [ ] **Step 2: Write failing Compound/Moonwell cToken test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { markCompoundV2Position } from "../src/treasury/protocol-position-adapters/compound-v2.mjs";

test("markCompoundV2Position converts cToken balance through exchange rate", async () => {
  const mark = await markCompoundV2Position({
    position: {
      positionId: "moonwell-pos",
      opportunityId: "moonwell-op",
      chain: "base",
      protocolId: "moonwell",
      bindingKind: "compound_v2_supply_withdraw",
      cTokenAddress: "0xcToken",
      assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      assetDecimals: 6,
      assetSymbol: "USDC",
    },
    walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 10_000_000n;
      if (functionName === "exchangeRateStored") return 2_000_000_000_000_000n;
      return 0n;
    },
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: "2026-05-03T12:00:00.000Z",
  });

  assert.equal(mark.valueUsd, 20);
  assert.equal(mark.markSource, "onchain_compound_exchange_rate");
});
```

- [ ] **Step 3: Implement Aave adapter**

Use `aTokenAddress` and optional debt token addresses from position metadata. If the current canary plan does not store these addresses yet, the registry task will derive them from configured protocol bindings.

Implementation rules:

- Read `balanceOf(walletAddress)` from `aTokenAddress`.
- Read variable and stable debt token balances if present.
- Convert raw balances by `assetDecimals`.
- Value net assets as `supplied - debt`.
- Emit `position_mark_failed` if `aTokenAddress` is missing for an Aave binding.

- [ ] **Step 4: Implement Compound/Moonwell adapter**

Implementation rules:

- Read `balanceOf(walletAddress)` from `cTokenAddress`.
- Read `exchangeRateStored`; fall back to `exchangeRateCurrent` only when explicitly allowed in options because it can be non-view on some markets.
- Convert cToken shares to underlying using Compound's exchange-rate scale.
- Subtract `borrowBalanceStored(walletAddress)` if the position metadata says it is a loop or borrow-capable position.
- Emit `position_mark_failed` if `cTokenAddress` is missing.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
node --test test/protocol-position-aave-v3-adapter.test.mjs test/protocol-position-compound-v2-adapter.test.mjs
```

Expected: all tests pass.

Commit:

```bash
git add src/treasury/protocol-position-adapters/aave-v3.mjs src/treasury/protocol-position-adapters/compound-v2.mjs test/protocol-position-aave-v3-adapter.test.mjs test/protocol-position-compound-v2-adapter.test.mjs
git commit -m "feat: mark lending protocol positions"
```

## Task 5: Adapter Registry And Marker CLI

**Files:**
- Create: `src/treasury/protocol-position-adapter-registry.mjs`
- Create: `src/treasury/protocol-position-marker.mjs`
- Create: `src/cli/mark-protocol-positions.mjs`
- Modify: `package.json`
- Test: `test/protocol-position-marker.test.mjs`

- [ ] **Step 1: Write failing registry test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProtocolPositionAdapter } from "../src/treasury/protocol-position-adapter-registry.mjs";

test("resolveProtocolPositionAdapter maps current Merkl ERC4626 bindings to erc4626 adapter", () => {
  const adapter = resolveProtocolPositionAdapter({
    chain: "base",
    protocolId: "yo",
    bindingKind: "erc4626_vault_supply_withdraw",
    shareTokenAddress: "0x0000000f2eB9f69274678c76222B35eEc7588a65",
  });

  assert.equal(adapter.id, "erc4626");
});
```

- [ ] **Step 2: Write failing marker test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { markActiveProtocolPositions } from "../src/treasury/protocol-position-marker.mjs";

test("markActiveProtocolPositions marks active positions and returns appendable events", async () => {
  const marks = await markActiveProtocolPositions({
    positions: [
      {
        event: "position_opened",
        status: "open",
        positionId: "p-erc4626",
        opportunityId: "op",
        chain: "base",
        protocolId: "yo",
        bindingKind: "erc4626_vault_supply_withdraw",
        shareTokenAddress: "0xVault",
        assetAddress: "0xAsset",
      },
    ],
    walletAddress: "0x96262bE63AA687563789225c2fE898c27a3b0AE4",
    contractReader: async ({ functionName }) => {
      if (functionName === "balanceOf") return 5_000_000n;
      if (functionName === "convertToAssets") return 5_100_000n;
      if (functionName === "decimals") return 6;
      if (functionName === "symbol") return "USDC";
      if (functionName === "asset") return "0xAsset";
      throw new Error(functionName);
    },
    priceReader: async () => 1,
    btcPriceUsd: 103000,
    observedAt: "2026-05-03T12:00:00.000Z",
  });

  assert.equal(marks.length, 1);
  assert.equal(marks[0].event, "position_marked");
  assert.equal(marks[0].valueUsd, 5.1);
});
```

- [ ] **Step 3: Implement registry**

Registry rules:

- `bindingKind === "erc4626_vault_supply_withdraw"` maps to ERC-4626 adapter.
- `bindingKind === "euler_evault_deposit_withdraw"` maps to ERC-4626 adapter because eVault accounting is share-to-asset style for this dashboard layer.
- `bindingKind === "aave_v3_supply_withdraw"` maps to Aave adapter.
- `bindingKind === "compound_v2_supply_withdraw"` maps to Compound adapter.
- Unknown binding returns `null`, causing a `position_mark_failed` event with `failureKind: "adapter_missing"`.

- [ ] **Step 4: Implement marker orchestration**

`markActiveProtocolPositions` should:

- Accept already-loaded active positions for tests.
- Resolve adapter per position.
- Catch per-position errors and convert them into `position_mark_failed`.
- Never throw one failed protocol in a way that blocks every other position mark.
- Return events sorted by `positionId` for deterministic tests.

- [ ] **Step 5: Add CLI and package script**

Add script:

```json
"status:protocol-position-marks": "node src/cli/mark-protocol-positions.mjs"
```

CLI behavior:

```bash
npm run status:protocol-position-marks -- --write
```

- Reads active positions from `data/merkl-portfolio-positions.jsonl`.
- Uses configured EVM RPCs from existing chain config.
- Writes JSONL events to `data/protocol-position-marks.jsonl` only with `--write`.
- Prints a JSON summary to stdout with `markedCount`, `failedCount`, and `totalValueUsd`.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
node --test test/protocol-position-marker.test.mjs
npm run status:protocol-position-marks -- --json
```

Expected:

- Unit tests pass.
- CLI exits 0 and prints JSON.
- With no RPC/env available, CLI reports failed mark events in preview JSON but does not write without `--write`.

Commit:

```bash
git add src/treasury/protocol-position-adapter-registry.mjs src/treasury/protocol-position-marker.mjs src/cli/mark-protocol-positions.mjs package.json test/protocol-position-marker.test.mjs
git commit -m "feat: add protocol position marker cli"
```

## Task 6: Status Slices And Dashboard Totals

**Files:**
- Create: `src/status/protocol-position-marks-slice.mjs`
- Modify: `src/status/current-dashboard-context.mjs`
- Modify: `src/status/merkl-active-slice.mjs`
- Modify: `src/status/capital-summary-slice.mjs`
- Modify: `dashboard/public/data.jsx`
- Modify: `dashboard/public/app.jsx`
- Test: `test/protocol-position-marks-slice.test.mjs`
- Test: `test/dashboard-live-slices.test.mjs`
- Test: `test/dashboard-app.test.mjs`

- [ ] **Step 1: Write failing protocol mark slice test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProtocolPositionMarksSlice } from "../src/status/protocol-position-marks-slice.mjs";

test("buildProtocolPositionMarksSlice totals fresh marks and exposes confidence", () => {
  const slice = buildProtocolPositionMarksSlice([
    { event: "position_marked", positionId: "p1", chain: "base", protocolId: "yo", valueUsd: 5.01, observedAt: "2026-05-03T12:00:00.000Z", confidence: "verified_current" },
    { event: "position_marked", positionId: "p2", chain: "ethereum", protocolId: "morpho", valueUsd: 33.7, observedAt: "2026-05-03T12:00:10.000Z", confidence: "verified_current" },
  ], { generatedAt: "2026-05-03T12:01:00.000Z" });

  assert.equal(slice.totalMarkedUsd, 38.71);
  assert.equal(slice.markedPositionCount, 2);
  assert.equal(slice.confidence, "verified_current");
  assert.equal(slice.byChain.base.valueUsd, 5.01);
});
```

- [ ] **Step 2: Write failing capital summary test**

```js
test("capital summary uses wallet plus marked protocol positions as current total", () => {
  const slice = buildCapitalSummarySlice({
    walletHoldings: { totalUsd: 267.79, items: [], scanErrors: [], walletCoverage: "partial_supported" },
    merklActivePositions: {
      items: [
        { label: "YO", chain: "base", protocol: "yo", valueUsd: 5.015801, markSource: "protocol_position_mark", markObservedAt: "2026-05-03T12:00:00.000Z" },
      ],
    },
    generatedAt: "2026-05-03T12:01:00.000Z",
  });

  assert.equal(slice.currentWalletUsd, 267.79);
  assert.equal(slice.protocolDeployedUsd, 5.02);
  assert.equal(slice.currentTotalUsd, 272.81);
  assert.equal(slice.assetHeadline, "Current total assets");
  assert.equal(slice.assetFormula, "current_wallet_plus_marked_protocol_positions");
});
```

- [ ] **Step 3: Modify `merkl-active-slice` to prefer marks**

Rules:

- Latest protocol mark wins over entry amount.
- Entry amount remains `entryUsd`.
- If no mark exists, preserve current behavior and set `markMissing: true`.
- APR display fields:
  - `aprPct` from current opportunity source gets `aprSource: "opportunity_current"`.
  - Entry-only APR gets `aprSource: "position_entry"` and the UI must label it `ENTRY APR`.
  - Do not call entry APR `live APY`.

- [ ] **Step 4: Modify `capital-summary-slice` totals**

Rules:

- `currentWalletUsd`: sum of supported free wallet balances from whole-wallet scan.
- `protocolDeployedUsd`: sum of open positions with current marks; use entry amount only as verified minimum when mark is missing.
- `currentTotalUsd`: current wallet plus marked protocol positions when every open position is marked fresh/recent.
- `verifiedMinimumUsd`: current wallet plus all tracked positions with either mark or entry amount.
- `assetConfidence` follows the data contract.
- `externalReferenceGapUsd` may show gap against Zerion/DeBank, but never override headline current assets.

- [ ] **Step 5: Modify dashboard copy**

Dashboard should render:

```text
Current total assets
$272.81
remaining $267.79 + marked protocols $5.02 = current total $272.81
```

When one protocol is missing a mark:

```text
Verified minimum assets
$272.81
remaining $267.79 + tracked protocols $5.02 = verified minimum $272.81
1 protocol mark missing
```

When external provider has a larger number:

```text
External reference: Zerion $455.69, gap $182.88
```

The external line must appear as a diagnostic, not the main wallet total.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
node --test test/protocol-position-marks-slice.test.mjs test/dashboard-live-slices.test.mjs test/dashboard-app.test.mjs
```

Expected: all tests pass.

Commit:

```bash
git add src/status/protocol-position-marks-slice.mjs src/status/current-dashboard-context.mjs src/status/merkl-active-slice.mjs src/status/capital-summary-slice.mjs dashboard/public/data.jsx dashboard/public/app.jsx test/protocol-position-marks-slice.test.mjs test/dashboard-live-slices.test.mjs test/dashboard-app.test.mjs
git commit -m "feat: reconcile protocol marks into dashboard assets"
```

## Task 7: Mindmap Asset Cards

**Files:**
- Modify: `dashboard/public/mindmap.jsx`
- Modify: `dashboard/public/data.jsx`
- Test: `test/mindmap-ui-source.test.mjs`

- [ ] **Step 1: Write failing mindmap source test**

```js
test("mindmap chain cards include free wallet plus marked protocol assets by chain", () => {
  const data = buildMindmapSource({
    walletItems: [
      { chain: "base", usd: 96.12, sym: "cbbtc" },
    ],
    positionItems: [
      { chain: "base", usd: 5.02, protocol: "yo", markSource: "protocol_position_mark" },
    ],
  });

  const base = data.nodes.find((node) => node.id === "base");
  assert.equal(base.walletUsd, 96.12);
  assert.equal(base.protocolUsd, 5.02);
  assert.equal(base.totalUsd, 101.14);
});
```

- [ ] **Step 2: Update chain card labels**

Rules:

- Chain node value must be chain free wallet value plus marked protocol value.
- Node details card must show:
  - `FREE`
  - `DEPLOYED`
  - `TOTAL`
  - `YIELD`
  - `MOVED 6H`
- Do not add protocol-live green dots.
- Do not put external provider totals on chain nodes.

- [ ] **Step 3: Run tests and commit**

Run:

```bash
node --test test/mindmap-ui-source.test.mjs
```

Expected: all tests pass.

Commit:

```bash
git add dashboard/public/mindmap.jsx dashboard/public/data.jsx test/mindmap-ui-source.test.mjs
git commit -m "feat: show marked protocol assets on mindmap"
```

## Task 8: Realtime Cadence And External Provider Policy

**Files:**
- Modify: `src/cli/run-dashboard-public-live.mjs`
- Modify: `src/treasury/address-scan-api.mjs`
- Modify: `test/address-scan-api.test.mjs`
- Modify: `test/dashboard-live-server.test.mjs`

- [ ] **Step 1: Write failing tests for provider TTL**

```js
test("external portfolio provider is reference-only and rate limited", async () => {
  const reader = resolveAddressScanPortfolioReader({
    providers: ["zerion"],
    zerionApiKey: "key",
    externalPortfolioTtlMs: 10 * 60_000,
  }, {
    zerionReader: async () => ({ provider: "zerion", walletUsd: 455.69, totalPortfolioUsd: 455.69 }),
  });

  const first = await reader({ address: "0xabc" });
  const second = await reader({ address: "0xabc" });
  assert.equal(first.provider, "zerion");
  assert.equal(second.provider, "zerion");
});
```

- [ ] **Step 2: Update external provider policy**

Rules:

- Zerion, DeBank, Zapper, Moralis, or 1inch can be added as optional reference providers.
- Default TTL: 10 minutes.
- Provider `429` becomes a diagnostic line only.
- Provider totals do not affect `currentTotalUsd`.
- Provider `only_complex` or protocol endpoint can be used in a manual reconciliation command, but not in the fast live dashboard loop.

- [ ] **Step 3: Update live dashboard cadence**

Recommended cadence:

- UI poll interval: 1 to 2 seconds for local JSON/static files.
- Whole-wallet local RPC scan: 15 to 30 seconds.
- Protocol position marks: 30 to 60 seconds.
- External portfolio provider reference: 10 minutes or manual refresh.
- Historical PnL or provider metrics: 30 minutes to 1 hour.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node --test test/address-scan-api.test.mjs test/dashboard-live-server.test.mjs
```

Expected: all tests pass.

Commit:

```bash
git add src/cli/run-dashboard-public-live.mjs src/treasury/address-scan-api.mjs test/address-scan-api.test.mjs test/dashboard-live-server.test.mjs
git commit -m "fix: keep external portfolio providers reference only"
```

## Task 9: Build And Browser Verification

**Files:**
- Generated by build: `dashboard/public/app.js`
- Generated by build: `dashboard/public/data.js`
- Generated by build: `dashboard/public/mindmap.js`

- [ ] **Step 1: Run focused asset tests**

```bash
node --test test/protocol-position-mark-schema.test.mjs test/protocol-position-ledger.test.mjs test/protocol-position-erc4626-adapter.test.mjs test/protocol-position-aave-v3-adapter.test.mjs test/protocol-position-compound-v2-adapter.test.mjs test/protocol-position-marker.test.mjs test/protocol-position-marks-slice.test.mjs test/dashboard-live-slices.test.mjs test/dashboard-app.test.mjs test/mindmap-ui-source.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Build dashboard**

```bash
npm run dashboard:build
```

Expected: build completes and regenerates dashboard public bundles.

- [ ] **Step 3: Run full check**

```bash
npm run check
npm test
```

Expected: both commands pass.

- [ ] **Step 4: Verify in browser**

Open `http://127.0.0.1:8787/` and verify:

- Assets tab main number shows an exact amount, not `$219+`.
- Formula shows `remaining + marked protocols = current total`.
- If a protocol mark is missing, the headline says `Verified minimum assets`.
- External provider number appears only as a diagnostic reference.
- DeFi tab uses `ENTRY APR` when the source is only the entry event.
- Mindmap chain cards include marked protocol assets by chain.
- Protocol-live green dots are absent.

- [ ] **Step 5: Commit generated dashboard bundles only if publishing dashboard assets**

```bash
git add dashboard/public/app.js dashboard/public/data.js dashboard/public/mindmap.js
git commit -m "build: refresh dashboard protocol asset bundles"
```

Skip this commit if the branch convention is to leave generated dashboard files unstaged.

## Risk Controls

- This plan uses read-only RPC calls only.
- No signer calls are added.
- No strategy cap, payback policy, or live sizing changes are added.
- All mark events are append-only JSONL.
- Failed marks never block live trading by themselves. They only lower dashboard confidence and surface reconciliation warnings.
- External provider totals never override the local accounting headline.
- BTC-first accounting remains intact by storing `valueBtc` where BTC price is available and leaving USD as display data.

## Acceptance Criteria

- Entering an ERC-4626 strategy no longer makes the dashboard appear to lose the principal, because vault shares are marked back into underlying asset value.
- The assets headline shows exact current total when every open protocol position has a fresh or recent mark.
- When marks are missing or stale, the UI says `Verified minimum assets` and tells the operator which protocol mark is missing.
- `APY 12.00%` is not shown as live unless sourced from a current protocol/opportunity mark. Entry APR is labeled as entry APR.
- Zerion/API rate limits no longer make the dashboard total jump or collapse.
- Mindmap cards reflect chain-level free wallet plus deployed protocol value.
- Tests prove wallet value and protocol value are not double-counted.

## Self-Review

Spec coverage:

- Multi-protocol tracking difficulty explained in `Research Summary`.
- Other wallet measurement approaches covered with primary references.
- Current BOB Claw root cause mapped to existing files.
- Detailed implementation plan covers schema, adapters, marker, status slices, dashboard, mindmap, provider policy, and verification.

Placeholder scan:

- No unresolved placeholder steps remain.
- Every task names exact files and commands.

Type consistency:

- `positionId`, `opportunityId`, `valueUsd`, `valueBtc`, `markSource`, `markObservedAt`, `markFreshness`, and `markConfidence` are consistent across schema, ledger, slice, and dashboard tasks.
