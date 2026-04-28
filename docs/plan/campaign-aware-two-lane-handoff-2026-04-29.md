# Campaign-Aware Two-Lane Handoff Plan

> **For Kimi / coding agent:** implement this as policy and reporting changes first. Do not add a new five-daemon system. Keep runtime signing deterministic, caps committed in code, and all live transactions behind the existing policy engine and kill-switch.

**작성일:** 2026-04-29 KST

**Goal:** Convert BOB Claw from broad infrastructure-first automation into a small-capital, campaign-aware operator system without overfitting to one successful campaign or becoming overly conservative.

**Architecture:** Keep the existing signer, policy engine, Merkl Portfolio Orchestrator, Capital Manager, receipt ledger, kill-switch, and payback accumulator. Replace the proposed five parallel strategy lanes with two operating lanes: an Anchor lane for validated Base yield/CL surfaces, and an Opportunistic lane for capped campaign/micro tests. New discovery signals should feed scoring and alerts first; automatic execution is allowed only when a committed policy profile, supported executor binding, inventory, receipt proof path, and cap budget all pass.

**Tech Stack:** Node.js ESM, existing `src/config/*.mjs`, `src/executor/policy/*.mjs`, `src/executor/merkl-*.mjs`, `src/risk/auto-kill-triggers.mjs`, dashboard JSON slices, `node --test`.

---

## 1. Decision Summary

Reject the five-lane simultaneous conversion as an execution model.

Adopt a two-lane model:

| Lane | Capital intent | Runtime posture | Primary code path |
|---|---:|---|---|
| Anchor | 65-80% of operating capital | Active, but only for measured Base-first surfaces | existing strategy caps + Aerodrome/YO/Merkl bindings |
| Opportunistic | 10-20% of operating capital | Campaign/micro tests with hard loss caps | Merkl Orchestrator + campaign-aware scoring |
| Gas/idle | 5-15% | Always liquid, mostly Base/OP/Arb gas and USDC | Capital Manager |

Do not create separate production lanes for campaign hunter, micro validator, yield rotation, airdrop farming, and cross-chain campaign arbitrage. Those are policy modes inside the existing orchestrator and capital manager.

## 2. Evidence Snapshot

### 2.1 Local System Reality

Commands checked:

- `npm run report:strategy-catalog -- --json`
- `npm run report:payback-status -- --json`
- `npm run report:wallet-holdings-slice -- --json`
- `AGENTS.md`
- `docs/plan/high-yield-campaign-strategy-research-plan.md`
- `docs/plan/high-yield-micro-track.md`
- `docs/plan/autonomous-discovery-architecture.md`

Findings:

| Area | Observed state | Decision impact |
|---|---|---|
| Strategy catalog | 8 implemented lanes; 4 measured below policy, 2 unobserved, 2 analysis-only | Gateway/route alpha is not the primary source |
| Payback | 601 sats pending; minimum payback is 50,000 sats | Payback code exists, but profit engine is underfed |
| Wallet slice | latest wallet inventory shows about $201 itemized wallet assets; protocol positions may not be fully included | Do not assume active $350 Aerodrome position until position accounting proves it |
| Merkl queue | existing queue is broad, stale from 2026-04-24 in places, and Ethereum-heavy | Re-rank for Base-first small-capital mode |
| Current docs | Kimi plan is too five-lane/risk-on; Claude critique is directionally useful but assumes some unproven active exposure | Need synthesis, not blind adoption |

### 2.2 Current Public Market Checks

Public APIs checked on 2026-04-29 KST:

- DefiLlama Yields: `https://yields.llama.fi/pools`
- Dexscreener token pairs: `https://api.dexscreener.com/latest/dex/tokens/0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf`
- Merkl Base opportunities: `https://api.merkl.xyz/v4/opportunities?chainId=8453&campaigns=true`
- DefiLlama prices: `https://coins.llama.fi/prices/current/...`

Findings:

