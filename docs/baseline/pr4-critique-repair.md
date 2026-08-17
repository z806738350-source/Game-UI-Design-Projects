# PR-4 evidence — Critique and Repair loop

- Milestone: PR-4 of 8
- Branch: `codex/audit-pr4-critique-repair`
- Audit findings addressed: F-04 and the runtime portion of F-05
- Formal release status: still blocked by PR-5 through PR-8

## Review evidence

- Automatic Critique materializes the selected Underlay as a real local PNG and hashes it.
- It creates a real Review Overlay PNG with reserved Slot IDs/protected boxes, then creates a second annotated Overlay with semantic findings.
- It creates a real component board from approved component state assets, with IDs and thumbnails.
- The model always receives three ordered image inputs: raw Underlay, Review Overlay, and component board. The previous caller-supplied `semantic` and `deterministic` shortcut is no longer used.
- Critique records model, Prompt SHA-256, all input PNG hashes/paths/sizes, metric threshold version, low-level metrics, semantic results, and stable issues.

## Deterministic metrics and issue mapping

Production code reads actual PNG pixels for every reserved region and calculates:

- edge density;
- local luminance contrast;
- quantized color complexity;
- highlight density;
- hard-edge crossings at the protected boundary.

The versioned `underlay-metrics-v1` candidate thresholds generate auditable busyness, highlight, and hard-edge issues. Semantic `background_busyness`, `contrast_conflict`, and `hard_edge_crossing` fields are all converted to issues; low confidence or incomplete three-image evidence requires manual review and can never auto-pass.

## Repair execution

- Repair planning chooses inpaint only when Provider Capabilities explicitly support it; otherwise it regenerates with the evidence pack.
- Inpaint sends a real PNG mask generated from target/protected regions. Regenerate sends parent Underlay, annotated Overlay, and component board as image references.
- Every successful repair saves a new local `underlay-vN` PNG plus Provider URL/task ID, parent Underlay ID, Repair Task ID, mode, hash, and timestamps.
- The old Critique is invalidated. The new Underlay is automatically re-measured and re-submitted for Critique, and the resulting artifact points only to the new Underlay ID.
- Provider failure or attempt overflow records `blocked` and `manual_review`; no task is left indefinitely `in_progress`.

## Acceptance evidence

Automated tests prove:

- real checkerboard/flat PNG regions produce distinguishable edge, contrast, color, highlight, and perimeter metrics;
- Overlay, semantic annotation, component-board thumbnail, and repair-mask files are real PNGs with hashes;
- UI-like regions, fake text, subject overlap, semantic busyness, contrast conflict, and hard-edge crossing map to blocking issues;
- missing three-image evidence and low confidence cannot auto-pass;
- Provider requests for inpaint contain an explicit image/mask/reference split, while regenerate carries the three evidence images;
- both inpaint and regenerate produce a new versioned Underlay and automatically run Critique on that new ID;
- a third automatic attempt with a two-attempt limit becomes blocked and requires manual review;
- the existing known-critical fixtures still have zero auto-passes.

## Verification commands and results

| Check | Result |
| --- | --- |
| TypeScript type check | passed |
| Full Node test suite | 58 passed, 0 failed |
| Production build | passed; 1,787 modules transformed |
| Quick-start preflight | passed |

## Remaining boundary

`underlay-metrics-v1` is a versioned candidate, not a claimed business-calibrated release threshold. PR-8 must run privacy-safe real Golden Samples and collect real designer scoring before calibration can be called complete. PR-5 must still validate the final composed pixels and current asset files. No formal acceptance is claimed here.
