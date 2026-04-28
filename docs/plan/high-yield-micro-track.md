# High-Yield Micro-Track Strategic Plan
## BOB Claw Capital Deployment v2.1

**Status:** Planning Phase  
**Objective:** Deploy $30-50 into 1-3 high-yield, well-managed positions on Base, with real-time risk monitoring and automatic circuit breakers.  
**Risk Philosophy:** "Lose $50, learn. Don't lose $500 guessing."

---

## 1. Opportunity Reality Check

### 1.1 What We Can Execute Today (Binding Ready)

| Opportunity | Chain | APR | TVL | Binding | Status |
|---|---|---|---|---|---|
| YO Protocol USDC | Base | 12% | $19.8M | ERC4626 | Live, $40 deployed |
| YO Protocol wETH | Base | 8% | $11.7M | ERC4626 | Available |

**Assessment:** Too conservative for the stated goal. YO is our baseline, not our experiment.

### 1.2 What We Can See But Cannot Execute (Missing Infrastructure)

| Opportunity | Chain | APR | TVL | Why Blocked | Binding Needed |
|---|---|---|---|---|---|
| Morpho-blue RE7USDC | Base | **85%** | $794K | Not in Merkl queue; likely no Merkl rewards or binding missing | Morpho Blue direct (not ERC4626 wrapper) |
| Aerodrome CL USDC-cbBTC | Base | **289%** | $4.7M | `clLp` disabled in policy; no CLAMM binding | Aerodrome Slipstream `mint()` + NFT position manager |
| PancakeSwap V3 USDC-MUSD | Base | **29%** | $47K | Listed but may be ERC4626 wrapper only; actual V3 LP unclear | Verify if wrapper or direct |
| Quickswap WETH-AIX | Base | **517%** | $10K | Not whitelisted; TVL too low for policy; no binding | Quickswap V3 CLAMM binding |

### 1.3 Key Insight

The 289-517% APR opportunities are **CLAMM (Concentrated Liquidity AMM)** positions. They offer extreme yields because:
- Impermanent Loss risk is concentrated in narrow ranges
- Most LPs lose money due to IL exceeding fees
- Rewards are paid in volatile tokens (AERO, QUICK, AIX)

**Mathematical reality:** A 289% APR CL position with ±15% price movement has expected IL of 2-5% per day. If price trends against the position, the LP loses principal faster than fees accumulate.

---

## 2. Track Architecture: Two-Lane Model

We split capital into two independent tracks with different risk profiles and monitoring intensity.

### 2.1 Track A: Baseline Yield (Existing)

- **Target APR:** 8-15%
- **Risk level:** Low-Medium
- **Positions:** YO Protocol, Aave, Morpho vaults
- **Auto-exit triggers:** Protocol exploit, 30% TVL drop, peg depeg >1%
- **Capital allocation:** 60-70% of deployable capital

### 2.2 Track B: High-Yield Micro-Track (New)

- **Target APR:** 30-100%+ (realistic net after IL)
- **Risk level:** High
- **Max positions:** 3
- **Max per position:** $15-30
- **Max total exposure:** $50 (hard cap)
- **Auto-exit triggers:**
  - **-25% unrealized loss** → immediate exit
  - **Reward token drops >25% in 6h** → harvest and exit
  - **Campaign ends in <6h** → harvest only, no re-entry
  - **IL exceeds fees earned over 24h** → exit
  - **Any protocol health flag** → instant unwind
- **Required infrastructure:**
  - CLAMM position manager (Aerodrome/Quickswap/Uniswap V3)
  - Real-time IL calculator
  - Reward token price monitor
  - Auto-rebalance or auto-exit logic

---

## 3. Infrastructure Development Plan

### 3.1 Phase 1: Foundation (Week 1-2)

**Goal:** Enable the first high-yield position with manual oversight.

| Task | Description | Complexity | Risk |
|---|---|---|---|
| 3.1.1 | Build `aerodrome-cl-auto-build.mjs` | High | Medium |
| 3.1.2 | Add Morpho Blue direct binding | Medium | Low |
| 3.1.3 | Build IL calculator for CL positions | Medium | Low |
| 3.1.4 | Integrate reward token price feed | Low | Low |
| 3.1.5 | Build aggressive exit monitor | Medium | Medium |

