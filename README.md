# API Format Fix

API Format Fix is a cross-platform Python library and command-line tool that extracts text from common document formats and applies reusable styles. It supports Markdown, CV, TXT, HTML, reStructuredText, TeX, RTF, ODT, DOCX, and PDF as inputs and converts extracted text to Markdown, HTML, DOCX, or PDF.

The initial release focuses on reliable text extraction and consistent restyling. Converting an existing DOCX or PDF extracts its text; it does not preserve the original page layout, images, tables, or advanced formatting.

## Install

Python 3.10 or later is required. Install all document-format support with:

```shell
python -m pip install ".[all]"
```

For development:

```shell
python -m pip install -e ".[all,dev]"
```

RTF and ODT readers can also be installed separately with `.[rtf]` and `.[odt]`.

Install the package and all optional format dependencies from PyPI:

```shell
python -m pip install "api-format-fix[all]"
```

pip still downloads the optional format dependencies from its configured package index.

For a tagged GitHub release, install the wheel directly from GitHub:

```shell
python -m pip install "api-format-fix[all] @ https://github.com/niktifin47/document-format-toolkit/releases/download/v0.1.1/api_format_fix-0.1.1-py3-none-any.whl"
```

## Quick start

```python
from api_format_fix import format_file

format_file(
    "resume.cv",
    "resume.pdf",
    preset="formal",
    color_scheme="navy",
)
```

The `.cv` extension is treated as Markdown text, so headings and lists can be used in a CV source file.
`format_file` uses the paths supplied by the caller, including absolute paths outside the current working directory. Applications that accept paths from untrusted users should validate and constrain them to an allowed directory before calling the library.
For untrusted documents, `ResourceLimits` and the CLI's `--max-input-bytes`, `--max-pdf-pages`, and `--max-text-chars` options can reject oversized input or extraction. Limits are not a parser sandbox and do not guarantee bounded intermediate memory for every third-party parser; impose process-level CPU/memory limits for hostile files.

```python
from api_format_fix import ResourceLimits, format_file

format_file(
    "input.pdf",
    "output.html",
    resource_limits=ResourceLimits(
        max_input_bytes=20_000_000,
        max_pdf_pages=200,
        max_text_chars=2_000_000,
    ),
)
```

Use the command-line interface:

```shell
api-format-fix resume.md resume.docx --preset friendly
api-format-fix resume.pdf resume.html --color-scheme teal
api-format-fix resume.pdf resume.html --max-input-bytes 20000000 --max-pdf-pages 100 --max-text-chars 2000000
api-format-fix resume.pdf resume.html --debug
api-format-fix --version
api-format-fix --diagnostics
api-format-fix --list-presets
```

For in-memory conversions, `format_content` accepts text or bytes. Markdown,
CV, TXT, HTML, reStructuredText, and TeX inputs accept strings or bytes; RTF,
ODT, DOCX, and PDF inputs use bytes. Markdown, CV, and HTML outputs are strings,
while DOCX/PDF outputs use bytes:

```python
from api_format_fix import format_content

html_document = format_content("# Resume", ".md", ".html")
pdf_document = format_content(b"# Resume", ".md", ".pdf")
markdown = format_content(pdf_document, ".pdf", ".md")
```

The CLI's `--debug` option prints a traceback for formatting errors; without it,
errors remain concise and include installation guidance for missing format extras.
`--version` prints the installed package version. `--diagnostics` prints JSON with
the Python/platform versions, supported input/output formats, and availability of
optional document-format dependencies; it does not import those dependencies.

Supported inputs: `.md`, `.cv`, `.txt`, `.html`, `.rst`, `.tex`, `.rtf`, `.odt`, `.docx`, and `.pdf`.

Supported outputs: `.md`, `.cv`, `.html`, `.docx`, and `.pdf`.

