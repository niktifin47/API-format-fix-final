# Changelog

## Unreleased (branch fix/rtf-ansi-codepage)
### Added
- Python CLI `--version` and `--diagnostics` (JSON runtime/format/optional-dependency report).
- `api_format_fix.__version__` and dynamic version sourcing from package metadata attribute.
- Android `ApiFormatFix.getFormatCapabilities()` and `FormatCapability` API with tests and README docs.
- `docs/ROADMAP.md` outlining 10 development stages and current blockers.

### Fixed
- RTF input decoding honors declared ANSI code pages for hex escapes in grouped content.
- RTF decoding now falls back for unknown/malformed legacy code pages and normalizes third-party parser failures.
- Regression coverage for DOCX split-run text and HTML escaping behavior.
