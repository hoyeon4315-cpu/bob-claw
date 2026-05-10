# BTC Capital Utilization Approval — Predicted Capital Flow

> **Scenario:** Operator approves capital deployment (`refill_routes_unresolved` and `strategy_dispatch_not_ready` blockers cleared).  
> **Date:** 2026-05-10  
> **Current measured capital:** ~$858.57 wallet holdings (13 chains) + protocol positions  
> **Mode:** Small-capital (`<$1,000`) — `small_capital_campaign_mode_v1` active  
> **Primary chain:** Base (evidence-primary, 70% max share)  

---

## 1. Starting Capital Snapshot (Pre-Approval)

### Wallet Holdings (RPC-verified, `report:wallet-holdings-slice`)
| Chain | Key Assets | Estimated USD |
|---|---|---|
| Bitcoin L1 | BTC 620,483 sats | **$501.08** |
| Base | ETH, wBTC.OFT, cbBTC | **~$35** (gas + dust) |
| Ethereum | stables, RWAs, ETH dust | **~$14** |
| Bera | BERA native | **$6.09** |
| Avalanche | AVAX native | **$5.33** |
| Others (Sonic, Soneium, BSC, etc.) | Gas tokens, dust | **~$297** (scattered) |
| **Total** | | **$858.57** |

### Protocol-Locked Positions
| Protocol | Chain | Status | Est. USD |
|---|---|---|---|
| YO (yoUSD vault) | Base | Active | ~$75 (per slot attribution) |
| Moonwell | Base | Exited (2026-05-06 `balanceOf=0`) | $0 |
| Morpho (Ethereum) | Ethereum | Exited | $0 |
| Aave | Ethereum | Exited | $0 |
| **Total protocol-locked** | | | **~$75** |

### Total Deployable Capital
- **Wallet:** $858.57
- **Protocol:** ~$75
- **Grand total:** **~$933** (small-capital mode still active)

---

## 2. Capital Manager Refill Plan (Post-Approval)

When `REFILL_REQUIRED` blocker clears, `plan-capital-manager-refill-jobs.mjs` computes:

### 2.1 Score-Weighted Targets
```
targetBalances = buildScoredTargetBalances({
  strategies: autoExecute=true strategies,
  positiveCaps: perChainUsd,
  filter: 11 official Gateway destinations,
  allocation: water-fill by weight, clip by per-chain/strategy caps
})
```

### 2.2 Expected Rebalance Actions
| From (Surplus) | To (Shortfall) | Asset | Est. USD | Reason |
|---|---|---|---|
| Bitcoin L1 | Base | wBTC.OFT via Gateway | **$300-400** | Anchor lane primary chain |
| Bitcoin L1 | Ethereum | wBTC.OFT via Gateway | **$50-75** | Opportunistic (Morpho, Aave) |
| Scattered chains (Sonic, Soneium, Bera) | Base | wBTC.OFT via Gateway | **$150-200** | Idle dust consolidation |
| Base wallet | YO vault | USDC → yoUSD | **$50-75** | Anchor yield position |

### 2.3 Gas Float Top-Ups
Per-chain minimum native token balances:
| Chain | Current | Target | Action |
|---|---|---|---|
| Base | $9.82 ETH | $12 | Top-up $2.18 |
| Ethereum | $14 ETH | $30 | Top-up $16 |
| Bera | $6 BERA | $6 | Adequate |
| Avalanche | $5.33 AVAX | $6 | Top-up $0.67 |

---

## 3. Strategy Allocation (Small-Capital Caps)

With `operatingCapitalUsd ≈ $933` and `bandId: "small"` (`multiplier: 1.0`):

### 3.1 Anchor Lane (55-70% target)
**Budget:** `$933 × 0.70 = $653` (absolute max, but soft guidance)
**Effective cap:** No hard cap for anchor, but per-strategy caps apply

| Strategy | Chain | Protocol | Allocation | Cap |
|---|---|---|---|---|
| YO yoUSD vault | Base | YO | **$75-100** | perTx $25, perDay $200 |
| Aerodrome CL (cbBTC/WETH) | Base | Aerodrome | **$100-150** | perTx $200, perDay $1000 |
| Wrapped-BTC loop | Base | Moonwell + Odos | **$150-200** | perTx $500, perDay $2000 |
| **Anchor subtotal** | | | **~$400-500** | |

