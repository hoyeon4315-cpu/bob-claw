# Branch Protection Readiness

Branch protection is a GitHub repository setting, not a repo-local file. This
runbook exists only to verify the external setting and to keep future readiness
checks from confusing documentation with enforcement.

## Verification

Run the focused verifier:

```bash
npm run check:branch-protection -- --repo=hoyeon4315-cpu/bob-claw
```

For raw GitHub evidence, use the readiness criterion commands directly:

```bash
gh api repos/hoyeon4315-cpu/bob-claw --jq '.permissions.admin'
gh api repos/hoyeon4315-cpu/bob-claw/rulesets
gh api repos/hoyeon4315-cpu/bob-claw/branches/main/protection
```

If `dev` exists later, also verify:

```bash
gh api repos/hoyeon4315-cpu/bob-claw/branches/dev/protection
```

## Current Intended Policy

- `main` requires pull requests before updates.
- Required status checks are not configured unless the check name is confirmed
  from actual GitHub Actions runs.
- Force pushes and branch deletion are disabled.
- `dev` is not protected because the branch does not currently exist.

Do not replace this external setting with placeholder config, fake ruleset
docs, or no-op workflows.