**Phase 1 Deliverable:** Deploy $15-30 into **one** high-yield position (Morpho RE7USDC or Aerodrome CL) with manual approval for entry, auto-exit enabled.

### 3.2 Phase 2: Automation (Week 3-4)

**Goal:** Reduce manual oversight to near-zero for Track B.

| Task | Description | Complexity |
|---|---|---|
| 3.2.1 | Auto-rebalance CL positions when price moves ±5% | High |
| 3.2.2 | Batch reward harvesting across positions | Medium |
| 3.2.3 | Auto-compound rewards into principal | Medium |
| 3.2.4 | Multi-position correlation risk monitor | Medium |

### 3.3 Phase 3: Scaling (Week 5+)

**Goal:** Expand to 3 positions, evaluate performance.

| Task | Description |
|---|---|
| 3.3.1 | Add Quickswap V3 binding |
| 3.3.2 | Evaluate 4-week realized returns vs. paper returns |
| 3.3.3 | Decision: scale up, maintain, or shut down Track B |

---

## 4. Return Prediction with Risk Management

### 4.1 Scenario Analysis: $30 in Morpho-blue RE7USDC (85% APR)

**Assumptions:**
- APR is sustainable for 30 days (big assumption — reward emissions decay)
- No smart contract exploit
- Entry/exit gas: $0.20 total (Base)
- No IL (stablecoin lending)

**Expected return:**
- Gross 30-day yield: $30 × (85% / 12) = **$2.13**
- Net after gas: **$1.93**
- Annualized net: **~64%**

**Risk-adjusted (80% confidence):**
- 20% chance APR drops to 40% in week 2 → expected yield: $1.20
- 10% chance smart contract issue → -$30
- Expected value: (0.7 × $1.93) + (0.2 × $0.80) + (0.1 × -$30) = **-$0.85**

**Conclusion:** Even with "safe" Morpho, the expected value is negative if we price in tail risk. But tail risk is priced by the entire DeFi market. For a $30 experiment, the question is not EV — it's "does the system survive and learn?"

### 4.2 Scenario Analysis: $30 in Aerodrome CL USDC-cbBTC (289% APR)

**Assumptions:**
- Price stays within ±8% of entry range for 7 days
- IL averages 0.3% per day
- Rewards harvested every 3 days
- Gas per harvest: $0.05

**Expected return (7-day hold):**
- Gross yield: $30 × (289% / 365) × 7 = **$1.66**
- IL: $30 × 0.003 × 7 = **$0.63**
- Harvest gas (2x): **$0.10**
- Net: **$0.93** (3.1% in 7 days)
- Annualized net: **~162%**

**Downside scenario (price exits range):**
- IL jumps to 5% immediately
- Net: -$1.50 + $0.20 (partial fees) = **-$1.30**
- Auto-exit triggers, total loss: **-$1.50**

**Conclusion:** CLAMM is viable ONLY with:
1. Tight auto-exit at -10% unrealized
2. Frequent harvesting (every 1-3 days)
3. Price monitoring every 15 minutes
4. Willingness to accept -25% drawdown as "learning cost"

### 4.3 Summary: Which Track B Strategy is Best?

| Strategy | Realistic Net APR | Max Drawdown | IL Risk | Execution Complexity |
|---|---|---|---|---|
| Morpho RE7USDC | 50-70% | -5% (exploit) | None | Medium |
| Aerodrome CL wide range | 80-120% | -15% | Medium | High |
| Aerodrome CL narrow range | 150-250% | -30% | High | High |
| Quickswap exotic pair | 200-400% | -50% | Very High | Very High |

**Recommendation:** Start with **Morpho RE7USDC** for Track B proof of concept. It's the only one where the system can learn without dying. Once the auto-exit infrastructure is proven, move to Aerodrome CL.

---

## 5. Policy Changes Required

### 5.1 New Config File: `src/config/high-yield-micro-track.mjs`