### 3.2 Opportunistic Lane (30% hard cap)
**Budget:** `min($933 × 0.30, $125) = $125` (capped by small-cap baseline)

| Strategy | Chain | Protocol | Allocation | Cap |
|---|---|---|---|---|
| Merkl campaign (highest score) | Base | YO / Aerodrome | **$35-80** | campaign max $80 |
| Merkl campaign (secondary) | Ethereum | Morpho | **$25-50** | per chain cap |
| **Opportunistic subtotal** | | | **~$60-125** | |

### 3.3 Micro-Test Lane (10% hard cap)
**Budget:** `min($933 × 0.10, $50) = $50` (capped by small-cap baseline)

| Strategy | Chain | Protocol | Allocation | Cap |
|---|---|---|---|---|
| New protocol micro-canary | Base | New venue | **$10-25** | Initial $10, max $25 after proof |
| Radar-driven tiny canary | Any | Executable | **$10-30** | perCanary $30, perDay $90 |
| **Micro subtotal** | | | **~$20-50** | |

### 3.4 Reserve / Unallocated
**Reserve floor:** `22-35%` of capital = `$205-326` (for gas, slippage, emergency exits)

---

## 4. Weekly Harvest → Payback Flow

### 4.1 Harvest Cycle (Auto-Scheduler)
```
scheduleHarvests({ positions, policy, now })
→ scans all live positions
→ emits harvest intents for positions where nextHarvestAt <= now
```

**Expected weekly harvests:**
| Position | Chain | Est. Weekly Yield | Asset |
|---|---|---|---|
| YO yoUSD | Base | ~$0.50-1.50 | yoUSD (stable) |
| Aerodrome CL | Base | ~$1.00-3.00 | AERO + fees |
| Wrapped-BTC loop | Base | ~$0.50-2.00 | USDC (borrow yield) |
| Merkl campaigns | Base/Eth | Variable | Reward tokens |
| **Total weekly gross** | | **~$2-6** | |

### 4.2 Auto-Convert
```
buildConvertIntent({ fromToken: rewardToken, toToken: wBTC.OFT, chain: base })
→ uses Odos/Uniswap v3
→ attaches expectedNetUsd
```

**Post-conversion:**
- Reward tokens → wBTC.OFT on Base
- Net after gas + slippage: ~$1.50-4.50/week

### 4.3 Auto-Compound (80%) + Payback Reserve (20%)
```
buildCompoundIntent({ harvestedAmount, compoundRatio: 0.80 })
→ 80% reinvested into same position
→ 20% flows to payback accumulator
```

**Weekly payback reserve:** `$1.50-4.50 × 0.20 = $0.30-0.90`
**In BTC:** `0.30/80,000 = 375 sats` to `0.90/80,000 = 1,125 sats`

### 4.4 Payback Accumulator
```
plannedPayback_sats = max(0, floor(profit_sats × baseRatio × regimeMultiplier × volMultiplier) - estimatedOfframpCost_sats)
```

**Current state:**
- Accumulated: **581 sats**
- Minimum to trigger: **5,000 sats**
- Weekly addition: ~375-1,125 sats
- **Time to first payback:** ~4-12 weeks (at current yield rates)

### 4.5 Payback Execution (Weekly Scheduler)
When `plannedPayback_sats >= 5,000`:
1. **Source:** wBTC.OFT on Base (profit reserve)
2. **Swap:** wBTC.OFT → native BTC via CoW/Uniswap v3
3. **Bridge:** LayerZero Composer to BOB L2
4. **Gateway:** `OfframpRegistry.createOrder()`
5. **Settlement:** Bitcoin L1 `bc1p809...` address
6. **Proof:** Bitcoin L1 balance delta confirmed by Receipt Ingestor

**Payback amount example (at 5,000 sats minimum):**
- Gross profit: 5,000 sats / 0.20 (baseRatio) = 25,000 sats profit required
- Offramp cost: ~500 sats (1-2% of payback)
- Net payback to operator: **~4,500 sats (~$36)**

---

## 5. Key Metrics Over Time (Projected)

Assuming capital remains ~$933 and yields are realized as estimated:

| Week | Harvested | Converted Net | Compounded | Payback Reserve | Cumulative Payback | Total Capital |
|---|---|---|---|---|---|---|
| 0 | — | — | — | 581 sats | 0 | $933 |
| 4 | $8-24 | $6-18 | $4.80-14.40 | 1,481-5,081 sats | 0 (below min) | $938-947 |
| 8 | $16-48 | $12-36 | $9.60-28.80 | 2,381-9,581 sats | 0 or 1st payback | $943-962 |
| 12 | $24-72 | $18-54 | $14.40-43.20 | 3,281-14,081 sats | 1-2 paybacks | $948-977 |
| 26 | $52-156 | $39-117 | $31.20-93.60 | 6,581-30,581 sats | 3-6 paybacks | $968-1,027 |

**Note:** These are rough projections. Actual yields depend on:
- Campaign duration and APR stability
- Reward token price (post-haircut applied)
- Gas costs (Base ~$0.012, Ethereum ~$0.36 per tx)
- Slippage on conversion
- Protocol incidents (auto-kill triggers)

---

## 6. Risk Scenarios

### 6.1 Base Chain RPC Failure
- **Impact:** Harvest, compound, payback blocked on Base
- **Mitigation:** Chain failover activates → Ethereum becomes temporary profit reserve
- **Time to switch:** ~5 minutes (nonce monitor + capital manager)

### 6.2 YO Vault APR Drops 50%
- **Impact:** Anchor lane yield halves
- **Mitigation:** Auto-harvest scheduler detects APR decay → `campaign_decay` trigger → position unwinds → capital reallocated to next highest scorer
- **Time to exit:** ~1 hour (fast-exit depth guard)

### 6.3 Merkl Reward Token Drops 25%
- **Impact:** Opportunistic lane EV turns negative
- **Mitigation:** `rewardTokenDropExitPct: 0.25` triggers auto-exit → capital returns to Base reserve
- **Time to exit:** ~30 minutes

### 6.4 3 Consecutive Failures on Any Strategy
- **Impact:** Strategy auto-paused
- **Mitigation:** `consecutive-failures.mjs` blocks next intent → operator review required
- **Recovery:** `healStrategyFailures` with cooldown (30 min) or operator reset via committed diff

---

## 7. What Triggers First Real Payback

**Minimum required:**
1. **Realized gross profit:** 25,000 sats (~$200 at $80k/BTC)
2. **After 20% baseRatio:** 5,000 sats planned payback
3. **After offramp cost:** ~4,500 sats net
4. **Bitcoin L1 delivery proof:** Confirmed balance delta

**At current yields ($2-6/week gross):**
- **Fastest path:** 4-5 weeks (if all yields realized and converted smoothly)
- **Realistic path:** 8-12 weeks (accounting for gas, slippage, campaign rotations)
- **Bear case:** 20+ weeks (if APRs drop, campaigns end, or positions need rebalancing)

---

## 8. Capital Concentration Risk

With $933 and Base as primary chain (70% max share):
- **Base concentration:** ~$653 max = **70%** — within policy
- **Ethereum concentration:** ~$140 max = **15%** — within policy
- **Other chains:** ~$140 combined = **15%** — within policy

**Diversity enforced by:**
- `enforceDiversity` in `top-k-rotator.mjs`: maxSameChain=1 per K slot
- `concentration_guard` in policy engine: rejects if chain/protocol/family exceeds threshold

---

## 9. Summary

**If operator approves capital utilization today:**

1. **Refill phase (Day 0-1):** BTC L1 → Base via Gateway ($300-400), scattered dust → Base ($150-200)
2. **Deployment phase (Day 1-3):**
   - Anchor: $400-500 (YO + Aerodrome CL + wrapped-BTC loop)
   - Opportunistic: $60-125 (Merkl campaigns)
   - Micro: $20-50 (new protocol tests)
   - Reserve: $200-300 (gas + emergency)
3. **Harvest cycle (Weekly):** $2-6 gross → $1.50-4.50 net → 20% to payback reserve
4. **First payback:** 4-12 weeks, ~4,500 sats (~$36) to `bc1p809...`
5. **Compounding:** 80% reinvested → capital grows slowly toward $1,000 threshold

**The system is code-ready. The blocker is operational (refill routes + strategy dispatch), not architectural.**

---

*Document generated: 2026-05-10*
*Data sources: `report:wallet-holdings-slice`, `plan-capital-manager-refill-jobs`, `src/config/small-capital-campaign-mode.mjs`, `src/config/payback.mjs`, `src/config/sizing.mjs`*
