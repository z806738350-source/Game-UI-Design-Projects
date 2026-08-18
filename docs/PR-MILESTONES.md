# Audit remediation: 8 PR milestones

These review units follow the dependency order required by `Game-UI-Design-Copilot-整改审核与执行基线-v1.0.md`. Every PR must include its automated checks, error paths, directly affected documentation, real-file evidence where applicable, and an updated acceptance record.

## Execution status

| Milestone | Status | Evidence |
| --- | --- | --- |
| PR-1 | Merged | GitHub PR #2; CI passed; `main` merge `a4f1e2b`; v1.1 corrected to prerelease. |
| PR-2 | Merged | GitHub PR #3; CI passed; `main` merge `59ea5b2`; `docs/baseline/pr2-composition-output.md`. |
| PR-3 | Merged | GitHub PR #4; CI passed; `main` merge `7e0e38e`; `docs/baseline/pr3-typography-truth.md`. |
| PR-4 | Merged | GitHub PR #5; CI passed; `main` merge `5ad6d32`; `docs/baseline/pr4-critique-repair.md`. |
| PR-5 | Merged | GitHub PR #6; CI passed; `main` merge `711e70d`; `docs/baseline/pr5-pixel-fidelity.md`. |
| PR-6 | Merged | GitHub PR #7; CI passed; `main` merge `bde8732`; `docs/baseline/pr6-product-workbenches.md`. |
| PR-7 | Merged | GitHub PR #8; CI passed; `main` merge `6e83b7e`; `docs/baseline/pr7-stale-transactional-migration.md`. |
| PR-8A | Merged | Runtime fixes from real E2E findings: GitHub PR #9 (`36b79d5`, `cd9a021`) and PR #10 (`bca8b0f`). |
| Style Contract 2.0 (P0) | Merged | GitHub PR #11; executable style schema with numeric bounds, required semantic colors, vague-word blacklist, and failing tests; `main` merge `e0b233e`. |
| PR-8B | Merged (GitHub #12, main@6d01004) | Fixture E2E evidence chain, model lineage, evidence tiering, CI additions (fixture job, gitleaks, macOS), reserved + Chinese font samples; runbook `docs/baseline/pr8-golden-release.md`. |
| PR-8C | Merged (GitHub #13, main@f404378) | Five samples APPROVED by designer signoff (韩枫，UI设计师；all criteria 5/5); index derived `released`; execution docs, README/CHANGELOG, signoff archive. |
| Release 0.2.0 | Released (tag v0.2.0, GitHub Release) | Version bump `0.2.0-alpha.1 → 0.2.0`, CHANGELOG formal entry, README/milestones updated; tag and GitHub Release created from merged main@d907c05 (PR #14). |

1. **Release correction, CI, and baseline** — mark the current build as an architecture alpha, preserve the independent audit, add PR/main CI, and freeze reproducible facts without claiming formal acceptance.
2. **Composition output and renderers** — persist real preview/final PNG output; implement exact, nine-slice, and vector-token renderer dispatch; export the verified final artifact.
3. **Typography truth** — separate import from authorization/exact confirmation; load real font files in the renderer; record the actual loaded family; remove unsupported format claims.
4. **Critique and Repair loop** — create review overlays, calculate deterministic image metrics, submit complete multimodal evidence, execute provider repair, and automatically re-critique the new underlay.
5. **Pixel-aware Fidelity** — validate the real final PNG and current asset files, add layout/pixel checks, and rewrite Final Approval around the latest evidence-bearing report.
6. **Product workbenches** — deliver Reference, Typography, Component Kit, Screen Manager, per-screen inputs, Underlay, and Fidelity workbenches without concentrating domain logic in `App.tsx`.
7. **Unified stale and transactional migration** — make the artifact dependency graph the sole invalidation source and make schema migration atomic, recoverable, fault-injected, and idempotent.
8. **Real Golden Samples and formal release** — run three privacy-safe real visual samples through the full chain, collect real designer signoff, complete execution-grade documentation, and restore formal release only when every Definition of Done item passes.

## Merge gates

- Do not merge a milestone until its required tests, failure paths, and directly affected documentation pass.
- Do not substitute manifests, task JSON, synthetic detector findings, or self-reported smoke tests for required visual files and business evidence.
- Back-end gates are authoritative; UI disabled states only mirror them.
- Preserve unrelated local changes and exclude unrelated visual redesign or bulk formatting.
- A later milestone may not be used to waive an unmet prerequisite; dependency failures keep downstream milestones blocked.
- Human design scores and signatures must come from real reviewers and must never be synthesized.
