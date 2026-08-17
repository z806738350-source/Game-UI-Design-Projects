# ADR-003: Deterministic final composition

Status: accepted

Strict final output is assembled locally from an approved underlay, component assets, and text layers. The composition manifest records every source and transform. Canvas 2D is the first implementation to avoid a native dependency while preserving reproducibility and offline recomposition.

