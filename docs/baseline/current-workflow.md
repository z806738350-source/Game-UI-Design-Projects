# 0.1.0 workflow baseline

- Baseline commit: `e3e8c550dfbd955594b81128a45839e43c51d968`
- Baseline branch: `main`
- Captured: 2026-08-17 (Asia/Shanghai)
- Upgrade branch: `codex/existing-style-v2`

## Current production flow

`input -> wireframe_interpretation -> layout_design -> style_resolution -> visual_exploration`

The baseline stores one active `main` screen, uses a single style contract, sends wireframe and reference images into full-screen image generation, and approves visual exploration results directly. It has no explicit font manifest, component contract, binding coverage, underlay review, deterministic composition, or final fidelity gate.

## Baseline artifacts

- Global: `project.json`, `style/style-contract.json`, `workflow/state.json`
- Screen-local: `screens/main/screen-contract.json`, `layout-proposals.json`, `approved-layout.json`, `visual-task.json`, `explorations/results.json`
- History: `workflow/artifact-history.json`, `workflow/history/*.json`

## Known risks frozen for comparison

- Existing projects branch only while producing style; full-screen generation still redraws shared UI and formal text.
- Reference roles are persisted but flattened during generation; the provider client truncates image inputs.
- `required_controls` are strings, not stable control identities.
- `components` accepts a shallow object without asset/state/reuse validation.
- All screen state is addressed through `project.screen_id`, normally `main`.

