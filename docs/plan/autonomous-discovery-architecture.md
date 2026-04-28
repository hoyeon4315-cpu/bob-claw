# DeFi Self-Discovery Architecture
## BOB Claw Autonomous Opportunity Lifecycle

**Status:** Architectural Proposal  
**Objective:** Answer the question: "If a new strategy appears on a new chain, can we find and execute it automatically?"

**Short Answer:** Not today. But we can build toward it. Here's the gap analysis and roadmap.

---

## 1. The Automation Gap: What We Do Now vs. What We Need

### 1.1 Current State (Semi-Automatic)

```
Human: "npm run scan-opportunities"
↓
Script fetches Merkl/DefiLlama APIs
↓
Human reads output, judges "this looks good"
↓
Human checks if binding exists in registry
↓
Human verifies contract is ERC4626 (manual RPC calls)
↓
Human edits config files
↓
Human runs executor
```

**Automation level: 15%**
- ✅ Data fetching is automated
- ✅ Basic filtering (TVL, APR thresholds) is automated
- ❌ Protocol classification: manual
- ❌ Contract verification: manual
- ❌ Binding compatibility: manual
- ❌ Risk assessment: semi-manual (policy checks exist but need human to select candidate)
- ❌ Execution decision: manual (dry-run by default)

### 1.2 Target State (Fully Autonomous)

```
Cron trigger every 15 minutes
↓
Multi-source scanner fetches all opportunities across N chains
↓
Auto-classifier categorizes by protocol family (ERC4626, Aave, CLAMM, Perp, etc.)
↓
Auto-verifier checks contract codehash, ownership, audit status
↓
Auto-binder matches protocol family to known execution templates
↓
Auto-simulator runs fork tests with $1 to verify deposit/exit path
↓
Auto-risk-engine evaluates IL, liquidation, depeg scenarios
↓
Auto-sizer calculates position size from policy + capital state
↓
Auto-policy-gate allows/rejects
↓
Auto-intent-builder constructs transaction sequence
↓
Signer daemon executes
↓
Auto-monitor tracks position health every block
↓
Auto-exit triggers when thresholds breached
```

**Automation level: 95%** (5% reserved for operator override/kill-switch)

---

## 2. The Six Layers of Autonomous DeFi

### Layer 1: Universal Scanner (Discovery)

**Current:** Merkl + DefiLlama for 11 chains. Fixed endpoints.

**Needed:**
- Plugin architecture: new DEX, new yield aggregator appears → add adapter, not new script
- On-chain event scanning: don't wait for APIs. Listen to `PoolCreated`, `VaultRegistered` events
- Social signal integration: detect new protocol launches from Twitter/Telegram/Farcaster (early alpha)
- MEV-proof scanning: use Flashbots-style RPCs to avoid frontrunning during discovery

**Implementation:**
```javascript
// src/executor/discovery/universal-scanner.mjs
const SCANNER_ADAPTERS = {
  merkl: new MerklAdapter(),
  defillama: new DefiLlamaAdapter(),
  subgraph: new SubgraphAdapter(),
  event_stream: new EventStreamAdapter(),
  social: new SocialSignalAdapter(), // future
};
```

### Layer 2: Auto-Classifier (Protocol Family Detection)

**Current:** Hardcoded `project` name matching (`morpho-blue`, `aerodrome-slipstream`, etc.)

**Needed:**
- ABI fingerprinting: detect `deposit/withdraw` (ERC4626), `supply/withdraw` (Aave), `mint/burn` (CLAMM), `openPosition/closePosition` (perp)
- Storage slot analysis: detect proxy patterns, upgradeable contracts
- On-chain behavior: call `asset()`, `totalAssets()`, `balanceOf()` and classify by response

**Implementation:**
```javascript
// src/executor/discovery/auto-classifier.mjs
async function classifyProtocolFamily(contractAddress, chain) {
  const calls = [
    { selector: "0x6f307dc3", name: "asset" },       // ERC4626
    { selector: "0x70a08231", name: "balanceOf" },    // ERC20
    { selector: "0x238d6572", name: "supply" },       // Aave
    { selector: "0x51cff8d9", name: "withdraw" },     // Aave/Morpho
    { selector: "0x3c8a7d8d", name: "mint" },         // CLAMM NFT
  ];
  // Execute multicall, score matches, return family + confidence
}
```