```javascript
export const HIGH_YIELD_MICRO_TRACK = Object.freeze({
  profileId: "high_yield_micro_track_v1",
  enabled: false, // Require operator explicit toggle
  maxTotalUsd: 50,
  maxPositions: 3,
  maxPerPositionUsd: 30,
  minPerPositionUsd: 10,
  targetChains: Object.freeze(["base"]), // Base only for gas efficiency
  targetAprMin: 30,
  
  // Risk circuit breakers
  autoExitTriggers: Object.freeze({
    unrealizedLossPct: 25,        // Exit at -25%
    rewardTokenDropPct: 25,       // Exit if reward token drops 25%
    campaignEndsHours: 6,         // No new entry, harvest only
    ilExceedsFeesHours: 24,       // If IL > fees over 24h, exit
    maxConsecutiveHarvestFailures: 2,
  }),
  
  // Position sizing
  sizing: Object.freeze({
    initialDeployPct: 0.20,       // 20% of available capital
    maxDeployPct: 0.35,           // Never exceed 35%
    compoundThresholdUsd: 5,      // Auto-compound when rewards > $5
  }),
  
  // Allowed opportunity types (expand as bindings are built)
  allowedExecutionSurfaces: Object.freeze({
    erc4626Vault: true,           // YO, Morpho vaults
    morphoBlueDirect: false,      // Enable after binding built
    clLp: false,                  // Enable after IL monitor built
  }),
});
```

### 5.2 Opportunity Policy Override

For Track B candidates only:
- Lower `minTvlUsdByFamily` to $50K for observation
- Enable `clLp` and `managedVault` for Base chain only
- Reduce `minHoursRemainingForNewEntry` to 12 hours (for quick rotation)
- Add `high_yield_micro_track` as a separate validation path

### 5.3 Sizing Policy Exception

Track B positions bypass `minPositionUsd: $25` via explicit `microTest: true` with `track: "high_yield"` metadata. The track-level cap ($50 total) is enforced instead of the global single-position cap.

---

## 6. Risk Management: How We Don't Lose More Than $50

### 6.1 Pre-Entry Checks (Deterministic)

1. **Contract verification:** Codehash matches known-good deployment
2. **TVL sanity:** TVL > $100K (anti-rug)
3. **APR sustainability:** APR > 30% but < 1000% (anti-Ponzi)
4. **Campaign duration:** > 24h remaining
5. **Liquidity depth:** Can exit within 1% slippage for position size
6. **Kill-switch:** System-wide kill-switch must be OFF

### 6.2 In-Position Monitoring (Every 15 minutes)

1. **Price oracle:** Pyth + Chainlink dual-source
2. **Unrealized PnL:** Track position value vs. entry
3. **IL calculator:** For CL positions, compute IL in real-time
4. **Reward accrual:** Estimate accumulated rewards
5. **Protocol health:** TVL, oracle deviation, admin changes

### 6.3 Exit Triggers (Automatic)

| Trigger | Action | Latency |
|---|---|---|
| Unrealized loss ≥ 25% | Full exit | < 5 minutes |
| Reward token drops ≥ 25% | Harvest + exit | < 10 minutes |
| Campaign ends in < 6h | Harvest only, no re-entry | < 30 minutes |
| IL > fees (24h rolling) | Full exit | < 5 minutes |
| Protocol health flag | Full exit | < 2 minutes |
| Kill-switch ON | Halt all entry, exit pending positions | Immediate |

### 6.4 Post-Exit Analysis

Every exit writes to `data/high-yield-track/exit-analysis.jsonl`:
- Entry/exit timestamps
- Gross yield, IL, gas costs
- Why exited (trigger or manual)
- Lessons for next iteration

---

## 7. First Deployment Plan: Morpho RE7USDC

### 7.1 Why This First

- **No IL:** Stablecoin lending (USDC)
- **Morpho Blue:** Battle-tested protocol, multiple audits
- **Base chain:** Gas negligible
- **Binding path:** We have `morpho_pool_supply_withdraw` in registry, but it maps to Aave-style. Need to verify if RE7USDC is a Morpho vault (ERC4626) or direct Blue market.

### 7.2 Pre-Flight Checklist

