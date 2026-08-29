# ADR-009: Intent Analysis authority, candidates, history, and crash safety

Status: accepted (v1.4 execution baseline ruling, 2026-08-30)

## One-way authority

```text
Intent Analysis v2 (AI evidence, read-only)
  → Intent Review v1.1 (designer's structured authority)
  → requirement (deterministic backend projection)
  → Functional Screen Contract prompt
```

- AI analysis is evidence only; it never writes `requirement` directly.
- In `structured-v2` mode the `requirement` string is produced exclusively by the
  deterministic renderer `renderIntentReview()`; the frontend never implements a
  second renderer.
- `intent_analysis`, candidate/history files, `confirmed_at`, provider metadata and
  all revisions are server-controlled. Generic `saveProject` PATCH silently ignores
  them in structured mode.
- Candidates have no business effect until adopted; history never resurrects
  `requirement_confirmed` (snapshots keep `was_confirmed` for audit only).

## Crash safety: single publish point + repair-on-read

Rejected alternative (v1.3): a cross-file transaction journal with rollback /
roll-forward phases, explicit recovery APIs, and a persisted invalidation-pending
event. The deployment is a single process writing local JSON files, so the journal
buys protection only against a crash inside a short local write sequence, at the
cost of recovery APIs, a recovery UI, three error codes, and Fail-Closed hydrate
states.

Adopted model:

- The sole authority publish point is the atomic single-file replacement of
  `screens/<id>/inputs.json` (`jsonStore.writeJson`).
- Every write before the publish point is either an orphan-safe append
  (history snapshot/index, candidate) or a re-derivable projection
  (`requirement.md`, `project.json` compatibility fields).
- Downstream artifacts are marked stale conservatively *before* the publish point,
  so every partial state skews toward "more stale", never false-fresh. Staleness is
  a pure function of `source.intent_context` binding, re-derivable at any time.
- After a publish, missing projections, candidate cleanup and downstream stale
  marks are completed forward by an idempotent repair pass in `hydrate()`.
  Published inputs are never rolled back; repair never resurrects confirmations.

Consequences: no transaction journal, no `getIntentTransactionStatus` /
`recoverIntentTransaction` / `retryIntentInvalidation` APIs, no
`intent_invalidation_pending` event, no hydrate Fail-Closed on half-written state.

## Identity and freshness

- `intent_review.revision` is CAS-only (save conflicts, candidate baselines).
- Screen Contract freshness binds `source.intent_context` =
  `{ wireframe_revision, intent_context_revision, intent_context_hash }`.
  The hash (SHA-256 of canonical JSON) exists to detect semantic no-ops:
  adopt/restore may change revisions while the six-section content and supporting
  context are unchanged, which must not stale downstream.
- Stale analysis (wireframe or project_type mismatch) is mechanically excluded from
  the Screen Contract context builder; UI labels alone are not a boundary.

## Concurrency

Long model calls run lock-free between two short locked phases (capture → call →
commit). Every terminal generation write performs request-id CAS first; stale
process `running` states convert to `interrupted` on open. Clones take the source
project write lock and Fail-Closed while a generation runs or an adopt/restore
commit is in flight.
