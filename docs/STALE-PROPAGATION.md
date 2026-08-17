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

## Regression matrix

Automated tests cover all six input-to-root mappings, page isolation, global fan-out, archived-Screen exclusion, continuation-mode invalidation through Visual/Underlay/Composition/Fidelity, duplicate-free transitive traversal, and stale Final Approval rejection.
