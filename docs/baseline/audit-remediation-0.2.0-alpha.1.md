# Audit remediation baseline — 0.2.0-alpha.1

- Captured: 2026-08-17 (Asia/Shanghai)
- Audited main commit: `498a8a965d4de374c5ef73389ad7fedc131e0c2c`
- Remediation baseline version: `0.2.0-alpha.1`
- Audit result: **not passed / architecture alpha**
- Governing audit: `docs/Game-UI-Design-Copilot-整改审核与执行基线-v1.0.md`

## Reproduction commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm build
pnpm quick-start:check
pnpm audit --prod --audit-level high
```

## Captured results

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm lint` | passed | TypeScript completed without diagnostics. |
| `pnpm test` | passed | 43 tests passed, 0 failed. |
| `pnpm build` | passed | Vite built 1,786 modules and produced a non-empty `dist/index.html`. |
| `pnpm quick-start:check` | passed | Dependencies available; expected port 5174; no reusable server. |
| `pnpm audit --prod --audit-level high` | passed | No known production dependency vulnerabilities. |

These results are reproducible engineering checks. They do not upgrade the audit result to formal product acceptance.

## Frozen product facts

- Strict-continuation contracts, schema v2, screen registry, reference packing, artifact dependencies, component/font contracts, underlay planning, critique integration, composition manifest, and preliminary fidelity gates exist.
- `composeVisual` does not yet produce and persist a real final PNG.
- exact, nine-slice, and vector-token component rendering are not yet implemented as production renderers.
- imported fonts are not yet proven to load through the final renderer, and authorization/exact truth is not fully separated.
- Repair currently plans work but does not complete a real provider repair and automatic re-critique loop.
- Fidelity primarily validates manifests rather than the final pixel artifact.
- multi-screen backend support exists, but the complete user-facing workbench and per-screen input flow are incomplete.
- current Golden Sample tests are synthetic control-plane fixtures, not real visual business acceptance.

## Remediation blockers

The governing audit defines fourteen findings (`F-01` through `F-14`) and eight dependency-ordered PR milestones. Formal release remains blocked until all blocker and critical findings are closed with real-file evidence, CI evidence, and required human signoff.

## Evidence policy

- A Manifest is not a final image.
- A Repair Task is not a completed repair.
- A declared exact asset is not proof that the renderer used it.
- Unit tests and Provider smoke tests are not strict visual E2E acceptance.
- Human design scoring must be recorded by a real reviewer and must not be synthesized.
