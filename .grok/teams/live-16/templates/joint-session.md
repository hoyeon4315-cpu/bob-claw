# Template: Joint Session (Multi-Agent Collaboration)

**Use this** when a problem genuinely requires 2~4 different roles to work together at the same time (not sequentially).

---

**When spawning a Joint Session**, the Engineering Manager or a Domain Lead should create one `task` call per participant, with roughly the following structure in each prompt:

---

**Joint Session Notice**

You are participating in a **Joint Session** using the BOB Claw 16-Person Live Team Protocol.

**Session Goal**:
[Clear, specific goal, e.g.]
"Within this session, converge on the best technical approach for validating DefiLlama yield pool receipts so that the lane can move from shadow to prelive. Produce a concrete recommendation + next implementation steps."

**Participants in this Joint Session**:
- Capital & Treasury Domain Lead
- Opportunity & Research Domain Lead
- Evidence, Data & Quality Domain Lead
- Yield & Campaign Opportunity Engineer
- Receipt & Reconciliation Engineer

**Shared Context** (all participants should read):
- `.grok/teams/live-16/active-work/defillama-receipt-validation.md`
- Recent capital-audit and strategy evidence outputs (links or summaries)

**Rules for this Joint Session**:
- Speak directly to other participants by role name.
- Be concise but substantive.
- If you need to pull in additional roles, say so clearly.
- At the end of the session, the group should produce:
  1. Agreed technical direction
  2. Clear next actions with owners
  3. Any blockers that require Engineering Manager decision

You may use multiple turns within this session. The goal is real collaboration and convergence, not just individual opinions.

---

**Best Practice**:
- The person initiating the Joint Session should also create (or update) a shared working file in `active-work/` so everyone has a common reference.
- After the session, one participant (usually a Domain Lead) should summarize the outcome in `decisions/` or the working file.