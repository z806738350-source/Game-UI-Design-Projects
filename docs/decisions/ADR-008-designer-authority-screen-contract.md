# ADR-008: Designer authority over the Screen Contract

Status: accepted (maintainer ruling after real-environment testing, 2026-08-26)

## Why the AI inventory is not the final contract

The `source_inventory` inventoried by the AI during the project-input phase is a
starting point, not a binding contract. The user is the most accurate judge of what
controls actually exist on screen; the whole purpose of the wireframe-interpretation
(「功能解读」) stage is that the designer corrects and adjusts the AI list. Enforcing
the original AI list as a gate through review/approval made that stage meaningless and
blocked legitimate edits (approval was rejected with
`SCREEN_CONTRACT_COVERAGE_INCOMPLETE` after the designer intentionally removed
AI-misinventoried items). Ruling: **the designer's adjusted Screen Contract is the
accurate answer.**

## What the designer may edit

`screen_name`, `purpose`, `primary_action`, `secondary_actions`,
`required_controls`, `required_information`, `states`, `edge_cases`,
`data_dependencies`, `design_constraints`, `review_metadata`
(`SCREEN_CONTRACT_EDITABLE_KEYS` in `designPipeline.cjs`, M4-I2).

## What is immutable evidence

`id`, `screen_id`, `schema_version`, `version`, `generation_id`, `content_hash`,
`source`, `source_inventory`, `coverage`, `status`, `approved_at`, `stale_at`,
`stale_reason` are system-controlled. A generic PATCH carrying them is silently
ignored (never rejected, so full-artifact UI saves keep working); a patch containing
only system fields is a whole no-op. `source_inventory` changes only through
requirement/wireframe re-parse; `coverage` is always recomputed by the backend.

## Generation gate vs approval gate

- Generation phase (`coverageGateErrors`, kunpoClient draft-repair loop only): the AI
  draft must cover every `source_inventory` item, judged exclusively by server-side
  `recomputeCoverage` — model-self-declared `coverage.covered_items` is never trusted
  (M4-I3), so a draft cannot claim coverage without producing real controls.
- Approval/save phase: full deterministic structural re-validation only
  (normalize → recompute coverage → structure checks); malformed edits are rejected
  before downstream invalidation (failure atomicity). Coverage differences never
  block approval.

## Coverage roles in UI, export, audit

Coverage is traceability, not a gate: recomputed on save/approval/snapshot against
the original inventory, written back, and shown honestly in the workbench as a
neutral strip ("来源清单对照 · N 项已保留，M 项本轮契约未保留"). Exports and audits
read it as the record of which inventory items the designer chose not to keep.
`SCREEN_CONTRACT_COVERAGE_INCOMPLETE` is retained in the frozen error-code registry
as a historical compatibility code only.

## Legacy project compatibility

Snapshots (`projectStore.open`) recompute coverage on open, so stale stored
"fully covered" values from old drafts cannot pass through as a false green — but the
recomputed diff only informs; it never disables approval, so legacy projects with
intentional designer removals approve normally.