### Layer 3: Auto-Verifier (Safety Check)

**Current:** Manual codehash comparison, manual TVL check

**Needed:**
- Bytecode hash matching against known-good deployments
- Ownership analysis: Is contract owned? Is owner an EOA or timelock?
- Pause function detection: Can admin freeze funds?
- Mint function detection: Can admin mint infinite shares?
- Self-destruct detection: Is contract destructible?
- External call analysis: Does it call unknown contracts?

**Implementation:**
```javascript
// src/executor/discovery/auto-verifier.mjs
async function verifyContractSafety(address, chain) {
  const bytecode = await getBytecode(address);
  const analysis = {
    hasSelfDestruct: detectSelfDestruct(bytecode),
    hasUpgradeableProxy: detectProxyPattern(bytecode),
    hasOwner: detectOwnerSlot(bytecode),
    hasPause: detectPauseFunction(bytecode),
    hasMint: detectMintFunction(bytecode),
    knownCodehash: matchKnownCodehash(bytecode),
  };
  return computeSafetyScore(analysis);
}
```

### Layer 4: Auto-Binder (Execution Path Generation)

**Current:** Registry requires manual entry for each protocol

**Needed:**
- Template-based binding generation: Given `family: "erc4626"`, auto-generate deposit/withdraw plans
- ABI-less binding: For simple protocols, generate calldata from function signatures alone
- Adapter fallback: If exact binding missing, use generic ERC20 approve + contract call

**Critical insight:** For ERC4626, we already have generic binding. The auto-binder just needs to detect "this is ERC4626" and reuse existing infrastructure.

**Implementation:**
```javascript
// src/executor/discovery/auto-binder.mjs
async function generateBinding(contractAddress, chain, family) {
  if (family === "erc4626") {
    const asset = await readErc20Asset(contractAddress);
    return {
      bindingKind: "erc4626_vault_supply_withdraw",
      vaultAddress: contractAddress,
      assetAddress: asset,
      // Auto-detected, no human needed
    };
  }
  if (family === "aave_v3") {
    // Detect underlying asset from pool data
    return { bindingKind: "aave_v3_pool_supply_withdraw", ... };
  }
  // ... etc
}
```

### Layer 5: Auto-Simulator (Dry-Run Validation)

**Current:** Manual fork tests, manual canary execution

**Needed:**
- Automated fork test: Given binding + $1 amount, simulate full round-trip on fork
- Detect revert reasons: "insufficient allowance", "slippage too high", "pool locked"
- Gas estimation on fork: verify transaction succeeds with realistic gas
- Time-travel simulation: fast-forward 1 day, check accrued yield > 0

**Implementation:**
```javascript
// src/executor/discovery/auto-simulator.mjs
async function simulateRoundTrip(binding, amount, chain) {
  const fork = await createFork(chain);
  const results = {
    deposit: await simulateDeposit(fork, binding, amount),
    wait1Day: await timeTravel(fork, 86400),
    accruedYield: await checkAccruedYield(fork, binding),
    exit: await simulateExit(fork, binding),
    netReturn: computeNetReturn(results),
  };
  return results.netReturn > 0 ? "PASS" : "FAIL";
}
```

### Layer 6: Auto-Policy (Risk-Adjusted Sizing)

**Current:** Human edits config files for caps, sizing, exit rules

**Needed:**
- Dynamic sizing based on opportunity characteristics:
  - TVL < $100K → max position $5
  - TVL $100K-$1M → max position $15
  - TVL > $1M → max position $30
  - No audit → max position $10
  - Admin is EOA → max position $5
- Auto-exit rule generation:
  - CLAMM → IL-based exit
  - Lending → HF-based exit
  - Staking → reward token price-based exit

---

## 3. New Chain / New Strategy Detection: Detailed Flow