HTML, reStructuredText, and TeX readers extract common visible text and headings; they do not preserve layout or every markup construct. RTF and ODT readers preserve extracted text only. RTF decoding honors declared ANSI code pages with tolerant fallback for malformed/unknown legacy encodings. DOCX and PDF input/output also extract/rebuild text and do not preserve original page layout, images, tables, embedded content, or advanced formatting. DOCX uses `python-docx`; PDF input uses `pypdf`; PDF output uses ReportLab; RTF uses `striprtf`; ODT uses `odfpy`. Optional imports remain lazy, and a missing dependency names the extra to install.

PDF input is text extraction only. A scanned PDF without a text layer produces empty text; OCR is not included.

Applications can query the immutable format matrix and supported-extension sets instead of maintaining their own lists:

```python
from api_format_fix import (
    SUPPORTED_INPUT_FORMATS,
    SUPPORTED_OUTPUT_FORMATS,
    get_format_capabilities,
)

pdf = get_format_capabilities()[".pdf"]
assert pdf.can_read and pdf.can_write
assert pdf.read_extra == pdf.write_extra == "pdf"
```

`read_extra` and `write_extra` identify the optional installation extra required for each operation, or `None` when no optional extra is needed.

## Kotlin and Android

The `android` Gradle module provides a native Kotlin API for Android (minimum SDK 23). Android currently supports `.md`, `.cv`, `.txt`, `.docx`, and `.pdf` inputs, and `.md`, `.cv`, `.html`, `.docx`, and `.pdf` outputs. Unlike the Python package, Android does not support HTML, reStructuredText, TeX, RTF, or ODT input. Add the module to an Android project and call:

```kotlin
val html = ApiFormatFix.formatText("# Resume", ".md", ".html")
val pdf = ApiFormatFix.formatContent(
    context,
    "# Resume".toByteArray(Charsets.UTF_8),
    ".md",
    ".pdf",
)
```

Text input/output uses `formatText`; `formatContent` handles byte input and output, including DOCX and PDF. PDF support uses PDFBox Android.

`ApiFormatFix.getFormatCapabilities()` returns an immutable map keyed by file
extension. Each `FormatCapability` reports whether Android can read and write
that format, so applications can discover platform support without maintaining
their own extension lists:

```kotlin
val pdf = ApiFormatFix.getFormatCapabilities().getValue(".pdf")
check(pdf.canRead && pdf.canWrite)
```

Configure `ResourceLimits` when processing untrusted files:

```kotlin
val limits = ResourceLimits(
    maxInputBytes = 20_000_000,
    maxPdfPages = 200,
    maxTextChars = 2_000_000,
    maxDecompressedBytes = 40_000_000,
)
val findings = ApiFormatFix.inspectContent(context, documentBytes, ".docx", limits)
val markdown = ApiFormatFix.formatContent(
    context,
    documentBytes,
    ".docx",
    ".md",
    resourceLimits = limits,
    removeHiddenCharacters = true,
)
```

All limits default to `null` (unlimited). `maxDecompressedBytes` bounds the DOCX `word/document.xml` entry; it does not cap total ZIP expansion. PDF page and text limits are checked during extraction, but PDFBox must load the PDF first, so they do not bound parser memory or CPU. Inspect findings are returned without changing content; cleanup is opt-in and preserves emoji joiners. Limits are not a parser sandbox: callers should constrain input paths and isolate processing of hostile files. Include the `android` directory as an Android library Gradle subproject; no Maven publication is configured. Python and Kotlin implementations are maintained as separate libraries.

## Platform and distribution support

| Platform or ecosystem | Available support |
| --- | --- |
| Windows x64 | Python package, plus a self-contained CLI EXE distributed inside a ZIP. Keep the ZIP as the only native artifact for now; MSI installation/update lifecycle and x86 dependency packaging are not justified by current demand. |
| Linux | Python package. CI checks Ubuntu 22.04/24.04, Debian, Fedora, and Arch Linux containers; distro installers and desktop-environment integrations are not provided. |
| macOS | Python package, covered by the CI OS matrix. No native macOS installer is provided. |
| npm / Node.js | No npm package or JavaScript API is provided. |
| iOS | No iOS runtime or native package is provided. |
| Android / Kotlin | Native Kotlin Android library in the `android` Gradle module (minimum SDK 23). It is not published to Maven Central. |

