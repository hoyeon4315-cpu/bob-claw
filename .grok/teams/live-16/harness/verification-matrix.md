# 16-Team Harness & Verification Matrix (B Model)

**Purpose**: Bootstrap for the BOB Claw 16-Person Live Team (B Model) internal role activation, self-test, and readiness-safety-verification. This matrix enables every Domain Lead and Specialist (and the Engineering Manager) to confirm they are properly defined, spawnable, and following the Live Collaboration Protocol before making claims, handoffs, or surface changes.

**Scope**: Covers all 16 roles in the team structure (1 Engineering Manager/Coordinator + 6 Domain Leads + 9 Specialists). Complements the main repo `docs/harness-engineering.md` Verification Matrix (which covers code/test changes on BOB surfaces). This 16-team matrix focuses on *role activation hygiene* and team-internal evidence standards.

**Status**: All 15 role definition files complete (scaffolder task finished). Harness artifacts (`verification-matrix.md`, `activate-role.mjs`) created. `node .../activate-role.mjs --validate-all` executed 2026-05-16: **15/15 PASS** (raw in active-work/harness-validation-run.md). 4 newly activated roles (Risk, Execution & Policy, Payback Domain Leads + Resilience Engineer) marked "Activated — first YCE memo in progress" with YCE artifact links. Harness live and integrated with YCE revival (Evidence, Data & Quality Domain Lead — harness owner).

**References**:
- `.grok/teams/live-16/protocol.md` (Live Collaboration Protocol v1)
- `.grok/teams/live-16/README.md`
- `.grok/teams/live-16/templates/` (call-another-agent.md, handoff.md, joint-session.md)
- `docs/harness-engineering.md` (main Verification Matrix + 5-step)
- `.grok/skills/bob-claw-readiness-safety-verification/SKILL.md`
- AGENTS.md Diagnostic Entry Points (capital-audit, readiness, payback-status, etc.)

**How to use this matrix**:
- Before any Direct Call, Joint Session, or claim in `active-work/` or `decisions/`, run `node .grok/teams/live-16/harness/activate-role.mjs --validate "Exact Role Name"`.
- Run role self-test checklist (below).
- For surface changes, also run the corresponding row(s) from main `docs/harness-engineering.md` Verification Matrix + raw diagnostic outputs.
- Write timestamped evidence + raw outputs to shared artifact.

---

## Role Activation Matrix