### Scenario: "Arbitrum에 새로운 DEX 'Nebula'가 나타나고, USDC-NEB 풀이 400% APR을 제공"

### 3.1 Current System (Fails)

1. Scanner: Arbitrum is in chain list ✅
2. API fetch: DefiLlama has the pool ✅
3. Filtering: APR 400% > threshold ✅
4. **Classifier:** `project: "nebula"` → unknown → **BLOCKED** ❌
5. Human must: investigate Nebula, read docs, verify contracts, build binding
6. Time to execution: 2-14 days

### 3.2 Target System (Succeeds)

1. **Discovery:** Event stream adapter detects `PoolCreated` on Arbitrum Nebula factory
2. **Classifier:** Multicall to pool contract → responds to `mint/burn/positions` → family: `uniswap_v3_like` ✅
3. **Verifier:** Bytecode matches Uniswap V3 pool codehash (verified) ✅
4. **Binder:** Auto-generates `uniswap_v3_lp_add_remove` binding with pool address ✅
5. **Simulator:** Fork test with $1 → deposit succeeds, 1-day yield > 0, exit succeeds ✅
6. **Policy:** TVL $50K → auto-size $5, CLAMM family → auto-exit at -20% IL ✅
7. **Execution:** Intent generated, policy gate allows, signer executes ✅
8. **Monitor:** Every block, check position range vs. current price ✅

**Time to execution: 15 minutes after pool creation**

---

## 4. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)
**Goal:** Make existing autopilot truly autonomous for known families

| Task | Description | Deliverable |
|---|---|---|
| 1.1 | Auto-classifier for ERC4626 | Detect any ERC4626 vault, auto-bind |
| 1.2 | Auto-classifier for Aave-style | Detect any Aave fork, auto-bind |
| 1.3 | Universal scanner refactor | Plugin architecture, multi-source merge |
| 1.4 | Auto-verifier v1 | Codehash matching, owner detection |

**Result:** System auto-discovers and auto-executes YO/Morpho/Beefy/Pendle clones on any chain. No human for known families.

### Phase 2: Expansion (Weeks 5-10)
**Goal:** Handle CLAMM and managed vaults

| Task | Description | Deliverable |
|---|---|---|
| 2.1 | CLAMM auto-binder | Detect V3/V4 pool, generate LP binding |
| 2.2 | IL auto-calculator | Real-time IL tracking for any V3 position |
| 2.3 | Auto-rebalance engine | Price moves 5% → auto-rebalance or exit |
| 2.4 | Auto-simulator v1 | Fork test any discovered opportunity with $1 |

**Result:** System can enter/exit any Uniswap V3/Aerodrome/Quickswap position autonomously.

### Phase 3: Intelligence (Weeks 11-20)
**Goal:** True self-discovery

| Task | Description | Deliverable |
|---|---|---|
| 3.1 | Event stream scanner | Listen to `PoolCreated`, `VaultRegistered` on all chains |
| 3.2 | Social signal adapter | Monitor Twitter/Telegram for new protocol launches |
| 3.3 | Auto-audit integration | Query audit databases (CertiK, OpenZeppelin, etc.) |
| 3.4 | Pattern learning | ML-free: statistical pattern matching for "good" vs "bad" protocols |

**Result:** System discovers opportunities before they appear on Merkl/DefiLlama. Executes within 1 hour of launch.

### Phase 4: Refinement (Weeks 21+)
**Goal:** Self-improving system

| Task | Description |
|---|---|
| 4.1 | Performance feedback loop | Track predicted vs. realized returns per strategy family |
| 4.2 | Auto-policy-tuning | Adjust sizing/exits based on historical performance |
| 4.3 | Cross-strategy learning | "CLAMM on Base worked well" → "try CLAMM on Arbitrum" |

---

## 5. The Hard Truth: What Will NEVER Be Fully Automated

| Task | Why | Workaround |
|---|---|---|
 **Completely novel protocol mechanics** | No existing template matches | Human review + custom binding (2-3 days) |
