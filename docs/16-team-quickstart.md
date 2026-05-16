# BOB Claw 16-Person Live Team (B Model) — Quickstart

**Purpose**: Copy-paste ready examples for the most common activation and collaboration flows.  
**Full Guide**: `docs/16-team-operations.md` (when to use, policy, artifacts, team map)  
**Canonical Roles & Protocol**: `.grok/teams/live-16/README.md` + `protocol.md` + `roles/*.md`

---

## 1. Basic Activation (User → Main Session)

```text
16-team으로 시작해
```

```text
16인 라이브 팀으로 이 작업 해줘
```

```text
16-Person Live Team (B Model)으로 DefiLlama YCE-003 dashboard surfaces wiring과 receipt E2E validation을 진행해
```

```text
/16-team Capital allocator math change affecting risk caps + payback accumulator + treasury gas — full impact analysis + proposal with evidence
```

After activation, the Engineering Manager loads the 16-person map, protocol, fresh raw diagnostics (`capital-audit --json`, readiness, payback-status, refill plan, dashboard-status), and begins spawning Domain Leads + Specialists in parallel.

Monitor with repeated:
```bash
# In your main session
get_command_or_subagent_output <task_id>
```

---

## 2. YCE-Style Feature Flow (Yield & Campaign Opportunity Engineer + Cross-Domain)

**Example user request** (after activation or directly):

```text
16인 라이브 팀으로 DefiLlama yield lane revival (YCE-003) dashboard promotion과 receipt validation을 완성해. snapshot:defillama → pairDefiLlamaYieldEntryExit proof → YIELD_KINDS surfaces wiring까지 E2E.
```

**What the 16-team does (typical parallel pattern)**:

1. Engineering Manager or Opportunity & Research Domain Lead writes initial note in `active-work/defillama-yield-lane-revival.md`
2. Direct Call / Joint Session spawns in one turn (all with `fork_context: true` + `background: true`):
   - Opportunity & Research Domain Lead + Yield & Campaign Opportunity Engineer (lead the feature)
   - Evidence, Data & Quality Domain Lead + Receipt & Reconciliation Engineer + Protocol Reader & On-chain Data Engineer (snapshot data + receipt proof + on-chain verification)
   - Capital & Treasury Domain Lead + Allocation & Rebalancing Specialist (allocation impact + refill)
   - Risk, Safety & Resilience Domain Lead (risk model update)
   - Payback & Gateway Settlement Domain Lead + Settlement & Proof Engineer (payback carry / proof impact)
3. All append to the shared `active-work/defillama-yield-lane-revival.md`
4. Evidence Lead runs final quality gate + harness checks
5. Consolidated proposal + patches handed back to main coordinator for integration + verifier + commit

**Key active-work artifact**: `active-work/defillama-yield-lane-revival.md`

**Common supporting commands** (run by Evidence or Receipt roles, raw output always quoted):
- `npm run report:capital-audit -- --json`
- `node src/cli/check-full-automation-readiness.mjs --json`
- `npm run report:payback-status -- --json`
- Dashboard: `dashboard/public/dashboard-status.json`

---

## 3. Multi-Domain Refactor Example (Allocation + Risk + Payback + Capital)

**User activation**:

```text
16인 라이브 팀으로 allocation math refactor — new concentration limits + risk drawdown model + payback accumulator impact 분석하고 proposal 만들어. Parallel로 Capital, Risk, Payback, Evidence, Execution Leads + Allocation Specialist 동원.
```

**Flow**:
- Joint Session or multiple Direct Calls (Manager spawns 4–5 agents simultaneously)
- Shared working doc: `active-work/allocation-refactor-impact.md` (or similar slug)
- Each Lead pulls their Specialist(s)
- Live Sync Call if consensus needed on cap/policy boundary
- Final output: evidence-backed proposal + diff summary + risk assessment + payback carry delta
- Handoff back to main coordinator with "Escalation: production promotion requires main session + verifier"

---

## 4. Verification Campaign / Harness Expansion

**User request**:

```text
16-team으로 16-person verification matrix와 E2E harness bootstrap 완성해. Evidence Domain Lead 주도로 receipt YIELD_KINDS validation, dashboard surfaces, capital-audit integration까지.
```

**Typical agents pulled**:
- Evidence, Data & Quality Domain Lead (owner)
- Harness & Verification Engineer (specialist capacity)
- Receipt & Reconciliation Engineer + Protocol Reader
- Yield & Campaign Opportunity Engineer (for YIELD_KINDS surfaces)
- Any Domain Lead whose area is touched (for matrix row ownership)

**Artifacts**:
- `.grok/teams/live-16/harness/verification-matrix.md` (or similar)
- Updates to `docs/harness-engineering.md` if needed
- Test harness scripts / matrix rows