| Claim | Verification | Policy treatment |
|---|---|---|
| Aerodrome cbBTC/WETH is a real high-quality surface | Dexscreener shows the largest Base Aerodrome cbBTC/WETH pair near $22.3M liquidity and about $66.5M 24h volume | Valid Anchor candidate after live position accounting and IL/range monitor |
| Aerodrome WETH-cbBTC APR can show 500%+ | DefiLlama showed Aerodrome Slipstream WETH-CBBTC pools around 518-638% APY, reward-dominant | Treat as volatile displayed APY, not guaranteed realized APR |
| Merkl currently exposes Aerodrome cbBTC/WETH directly | Not verified in Merkl Base API; Merkl showed Quickswap cbBTC/WETH around 23.9% APR, not Aerodrome | Do not conflate DefiLlama/Aerodrome yield with Merkl campaign rewards |
| BTC around $77.7k in Claude report | DefiLlama current check showed BTC near $76.1k | Any report must timestamp prices |
| Five lanes are necessary | Not supported | Use two lanes plus policy hooks |

## 3. Synthesis of Claude and Kimi Plans

### Keep From Claude

- Five-lane simultaneous execution should be rejected for $500-scale capital.
- Existing Merkl Portfolio Orchestrator should absorb campaign hunting rather than adding a new daemon family.
- Aerodrome CL can be an Anchor candidate, but only with live IL/range monitoring and position accounting.
- Campaign tokens must be valued with a haircut and sold quickly unless explicitly whitelisted.
- Protocol concentration and ETH/BTC ratio movement are more important risks than generic APR-chasing.

### Keep From Kimi

- The system was overbuilt for broad transport/arbitrage and should be made opportunity-aware.
- "Confirm then expand" is the right live-capital validation method for campaign/micro tests.
- Micro tests are justified as learning budget, not stable yield.
- Existing safety harnesses should stay: policy engine, signer, audit log, kill-switch, payback ledger.

### Reject or Rewrite

| Original idea | Problem | Replacement |
|---|---|---|
| Monthly $50-100 stable target | Too close to assuming recurring 10-20% monthly return | Use monthly realized target bands: base $0-30, good $30-60, outlier $100+ |
| 60% campaign success target | Too high after token drawdown, anti-dust, sybil, gas | Track three rates: reward-accrual pass, realized-positive pass, outlier pass |
| Five independent lanes | Capital fragmentation and monitoring overhead | Two lanes with sub-modes |
| APR > 200% as entry trigger | Mostly marks volatile/low-depth pools | Use expected realized net after haircut, IL, gas, and exit cost |
| Auto airdrop farming | Weak EV and high time/noise | Manual side quest only; no signer automation |
| Cross-chain yield capital by default | Bridge/latency/campaign risk outweighs benefit at small size | Base-first; non-Base only with explicit net EV after bridge |

## 4. Required AGENTS.md Policy Changes

Do not paste market numbers like "641% APR" into `AGENTS.md`; they go stale. Add durable operating rules instead.

### 4.1 Add to Core Context

Recommended new bullets:

```markdown
- **Small-capital operating mode is active while operating capital is below $1,000.** In this mode, the primary alpha source is campaign-aware destination-chain yield, not route/transport spread. The system should run a Base-first two-lane model: Anchor yield/CL surfaces plus an Opportunistic campaign/micro-test sleeve.
- **Displayed APR is not strategy evidence.** Campaign, Merkl, Aerodrome, DefiLlama, or protocol UI APR must be converted into expected realized BTC-first PnL after reward-token haircut, IL, gas, bridge cost, claim/swap cost, and exit cost before it can drive sizing.
- **Outlier campaign wins are evidence of a lane, not a baseline.** A single BOB Rise-style payout can justify building detection and execution support, but it must not be annualized into monthly targets or cap increases.
```

### 4.2 Add to Objective Review

```markdown
- Do not create new live strategy lanes when an existing orchestrator can express the behavior as a policy hook. Campaign hunting, micro-tests, yield rotation, and local-chain opportunities should first be implemented as Merkl/Capital Manager scoring and exit policies.
- Campaign opportunities may be run live within cap only after the candidate has: current campaign data, supported executor binding, deterministic entry/exit path, reward-token valuation haircut, gas/claim/swap estimate, max loss, and receipt proof path.
- Do not call a campaign "successful" until reward accrual, claimability, token conversion, and realized net PnL are measured. Track paper, pending, estimated, and realized separately.
```

### 4.3 Add to Risk Limits

