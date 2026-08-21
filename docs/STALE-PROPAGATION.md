# Artifact stale propagation

`electron/services/artifactDependencies.cjs` is the only source of downstream invalidation truth. It defines direct edges and computes the transitive closure; pipeline code does not maintain a second stage-based list.

## Input roots and scope

| Change | Graph root | Scope |
| --- | --- | --- |
| Requirement | `input-requirement` | Current Screen only |
| Wireframe | `input-wireframe` | Current Screen only |
| Reference images / Inventory | `input-references` | Every non-archived Screen |
| Art Direction | `input-art-direction` | Every non-archived Screen |
| Project Type | `input-project-type` | Every non-archived Screen |
| Continuation Mode | `input-continuation-mode` | Every non-archived Screen |

Global Style, Font, and Component changes also fan out to every non-archived Screen. Screen Contract, bindings, layout, Underlay, visual, composition, and fidelity changes remain scoped to the target Screen. Global Artifact files are written once even while their dependent page Artifacts are traversed per Screen.

Each stale write records `stale_at` and `stale_reason`, updates the corresponding workflow stage, and reports affected Screen IDs. Archived Screens are excluded. A stale Fidelity Report cannot satisfy Final Approval because approval requires report status `passed` and current evidence.

## Visual evidence supersession

Strict-route Visual Results changes supersede old evidence at the moment the change starts, not after it succeeds: underlay regeneration (`visual_results_regenerated`), a new review decision (`visual_review_changed`), and repair additions (`visual_results_repaired`) all invalidate `visual-results` roots immediately, so the Critique/Composition/Fidelity chain can never keep trusting replaced evidence even when the follow-up generation fails. Composition Manifests additionally record the Visual Results version, selected variation IDs, and review hash at composition time; Final Approval and export reverify that binding and reject drifted delivery chains with `VISUAL_RESULTS_BINDING_STALE`.

## Regression matrix

Automated tests cover all six input-to-root mappings, page isolation, global fan-out, archived-Screen exclusion, continuation-mode invalidation through Visual/Underlay/Composition/Fidelity, duplicate-free transitive traversal, stale Final Approval rejection, and the three visual supersession events staling the strict Critique/Composition/Fidelity chain.
