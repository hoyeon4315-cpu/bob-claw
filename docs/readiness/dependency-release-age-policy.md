---
dependency_release_age_policy:
  minimum_days:
    npm: 7
    github_actions: 7
  emergency_exception: operator/security review required
  automation_gap_behavior: manual reviewer enforcement required until dependency update automation is merged
  auto_merge: prohibited
---

# Dependency Release Age Policy

BOB Claw does not merge dependency version bumps immediately after an upstream release.

## Required delay

- npm dependency updates must wait at least 7 days after the upstream release before merge.
- GitHub Actions dependency updates must wait at least 7 days after the upstream release before merge.
- The same 7 day minimum applies to bot PRs and manual dependency bump PRs.

## Emergency exception

- A security emergency exception requires operator/security review required before merge.
- The PR must link the upstream advisory or CVE, explain why the 7 day delay is unsafe to keep, and record the approval in the PR conversation.
- The exception is a one-off approval only. It is not a default bypass, blanket approval, or auto-merge path.

## Automation and verification

- If `.github/dependabot.yml` is present, it must use Dependabot's supported `cooldown` settings for npm and `github-actions` updates at or above the policy minimum.
- If Renovate config is present, it must use Renovate's supported `minimumReleaseAge`, `stabilityDays`, or an equivalent supported delay gate for npm and `github-actions` updates at or above the policy minimum.
- If dependency update automation is not present in the checked-out branch, reviewers still enforce the same 7 day delay manually and `npm run check:dependency-release-age` remains the verification handle for this policy.
