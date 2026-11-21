# Contributing

1. Use Python 3.10 or later. The Android module requires JDK 17 and Android SDK 35, and the TypeScript package requires Node.js 22.18 or later.
2. In `Linux_MacOs_Windows support`, install Python development dependencies with `python -m pip install -e ".[all,dev]"`.
3. Add focused tests for behavior changes and update the README for user-facing options.
4. In `Linux_MacOs_Windows support`, run `python -m ruff check .`, `python -m pytest`, and `python -m build`.
5. In `mobile development support`, run `.\gradlew.bat :android:testDebugUnitTest :android:assembleDebug :android:lintDebug` on Windows or `bash ./gradlew :android:testDebugUnitTest :android:assembleDebug :android:lintDebug` on Linux/macOS.
6. When changing the TypeScript package, run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` in `npm package`.
7. Open a pull request against `main`. CI runs the affected platforms' checks and reports skipped platforms in the stable `CI` summary. Changes to shared CI configuration run all checks. CodeQL runs affected languages on changes and all languages weekly. For PRs without platform changes, Python CodeQL still runs to supply the separately required GitHub code-scanning check.

Document input is untrusted. Keep output escaping and explicit optional-dependency errors intact.

## Test performance and failure reports

- Keep tests isolated and deterministic. Use `tmp_path` for files and small in-memory
  documents where file I/O is not under test. Avoid network calls, sleeps, and
  subprocesses unless that boundary is the behavior being tested.
- Run a focused selection while developing, for example
  `python -m pytest tests/test_renderer.py -k rtf`. After a failed local run,
  `python -m pytest --lf` reruns the cached failures. Run the full checks above before
  submitting.
- All Python tests, including future tests, inherit full assertion diffs, long
  tracebacks, captured output/logs on failure, strict configuration/marker checks,
  a failure/skip summary, and the ten slowest test durations from `pyproject.toml`.
  Local runs write `reports/pytest.xml` (overwritten on the next run); the
  OS/version CI jobs use `reports/<python-version>/pytest.xml` to keep reports
  separate. Failed tests' captured output and logs are included, but passing
  tests' logs are omitted. Do not put credentials or real private documents in
  test output.
- CI keeps the full OS/Python and Linux distribution test coverage, but runs Ruff
  and the distribution build once in the `quality` job. The five macOS Python
  versions run independently on one macOS runner to reduce runner queue demand;
  a failure or timeout in one version does not skip the others and still fails
  CI. Each macOS version has a three-minute execution timeout and the whole job
  has a 20-minute limit; GitHub's runner queue is separate and can still delay a
  job before it starts. Pip and Gradle caches reduce repeat setup/build work;
  superseded workflow runs are cancelled.
- Each check job uploads its original logs and reports for 14 days, even on failure.
  Python artifacts are named by OS/version or Linux distribution and include the
  interpreter and installed package versions. Android artifacts include Gradle
  output, JUnit XML/HTML test reports, and lint reports when produced. The final
  `CI` summary lists the outcomes with reproduction guidance; no different-platform
  diagnostic rerun substitutes for the original failure.
- If a macOS version times out before its normal upload, the failed job also
  uploads any partial logs as `python-macos-partial-reports`.
- To reproduce a Python failure, use the same OS, Python version, and dependency
  versions from `environment.txt`, then run
  `python -m pytest "tests/test_file.py::test_name"` with the reported test node ID.
  For Android, add `--continue --stacktrace --console=plain` to the Gradle command
  above. Independent tasks continue after failures to collect more evidence, but
  the build still fails. Future Android unit tests inherit full
  exception/cause/stack-trace logging.

Tagged releases attach Python distributions, a Windows CLI ZIP, and generated Winget manifests. Winget publication requires submitting the generated manifests to Microsoft's `winget-pkgs` repository.

## Merged pull request tracking

The `Record merged pull requests` workflow adds merged PRs to the owner's GitHub
Project and posts a short metadata-based summary on each PR. It uses the
repository Actions secret `PROJECT`, a classic token with project and repository
access; GitHub Actions must also be allowed to create pull requests. The workflow
opens a separate PR to add each merge to the planning skill, so branch protection
and review remain in effect. Reviewers may need to resolve conflicts if several
updates are open at once, and may need to approve CI workflows for PRs created
with `GITHUB_TOKEN`.

Summary-only PRs are recorded in the project but do not open another summary PR.
Add their planning-skill entries manually in batches if needed. If a run fails
after pushing its summary branch but before creating the PR, inspect that branch
and open the PR manually rather than deleting or overwriting it. The automation
does not independently assess API impact, test results, or milestone completion.
