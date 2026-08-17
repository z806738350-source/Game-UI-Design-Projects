# PR-6 evidence: product workbenches

## Scope

This milestone turns the strict-continuation data contracts into focused designer workbenches and makes screen identity explicit across UI, IPC, web API, storage, and pipeline calls.

## Acceptance evidence

- **Reference Inventory / Pack:** each reference has role, approval, screen type, contents, baseline, and notes. The UI shows deterministic attachment order, provider capacity, omissions, and omission reasons; a run with omissions requires explicit confirmation. Inventory changes are versioned and invalidate dependent work.
- **Stable controls:** required controls use `{ id, label, role, required }`. Legacy strings migrate deterministically, label edits do not mutate IDs, and bindings address stable IDs.
- **Component Kit:** state previews, exact/nine-slice/vector modes, visual nine-slice margins, scalable-center validation, text/scale/locked policies, real file hash, dimensions, MIME, alpha metadata, source bounding boxes, and Game UI Forge manifest import are available. Approval re-reads the actual files.
- **Screen Manager:** create, switch, duplicate, rename, and archive are exposed. Active screen and screen count are visible; the active screen cannot be archived. Requirements, wireframes, artifacts, workflow state, and inheritance/duplication provenance are stored per screen.
- **Explicit screen context:** screen-scoped calls require `screenId`; missing, archived, unknown, or inactive context is rejected before pipeline work begins.
- **Focused workbenches:** Typography, Underlay Review/Repair, and Fidelity are separate feature modules rather than domain logic embedded in the application shell.

## Verification

- Node service test suite, including reference ordering/omissions, stable-control migration, Forge asset evidence, screen isolation, and screen-context rejection.
- TypeScript no-emit check.
- Production renderer build.
- application quick check.
- dependency vulnerability audit and secret scan.
- local in-app browser walkthrough covering project creation, screen creation/switching, and Reference Inventory rendering.

Formal acceptance is intentionally not asserted here. Real golden samples and human designer signoff remain PR-8 gates.
