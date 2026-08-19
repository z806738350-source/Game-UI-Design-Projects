# Changelog

## 0.2.2 — 2026-08-19

> Final compliance and governance closure for the v0.2.1 audit verdict (F-01～F-04). No artifact schema or pipeline-semantics changes beyond the frozen binding gate; `v0.2.0` / `v0.2.1` tags are preserved untouched.

- F-01 Binding State/Font Role true explicitness (PR-20): the frozen `BINDING_VALIDATION_CODES` registry now backs every public binding gate code; BindingWorkbench requires explicit State and Font Role selection (no auto-defaults), the backend rejects unresolved generic `action` roles, and the strict compositor no longer falls back to `button-label` or `family.font_role`.
- F-03 UI E2E full scenario coverage (PR-21): added UIE2E-02B (multi-screen lifecycle with independent wireframe/contract, rename, duplicate, archive), UIE2E-03B (nine-slice configuration + render_log assertions), and UIE2E-07B/07C/07D/07E (font/component asset failures with frozen error codes, component-change stale chains, contract editing/export/mode switching through UI only); removed all business-mutating `callRendererApi` shortcuts so E2E proves UI-driven state changes; trace evidence (screenshots, renderer/main logs) uploads on failure.
- F-02 Documentation fact integrity (PR-22): `check-error-docs` validates all three frozen registries (ERROR_CODES / FIDELITY_ISSUE_CODES / BINDING_VALIDATION_CODES) bidirectionally against ERROR-CATALOG with no `BINDING_` exemption; new `check-doc-commands` verifies every documented pnpm command exists; new `check-project-tree` cross-checks the README `PROJECT_TREE` block, the golden evidence workspace, and the artifact registry against the machine fact source `docs/schemas/project-directory.required.json`; `pnpm test:docs` aggregates all four checks and CI `docs-validate` runs the same aggregation; 19 negative fixtures prove wrong commands, missing/unregistered codes, and misplaced artifacts fail the gate.
- Registry repair: `COMPOSITION_OUTPUT_MISSING` registered in FIDELITY_ISSUE_CODES, fixing an undefined issue code in fidelity reports.
- Governance: ADR-007 records the single-maintainer exception (seven required CI checks + substantive CodeReview substitute for a second human approver); CODEOWNERS and Ruleset remain enforced on `main`.

## 0.2.1 — 2026-08-19

> Remediation completion release (REM-01~06) on top of the `0.2.0` formal release. No artifact schema, backend gate, or golden evidence changes; the 0.2.0 Definition of Done remains valid.

- Binding semantic compatibility: froze the `binding-policy-v1` control-role policy (`electron/services/controlRolePolicy.cjs`) and made binding approval enforce it; no implicit first-family binding — every binding must be an explicit, role-compatible choice (BINDING_* gate codes).
- Workbench boundaries: each UI workbench may only invoke the IPC operations allowed for its pipeline stage; cross-boundary calls are rejected by the backend.
- UI E2E in CI: Playwright + Electron end-to-end suite (`tests/ui-e2e/`) driven by a local FixtureProvider (no real provider calls), plus frontend workbench unit tests; both run as required CI checks.
- Execution-grade documentation: 11 contract documents (`docs/contracts/`), 4 user guides (`docs/user/`), and 8 development/operations documents (`docs/dev/`) with field tables, state machines, approval/stale semantics, error codes, valid/invalid JSON examples, and source/test pointers.
- Error-code factualization: frozen registry `electron/services/errorCodes.cjs` (ERROR_CODES + FIDELITY_ISSUE_CODES) referenced by services; `docs/dev/ERROR-CATALOG.md` kept consistent by bidirectional validation.
- Automated documentation gate: `scripts/check-docs.cjs` + `scripts/check-error-docs.cjs` behind `pnpm test:docs` and the new CI `docs-validate` job (required docs, template headings, JSON fence parseability, referenced-path existence, README index consistency).
- Protected main: GitHub Ruleset on `main` (no direct pushes or bypasses) with all required checks; releases follow `docs/dev/RELEASE-CHECKLIST.md`.

## 0.2.0 — 2026-08-18

> Formal release. The remediation Definition of Done is complete: five real-provider golden samples pipeline-passed (three calibrated + two reserved, including a Simplified Chinese font sample), fixture E2E replays the published evidence chain in CI, and designer signoff is APPROVED for every sample (`release-evidence/golden-samples/index.json` derives `released`). This reissues the `0.2.0` line whose first acceptance was withdrawn on 2026-08-17.