---

## 5. Direct Call Mid-Stream (Agent-to-Agent)

Inside an active 16-team session, any agent can trigger a Direct Call:

Example prompt fragment an agent would produce:

```
Capital & Treasury Domain Lead + Evidence, Data & Quality Domain Lead,

YCE-003 dashboard promotion now requires updated target-balance scoring because of new DefiLlama receipt-bound pools. Blocker details and current snapshot evidence in active-work/defillama-yield-lane-revival.md.

Please review allocation impact and receipt quality gate. I have prepared the surface diffs.

Direct Call via protocol.
```

The Manager (or addressed Lead) then executes the `spawn_subagent` with the exact role file + protocol + shared file + fork_context.

---

## 6. Joint Session Example (Real-Time Cross-Domain Consensus)

Manager or Lead issues:

```
Joint Session: Decide whether DefiLlama non-Merkl yield pools can be promoted to prelive under current receipt-proof + capital rules.

Participants:
- Opportunity & Research Domain Lead
- Evidence, Data & Quality Domain Lead
- Capital & Treasury Domain Lead
- Yield & Campaign Opportunity Engineer
- Receipt & Reconciliation Engineer
- Risk, Safety & Resilience Domain Lead

Shared context: active-work/defillama-yield-lane-revival.md + latest capital-audit + payback-status + dashboard-status.json

All participants: append findings and converge on YES/NO + conditions within this session. Produce recommendation + next steps.
```

All 2–4 (or more) agents are spawned in the same turn with the joint-session template + shared goal.

---

## 7. Monitoring & Continuing Parallel Work

After spawning several agents:

```bash
# Repeat as needed (non-blocking)
get_command_or_subagent_output 019e2e9a-51f5-7b33-a03a-6fc494da01f7
get_command_or_subagent_output 019e2e9a-51f5-7b33-a03a-6fdd182e9e4b
# ... more task_ids
```

When a stream finishes a meaningful unit (file written, E2E validated, proposal ready), the agent appends to the shared active-work doc and the Manager integrates or pulls the next specialist.

To add more agents mid-task: simply address them by role in the shared doc or in a new message — the Manager will spawn with fork_context.

---

## 8. Handoff Example (Explicit Ownership Transfer)

```
Handoff from: Yield & Campaign Opportunity Engineer
To: Receipt & Reconciliation Engineer
Why: Receipt parsing + pairDefiLlamaYieldEntryExit proof logic for non-Merkl pools is deeper in your ownership area.
Current state: See active-work/defillama-yield-lane-revival.md (snapshot data classified, on-chain verification partial)
Open questions:
- How to prove entry/exit for the new YIELD_KINDS pools?
- Should we extend settlement-proof helper or create dedicated receipt validator?

Please confirm receipt and continue in Execution Mode.
```

Receiver replies "Received — continuing" in the doc and takes ownership (possibly pulling Protocol Reader or Evidence Lead).

---

## 9. Escalation Back to Main Coordinator

When 16-team work is complete or hits a high-risk boundary:

```
Handoff to Main Grok Coordinator (via 16-team-manager):

Consolidated output from 16-Person Live Team for: <task>
- Raw patches / file changes: ...
- Evidence artifacts: active-work/<slug>.md + decisions/<id>.md
- Raw diagnostics quoted: capital-audit..., readiness..., payback...
- Residual risk / promotion recommendation: ...
- Required next: verifier-agent + harness Verification Matrix row X + full test suite

Please integrate, run verifier, and promote if safe.
```

Main coordinator applies, verifies, and decides on commit / production promotion under full Supreme Law.

---

## 10. Useful References (Always Re-Read Before Work)

- `docs/16-team-operations.md` — full policy, when-to-use, artifact map, Domain Lead list
- `.grok/teams/live-16/protocol.md` — Live Collaboration Protocol v1 (the law inside the team)
- `.grok/teams/live-16/README.md` — current 16-person map + status
- `docs/harness-engineering.md` + `docs/skill-usage-guidelines.md` — still mandatory (Master Decision Matrix routes multi-domain work here)
- `AGENTS.md` — core product rules + diagnostic entry points (always quote raw)
- Latest `active-work/*.md` + `decisions/` for the specific task

---

**Tip**: The fastest way to get velocity is to activate with a clear task, let the Manager spawn 3–6 agents in the first turn (parallel default), and then use Direct Call / Handoff / Joint Session language in the shared active-work files.

All real work leaves traces in the artifact locations. No silent progress.

For the complete picture (policy nuances, relaxed Gateway details, full role list, integration with Supreme Law), read `docs/16-team-operations.md` first.