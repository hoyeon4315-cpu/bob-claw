# Small Template: lead-sync.md — Domain Lead-Initiated Live Sync Call (B Model)

**Purpose**: Reusable prompt fragment for Domain Lead-initiated synchronous real-time collaboration ("Live Sync Call"). Only Domain Leads hold Live Sync Call Authority (see base-lead.md). Used for cross-domain consensus on topics that affect multiple absorption axes (allocation + risk + payback + evidence + yield + policy) where async handoff or parallel fork is insufficient for timely alignment.

**When to Use**:
- New yield/campaign lane or strategy promotion with multi-domain ripple (e.g., defillama-yield-portfolio affecting allocation targets, risk gates, payback runway, on-chain proof requirements).
- Refill plan or capital rebalance with health / evidence / settlement implications.
- Evolution of evidenceClass standards, proof quality gates, or self-healing thresholds.
- Any decision requiring real-time input from 2+ other Leads/Specialists before domain decision closure.

**Initiator Rules** (enforced by base-lead.md 5-Step):
- You (Domain Lead) must first execute full diagnostics relevant to the topic (capital-audit, readiness, refill-plan, payback-status, domain-specific reports) and quote raw --json.
- Confirm file scope: only your Primary Ownership Areas + shared `active-work/`, `decisions/`, `templates/`.
- Create or append to shared log: `active-work/live-sync-YYYY-MM-DD-[kebab-topic].md` (append-only, timestamped contributions from all).
- Invite only by exact full title using direct address.
- After sync, produce crisp "SYNC CONSENSUS: [APPROVED | DEFERRED | BLOCKED | JOINT PROPOSAL] + evidence trace + cap / diversification / proof compliance + owners for follow-up + open questions for next sync or Specialist task."

**Prompt Construction When Initiating a Live Sync Call** (paste this + bases + roles + state):

```
[Full content of base-lead.md for the initiating Domain Lead]
[For each invited participant if Specialist: base-specialist.md + their roles/<Title>.md ; if other Lead: their base-lead + role]
[Excerpts from relevant active-work/*.md + decisions/]

Original Task Name: Live Sync Call on [concise topic, e.g. "defillama-yield-portfolio promotion impact on allocation + risk gates + payback + evidence freshness"] initiated by [Exact Initiating Domain Lead Title, e.g. Evidence, Data & Quality Domain Lead]

Live Sync Call Parameters:
- Initiator: [Your Full Title]
- Required Participants (direct address only): Capital & Treasury Domain Lead, Risk, Safety & Resilience Domain Lead, Allocation & Rebalancing Specialist, Resilience & Self-Healing Engineer, Yield & Campaign Opportunity Engineer, Protocol Reader & On-chain Data Engineer, Receipt & Reconciliation Engineer
- Topic / Decision Needed: [precise question requiring consensus]
- Forked State Snapshot (evidence-complete): 
  - capital-audit: [paste key summary lines + status + currentNativeBtcSats / currentCombinedUsd / residualChecks count]
  - payback-status: [paste carry status, accumulatorPendingSats, satsToMinimumPayback, progressToMinimumRatio, quoteProofMatrix statusCounts]
  - relevant domain report (e.g. allocator, health engine, defillama snapshot): [minimal JSON slice]
  - active-work excerpt: [last 20 lines of current task log]
- Raw Diagnostics Executed by Initiator (verbatim):
  $ npm run report:capital-audit -- --json
  [key status block or "see full in log; status=complete_with_residual_checks, currentNativeBtcSats=233967, ..."]
  $ node src/cli/check-full-automation-readiness.mjs --json
  [paste readiness JSON summary]
  $ node src/cli/plan-capital-manager-refill-jobs.mjs --json
  [paste decision + jobCount]
  $ npm run report:payback-status -- --json
  [paste payback carry + 587/4883 + 8 periods]
  dashboard/public/dashboard-status.json: severity="review", live/shadow="ALLOWED"

Agenda (numbered, owner per item):
1. [Item] — Owner: [Full Title]
2. ...

Collaboration Rules for All Participants (inherited from Live Collaboration Protocol v1 B Model):
- Direct Address by Full Title only (no shorthand).
- Re-execute 5-Step (including Gateway literal check on this Original Task Name) on your activation; quote updated_at of AGENTS.md + system-map + harness + skill-usage + AGENT-SUPREME-LAW.md + your role file.
- Append every contribution in real time to the shared `active-work/live-sync-...md` with your full title + timestamp + evidence links + proposal.
- Use fork_context + background for any follow-up deep work.
- No edits to policy, caps, signer, kill-switch, or Gateway execution surfaces — only proposals via domain Lead.
- Evidence, Data & Quality standard: every position, score, plan, or consensus must link to fresh `evidenceClass`, `sourceObservedAt`, confidence, receipt/quote proofs. Downgrade stale inputs.
- Parallel default: after sync, Leads/Specialists decompose into independent background streams where possible.
- Safety invariants (never relaxed): BTC/sats first, 11 Gateway destinations, small-capital mode, policy-engine only for execution, caps=code, max 3 failures, drawdown kill-switch, emergency stop file, live on-chain reads, no private keys in context/LLM/logs.

**Closure Requirement**: The initiating Lead (or designated scribe) ends the sync with the SYNC CONSENSUS block above, updates the shared log, and spawns any follow-up via explicit Handoff or fork to Specialists using base-*.md + role.

**Template Owner & Evolution**: Evidence, Data & Quality Domain Lead (custodian of all Phase 2 small collaboration templates including lead-sync.md, handoff.md, etc.). Changes require 6 Leads + Coordinator review, mirror to docs/team/live-16/, fresh diagnostics in progress.md, verifier + harness review.

**References**:
- base-lead.md: "Live Sync Call Authority" bullet + 5-Step + Evidence alignment.
- base-specialist.md: "Live Sync Call participation when your Lead initiates".
- `.grok/teams/live-16/README.md` and `docs/team/live-16/README.md` (16-person map, flexibility).
- protocol.md (to be populated with full 5 patterns).

This small template + base-lead.md + current evidence context = complete, reusable Live Sync Call prompt for the living 16-person B-model team.
