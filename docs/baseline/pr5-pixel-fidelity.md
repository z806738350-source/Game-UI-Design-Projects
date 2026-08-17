# PR-5 evidence — Pixel-aware Fidelity and Final Approval

- Milestone: PR-5 of 8
- Branch: `codex/audit-pr5-pixel-fidelity`
- Audit finding addressed: F-06
- Formal release status: still blocked by PR-6 through PR-8

## Authoritative evidence inspection

Fidelity now reads the actual persisted final PNG and verifies:

- readable PNG format, current SHA-256, byte length, canvas dimensions, output/Manifest version, and source identity;
- a real alpha channel with visible pixels rather than an empty transparent artifact;
- every current Component Contract state file and Font Manifest file, including unused imported assets;
- current font family/PostScript identity in addition to file hash;
- each rendered layer bbox against its normalized Manifest rect;
- real output crop hashes for every rendered layer;
- component overlap and declared 5% safe-area compliance;
- text Alpha ink bounds and boundary contact/overflow;
- four fixed nine-slice corners with unchanged dimensions and source/rendered pixel hashes.

The Fidelity Report separates `manifest_consistency` from `visual_fidelity`. Its evidence includes `pixel-fidelity-v1`, explicit thresholds, output metadata, current asset hashes, rendered crop hashes, renderer version, Manifest hash, and a deterministic evidence digest. Optional SSIM/LPIPS is not claimed; canonical output crop hashes are retained as the current reproducible evidence.

## Final Approval

- Composition Manifest and Fidelity Report are generated, read-only evidence artifacts; the generic edit path rejects attempts to rewrite them.
- A report identifies the exact Manifest ID/version and Composition Output ID/version/hash it checked.
- At approval time the backend re-runs the current pixel and asset inspection.
- Approval fails when the current inspection has any issue, when the saved report did not pass, or when its evidence digest differs from the freshly computed digest.
- A previously passing report therefore cannot approve a deleted/resized final PNG or a component/font file changed after the report was created.

## Acceptance evidence

Automated real-file tests prove:

- component and font file tampering fails after re-hashing;
- deleted, hash-changed, resized, or empty-transparent final PNGs fail;
- output/Manifest version mismatch fails;
- rendered bbox mismatch, component overlap, declared safe-area violation, and text boundary overflow fail;
- a changed fixed nine-slice corner hash fails;
- the report stores both consistency sections, check version, thresholds, evidence, and digest;
- generated evidence cannot be edited through the artifact API;
- Final Approval re-checks current assets and rejects a component changed after a passing report.

## Verification commands and results

| Check | Result |
| --- | --- |
| TypeScript type check | passed |
| Full Node test suite | 59 passed, 0 failed |
| Production build | passed; 1,787 modules transformed |
| Quick-start preflight | passed |

## Remaining boundary

PR-5 closes the required file, asset, layout, typography, and nine-slice Fidelity checks. It does not claim optional perceptual similarity scoring. PR-6 must make all audit artifacts reviewable through focused product workbenches; PR-7 must unify stale propagation and migration safety; PR-8 still requires privacy-safe real samples and human designer signoff before formal release.