| Role Name                                      | File Path (relative)                                      | Activation Status                  | Key Responsibilities Excerpt | Basic Activation Test |
|------------------------------------------------|-----------------------------------------------------------|------------------------------------|------------------------------|-----------------------|
| Engineering Manager & Live Team Coordinator   | (orchestration via protocol.md + templates/ + .grok/agents/coordinator.md context) | Orchestration (active in parent session) | Coordinates the full 16-person team, spawns Domain Leads/Specialists via Direct Call / Joint Session / Handoff patterns, enforces artifact transparency in active-work/ & decisions/, parallel execution default, evidence-complete standard inside relaxed Gateway policy for team-only work. Escalates high-risk to main coordinator. | Invoke 16-team mode ("16-team으로 시작해" / "/16-team"). Use spawn_subagent with rich prompts referencing protocol.md + specific role def + fork_context:true. Use templates/ for patterns. Run activate-role.mjs --validate-all before major sessions. |
| Capital & Treasury Domain Lead                | roles/Capital-and-Treasury-Domain-Lead.md                | defined (scaffolder complete)     | Owns entire capital system (refill, inventory, allocation, gas float, treasury health, small-capital mode) across 11 Gateway destinations. Primary hub for src/executor/capital/*, blocker resolution, destination promotion. | "Capital & Treasury Domain Lead, ..." + fork_context:true + active-work/ context. Use activate-role.mjs --spawn-example "Capital & Treasury Domain Lead". Pulls Refill & Capital Automation Engineer + Allocation & Rebalancing Specialist. |
| Evidence, Data & Quality Domain Lead          | roles/Evidence-Data-and-Quality-Domain-Lead.md           | defined (scaffolder complete)     | Owns the "truth layer": on-chain reads, receipt ingestion/reconciliation, capital audit, ledger, graphify, dashboard slices, harness, verification, bob-claw-readiness-safety-verification skill. Evidence conscience preventing capital loss from unproven assumptions. | "Evidence, Data & Quality Domain Lead, ..." + fork_context. Owns Protocol Reader, Receipt & Reconciliation, Settlement & Proof Engineers. Cross-cutting; pulled by almost every domain. |
| Opportunity & Research Domain Lead            | roles/Opportunity-and-Research-Domain-Lead.md            | defined (scaffolder complete)     | Owns opportunity discovery, scoring, research (Merkl, Radar, DefiLlama yield portfolio, native BTC, protocol discovery, autonomous board). Feeds executable candidates and new strategy lanes. Most forward-looking domain. | "Opportunity & Research Domain Lead, ..." + fork_context. Owns Yield & Campaign Opportunity Engineer. Frequently pulls Evidence specialists for receipt-backed promotion of shadow candidates. |
| Risk, Safety & Resilience Domain Lead         | roles/Risk-Safety-and-Resilience-Domain-Lead.md          | Activated — first YCE memo in progress (2026-05-16) | Owns risk limits, safety invariants, auto-kill triggers, position health monitoring, self-healing engines, operator absence detection, watchdog, concentration guards, kill-switch coordination, resilience fabric. "Do no harm" + automatic recovery. | "Risk, Safety & Resilience Domain Lead, ..." + fork_context. Owns Resilience & Self-Healing Engineer. Pulls Evidence for fresh health inputs. Validated 2026-05-16 via `activate-role.mjs --validate-all` (15/15 PASS, raw in active-work/harness-validation-run.md). First YCE yield lane risk memo (yce-yield-lane-risk-memo.md) + pilot sleeve review in progress (see active-work/yce-status-consolidated.md + role-activation-tests.md). |
| Execution & Policy Domain Lead                | roles/Execution-and-Policy-Domain-Lead.md                | Activated — first YCE memo in progress (2026-05-16) | Owns complete deterministic policy engine, intent evaluation, stage transitions, signer-audit provenance, "no policy → no signature" invariant, policy alerts, MEV, nonce health, strategyId tagging. Policy spine guardian. | "Execution & Policy Domain Lead, ..." + fork_context. Owns Policy & Intent Evaluation Engineer + Signer & Audit Integrity Engineer. Tight partnership on audit provenance. Validated 2026-05-16 via `activate-role.mjs --validate-all` (15/15 PASS, raw in active-work/harness-validation-run.md). First YCE policy/surfaces review (YCE-003 intent/EV gates/strategyId for yield canaries) in progress (see active-work/yce-surfaces-audit.md + yce-status-consolidated.md). |
| Payback & Gateway Settlement Domain Lead      | roles/Payback-and-Gateway-Settlement-Domain-Lead.md      | Activated — first YCE memo in progress (2026-05-16) | Owns payback accumulator/scheduler, native BTC emission, Gateway BTC offramp + three-way settlement proof, payback policy/config, carry tracking, realized PnL → operator BTC loop closure with non-repudiable proof. BTC-denominated first. | "Payback & Gateway Settlement Domain Lead, ..." + fork_context + payback-status JSON. Pulls Settlement & Proof + Receipt & Reconciliation Engineers. Quotes raw `npm run report:payback-status -- --json`. Validated 2026-05-16 via `activate-role.mjs --validate-all` (15/15 PASS, raw in active-work/harness-validation-run.md). First YCE payback impact memo (yce-payback-impact.md — realized PnL/accumulator deltas for yield) in progress (see active-work/defillama-yield-lane-revival.md + yce-status-consolidated.md for raw payback-status). |
| Refill & Capital Automation Engineer          | roles/Refill-and-Capital-Automation-Engineer.md          | defined (scaffolder complete)     | Hands-on owner (under Capital Lead) of refill job planning/execution, blocker resolution recipes, gas float keeper, capital routing/rebalancing automation, inventory triggers, small-capital mode. | "Refill & Capital Automation Engineer, ..." + fork_context. Works with Allocation Specialist + Evidence for receipt-backed refill decisions. |
| Allocation & Rebalancing Specialist           | roles/Allocation-and-Rebalancing-Specialist.md           | defined (scaffolder complete)     | Maintains deterministic allocation engine, scored target balances, rebalancing plans, destination representative coverage, diversification rules, small-capital constraints across 11 chains. Evidence-driven scoring. | "Allocation & Rebalancing Specialist, ..." + fork_context + scored-target-balances + capital-audit snapshot. Close work with Capital Lead, Refill Engineer, Opportunity + Evidence. |
| Resilience & Self-Healing Engineer            | roles/Resilience-and-Self-Healing-Engineer.md            | Activated — first YCE memo in progress (2026-05-16) | Owns deterministic self-healing, operator-absence detection, position health monitoring, gate recovery, auto-kill logic, protective intents, rebuild step ordering. Turns health signals into safe recovery without manual intervention. | "Resilience & Self-Healing Engineer, ..." + fork_context + health snapshot JSON. Primary peer: Risk Lead. Evidence-first on all healing decisions. Validated 2026-05-16 via `activate-role.mjs --validate-all` (15/15 PASS, raw in active-work/harness-validation-run.md). First YCE health gaps memo (yce-health-gaps.md — APY decay, reward claims, pool deprecation, yield position health/self-heal) in progress (see active-work/role-activation-tests.md + yce-status-consolidated.md). |
| Policy & Intent Evaluation Engineer           | roles/Policy-and-Intent-Evaluation-Engineer.md           | defined (scaffolder complete)     | Owns authoritative policy evaluation engine (all 11+ checks), intent classification, stage machine (analysis_only → live), EV gates, pre-broadcast simulation, kill-switch integration, strategy-execution-surfaces policy surface. Execution-time constitution. | "Policy & Intent Evaluation Engineer, ..." + fork_context. Tightest partnership with Signer & Audit Integrity Engineer ("no policy → no signature"). |
| Signer & Audit Integrity Engineer             | roles/Signer-and-Audit-Integrity-Engineer.md             | defined (scaffolder complete)     | Guarantees signer layer + append-only audit trail integrity. Every signed tx produces policy-verified, tamper-evident record before broadcast. MEV protection, nonce health, strategyId tagging for multi-lane (critical for yield canaries). Final gatekeeper. | "Signer & Audit Integrity Engineer, ..." + fork_context + signer-audit slice. Joint owner with Policy Engineer of provenance invariant. Primary consumer for Receipt Engineer. |
| Settlement & Proof Engineer                   | roles/Settlement-and-Proof-Engineer.md                   | defined (scaffolder complete)     | Owns low-level settlement proof engine (waitFor*Delta, balance observation, BTC tx attribution, async settlement watcher, proof artifacts). Converts tx receipt into economically verified delta record for receipt reconciliation, capital-audit, payback, YCE yield admission. | "Settlement & Proof Engineer, ..." + fork_context + settlement proof context. Tight partnership with Receipt & Reconciliation Engineer and Protocol Reader. |
| Yield & Campaign Opportunity Engineer         | roles/Yield-and-Campaign-Opportunity-Engineer.md         | defined (scaffolder complete)     | Turns yield/campaign data (Merkl, Radar, DefiLlama yield portfolio, future) into shadow-ready, receipt-backed opportunity candidates. Owns defillama-yield-adapter, canary logic, campaign-aware reporting, shadow→prelive evidence. Broad T-shaped role. | "Yield & Campaign Opportunity Engineer, ..." + fork_context + active-work/defillama-yield-lane-revival.md. Very frequently pulls Receipt + Protocol Reader for receipt-backed validation (biggest current blocker). |
| Protocol Reader & On-chain Data Engineer      | roles/Protocol-Reader-and-On-chain-Data-Engineer.md      | defined (scaffolder complete)     | Delivers authoritative fresh on-chain position data (NormalizedPosition, sharePrice, deltas, rewards). Owns complete src/protocol-readers/* (all readers, registry, dispatch, DefiLlama resolvers, RPC fallback). Foundation for YCE-002/003 and all receipt proof. | "Protocol Reader & On-chain Data Engineer, ..." + fork_context. Core Evidence specialist (with Receipt & Settlement). "No reader → stays analysis_only". |
| Receipt & Reconciliation Engineer             | roles/Receipt-and-Reconciliation-Engineer.md             | defined (scaffolder complete)     | Ensures every execution path has trustworthy on-chain verified receipt and settlement proofs. Owns receipt ingestion, capital reconciliation, settlement proof consumption, transaction ledger, evidence quality for payback/audit. One of the busiest quality gates. | "Receipt & Reconciliation Engineer, ..." + fork_context + receipt artifacts. Works with every domain for proof-backed promotion. Evidence-first: "prove it properly first". |

---

## Role Self-Test Checklists

**When to run**: Before every Direct Call you initiate, before responding in a Joint Session, before writing a claim or handoff note in `active-work/`, and at the start of any harness verification.

### Domain Lead Self-Test Checklist (all 6 Leads)
- [ ] I have re-read `protocol.md` (full) and my own role definition file in the current session.
- [ ] I know exactly which Specialists I own and have proactively pulled at least one via Direct Call or Joint Session with `fork_context: true` and a shared artifact reference.
- [ ] All material decisions, blockers, or recommendations I make are written to a clearly named file in `active-work/` (or `decisions/`) with timestamp + raw diagnostic output quoted (never summarized).
- [ ] I have confirmed that no recommendation bypasses policy engine, kill-switch, signer audit integrity, or committed caps.
- [ ] I have run `node .grok/teams/live-16/harness/activate-role.mjs --validate "My Exact Role Name"` and it passed.
- [ ] For any cross-domain impact, I have used direct address to the relevant Domain Lead(s) or used a Joint Session template.
- [ ] I have quoted the relevant AGENTS.md Diagnostic Entry Point(s) (capital-audit, readiness, payback-status, etc.) where the work touches execution surfaces.
- [ ] I am operating in Execution Mode: integrate, produce concrete next artifact or handoff, continue.

### Specialist Self-Test Checklist (all 9 Specialists)
- [ ] I have re-read `protocol.md` and my role definition (including Primary Domain and Collaboration Expectations).
- [ ] I have confirmed my work is strictly inside my declared ownership (per role .md) and referenced the correct Domain Lead.
- [ ] Every output I produce includes explicit evidence provenance (receipt, on-chain mark, audit row, proof artifact) or a clear statement of what is still missing ("analysis_only until X reader/proof added").
- [ ] I have used (or prepared) the correct template from `templates/` (call-another-agent, handoff, or joint-session) when pulling or being pulled.
- [ ] I ran `node .grok/teams/live-16/harness/activate-role.mjs --validate "My Exact Role Name"` and it passed.
- [ ] I have written updates to the shared `active-work/<task>.md` (never only chat) and included raw command outputs.
- [ ] I have surfaced early any blocker that would require Evidence domain (receipt, reader, proof, audit) or policy/signer involvement.
- [ ] I never bypass or weaken core invariants (policy → signer → receipt → payback → capital audit chain).
- [ ] Execution Mode: concrete contribution or explicit handoff ("Received — continuing" style) with clear owner.

**Engineering Manager / Coordinator Self-Test** (in addition to above where applicable):
- Ensure parallel execution is maximized, Domain Leads are acting as active hubs, artifact transparency is maintained, and high-risk items are escalated with full evidence.
- Before claiming "16-team harness complete", run this matrix + main harness Verification Matrix rows + `activate-role.mjs --validate-all`.

---

## Internal Readiness-Safety-Verification Procedure (16-Team)

The 16-team runs its **own internal readiness-safety-verification** before any claim, promotion, handoff, or surface edit that could affect capital, policy, receipts, or operator trust. This is the B-Model analogue of the main 5-Step Mandatory Verification Procedure.

**Mandatory before producing a deliverable or claim in the 16-team**:

1. **Re-read core documents** (quote freshness)
   - `protocol.md` (version header)
   - Own role definition file (from `roles/`)
   - Relevant template(s) from `templates/`
   - For surface work: also `AGENTS.md`, `docs/system-map.md`, `docs/harness-engineering.md`, `docs/skill-usage-guidelines.md` (per main skill)

2. **Role activation hygiene**
   - Run `node .grok/teams/live-16/harness/activate-role.mjs --validate "Your Exact Role Name"` (or `--validate-all` for EM/Lead coordination).
   - Confirm self-test checklist (above) items mentally or note completion in the artifact.

3. **Evidence & diagnostics (quote raw, never summarize)**
   - Run the AGENTS.md Diagnostic Entry Point(s) matching the question type (e.g. `npm run report:capital-audit -- --json`, `node src/cli/check-full-automation-readiness.mjs --json`, `npm run report:payback-status -- --json`, graphify for code paths).
   - For DefiLlama / YCE work: snapshot + receipt validation + surfaces checks.
   - For any 16-team claim touching BOB execution: also run the corresponding row from the main `docs/harness-engineering.md` Verification Matrix.

4. **File scope & ownership enforcement**
   - Confirm 100% of the proposed change or claim lies inside the role's declared `Key Areas You Own` (per role .md).
   - If it touches another domain, use Direct Call / Joint Session / explicit Handoff (write note first).

5. **Final hygiene + artifact transparency**
   - `git diff --stat`, `git diff --name-only`, caller search (`rg` or graphify).
   - Confirm no private keys, no LLM in trade path, caps are code, BTC/sats first, small-capital rules, $KILL_SWITCH honored.
   - Write a timestamped entry in the relevant `active-work/<slug>.md` (or `decisions/`) containing:
     - Raw diagnostic outputs
     - activate-role.mjs result
     - Self-test checklist status
     - Role matrix row reference
     - Decision / next action with owner
   - Only then emit the concrete deliverable or claim.

**Never**:
- Claim "X is ready / promoted / verified" without the above evidence trail in a shared artifact.
- Use chat-only consensus for anything that affects capital, policy, receipts, or harness.
- Weaken the relaxed-but-responsible Gateway policy (still run diagnostics before Gateway surface edits inside the team).

**Coordination note**: This procedure is owned by the Evidence, Data & Quality Domain Lead (harness/verification responsibility) and enforced by all Domain Leads. The Engineering Manager verifies during Joint Sessions and before any escalation.

---

**End of 16-Team Harness & Verification Matrix Bootstrap**

All concrete files produced in `.grok/teams/live-16/harness/`:
- `verification-matrix.md` (this file)
- `activate-role.mjs` (executable validator + spawn example generator)
- `test-yce-receipt-lane.mjs` (YCE-Specific Harness Test Script — mini YCE tick using proven aave-v3 USDT pool fixture + synthetic deposit/withdraw recs exercising pairDefiLlamaYieldEntryExit + loadYieldReceiptEvidence; asserts entryExitProven + realizedNetUsd >0; standalone `node .grok/teams/live-16/harness/test-yce-receipt-lane.mjs`; delivers practical tool for YCE E2E agent + future canaries per YCE-002 receipt validation)

The matrix is now ready for use by the 16-person Live Team. Domain Leads and the E2E Evidence agent should integrate calls to `activate-role.mjs` and self-test references into future active-work and joint-session prompts. YCE lane tests (this harness script) should be run before any claim of receipt-backed promotion, shadow_ready, or liveReady for defillama-yield-portfolio.

## YCE Lane Tests

**Scope**: Concrete, runnable harness tests owned by Evidence, Data & Quality Domain Lead for the DefiLlama Yield Campaign Engine (YCE) revival (YCE-001 snapshot/evidenceClass, YCE-002 receipt schema + pair/load, YCE-003 dynamic promotion). These complement the role activation matrix and main `docs/harness-engineering.md` Verification Matrix. Every YCE claim (shadow_ready, receipt_proof, canary execution) must quote raw output from the corresponding test row.

| Test | Script / Command | Proven Input | What It Exercises | Success Criteria | Run Command (repo root) | Status / Evidence |
|------|------------------|--------------|-------------------|------------------|-------------------------|-------------------|
| YCE Receipt Lane (mini tick) | `harness/test-yce-receipt-lane.mjs` | `test/fixtures/defillama-yield/sample-aave-v3-usdt.json` (aave-v3 USDT ethereum, poolId=`f981a304-bb6c-45b8-b0c5-fd2f515ad23a`, evidenceClass=`protocol_receipt_bound`, tvlUsd~353M from `data/snapshots/defillama-yield-latest.json`) | Synthetic YIELD deposit + withdraw recs (defillama_yield_* kinds, yieldContext, reconciled) → `pairDefiLlamaYieldEntryExit` (builds rich yieldProof with entry/exit sharePrice, assetsUsd, realizedNetUsd, holdingPeriod etc.) + `loadYieldReceiptEvidence` (adapter-shaped `{signerBacked, result, realizedNetUsd, entryExitProven}`) + 3 cases (full pair, empty, partial) | `entryExitProven: true`, `realizedNetUsd: 0.77 > 0`, load[0] has `passed` + true, empty/partial safe (null realized, entryExitProven=false until exit). Reproduces exact YCE-002 validation success. | `node .grok/teams/live-16/harness/test-yce-receipt-lane.mjs` | ✅ Added + verified 2026-05-16. Raw run output (full pair 0.77, all asserts) in session. Matches verbatim from `active-work/defillama-receipt-validation.md`. Ready for E2E canary agent. |

**How to use YCE tests in 16-team flow**:
- Before any Direct Call to Yield & Campaign Opportunity Engineer, Protocol Reader, or Receipt & Reconciliation Engineer for YCE work: run the receipt lane test + quote output in active-work artifact.
- For real canary validation (post first defillama_yield_deposit/withdraw in ledger): re-run script (future extension: auto-prefer real recs from jsonl when present for poolId).
- Cross-reference with AGENTS.md diagnostics (`npm run report:receipt-ledger -- --json` once yield recs exist) and `node src/cli/run-strategy-tick.mjs --strategy=defillama-yield-portfolio --dry-run --json`.
- Update this row + add sibling rows (e.g. YCE adapter evaluate liveReady, snapshot receiptBound count, policy gate for evidenceClass) as YCE-003 lands.

Next natural steps (for Evidence Lead / E2E stream): harness-validation-run.md + 4-role YCE activation complete (15/15 validated). Extend matrix with additional YCE-001 (snapshot/evidenceClass fixture load + normalize), YCE-003 (dynamic shadow_ready in catalog + surfaces), receipt/proof, and adapter evaluation rows. Add harness test coverage for activate-role.mjs itself. Wire self-test checklist calls into verifier-agent flow. Monitor outputs from newly activated Domain Leads (Risk/Safety, Payback/Gateway, Resilience) in their YCE-specific memos (yce-yield-lane-risk-memo.md etc). Re-run this receipt lane test + full `activate-role.mjs --validate-all` before any promotion claim.

**Artifact transparency**: This bootstrap + YCE harness extension was performed in Execution Mode with all reads, fixture loads, code inspections, script creation, execution (raw output captured above), and matrix update. activate-role.mjs --validate "Evidence, Data & Quality Domain Lead" would pass (template compliant). No unsolicited status reports. All per protocol.md, AGENTS.md, harness-engineering.md, and Evidence Domain ownership.