## Presets and colors

Built-in presets:

| Preset | Font | Size | Default color scheme |
| --- | --- | ---: | --- |
| `formal` | Times New Roman | 11 pt | `navy` |
| `friendly` | Arial | 11 pt | `teal` |

Built-in color schemes include `navy`, `teal`, and 100 distinct generated palettes, `spectrum-001` through `spectrum-100`. In Python, `format_file` also accepts custom `Template` and `ColorScheme` objects. Use `font_family` in Python or `--font-family` in the CLI to choose among the supported font-family names. Twenty-one additional freely licensed font family names are provided: Alegreya, Atkinson Hyperlegible, Carlito, DejaVu Sans, Fira Sans, IBM Plex Sans, Inter, Lato, Liberation Sans, Merriweather, Montserrat, Noto Sans, Noto Serif, Nunito, Open Sans, PT Sans, Poppins, Roboto, Source Sans 3, Source Serif 4, and Ubuntu. Arial and Times New Roman remain available for compatibility. The library does not bundle font files; font availability depends on the target system. PDF output uses ReportLab's built-in Helvetica or Times family, so other selected font names do not embed or provide fonts for PDF output.

## Unicode inspection and safety limits

Extracted text is scanned for Unicode control/format characters that can be invisible, including bidirectional controls, zero-width spaces, and unusual Unicode whitespace. Findings are reported as Python `UserWarning`s and are available through `inspect_document` / `inspect_file`. The CLI asks before cleanup interactively; use `--remove-hidden-characters` for an explicit non-interactive opt-in. Cleanup preserves the zero-width joiner used in emoji sequences, removes flagged controls, and normalizes unusual whitespace to a standard space. No content is modified by default.

This character scan is a review aid, **not malware detection or a security guarantee**. It cannot determine whether a character, font, color, signature, image, 3D asset, animation frame, or embedded object is malicious. This library does not inspect images, 3D models, animations, or digital signatures; it does not anonymize, validate, or protect signatures against copying or identity fraud. Do not rely on it to verify document authenticity or prevent phishing, malware, or identity theft. Integrating add-ons or modifying the code may introduce additional security risks; review dependencies and changes independently. Configure `ResourceLimits` and isolate processing when handling untrusted files.

## Development

```shell
python -m pytest
python -m ruff check .
python -m build
```

Pull requests run the Python checks in GitHub Actions on Linux, Windows, and macOS with Python 3.10 through 3.14, plus Linux container checks for Ubuntu 22.04/24.04, Debian, Fedora, and Arch Linux. This validates the CLI/library in those operating-system environments; it does not emulate GUI desktop workspaces or iOS. A separate Linux job tests, builds, and lints the Android module. When CI fails, a diagnostic job reruns Python checks with verbose output on Ubuntu/Python 3.12 and summarizes each result; compare it with the original matrix job for platform-only failures. CodeQL runs as a separate security analysis and must be reviewed independently—test/build failures are not themselves a security assessment. Run the same Android checks locally with `.\gradlew.bat :android:testDebugUnitTest :android:assembleDebug :android:lintDebug` on Windows or `bash ./gradlew :android:testDebugUnitTest :android:assembleDebug :android:lintDebug` on Linux/macOS. Pushing a `v*` tag builds source and wheel distributions, publishes them to PyPI through GitHub Actions Trusted Publishing, and attaches them to a GitHub Release.

The same release workflow also builds a self-contained Windows CLI ZIP, generates WinGet manifests with the release URL and SHA-256 checksum of that release asset, and attaches a `SHA256SUMS.txt` file for the release artifacts. Submit those manifests to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) to make `winget install niktifin47.APIFormatFix` available after Microsoft accepts the package. No WinGet submission or npm publication is made by this repository's workflow; both require maintainer-controlled registry accounts and review. A published checksum becomes available only after a maintainer creates and tests a tagged release.

## License

BSD 3-Clause. See [LICENSE](LICENSE).
