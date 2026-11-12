---
name: adding-formats
description: Add input or output document formats with safe extraction and reusable styling.
---

# Adding a document format

1. Keep input extraction in `src/api_format_fix/renderer.py` separate from output renderers.
2. Import format-specific packages inside the corresponding function. Add the package to the matching optional extra in `pyproject.toml`.
3. Raise an actionable `ImportError` that names the extra to install; do not silently substitute another format.
4. Escape source text before passing it to HTML or PDF markup APIs.
5. Add focused tests for content, style application, unsupported inputs, and the optional renderer.
6. Document whether importing that format preserves only text or also layout and embedded content.
