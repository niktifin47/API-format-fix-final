# Contributing

1. Use Python 3.10 or later.
2. Install development dependencies with `python -m pip install -e ".[all,dev]"`.
3. Add focused tests for behavior changes and update the README for user-facing options.
4. Run `python -m ruff check .`, `python -m pytest`, and `python -m build`.
5. Open a pull request against `main`; GitHub Actions runs the same checks.

Document input is untrusted. Keep output escaping and explicit optional-dependency errors intact.

Tagged releases attach Python distributions, a Windows CLI ZIP, and generated Winget manifests. Winget publication requires submitting the generated manifests to Microsoft's `winget-pkgs` repository.
