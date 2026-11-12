# Copilot instructions

- Keep document parsing independent of output-specific libraries.
- Treat input document text as untrusted: escape it before inserting into HTML or PDF markup.
- Preserve explicit errors for unsupported formats and missing optional dependencies.
- Add or update focused tests for every format or preset behavior change.
- Run `python -m ruff check .`, `python -m pytest`, and `python -m build` before completing changes.
- Keep optional format dependencies lazy-loaded so Markdown and HTML remain usable without them.