```markdown
- **Small-capital sleeve caps (<$1,000 operating capital):**
  - Anchor lane: 65-80% target allocation, but any CL position requires live range/IL monitoring and an emergency exit path.
  - Opportunistic lane: 10-20% hard cap; default $80 max while capital is around $500.
  - Micro-test budget: 6% hard cap; default $30 max while capital is around $500.
  - Per new/unproven protocol: $10 initial cap, $25 max after receipt-backed reward accrual and exit proof.
  - Per campaign: $25 initial cap, $50 max unless a committed diff raises it after realized-positive evidence.
  - Non-Base new entries require expected realized net profit greater than bridge+gas+claim+swap costs by at least $10 or 5% of position size, whichever is higher.
- **Protocol and venue concentration:** no single non-bluechip protocol may exceed 25% of operating capital without an explicit committed diff. CL venue exposure above 50% requires live position accounting, time-in-range monitoring, and a tested unwind.
- **Reward-token haircut:** non-stable reward tokens default to a 50% valuation haircut; pre-TGE/points default to 80-90% haircut; whitelisted liquid tokens may use a lower haircut only via config.
```

### 4.4 Add to Auto Kill-Switch Triggers

```markdown
- `relative_price_move` — trips when a configured pair used by a CL strategy moves beyond its window, e.g. ETH/BTC 7d move > 15% for WETH-cbBTC CL positions.
- `cl_range_health` — trips or pauses the strategy when time-in-range falls below policy threshold or IL exceeds fees over the configured window.
- `protocol_incident` — pauses affected strategies when a pinned exploit/incident feed or manually committed incident file names a touched protocol.
- `campaign_decay` — exits or pauses an opportunistic position when realized APR falls below 50% of entry APR, campaign TVL drains by 30%, reward token drops by 25%, or campaign end is within the harvest window.
```

### 4.5 Update Operator Memory

Replace stale strategy snapshot language with:

```markdown
- Current small-capital strategy posture: Base-first two-lane model.
  - Anchor lane: validated Base yield/CL candidates such as YO and Aerodrome cbBTC/WETH are allowed research/execution targets only with live position accounting, IL/range monitor, caps, and exit path.
  - Opportunistic lane: Merkl/campaign/micro-test opportunities are handled by Merkl Portfolio Orchestrator + Capital Manager policy hooks, not by five independent strategy daemons.
  - Route/transport lanes remain infrastructure unless measured positive edge returns.
  - Payback engine remains active carry; blocker is insufficient realized profit, not missing payback code.
```

## 5. Required Policy/Code Changes for Kimi

### Task 0: Worktree and Artifact Guard

**Files:** none

- Check `git status --short`.
- Do not revert existing user/generated changes.
- Treat `dashboard/public/*.json` and `data/*.jsonl` as generated artifacts unless the task explicitly requires them.
- Do not modify or delete audit logs.

Acceptance:

- A short note in the PR or handoff explains which dirty files were ignored as generated artifacts.

### Task 1: Add Small-Capital Campaign Policy Config

**Create:** `src/config/small-capital-campaign-mode.mjs`

The config should express the durable policy, not current APR numbers.

Required fields:

- `enabled`
- `capitalThresholdUsd`
- `anchorTargetPct`
- `opportunisticMaxPct`
- `microMaxPct`
- `defaultBudgetsUsd`
- `baseFirstChains`
- `nonBaseEntry`
- `rewardHaircuts`
- `campaignEntry`
- `microEntry`
- `clRisk`
- `protocolConcentration`

Suggested defaults:

