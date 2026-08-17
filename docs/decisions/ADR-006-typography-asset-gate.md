# ADR-006: Typography asset gate

Status: accepted

Font Manifest is the source of truth for file identity, license state, coverage, and role fidelity. Identity-critical roles require `exact` for strict final approval. Preview may expose unresolved/substitute roles with a visible risk, but no code path may silently classify a system fallback as exact.

