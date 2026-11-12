---
name: maintaining-quality
description: Validate changes and maintain GitHub Actions for API Format Fix.
---

# Quality and release workflow

1. Run `python -m ruff check .`, `python -m pytest`, and `python -m build`.
2. CI runs on pull requests and pushes to `main` for Python 3.10 through 3.13.
3. A `v*` tag builds wheel and source distributions and attaches them to a GitHub Release.
4. Do not publish to PyPI or add credentials to workflows unless the repository owner explicitly requests that change.
5. Keep workflow permissions limited to the contents required by each job.
