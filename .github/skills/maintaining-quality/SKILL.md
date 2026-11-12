---
name: maintaining-quality
description: Validate changes and maintain GitHub Actions for API Format Fix.
---

# Quality and release workflow

1. Run `python -m ruff check .`, `python -m pytest`, and `python -m build`.
2. Validate the Android module locally with `.\gradlew.bat :android:testDebugUnitTest :android:assembleDebug :android:lintDebug` or `bash ./gradlew :android:testDebugUnitTest :android:assembleDebug :android:lintDebug`.
3. CI runs on pull requests and pushes to `main` on Linux, Windows, and macOS for Python 3.10 through 3.14, with a separate Android test/build/lint job.
4. A `v*` tag builds wheel/source distributions and a self-contained Windows CLI ZIP, then attaches them to a GitHub Release.
5. The release also generates Winget manifests using the Windows ZIP's actual SHA-256. Submit those manifests to `microsoft/winget-pkgs` for catalog publication.
6. Do not publish to PyPI or add credentials to workflows unless the repository owner explicitly requests that change.
7. Keep workflow permissions limited to the contents required by each job.
