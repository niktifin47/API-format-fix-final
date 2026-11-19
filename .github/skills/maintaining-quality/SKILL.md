---
name: maintaining-quality
description: Validate changes and maintain GitHub Actions for API Format Fix.
---

# Quality and release workflow

1. Run `python -m ruff check .`, `python -m pytest`, and `python -m build`.
2. Validate the Android module locally with `.\gradlew.bat :android:testDebugUnitTest :android:assembleDebug :android:lintDebug` or `bash ./gradlew :android:testDebugUnitTest :android:assembleDebug :android:lintDebug`.
3. Validate the TypeScript package in `npm/` with `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` (Node.js 22.18 or later).
4. CI runs on pull requests and pushes to `main` on Linux, Windows, and macOS for Python 3.10 through 3.14, with a separate Android test/build/lint job and an npm package job on Node.js 22 and 24. macOS versions share one runner to reduce queue pressure but retain independent results and diagnostics.
5. A `v*` tag builds wheel/source distributions and a self-contained Windows CLI ZIP, then attaches them to a GitHub Release.
6. The release also generates Winget manifests using the Windows ZIP's actual SHA-256. Submit those manifests to `microsoft/winget-pkgs` for catalog publication.
7. Do not publish to PyPI or npm or add credentials to workflows unless the repository owner explicitly requests that change. The npm package is published manually with `npm publish` in `npm/`.
8. Keep workflow permissions limited to the contents required by each job.
