---
name: adding-presets
description: Add or adjust document style presets and color schemes in API Format Fix.
---

# Adding a preset or palette

1. Define immutable values in `src/api_format_fix/models.py`.
2. Presets should refer to a registered color scheme by name; palettes must use CSS-compatible hex colors.
3. Keep defaults consistent across HTML, DOCX, and PDF renderers. PDF can use only its built-in Helvetica or Times family.
4. Add a test proving the selected preset or custom palette affects rendered output.
5. Update the preset table and usage examples in `README.md` when a built-in option changes.