```javascript
export const SMALL_CAPITAL_CAMPAIGN_MODE = Object.freeze({
  profileId: "small_capital_campaign_mode_v1",
  enabled: true,
  capitalThresholdUsd: 1_000,
  anchorTargetPct: Object.freeze({ min: 0.65, max: 0.80 }),
  opportunisticMaxPct: 0.20,
  microMaxPct: 0.06,
  defaultBudgetsUsd: Object.freeze({
    opportunisticMaxUsd: 80,
    microMaxUsd: 30,
    initialCampaignUsd: 25,
    maxCampaignUsd: 50,
    initialMicroUsd: 10,
    maxMicroUsd: 25,
  }),
  baseFirstChains: Object.freeze(["base", "optimism", "arbitrum"]),
  nonBaseEntry: Object.freeze({
    minNetProfitUsd: 10,
    minNetProfitPctOfPosition: 0.05,
  }),
  rewardHaircuts: Object.freeze({
    stable: 0.0,
    liquidBluechip: 0.25,
    defaultRewardToken: 0.50,
    preTgeOrPoints: 0.85,
  }),
  campaignEntry: Object.freeze({
    minHoursRemaining: 24,
    realizedNetBufferUsd: 3,
    maxGasAndClaimPctOfExpectedReward: 0.20,
    aprDecayExitPct: 0.50,
    tvlDrainExitPct: 0.30,
    rewardTokenDropExitPct: 0.25,
  }),
  microEntry: Object.freeze({
    minSafetyScore: 70,
    maxNewProtocolInitialUsd: 10,
    maxNewProtocolAfterProofUsd: 25,
    observationHoursBeforeScale: 48,
  }),
  clRisk: Object.freeze({
    maxEthBtcMove7dPct: 0.15,
    minTimeInRangePct24h: 0.80,
    exitWhenIlExceedsFeesHours: 24,
  }),
  protocolConcentration: Object.freeze({
    defaultMaxPct: 0.25,
    venueMaxPctWithLiveMonitor: 0.50,
  }),
});
```

Tests:

- New config shape test under `test/small-capital-campaign-mode.test.mjs`.

### Task 2: Integrate Policy Into Existing Opportunity Scoring

**Modify:**

- `src/config/merkl-opportunity-policy.mjs`
- `src/config/merkl-portfolio.mjs`
- `src/executor/policy/opportunity-policy.mjs`

Implementation intent:

- Add a small-capital profile rather than replacing the aggressive profile globally.
- Base-first candidates receive positive weight.
- Ethereum L1 candidates are allowed only when notional and expected realized net justify gas.
- Display APR is converted to `expectedRealizedAprPct` using reward haircut and cost estimates.
- Reject/alert candidates that pass displayed APR filters but fail realized net filters.

Acceptance:

- A candidate with 300% displayed APR, illiquid reward token, and high claim cost can be rejected.
- A Base campaign with moderate APR but positive expected realized net can be ranked above an Ethereum dust candidate.
- No policy path uses an LLM judgment.

### Task 3: Make Campaign Scanning Alert-First

**Prefer modify over new daemon:**

- Existing Merkl reporting/orchestrator modules if suitable.
- Add CLI only if needed: `src/cli/report-campaign-aware-opportunities.mjs`.

Required output fields:

- chain
- protocol
- opportunity id
- displayed APR
- expected realized APR after haircut
- TVL
- campaign age
- hours remaining
- expected gas/claim/swap/bridge cost
- reward token and haircut
- entry status: `observe`, `manual_confirm`, `auto_allowed`, `blocked`
- blockers

Do not sign from the scanner. It may enqueue only candidates that already pass deterministic policy and committed caps.

Acceptance:

- `npm run report:campaign-aware-opportunities -- --json` or equivalent produces a JSON artifact without touching signer or audit logs.

### Task 4: Fix Position Accounting Before Scaling Anchor

**Problem:** Latest wallet slice proves about $201 itemized wallet assets but does not prove the claimed $350 Aerodrome active position. Protocol positions may be outside that slice.

**Modify or create:**

- A position reconciliation report that includes wallet tokens plus known protocol positions.
- If Aerodrome CL is active, detect the NFT position, token pair, range, liquidity, current tick, unclaimed fees/rewards, estimated IL, and exit route.

Possible files:

- `src/executor/realtime-portfolio.mjs`
- `src/executor/health/position-reconciler.mjs`
- `src/strategy/aerodrome-cl-manager.mjs`
- `src/cli/report-anchor-position-health.mjs`

Acceptance:

- A report can answer: "Is there an active Aerodrome WETH-cbBTC/cbBTC-USDC position? How much USD? What range? What time-in-range? What exit path?"
- Anchor allocation may not assume a position exists unless this report proves it.

### Task 5: Add CL and Campaign Auto-Kill Inputs

**Modify:**

- `src/config/auto-kill.mjs`
- `src/risk/auto-kill-triggers.mjs`

Add pure evaluators for:

- relative pair move
- CL time-in-range / IL-vs-fees
- protocol incident file
- campaign decay

Inputs should come from JSON files or existing status artifacts, not from external network calls inside the signer path.

Acceptance:

- Unit tests cover pass and trip cases.
- Missing optional files produce `not_evaluated`, not false safety.

