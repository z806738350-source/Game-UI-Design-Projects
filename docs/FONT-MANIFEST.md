# Font Manifest

`style/font-manifest.json` records the copied font asset, SHA-256 identity, OpenType family/PostScript names, detected Unicode coverage, license status, and role mapping. `exact`, `approved-substitute`, and `unresolved` are explicit. Strict final composition requires `exact` for every identity-critical role, confirmed licensing, the required glyph coverage, and a present asset hash. Preview output may carry a typography warning watermark; final output may not.

