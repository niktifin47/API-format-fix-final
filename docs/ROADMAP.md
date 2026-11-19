# Development roadmap (10 stages)

## Stage 1 - Stabilize and release current fixes
- [x] Branch `fix/rtf-ansi-codepage` pushed with CLI `--version`/`--diagnostics`, Android `getFormatCapabilities()`, RTF fixes, and regression tests.
- [x] Added `CHANGELOG.md` and PR/CI guidance.
- Blockers: GitHub PR not creatable from this environment (`gh` unavailable, no API token configured). Open PR to `main` from pushed branch and confirm full CI/CodeQL before tagging.

## Stage 2 - Harden RTF/legacy decoding
- [x] Encoding fallback for unknown/malformed ANSI code pages, tolerant decoding, and normalized parser failures.
- [ ] Expand control-word/Unicode edge-case corpus and fuzz/property-style tests.

## Stage 3 - Improve DOCX/PDF fidelity
- [ ] Preserve more extractable structure/metadata where feasible, add golden tests, and document fidelity limits.

## Stage 4 - Resource-limit and threat-model hardening
- [x] Documented limits/sandbox boundaries in README; resource-limit tests cover key paths.
- [ ] Tighten/enforce limits across all parsers (incl. ODT/PDF internals) and add hostile-input diagnostics.

## Stage 5 - Android/Python parity
- [x] Android exposes capability discovery API; format gaps documented.
- [ ] Align diagnostics/errors and prioritize missing Android input formats or explicit gating.

## Stage 6 - CLI UX
- [x] `--version`, `--diagnostics`, `--list-presets`, `--debug`, hidden-char prompt/flag.
- [ ] Batch conversion, stdout/format controls, machine-readable errors, stable exit codes.

## Stage 7 - Configurable templates
- [ ] User-defined presets/colors/fonts via config with validation and preview tests.

## Stage 8 - Quality and observability
- [ ] Coverage expansion, edge-case corpus, benchmarks, structured diagnostics hooks.

## Stage 9 - Packaging and distribution
- [ ] Changelog discipline, release automation hardening, signing/reproducibility evaluation, PyPI/Maven/Winget readiness.

## Stage 10 - Ecosystem and integrations
- [ ] Stable API examples, downstream migration guidance, wrapper/service evaluation.
