# PR-3 evidence — Typography truth

- Milestone: PR-3 of 8
- Branch: `codex/audit-pr3-typography-truth`
- Audit finding addressed: F-03
- Formal release status: still blocked by PR-4 through PR-8

## Authorization and identity flow

- Import accepts only OTF/TTF and always writes `license_status: unresolved`; request metadata cannot pre-confirm authorization.
- A separate user action must explicitly confirm both project-use authorization and an exact font role. That action records actor/time evidence and invalidates downstream artifacts.
- Generic Font Manifest editing cannot modify font assets, authorization, or role bindings, so it cannot bypass the dedicated confirmation action.
- Font Manifest validation requires the parsed family, PostScript name, format, SHA-256, coverage, license evidence, and exact-role evidence.
- WOFF/WOFF2 are rejected until a real parser and real-file tests exist.

## Actual loading and rendering

- The strict UI reads the verified project font bytes, constructs a browser `FontFace`, awaits `face.load()` and `document.fonts.ready`, and checks the family before requesting Final composition.
- The authoritative persisted PNG is rendered in the main/service process using Sharp/Pango with the exact `fontfile` path. The file is re-inspected and re-hashed immediately before rendering.
- Final mode never falls back. Missing files, changed hashes, changed family/PostScript identity, missing authorization evidence, missing exact evidence, or render failure stop composition.
- Preview mode may use `sans-serif` only when exact loading fails, and records `actual_font_verified: false` plus the fallback reason.
- Composition Output records `actual_loaded_family`, actual PostScript name, current font hash, and per-layer effect settings. Fidelity requires matching actual render evidence for every exact text layer.

## Typography effects

The production text renderer applies and records font size/weight, letter spacing, line height, fill or linear gradient, stroke, shadow, baseline offset, alignment, and tabular/proportional numeric styling.

## Acceptance evidence

Automated tests use a real installed TTF file and prove:

- attempted authorization metadata on import remains unresolved;
- explicit authorization and exact-role confirmation records auditable evidence;
- unsupported WOFF/WOFF2 import is rejected;
- strict validation rejects missing identity, coverage, authorization, and exact evidence;
- exact fontfile rendering records the parsed actual family, PostScript name, and hash;
- the same text rendered with the exact font and preview fallback produces different PNG hashes;
- a missing font file blocks Final rendering instead of silently falling back;
- unresolved authorization blocks Final Composition before Final Approval can exist;
- Fidelity fails when an exact text layer lacks matching actual-render evidence.

## Verification commands and results

| Check | Result |
| --- | --- |
| TypeScript type check | passed |
| Full Node test suite | 52 passed, 0 failed |
| Production build | passed; 1,787 modules transformed |
| Quick-start preflight | passed |

## Remaining boundary

PR-3 closes the audited typography-truth finding but does not claim formal acceptance. PR-4 must implement real Review Overlay, deterministic image metrics, provider Repair execution, a new Underlay, and automatic re-critique. Pixel-aware whole-output Fidelity remains PR-5.
