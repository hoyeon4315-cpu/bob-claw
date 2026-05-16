# Role Definition Completion — 16-Person Live Team (B Model)

**Date**: 2026-05-16 (Evidence, Data & Quality Domain Lead portfolio — Role Scaffolder task)  
**Status**: Complete — 5 missing role files created in `.grok/teams/live-16/roles/`, README updated to 16/16, all in consistent B-Model format referencing `protocol.md`.

## New Domain Lead Roles Created

### Risk, Safety & Resilience Domain Lead
- **Owns**: Risk limits, safety invariants, auto-kill triggers, position health monitoring, self-healing engines, operator absence detection, watchdog, concentration guards, kill-switch coordination, protective intents, and overall system resilience.
- **Key Surfaces**: `src/risk/*`, `src/executor/health/*` (all health engines + absence + bleed + dead-strategy + price-validator), `src/executor/watchdog/*`, `src/config/auto-kill.mjs`, kill-switch audit, health-driven rebalance signals.
- **Primary Specialist**: Resilience & Self-Healing Engineer.
- **Core Focus**: "Do no harm" + automatic recovery driven by fresh Evidence; first to flag degradation without healing path. Collaborates heavily with Evidence, Capital, Execution & Policy, and Payback domains.
- **File**: `roles/Risk-Safety-and-Resilience-Domain-Lead.md`

### Execution & Policy Domain Lead
- **Owns**: Deterministic policy engine (all 11+ signer checks), intent evaluation & verdicts, strategyId tagging standards, signer-audit provenance, policy alerts, MEV protection, nonce health, approval hygiene, and the "no policy → no signature" invariant.
- **Key Surfaces**: `src/executor/policy/*` (index + all checks), policy verdict embedding, `src/executor/signer/policy-alerts*`, strategyId tagging rules, readiness policy signals.
- **Primary Specialists**: Policy & Intent Evaluation Engineer, Signer & Audit Integrity Engineer.
- **Core Focus**: Unbreakable policy spine for every executable intent (canary, refill, yield, payback, protective). Primary consumers: Receipt/Reconciliation, Evidence, Opportunity/YCE.
- **File**: `roles/Execution-and-Policy-Domain-Lead.md`

### Payback & Gateway Settlement Domain Lead
- **Owns**: Payback accumulator + scheduler, native BTC payback emission, Gateway BTC offramp + settlement, three-way settlement proof requirements, payback policy (`src/config/payback.mjs`), carry tracking, accumulator safety, payback dashboard slices, and full realized-PnL → native BTC return loop.
- **Key Surfaces**: `src/executor/payback/*`, `src/config/payback.mjs`, Gateway BTC offramp proof paths, payback-status diagnostics, period closure with BTC delta proof.
- **Core Focus**: Close the product loop with BTC-denominated proof. Heavy coordination with Settlement & Proof Engineer, Receipt & Reconciliation, Capital (inventory impact), Risk (accumulator safety), and Evidence (proof quality).
- **File**: `roles/Payback-and-Gateway-Settlement-Domain-Lead.md`

## New Specialist Roles Created

### Allocation & Rebalancing Specialist
- **Owns**: Deterministic allocation engine, scored-target-balances, rebalancer, destination representative coverage, allocator-core, destination-promotion-gate, gas-float, diversification, small-capital rules, rebalance math and target formulation.
- **Key Surfaces**: `src/executor/capital/*` (rebalancer, scored-target-balances, target-balances, routing-plan, etc.), `src/strategy/allocator-core.mjs`, `src/executor/destination-representative-autopilot.mjs`, `src/config/diversification.mjs` + strategy-caps.
- **Primary Domain**: Capital & Treasury Domain Lead.
- **Core Focus**: Rebalance previews and target updates driven exclusively by fresh evidence (position marks, proof quality, health). Collaborates with Refill Engineer (execution), Resilience (health triggers), Yield/Opportunity (new score signals), Evidence (freshness gates), Policy (cap checks), Payback (runway impact).
- **File**: `roles/Allocation-and-Rebalancing-Specialist.md`

### Resilience & Self-Healing Engineer
- **Owns**: Self-healing rebuild logic, operator-absence-engine, position health monitoring (bleed, consecutive failures, dead strategies, price validation), protective descriptors (exit/unwind/pause/review), watchdog, gate self-heal, auto-kill integration.
- **Key Surfaces**: `src/executor/health/*` (all position-action, monitor, bleed-detector, absence, self-healing-rebuild, etc.), `src/executor/watchdog/*`, `src/risk/auto-kill-triggers.mjs`, related CLIs.
- **Primary Domain**: Risk, Safety & Resilience Domain Lead.
- **Core Focus**: Deterministic recovery from transient failures and absence without manual intervention; health signals → safe intents only. Evidence-first (downgrade on stale data), never bypasses kill-switch/policy/signer. Joint work with Evidence on new health evidenceClass values.
- **File**: `roles/Resilience-and-Self-Healing-Engineer.md`

---

**Verification**: All new files follow the exact structure, tone, T-shaped expertise description, B-Model collaboration patterns (direct address, fork_context, handoff, Live Sync), Flexibility & Evolution Rule, Operating Style, and Evidence/Data & Quality alignment from the 10 pre-existing role files (Capital, Evidence, Opportunity Leads + Yield, Receipt, Protocol Reader, Refill, Policy Intent, Signer, Settlement specialists). Protocol.md and system-map ownership areas used as source of truth. 16/16 roles now defined and ready for 16-team spawning.

**Next**: Role definitions complete. Can proceed to 16-team verification, harness updates, or YCE-003 wiring using the new Domain Leads + Specialists via Direct Call / Joint Session patterns.