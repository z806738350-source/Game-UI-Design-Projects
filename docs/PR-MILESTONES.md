# Existing-style continuation: 7 PR milestones

These are dependency-ordered review units. Every PR includes tests and its directly affected documentation.

1. **Existing Mode Guardrails** — continuation mode, strict underlay prompt, provider capabilities, deterministic reference pack, no silent truncation.
2. **Schema 2.0 and migration** — global/screen artifact paths, registry, active screen, recoverable 1.0 migration, screen-aware API.
3. **Typography and Component Kit** — font and component contracts, asset integrity, strict approval gates, workbench boundaries.
4. **Bindings and component-aware layout** — stable controls, 100% required coverage, component slots, layout validation, dependency invalidation.
5. **Underlay contract, guide, critique, repair** — reserved-region contract, deterministic guide, evidence-bearing critique, bounded repair and waiver gate.
6. **Composition and fidelity** — deterministic layer plan/rendering, typography enforcement, composition manifest, final fidelity approval.
7. **Golden samples and release** — end-to-end fixtures, new-project regression, user docs, changelog, version 0.2.0, full release checks.

## Cross-PR rules

- Back-end gates are authoritative; UI affordances mirror them.
- Approved artifacts are versioned and never overwritten without history.
- Upstream changes mark only affected downstream artifacts stale.
- Existing safety controls are retained; no new release hashes or baselines are introduced beyond artifact asset identity required for reproducible composition.
- Real provider smoke tests are release-environment checks and cannot be replaced by mocks.
