# Changelog

## Unreleased (branch fix/rtf-ansi-codepage)
### Added
- Python CLI --version and --diagnostics (JSON runtime/format/optional-dependency report).
- pi_format_fix.__version__ and dynamic version sourcing from package metadata attribute.
- Android ApiFormatFix.getFormatCapabilities() and FormatCapability API with tests and README docs.

### Fixed
- RTF input decoding honors declared ANSI code pages for hex escapes in grouped content.
- Regression coverage for DOCX split-run text and HTML escaping behavior.
