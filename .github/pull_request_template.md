## Description / Summary

<!-- Describe what changed and why in 1-3 concise bullets. -->

What changed:
<fill in>

Why:
<fill in>

## Scope

<!-- List the files, modules, or docs changed by this PR. Keep the scope narrow. -->

Files, modules, or docs changed:
<fill in>

## Testing Done / Verification

<!-- Paste the exact commands you ran and the key output lines that prove the result. Do not summarize away the evidence. -->

Commands run:

```text
<fill in>
```

Key output lines:

```text
<fill in>
```

Notes:
<fill in>

## Relevant Context

<!-- Add the reviewer context that is necessary to understand this change. Link related issues, docs, plans, or signals. -->

<fill in>

## Safety Impact

<!-- Mark every item explicitly. If anything changed, explain the impact and why it is safe. -->

- Caps changed: [ ] yes [ ] no
- Signer changed: [ ] yes [ ] no
- Kill-switch changed: [ ] yes [ ] no
- Policy changed: [ ] yes [ ] no
- Readiness checks changed: [ ] yes [ ] no
- Payback changed: [ ] yes [ ] no
- Secrets or private keys changed: [ ] yes [ ] no

Notes:
<fill in>

## Runtime / Live Path Impact

<!-- Mark every item explicitly. If anything changed, explain the live-path effect and whether it is intentional. -->

- Live execution impacted: [ ] yes [ ] no
- Signer daemon impacted: [ ] yes [ ] no
- Payback scheduler impacted: [ ] yes [ ] no
- Capital mover impacted: [ ] yes [ ] no
- Dashboard truth or deploy impacted: [ ] yes [ ] no

Notes:
<fill in>

## Generated Files

<!-- Confirm whether any generated/runtime files were touched. Prefer none. Do not stage unnecessary artifacts. -->

- Dashboard public JSON included: [ ] yes [ ] no
- Logs included: [ ] yes [ ] no
- Data snapshots included: [ ] yes [ ] no
- Build artifacts included: [ ] yes [ ] no
- Coverage outputs included: [ ] yes [ ] no
- Dependency or cache folders included: [ ] yes [ ] no

If anything generated was included, explain why it was intentionally changed:
<fill in>

## Deployment / Dashboard Impact

<!-- Explain whether this PR changes deployed truth surfaces, dashboard public output, or any deployment step. -->

- Deployment affected: [ ] yes [ ] no
- Dashboard affected: [ ] yes [ ] no

Monitoring or rollback notes:
<fill in>

## Checklist

- [ ] I did not ask this PR to deploy, trade live, sign transactions, move capital, or bypass safety gates.
- [ ] I did not include private keys, env secret values, wallet secrets, Telegram tokens, API keys, or seed phrases in the PR body, screenshots, or logs.
- [ ] I verified that no unrelated generated/runtime files were committed.
- [ ] I verified the diff is focused on the intended signal only.
- [ ] I included the exact commands and key output lines needed for review.
- [ ] I included enough context for a reviewer to understand the change without guessing.

## Secret Safety Warning

Do not paste private keys, env secret values, wallet secrets, Telegram tokens, API keys, or seed phrases into this PR body, screenshots, terminal output, logs, or attached artifacts. Redact sensitive values and replace them with safe placeholders.
