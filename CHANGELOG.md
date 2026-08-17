# Changelog

## Unreleased — audit remediation PR-4

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
