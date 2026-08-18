# Changelog

## Unreleased — audit remediation PR-8B/8C (golden fixture E2E, evidence governance, CI, designer signoff)

- Designer signoff completed: all five golden samples APPROVED by human review (every criterion ≥ 4, signer and date recorded); `index.json` derives `released`; signoff export archived at `release-evidence/golden-samples/signoff-results-2026-08-18.json`.
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
