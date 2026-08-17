# Audit remediation: 8 PR milestones

These review units follow the dependency order required by `Game-UI-Design-Copilot-整改审核与执行基线-v1.0.md`. Every PR must include its automated checks, error paths, directly affected documentation, real-file evidence where applicable, and an updated acceptance record.

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
