# PR-2 evidence — Composition Output and production renderers

- Milestone: PR-2 of 8
- Branch: `codex/audit-pr2-composition-output`
- Audit findings addressed: F-01 and F-02
- Formal release status: still blocked by PR-3 through PR-8

## Delivered runtime behavior

- `composeVisual` now invokes the main-process pixel renderer before it saves a completed Composition Manifest.
- Every successful render writes `screens/<screen-id>/compositions/preview-vN.png` or `final-vN.png`.
- `screens/<screen-id>/composition-output.json` records the real PNG path, SHA-256, dimensions, byte length, render time, renderer version, Underlay hash, deterministic layer order, and per-layer diagnostics.
- The Manifest references the exact current Output artifact and hash; a Manifest alone is not treated as a completed render.
- Strict Electron and Web exports copy/stream the verified final file. They do not download the selected provider Underlay.

## Renderer registry

| Contract mode | Production behavior | Failure gate |
| --- | --- | --- |
| `exact` | Uniform scaling only; records both scale axes and asset hash. | Rejects non-uniform or min/max-policy violations before pixels are accepted. |
| `nine-slice` | Extracts nine source regions; corners remain unscaled, edges resize on one axis, center resizes on both axes. | Rejects invalid integer margins, empty source center, undersized targets, and changed asset hashes. |
| `vector-token` | Requires and rasterizes an SVG source at the requested output size. | Rejects bitmap fallback and invalid SVG sources. |

`reference-locked` and `local-generated` are explicit aliases of the exact renderer; they are not routed through a generic stretch fallback.

## Acceptance evidence

Automated real-pixel tests prove:

- all four nine-slice corner patches remain byte-identical after a 12×12 source is expanded to 30×20;
- top/bottom edges preserve height while stretching horizontally;
- an exact 10×5 asset targeting a 20×20 slot fails with `EXACT_NON_UNIFORM_SCALE`;
- an exact 10×5 asset targeting 20×10 records a uniform 2× transform;
- vector-token rejects bitmap fallback and produces a requested SVG-derived raster;
- rendering the same Manifest twice produces the same PNG hash;
- the final PNG hash differs from the Underlay hash when a component is composed;
- deleting the final PNG makes output verification and Final Approval fail.

## Verification commands and results

| Check | Result |
| --- | --- |
| TypeScript type check | passed |
| Full Node test suite | 48 passed, 0 failed |
| Production build | passed; 1,786 modules transformed |
| Quick-start preflight | passed |
| Production dependency audit | no known vulnerabilities |

## Remaining boundary

Text is currently emitted through an SVG preview layer whose diagnostic records `actual_font_verified: false`. PR-3 must replace this with the audited real-font loading path, explicit authorization/exact confirmation, actual family evidence, typography effects, and supported-format cleanup. This PR does not claim F-03 is closed.
