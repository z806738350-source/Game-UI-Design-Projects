# 0.2.0 acceptance record

- Date: 2026-08-17
- Branch: `codex/existing-style-v2`
- Milestones: 7 local PR commits, dependency ordered

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm lint` | passed |
| `pnpm test` | passed — 43 tests, 0 failures |
| `pnpm build` | passed |
| `pnpm quick-start:check` | passed |
| local browser UI | passed — strict/guided selector visible; no console warnings/errors |
| `pnpm test:kunpo` | passed — real multimodal Artifact |
| `pnpm test:kunpo-image` | passed — real Image-GPT2 task, trusted permanent CDN result |

The first provider invocation was blocked by the local sandbox network boundary; the authorized network run passed. No mock result was substituted.

## Golden samples

All three privacy-safe samples are executed in automated tests. Known button/navigation/text contamination and subject-slot crossing produce blocking critique; known critical auto-pass count is zero. Visual 4/5 scoring remains a human review responsibility when production-owned images and fonts are supplied.

## Migration

Automated 1.0→2.0 migration test passes. It preserves the legacy project/workflow snapshot, registers `main`, writes a migration log, retains legacy visuals, and does not invent font or component evidence.

## Release blockers

- blocker: 0
- critical: 0
- unresolved automated checks: 0
- release-environment provider smoke: passed

## Conclusion

Automated and real-provider release gates pass for 0.2.0. Production projects must still supply licensed fonts, approved component assets, and human visual scoring; strict backend gates intentionally block final approval until those project-specific inputs exist.
