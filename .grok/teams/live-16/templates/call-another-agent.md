# Template: Call Another Agent (Direct Call)

**Use this template** when one agent needs to pull in another specific role for help, review, or joint work.

---

**In the prompt for the `task` tool, include the following section:**

---

You are being called into a live collaboration using the BOB Claw 16-Person Live Team Protocol (see `.grok/teams/live-16/protocol.md`).

**Calling Agent**: [Exact Role Name of the agent making the request]  
**Called Role**: [Exact Role Name being called, e.g. "Receipt & Reconciliation Engineer"]

**Context / Why you are needed**:
[2-4 sentences explaining the situation and the specific help or decision required]

**Relevant shared artifacts** (read these first):
- `.grok/teams/live-16/active-work/<relevant-file>.md`
- (list any other key files or recent outputs)

**What the calling agent expects from you**:
- [Clear expectation: review and give opinion, take ownership of this sub-problem, propose a design, help debug, etc.]

**Collaboration rules**:
- You may directly address other agents if you need more input.
- Use `fork_context: true` if you later need to pull someone else in.
- Write important updates to the shared active-work file.
- Stay in Execution Mode: integrate context and contribute concretely.

Please respond with your analysis or proposed next step. If you need to pull in additional roles, say so clearly.

---

**When actually spawning**, the Engineering Manager (or Domain Lead) should:
1. Paste the above into the child `prompt`.
2. Set `fork_context: true`.
3. Optionally set `background: true` if the task is long.
4. Use `capability_mode: "all"` for most roles.