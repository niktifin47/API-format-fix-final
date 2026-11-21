---
name: maintaining-quality
description: Validate changes and maintain GitHub Actions for API Format Fix.
---

# Quality and release workflow

1. In `Linux_MacOs_Windows support`, run `python -m ruff check .`, `python -m pytest`, and `python -m build`.
2. In `mobile development support`, validate Android with `.\gradlew.bat :android:testDebugUnitTest :android:assembleDebug :android:lintDebug` or `bash ./gradlew :android:testDebugUnitTest :android:assembleDebug :android:lintDebug`.
3. Validate the TypeScript package in `npm package/` with `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` (Node.js 22.18 or later).
4. CI runs affected platform checks on pull requests and pushes to `main`. Shared CI configuration runs all checks. Python tests cover Linux, Windows, and macOS for Python 3.10 through 3.14; Android has a separate test/build/lint job and npm runs on Node.js 22 and 24. macOS versions share one runner but retain independent results.
5. A `v*` tag builds wheel/source distributions and a self-contained Windows CLI ZIP, then attaches them to a GitHub Release.
6. The release also generates Winget manifests using the Windows ZIP's actual SHA-256. Submit those manifests to `microsoft/winget-pkgs` for catalog publication.
7. Do not publish to PyPI or npm or add credentials to workflows unless the repository owner explicitly requests that change. The npm package is published manually with `npm publish` in `npm package/`.
8. Keep workflow permissions limited to the contents required by each job.