- Designer signoff completed: all five golden samples APPROVED by 韩枫（UI设计师） (every criterion scored 5, signer and date recorded); signoff export archived at `release-evidence/golden-samples/signoff-results-2026-08-18.json`.
- Replaced the synthetic known-issues gate tests with `goldenFixtures.test.cjs`, which replays the published real-provider evidence chain: index consistency, negative-control rejection, input/semantic-response/final-PNG hash recomputation, connected repair chain with provider task ids, zero-blocking final underlay re-review, and component/font coverage including `zh_cn`.
- Recorded full Model Lineage in every execution log: model, critique prompt hash, input hashes, raw semantic responses, repair parent/child chain with provider task ids and output hashes, final underlay, final PNG hash, and frozen `threshold_version` (`underlay-metrics-v1`).
- Added two reserved validation samples that never participated in threshold calibration: `jade-shop-zh` (Simplified Chinese copy, currency/percent/mixed CJK-Latin text, Noto Sans SC under SIL OFL 1.1) and `frontier-campaign`; `index.json` now derives `released/pending-signoff/failed/prepared` from execution logs and designer signoff.
- Tiered the golden evidence: Git keeps reproducible inputs, JSON evidence, finals, manifests, fonts, and signoff records; source boards, repair attempt archives, and intermediate workspace PNGs stay local or ship as release assets (`.gitignore`).
- Normalized absolute workspace paths out of exported snapshots and execution logs; transient network failures (socket error codes and provider 502/503/504) retry a sample once.
- CI gained a fixture E2E job, a gitleaks secret scan, and a macOS validate job.

## Unreleased — audit remediation PR-5

- Added an asynchronous pixel Fidelity inspector that decodes the persisted final PNG and verifies format, dimensions, alpha, visible pixels, file hash, canvas, and output version.
- Re-hashes every current component and font file and re-parses font identity instead of trusting Manifest-shaped hashes.
- Added rendered crop hashes, bbox, overlap, declared safe-area, text ink-boundary, and nine-slice fixed-corner checks.
- Split reports into Manifest Consistency and Visual Fidelity, with versioned checks, thresholds, evidence files, and a deterministic evidence digest.
- Made generated Composition Manifest/Fidelity Report artifacts read-only through the edit API.
- Final Approval now re-runs current pixel/asset inspection and accepts only a passing latest report with an identical evidence digest.

## Audit remediation PR-4

- Added persisted Review Overlay PNGs with slot/protected-region labels and post-review semantic annotations.
- Added production pixel metrics for edge density, local contrast, color complexity, highlight density, and hard-edge crossings.
- Changed automatic critique to always submit the real Underlay, Review Overlay, and approved component board; callers can no longer inject deterministic or semantic findings.
- Added prompt/model/input hashes, versioned threshold evidence, complete semantic issue mapping, and mandatory manual review for low confidence or incomplete evidence.
- Added real provider repair execution for inpaint and regenerate, including a real mask for inpaint, parent/version provenance, saved repaired Underlays, and automatic re-critique.
- Added bounded-attempt failure handling that ends in blocked/manual-review instead of leaving an in-progress task.

## Audit remediation PR-3

- Split font import from explicit license and exact-role confirmation; imports always start unresolved.
- Added browser `FontFace` loading with `document.fonts.ready` before strict final composition.
- Added authoritative Sharp/Pango fontfile rendering with actual family, PostScript name, hash, and effect diagnostics.
- Added letter spacing, line height, stroke, shadow, gradient, baseline offset, and tabular-number rendering controls.
- Removed WOFF/WOFF2 import claims until a real parser is available.
- Made strict final composition and Fidelity fail on missing, changed, unconfirmed, mismatched, or fallback fonts.
- Added real-font tests proving exact/fallback pixel differences and no final fallback on load failure.

## Audit remediation PR-2

- Added a real main-process PNG compositor backed by a pinned `sharp/libvips` renderer.
- Added a persisted Composition Output artifact with path, hash, dimensions, renderer version, and per-layer diagnostics.
- Added separate exact, nine-slice, and SVG vector-token renderers; exact rejects non-uniform/out-of-policy scaling and nine-slice preserves fixed corner patches.
- Changed strict Electron and Web export paths to export the verified final PNG instead of the provider Underlay.
- Made Fidelity and Final Approval reject missing, unreadable, dimension-mismatched, hash-mismatched, stale, or non-final Composition Outputs.
- Added real-pixel renderer tests and a strict filesystem pipeline test, including deletion failure behavior.

## 0.2.0-alpha.1 — 2026-08-17

- Reclassified the current build as an architecture alpha after independent remediation audit.
- Added the audit execution baseline and made the remaining production gaps explicit.
- Added pull-request and main-branch CI for lint, tests, build, and dependency audit.
- Preserved the existing strict-continuation control plane while formal release remains blocked.

## 0.2.0 — 2026-08-17 (formal acceptance withdrawn)

> This version established the architecture baseline but did not satisfy formal production acceptance. It is superseded by `0.2.0-alpha.1` until the remediation Definition of Done is complete.

- Existing projects default to strict continuation with underlay-only image generation.
- Added deterministic reference packs and explicit provider capacity decisions.
- Added recoverable project schema 2.0 migration and multi-screen isolation.
- Added font/component asset contracts, binding coverage, component-aware layout, underlay critique/repair, deterministic composition, and final fidelity gates.
- Added strict continuation and production controls to the existing React workbench.
- Preserved the new-project exploration path.