| **Governance exploits / admin rug** | Bytecode can't predict human intent | Safety score + small position sizing |
| **Oracle manipulation** | On-chain can't predict off-chain price feed attacks | Multi-source oracles + circuit breakers |
| **Regulatory shutdown** | Legal events are off-chain | Geographic diversification + kill-switch |
| **Smart contract bugs in novel code** | Formal verification is hard | Insurance protocols + small exposure |

**Principle:** We automate 95% of the boring work. The 5% that requires human judgment gets flagged for operator review.

---

## 6. Merkle Gamma Vault Example: What Would True Automation Look Like?

### Current (Manual)
```
Human: "npm run scan-opportunities"
Human: sees Gamma wETH-USDC at 38.9%
Human: checks if Gamma is in registry → no
Human: checks contract 0x1180...729C
Human: RPC call: "is this ERC4626?"
Human: reads Gamma docs
Human: adds registry entry
Human: edits policy
Human: runs executor
```

### Target (Automatic)
```
[15:00] Scanner: New opportunity detected on Base
        Gamma wETH-USDC vault, APR 38.9%, TVL $9.9K
[15:01] Classifier: Multicall to 0x1180...729C
        → responds to asset(), deposit(), redeem() → ERC4626 family (confidence: 99%)
[15:02] Verifier: Codehash matches Gamma v2 deployment (known good)
        Owner: Gamma multisig (timelock: 48h)
        No self-destruct, no mint function detected
        Safety score: 87/100
[15:03] Binder: Auto-generates erc4626_vault_supply_withdraw binding
        vaultAddress: 0x1180...729C
        assetAddress: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 (wETH)
[15:04] Simulator: Fork test with $1
        Deposit: ✅ (gas 142K)
        1-day yield: $0.0011 (40.1% APR realized)
        Exit: ✅ (gas 89K)
        Net return after gas: positive ✅
[15:05] Policy:
        TVL $9.9K < $100K → max position $5
        Safety score 87 → no reduction
        ERC4626 family → standard exit rules
        Total Track B allocated: $35/50 → can add $15
        → Final position: $5 (sized down from $15 by policy)
[15:06] Intent built:
        approve wETH → deposit vault
        Gas estimate: $0.08
[15:07] Policy gate: ALLOW ✅
[15:08] Signer: Transaction broadcast
        Tx: 0xabc...
[15:09] Monitor: Position tracking enabled
        Auto-exit at: -25% unrealized, reward drop 25%, vault TVL drop 50%
```

**Human intervention: 0 times.**
**Time from discovery to execution: 9 minutes.**

---

## 7. What We Should Build Next Week

If you want to move toward true automation, next week's priority is:

1. **Auto-classifier v0.1**: Detect ERC4626 vaults by calling `asset()` + `deposit()`
2. **Auto-binder v0.1**: Given ERC4626 address, auto-generate binding with `vaultAddress` + `assetAddress`
3. **Universal scanner v0.1**: Merge Merkl + DefiLlama + on-chain event listening into one cron job
4. **Auto-verifier v0.1**: Bytecode hash matching against known deployments

These 4 things alone would make the system auto-discover and auto-bind **any ERC4626 vault on any chain**. That covers ~60% of DeFi yield opportunities.

Then CLAMM auto-binder (Phase 2) covers another 25%.

Then we have 85% automation.

---

## Appendix: Technical Debt Items Blocking Automation

| Debt | Impact | Fix |
|---|---|---|
| Hardcoded `KNOWN_TOKENS` in `realtime-portfolio.mjs` | New token = code change | Auto-detect from transfer events |
| Hardcoded `project` whitelist in `fetchCurrentOpportunities` | New DEX = code change | Family-based classification instead |
| Manual `PROTOCOL_CONFIGS` in rebalancer | New protocol = code change | Auto-discovery + dynamic config |
| No on-chain event listening | Always reactive, never proactive | Add `ethers.WsProvider` event listeners |
| No fork-based auto-simulation | Can't verify unknown contracts | Integrate Anvil/tenderly fork in CI |

---

*Document version: 0.1*  
*Question raised: 2026-04-28*  
*Next action: Operator decision on Phase 1 scope*