### Task 6: Update Dashboard/Reports Without Adding Raw Risk Jargon

**Modify:**

- Dashboard status slice generator, not browser-side raw JSONL.
- Campaign-aware report artifacts.

Dashboard should show:

- Anchor lane status
- Opportunistic lane budget used
- pending/carry payback
- next campaign candidate count
- top blocker in user language

It should not show formulas, private policy internals, or signer details.

### Task 7: Update `AGENTS.md`

Use the policy text in section 4. Keep `AGENTS.md` focused on durable operating rules and current operator memory. Put detailed implementation runbooks in docs, not in `AGENTS.md`.

Acceptance:

- `AGENTS.md` no longer implies all-chain allocation is always preferred for small capital.
- It clearly says campaign-aware small-capital mode is Base-first, two-lane, and realized-PnL driven.

## 6. Measurements That Must Not Be Skipped

Before any cap increase or automatic entry:

1. Re-run strategy catalog:
   - `npm run report:strategy-catalog -- --json`
2. Re-run payback:
   - `npm run report:payback-status -- --json`
3. Re-run wallet/protocol position accounting:
   - `npm run report:wallet-holdings-slice -- --json`
   - new anchor position health report from Task 4
4. Re-run campaign scan:
   - new campaign-aware report from Task 3
5. Verify tests:
   - `npm test`
   - targeted tests for new config/policy/risk files

## 7. First Month Operating Plan

### Week 1: Make the System Honest

- Add small-capital policy config.
- Add campaign-aware report, alert-only.
- Add anchor position health report.
- Update AGENTS durable rules.
- Do not increase caps.

Decision gate:

- If active Aerodrome position is not proven, treat Aerodrome as candidate, not Anchor allocation.

### Week 2: Base-First Campaign Scoring

- Re-rank Merkl/DefiLlama candidates for Base/OP/Arb.
- Apply reward haircuts and gas/claim/swap cost.
- Let top candidates become `manual_confirm` only, unless already supported by committed caps and executor binding.

Decision gate:

- First two entries should be manual-confirm or tiny canary only.

### Week 3: Opportunistic Sleeve Live Validation

- Run up to three capped opportunities.
- Initial entry: $10-25 depending on campaign vs micro.
- Scale only after 48h reward accrual and exit path proof.

Decision gate:

- Continue only if realized-positive rate is above zero after costs. Do not require 60%.

### Week 4: Anchor / Opportunistic Split Review

- Compute realized PnL, pending rewards, gas, claim/swap costs, and BTC-denominated carry.
- Decide whether to:
  - keep opportunistic budget at $80,
  - reduce to $30 learning budget,
  - or increase only via committed diff after realized-positive evidence.

## 8. Success Metrics

Use metrics that survive bear/neutral markets.

| Metric | Good first-month result | Failure signal |
|---|---:|---:|
| Realized net PnL | $0-30 normal, $30-60 strong | negative from repeated gas/failed entries |
| Opportunistic drawdown | less than $30 | more than $30 without operator-approved continuation |
| Reward accrual proof | at least one proof | no proof after multiple entries |
| Position accounting | anchor positions reconciled | dashboard and wallet reports disagree materially |
| Payback carry | increases in sats | still only paper USD values |

Do not use monthly $100 as a pass/fail target while capital is near $500. Treat $100+ months as outlier capture.

## 9. Non-Goals

- No runtime LLM decision-making.
- No new signer bypass.
- No five independent campaign daemons.
- No automatic social/X signal execution. Social signals may create alerts only.
- No auto-whitelisting unknown tokens.
- No cap increase from displayed APR alone.
- No Ethereum L1 dust farming unless expected realized net clears the non-Base threshold.

## 10. Open Questions for Operator Review

1. Is the intended operating capital currently about $500, about $200 wallet-only, or $500 including protocol positions? Kimi should not size policies until the position reconciler answers this.
2. Should Aerodrome CL be allowed to exceed 50% of capital after the live monitor exists, or should 50% remain a hard venue cap?
3. Should reward tokens be auto-sold to USDC by default, or only reported for manual harvest/sell during the first month?

Recommended default answers for implementation: reconcile first; keep 50% hard venue cap until 4 weeks of receipts; auto-sell only for allowlisted liquid tokens and otherwise alert.

