# Contributing

1. Use Python 3.10 or later. The Android module requires JDK 17 and Android SDK 35.
2. Install Python development dependencies with `python -m pip install -e ".[all,dev]"`.
3. Add focused tests for behavior changes and update the README for user-facing options.
4. Run `python -m ruff check .`, `python -m pytest`, and `python -m build`.
5. Run `.\gradlew.bat :android:testDebugUnitTest :android:assembleDebug :android:lintDebug` on Windows or `bash ./gradlew :android:testDebugUnitTest :android:assembleDebug :android:lintDebug` on Linux/macOS.
6. Open a pull request against `main`; GitHub Actions runs the Python checks on Linux, Windows, and macOS with Python 3.10 through 3.14, plus Android tests, build, and lint.

Document input is untrusted. Keep output escaping and explicit optional-dependency errors intact.

Tagged releases attach Python distributions, a Windows CLI ZIP, and generated Winget manifests. Winget publication requires submitting the generated manifests to Microsoft's `winget-pkgs` repository.
