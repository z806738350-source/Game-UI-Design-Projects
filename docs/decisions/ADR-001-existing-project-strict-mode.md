# ADR-001: Existing projects default to strict continuation

Status: accepted

Existing projects default to `existing-strict`; `existing-guided` requires an explicit user choice and new projects remain `exploration`. This prevents a mode omission from silently enabling shared-component redraw. Mode changes invalidate incompatible downstream artifacts because prompt and approval semantics change.

