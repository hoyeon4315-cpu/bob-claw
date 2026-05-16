# Live Collaboration Protocol v1 — BOB Claw 16-Person Team (B Model)

**Version**: 1.0  
**Philosophy**: Real engineering team behavior — agents directly communicate, pull each other in, hand off work, run parallel sessions, and self-organize under Domain Lead coordination. Not everything funnels through the Engineering Manager.

---

## 1. Core Principles

1. **Direct Address**  
   Agents speak to each other by full role name ("Capital Systems Domain Lead", "Yield & Campaign Opportunity Engineer", etc.).

2. **Domain Leads as Active Hubs**  
   Each Domain Lead is responsible for knowing their team's capacity and actively pulling the right specialists. They are portfolio managers, not just title holders.

3. **Live Context via fork_context**  
   When pulling another agent, we almost always use `fork_context: true` so the new agent arrives with rich recent context instead of cold start.

4. **Artifact-First Transparency**  
   Important discussions, decisions, and handoffs are written to shared files in `active-work/` or `decisions/`.

5. **Relaxed but Responsible Gateway Policy (Team-Only)**  
   Inside this 16-team mode:
   - The hard literal-word "Gateway" refusal is **suspended**.
   - Agents may freely analyze, design, and edit Gateway-related surfaces (onramp/offramp helpers, settlement proofs, quotes, etc.).
   - They **must** still run the required diagnostics before material changes (`report:capital-audit -- --json`, readiness check, payback status, etc.).
   - They may **not** weaken committed caps, core policy invariants, or signer audit integrity.
   - High real capital loss risk changes escalate to the main coordinator.

   Outside this mode (main coordinator, production execution) the full strict Supreme Law remains in force.

6. **Parallel Execution as Default**  
   In the 16-person Live Team (B Model), parallel work is the default and strongly recommended approach.  
   The Engineering Manager and Domain Leads must actively look for opportunities to run multiple independent or loosely coupled tasks simultaneously by spawning several subagents in parallel, rather than processing work sequentially.  
   Use `background: true`, `fork_context: true`, and simultaneous multi-agent spawning whenever appropriate.  
   This principle applies across all sessions.

---

## 2. Standardized Collaboration Patterns

### Pattern 1: Direct Call (Most Common)
**When**: One agent needs input or help from another specific role.

**Example flow**:
- Yield & Campaign Opportunity Engineer is stuck on receipt validation for a DefiLlama pool.
- It writes a short note in `active-work/defillama-receipt-validation.md`
- Then addresses: "Evidence, Data & Quality Domain Lead + Receipt & Reconciliation Engineer, the DefiLlama yield lane needs receipt-backed validation logic. I left the current blocker in active-work/defillama-receipt-validation.md. Can you review with me?"

The Engineering Manager (or Domain Lead) then spawns the requested agents with `fork_context: true` + the relevant file + the question.

### Pattern 2: Joint Session (2–4 Agents)
**When**: A decision or piece of work genuinely requires multiple domains at the same time.

**How**:
- A Domain Lead or the Engineering Manager spawns 2–4 agents in one step.
- All receive `fork_context: true` and a shared goal ("Converge on the best approach for X within 20 minutes").
- They discuss (in the session) and produce a joint recommendation or implementation plan.

Good for: complex capital + evidence + opportunity intersections, new strategy admission, major policy changes inside the team scope.

### Pattern 3: Explicit Handoff
**When**: Work clearly belongs more in another role's primary area.

**Format** (write this clearly):
```
Handoff from: Yield & Campaign Opportunity Engineer
To: Receipt & Reconciliation Engineer
Why: This receipt parsing logic for new yield sources is deeper in your ownership.
Current state: See active-work/defillama-receipt-validation.md
Open questions:
- How do we prove entry/exit for non-Merkl yield pools?
- Should we extend the existing settlement-proof helper?

Please confirm receipt and continue.
```

Receiving agent replies with "Received — continuing" and takes ownership.

### Pattern 4: Proactive Pull-In by Domain Lead
Domain Leads are expected to monitor `active-work/` in their domain and proactively pull specialists when they see signals that more brainpower is needed.

### Pattern 5: Escalation / Cross-Domain Sync (Rare)
Only used when:
- Two Domain Leads cannot agree
- The decision has potential high capital risk
- Truly novel work that doesn't clearly fit existing domains

In this case, the Engineering Manager facilitates a short sync.

---

## 3. Technical Spawn Patterns (How We Actually Call Agents)

All collaboration ultimately happens through the `task` / `spawn_subagent` tool.

### Recommended Parameters for B-Model Collaboration

**For a normal Direct Call or Pull-In**:
- `fork_context: true`
- `capability_mode: "all"` (for most roles)
- Rich `prompt` that includes:
  - "You are the [Exact Role Name]"
  - Reference to this `protocol.md`
  - The specific question + relevant recent files / context
  - "Stay in Execution Mode. Integrate results and continue."

**For risky parallel exploration**:
- `isolation: "worktree"`
- `background: true`

**For deep continuation of one agent's thinking**:
- `resume_from: <previous task_id>`

**For Joint Sessions**:
Spawn multiple agents in a single turn (the system supports parallel `spawn_subagent` calls), all with `fork_context: true` and a shared "Joint Session Goal" section in their prompts.

---

## 4. Shared State Locations (Mandatory for Transparency)

- `active-work/<task-slug>/` — working documents, blocker notes, partial plans
- `decisions.md` (at team root) — important team-level decisions with rationale
- Per-role or per-task `plan-*.md` files when doing multi-step implementation

Agents are instructed to write clearly named, findable updates instead of only chatting in the session.

---

## 5. Role Evolution & New Work Absorption

When a completely new strategy, data source, or system appears:

1. The relevant Domain Lead declares "This belongs in my domain."
2. The Lead decides which existing Specialist(s) will absorb it (or temporarily borrows someone from another domain).
3. If the work is truly novel and doesn't fit well, the Engineering Manager can authorize a role evolution or temporary specialist reallocation.
4. No new role is created lightly — we prefer stretching existing T-shaped people first.

This is the main mechanism that delivers the flexibility the user asked for.

---

## 6. Execution Mode Discipline (Still Applies)

Even with the relaxed Gateway rule:
- Every agent still follows the spirit of the 5-Step (read core docs, run diagnostics, quote raw outputs when relevant).
- No unsolicited Lx-style checklists.
- Integrate results silently and continue.
- Short, natural termination summary only at natural completion of a unit of work.

---

**This protocol is the operating law for the 16-person Live Team.**

All role definitions in `roles/` reference this file. All spawn templates in `templates/` are written to support these patterns.

When in doubt, default to **direct address + Domain Lead coordination + artifact transparency**.