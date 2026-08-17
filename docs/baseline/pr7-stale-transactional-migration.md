# PR-7 evidence: unified stale graph and transactional migration

## F-11 — one invalidation source

- Removed the legacy stage-based invalidation function.
- Mapped Requirement, Wireframe, References, Art Direction, Project Type, and Continuation Mode to explicit graph roots.
- Direct dependency edges produce a duplicate-free transitive closure through final Fidelity.
- Page roots target one explicit Screen; global roots enumerate every non-archived Screen and report the affected IDs.
- Artifact and workflow statuses change together, and stale reports remain ineligible for Final Approval.

## F-12 — recoverable directory transaction

- A complete hidden sibling backup is created before any project mutation.
- All Schema 2.0 writes occur in a complete staging copy and are validated before directory promotion.
- Directory-switch failures restore the original; failures before the switch never touch it.
- The failure record lives beside the project so recovery evidence does not change the restored project tree.
- Eight fault-injection checkpoints verify exact tree restoration, nested backup completeness, successful retry, and idempotent repeat execution.

## Verification commands

- full Node service test suite
- CI-equivalent `tsc -b && vite build`
- application quick check
- dependency audit, target preflight, staged secret scan, and GitHub Actions

Formal release remains blocked on PR-8 real visual golden samples and human designer signoff.
