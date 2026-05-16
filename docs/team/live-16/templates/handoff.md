# Small Template: handoff.md — Explicit Handoff Pattern (B Model Collaboration)

**Purpose**: Reusable prompt fragment defining the mandatory explicit handoff format and rules. Used whenever work or decision ownership must transfer between roles (Lead ↔ Specialist, cross-domain, or to Coordinator). Complements Live Sync Calls and fork_context delegation. Ensures no dropped context, full evidence provenance, and clear expected deliverable.

**When to Use Handoff** (per Live Collaboration Protocol v1 B Model):
- Task or proposal exceeds current role's Primary Ownership Areas or requires deeper specialization in another domain.
- After initial analysis, a Specialist needs to hand back to Lead for domain decision authority.
- Cross-domain impact (e.g. allocation change → risk gate review → payback runway update) requires sequential ownership transfer.
- Temporary delegation during joint session follow-up.
- Never for production execution changes (those go through policy + signer only).

**Mandatory Handoff Format** (exact string prefix, no deviation; all participants must recognize and act on it):

```
Handoff to [Exact Full Title of Receiver, e.g. "Allocation & Rebalancing Specialist" or "Capital & Treasury Domain Lead" or "Evidence, Data & Quality Domain Lead + Protocol Reader & On-chain Data Engineer"]: 

Reason for transfer: [1-2 sentences, evidence-driven, e.g. "New YCE-003 lane introduces destination_representative_proven evidenceClass that directly affects scored-target-balances and rebalance math; requires your allocator-core ownership before I can finalize risk gate proposal."]

Complete current state snapshot (forked):
- Relevant files / modules touched: [list exact paths]
- Current evidence slice: [paste minimal JSON: capital-audit summary, payback carry 587/4883/0.0234, quoteProofMatrix status, health snapshot, allocation scores, etc.]
- Work completed so far: [bullet list with timestamps + your title + proof links]
- Open questions / blockers: [numbered, with ownership]
- Suggested next steps: [optional]

Precise expected output / deliverable from receiver: [concrete, measurable, e.g. "Produce updated destination-promotion-gate scores + rebalance preview for wBTC.OFT base sleeve under small-capital + diversification rules. Append to active-work/yce-promotion.md with REBALANCE PLAN block + cap compliance proof. Then handoff back or initiate Live Sync if cross-impact."]

Current shared log: active-work/[task-or-sync-name].md (append your contribution here before/after handoff)
```

**Receiver Obligations** (enforced in base-*.md):
- Upon seeing "Handoff to [Your Title]": immediately confirm 100% of incoming scope is inside your declared Primary Ownership Areas (refuse otherwise and return with explanation).
- Re-execute full 5-Step Mandatory Verification (Gateway literal check on the handoff text + Original Task Name, diagnostics for your surfaces, quote raw, hygiene).
- Fork the provided state + your role + base template.
- Acknowledge receipt in the shared active-work log: "[Your Full Title] received handoff at [timestamp]. Running 5-Step... [key diagnostic status]."
- Complete the requested deliverable or further handoff (never drop the ball).
- Close your unit of work with your role's standard closure format (DOMAIN DECISION or SPECIALIST OUTPUT) + link back to the handoff.
- If cross-domain implications arise during execution, initiate Live Sync (if Lead) or handoff up to your Lead.

**Handoff Variations** (small patterns):
- **Lead-to-Specialist**: Detailed state + math ownership transfer (e.g. Capital Lead hands allocation scoring delta to Allocation Specialist).
- **Specialist-to-Lead**: Proposal + evidence complete; requests domain authority decision (e.g. "recommend this rebalance plan — approve?").
- **Cross-Domain Joint**: "Handoff to Evidence, Data & Quality Domain Lead + Protocol Reader & On-chain Data Engineer" for new evidenceClass definition.
- **Escalation to Coordinator**: For 16-team process / protocol evolution or unresolvable scope conflict.
- **Temporary/Parallel**: Handoff a slice while keeping primary ownership (use with fork_context).

**Rules**:
- Always explicit format — no implicit "I'll take this" or vague delegation.
- Handoff does not bypass 5-Step or Evidence quality gates.
- After handoff, the receiver owns the deliverable; initiator monitors via shared log + direct address follow-ups.
- Log every handoff in the task's active-work/*.md for audit trail (ties to receipt proofs and capital-audit).
- Never handoff policy engine, cap definitions, signer code, kill-switch, or Gateway execution surfaces (propose only via your Lead).

**Template Owner & Evolution**: Evidence, Data & Quality Domain Lead. All small templates (lead-sync.md, handoff.md, future call-another-agent.md / joint-session.md) maintained together. Updates mirrored to docs/team/live-16/templates/, reflected in both READMEs + progress docs, with fresh raw diagnostics.

**References**:
- base-lead.md: "Explicit Handoff Protocol" bullet + "Handoff to [Full Title]: reason...".
- base-specialist.md: "explicit handoff format", "Handoff to [Full Title]" in specialist rules and example calls.
- All roles/*.md "Mandatory Live Collaboration Protocol" sections.
- `.grok/teams/live-16/README.md` Key Files + Next (handoff.md listed as remaining template).

This handoff.md + base templates + current fork state = complete, traceable handoff prompt for the 16-person living team. Use it to keep ownership clear, evidence flowing, and work progressing in parallel without loss of context.
