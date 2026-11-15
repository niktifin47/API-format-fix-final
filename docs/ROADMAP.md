# Development roadmap (10 stages)

## Stage 1 - Stabilize and release current fixes
- Branch ix/rtf-ansi-codepage pushed with CLI --version/--diagnostics, Android getFormatCapabilities(), RTF codepage decoding fixes, and DOCX/HTML escaping regression tests.
- Blockers: GitHub PR not creatable from this environment (gh unavailable, no API token configured). Open PR to main from pushed branch and confirm full CI/CodeQL before tagging.

## Stage 2 - Harden RTF/legacy decoding
- Broaden encoding fallback, control-word normalization, malformed-input handling, and fuzz/property-style tests.

## Stage 3 - Improve DOCX/PDF fidelity
- Preserve more extractable structure/metadata where feasible, add golden tests, and document fidelity limits.

## Stage 4 - Resource-limit and threat-model hardening
- Tighten/enforce limits across parsers, improve hostile-input diagnostics, document sandbox boundaries.

## Stage 5 - Android/Python parity
- Align capability/diagnostic surfaces and prioritize missing Android input formats or explicit gating.

## Stage 6 - CLI UX
- Batch conversion, stdout/format controls, machine-readable errors, stable exit codes.

## Stage 7 - Configurable templates
- User-defined presets/colors/fonts via config with validation and preview tests.

## Stage 8 - Quality and observability
- Coverage expansion, edge-case corpus, benchmarks, structured diagnostics hooks.

## Stage 9 - Packaging and distribution
- Changelog discipline, release automation hardening, signing/reproducibility evaluation, PyPI/Maven/Winget readiness.

## Stage 10 - Ecosystem and integrations
- Stable API examples, downstream migration guidance, wrapper/service evaluation.