- [ ] Verify RE7USDC contract is ERC4626 (call `asset()`, `deposit()`)
- [ ] Verify current APR is sustainable (check reward emission schedule)
- [ ] Confirm Base USDC balance ≥ $30
- [ ] Build/test deposit intent via `erc4626-protocol-canary.mjs`
- [ ] Set up position monitoring (automated)
- [ ] Confirm auto-exit path (redeem → USDC)

### 7.3 Deployment Steps

1. **Day 0:** Pre-flight checklist complete
2. **Day 0:** Deploy $30 USDC → RE7USDC
3. **Day 1-7:** Monitor every 4 hours. Log yield accrual.
4. **Day 7:** Evaluate. If APR > 50% and no issues, hold.
5. **Day 14:** Decision point:
   - If net yield > $1.50: Consider adding second position
   - If net yield < $0.50: Exit, analyze, iterate
   - If any trigger fired: Exit, document, improve

---

## 8. Timeline & Milestones

| Week | Milestone | Capital at Risk |
|---|---|---|
| W1 | Infrastructure build (Morpho binding, IL calc, monitor) | $0 |
| W2 | First $30 deploy (Morpho RE7USDC) | $30 |
| W3 | Evaluate W2 results. Build Aerodrome CL binding if W2 positive. | $30 |
| W4 | Potential second position (Aerodrome CL $15-20) | $45-50 |
| W5+ | Evaluate 4-week data. Decision: scale, maintain, or close Track B. | $0-50 |

---

## 9. Success Criteria

Track B is considered successful if **all** of the following are met after 4 weeks:

1. **No single loss > $10** (max drawdown per position)
2. **Total net yield > $5** (10% on $50, or 17% on $30)
3. **All auto-exit triggers worked correctly** (tested via simulation or real event)
4. **System remained stable** (no crashes, no manual intervention required for routine ops)
5. **Learning documented:** At least 3 concrete improvements identified for next iteration

---

## 10. Open Questions for Discussion

1. **Should we build Morpho Blue direct binding, or find an ERC4626 wrapper?**
   - Direct: More control, more code
   - Wrapper: Reuse existing ERC4626 infrastructure, but wrapper adds smart contract risk

2. **Aerodrome CL auto-rebalance: should we implement it?**
   - Yes: Maximizes time-in-range, but adds complexity and gas
   - No: Simpler, accept lower yield, rely on auto-exit and manual re-entry

3. **Should Track B have its own kill-switch, or share the system-wide one?**
   - Own: More granular control
   - Shared: Simpler, consistent with current architecture

4. **What is the maximum acceptable "learning cost"?**
   - Proposal: $50 total across all Track B experiments. If exceeded, pause Track B for review.

5. **Should we use Merkl rewards as the primary filter, or expand to non-Merkl opportunities?**
   - Merkl-only: Smaller universe, but rewards are transparent and trackable
   - Expanded: More opportunities, but need to build reward tracking from scratch

---

## Appendix A: Morpho RE7USDC Contract Verification

```bash
# Verify if RE7USDC is ERC4626
cast call 0xRE7_ADDRESS "asset()" --rpc-url $BASE_RPC
cast call 0xRE7_ADDRESS "totalAssets()" --rpc-url $BASE_RPC
cast call 0xRE7_ADDRESS "convertToAssets(uint256)" 1000000000 --rpc-url $BASE_RPC
```

If `asset()` returns USDC address, it's ERC4626 and deployable today with existing infrastructure.

## Appendix B: Aerodrome Slipstream Pool Discovery

```bash
# Factory address: 0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A
# Find pool for USDC-cbBTC
cast call 0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A \
  "getPool(address,address,uint24)" \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf \
  100 --rpc-url $BASE_RPC
```

## Appendix C: Reference — CLAMM IL Formula

For a position in range [P_a, P_b] with current price P:

```
IL = 2 * sqrt(k) / (1 + k) - 1
where k = P_exit / P_entry (if P_exit > P_entry)
or k = P_entry / P_exit (if P_exit < P_entry)
```

For narrow ranges (e.g., ±5%), IL becomes significant at ±10% price movement.

---

*Document version: 0.1*  
*Last updated: 2026-04-28*  
*Next review: After first Track B deployment (target W2)*
