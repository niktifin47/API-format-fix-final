# @niktifin47/api-format-fix

Extract text from common document formats and restyle it with reusable presets, in Node.js. This is the native TypeScript port of the [Python library](https://github.com/niktifin47/document-format-toolkit#readme); it has no Python dependency.

It reads Markdown, CV, TXT, HTML, reStructuredText, TeX, RTF, ODT, DOCX, and PDF, and writes Markdown, CV, HTML, DOCX, or PDF. Conversion extracts **text and headings/lists only**; original page layout, images, tables, and advanced formatting are not preserved.

## Install

Requires Node.js 22.13 or later. The package is ESM and also works from CommonJS with `require()` on Node.js 22.12+.

```shell
npm install @niktifin47/api-format-fix
```

Everything except PDF works with that one install. PDF support uses optional peer dependencies that are loaded only when a PDF is read or written:

```shell
npm install pdfkit pdfjs-dist
```

A missing optional package raises a `MissingDependencyError` naming the package to install.

## Quick start

```ts
import { formatContent, formatFile } from "@niktifin47/api-format-fix";

await formatFile("resume.cv", "resume.pdf", { preset: "formal", colorScheme: "navy" });

const html = await formatContent("# Resume", ".md", ".html"); // string
const docx = await formatContent("# Resume", ".md", ".docx"); // Uint8Array
const markdown = await formatContent(docx, ".docx", ".md");
```

`.cv` is treated as Markdown, so headings and lists work in a CV source file. Format arguments accept names with or without the leading dot.

`formatContent` accepts a string or bytes for Markdown, CV, TXT, HTML, reStructuredText, and TeX input; RTF, ODT, DOCX, and PDF input must be bytes (`Uint8Array` or `Buffer`). Markdown, CV, and HTML output is a string; DOCX and PDF output is a `Uint8Array`. All conversion functions are asynchronous.

Command line:

```shell
npx @niktifin47/api-format-fix resume.md resume.docx --preset friendly
api-format-fix resume.pdf resume.html --color-scheme teal --max-input-bytes 20000000
api-format-fix --list-presets
api-format-fix --diagnostics
```

Options: `--preset`, `--color-scheme`, `--font-family`, `--max-input-bytes`, `--max-pdf-pages`, `--max-text-chars`, `--max-decompressed-bytes`, `--remove-hidden-characters`, `--debug`, `--version`. Errors are concise unless `--debug` is given.

## API

| Export | Purpose |
| --- | --- |
| `formatFile(input, output, options?)` | Format a file; the output format comes from the destination extension. Resolves to the output path. |
| `formatContent(data, inputFormat, outputFormat, options?)` | Format in-memory content. |
| `inspectFile(path, limits?)` / `inspectDocument(document)` | Report invisible or control characters. |
| `removeSuspiciousCharacters(document)` | Return a cleaned copy of a document. |
| `parseMarkdown`, `parseHtml`, `parseRst`, `parseTex` | Parse text into a `Document` of blocks. |
| `renderDocument(document, format, style?)` | Render a `Document` as Markdown/CV/HTML text. |
| `getFormatCapabilities()`, `SUPPORTED_INPUT_FORMATS`, `SUPPORTED_OUTPUT_FORMATS` | Discover which formats can be read or written and which optional package each needs. |
| `PRESETS`, `COLOR_SCHEMES`, `FONT_FAMILIES` | Built-in styles. |

Options for `formatFile` and `formatContent`:

| Option | Meaning |
| --- | --- |
| `preset` | `"formal"` (default) or `"friendly"`, or a custom `Template`. |
| `colorScheme` | A built-in name or a custom `ColorScheme` (`#rrggbb` colors). |
| `fontFamily` | One of `FONT_FAMILIES`, or any name made of letters, digits, spaces, commas, apostrophes, and hyphens. |
| `removeHiddenCharacters` | Remove invisible/control characters from extracted text. Off by default. |
| `resourceLimits` | See [Safety limits](#safety-limits). |

```ts
const pdf = await formatContent(bytes, ".docx", ".pdf", {
  preset: { name: "custom", fontFamily: "Times New Roman", fontSizePt: 12, headingSizePt: 18, colorScheme: "custom" },
  colorScheme: { name: "custom", text: "#111111", heading: "#17365d", accent: "#345f8c" },
});
```

### Presets and colors

| Preset | Font | Size | Default color scheme |
| --- | --- | ---: | --- |
| `formal` | Times New Roman | 11 pt | `navy` |
| `friendly` | Arial | 11 pt | `teal` |

Built-in color schemes are `navy`, `teal`, and 100 generated palettes, `spectrum-001` through `spectrum-100`, identical to the Python package. The library does not bundle font files; font availability depends on the machine opening the output. PDF output uses PDF's built-in Helvetica or Times fonts, so other font names are not embedded, and characters outside Windows-1252 (such as Cyrillic, CJK, and emoji) are written as `?`.

### Errors

All library errors extend `ApiFormatFixError`: `DocumentParseError` (malformed or encrypted input), `ResourceLimitError`, `UnsupportedFormatError`, `InvalidOptionError`, and `MissingDependencyError`. Passing the wrong input type throws a `TypeError`.

## Safety limits

Document input is untrusted. Text is escaped before it is written to HTML, DOCX XML, or PDF, and extracted text is scanned for invisible characters (bidirectional controls, zero-width characters, unusual whitespace). Findings are emitted as a Node.js `HiddenCharacterWarning` and returned by `inspectFile`/`inspectDocument`; text is only changed when you pass `removeHiddenCharacters`.

```ts
await formatFile("input.pdf", "output.html", {
  resourceLimits: { maxInputBytes: 20_000_000, maxPdfPages: 200, maxTextChars: 2_000_000, maxDecompressedBytes: 40_000_000 },
});
```

All limits are unset by default. `maxTextChars` counts Unicode code points, `maxInputBytes` counts UTF-8 bytes for string input, and `maxDecompressedBytes` bounds each XML part read from a DOCX or ODT archive. Independently of those limits, XML nested deeper than 256 levels (DOCX/ODT) and HTML nested deeper than 512 elements are rejected with a `DocumentParseError`, because deeper documents make the parsers quadratic. Limits are not a parser sandbox: PDF parsing in particular is not bounded in memory or time, so isolate processing of hostile files with process-level limits. The library uses the paths you give it, so constrain untrusted paths before calling. This is a review aid, not malware detection.

## Differences from the Python package

The formats, presets, palettes, safety scan, and error behavior match the Python package. Markdown, reStructuredText, TeX, and well-formed HTML are parsed identically, and the Markdown and HTML renderers produce byte-identical output. Deliberate differences:

- The API is asynchronous and uses `camelCase` names and an options object.
- DOCX and ODT are read and DOCX is written without extra packages; only PDF needs optional packages (`pdfkit` to write, `pdfjs-dist` to read).
- HTML is tokenized by `htmlparser2`, so `<br>` is always a single line break and malformed nesting follows HTML5 implied-close rules.
- RTF `\par` separates paragraphs (Python merges consecutive paragraphs), and RTF code pages that Node's `TextDecoder` does not know (for example 437 and 850) fall back to Windows-1252.
- Text inside DOCX tables is extracted as separate paragraphs, and each ordered list in DOCX output restarts at 1.
- Characters XML or the built-in PDF fonts cannot represent are replaced (`U+FFFD` in DOCX, `?` in PDF).
- `maxDecompressedBytes` is an additional limit.

## Development

```shell
npm ci
npm run typecheck
npm test   # runs TypeScript directly; needs Node.js 22.18 or later
npm run build
```

`npm publish` runs `npm run build` first (`prepack`) and publishes the `dist` directory.

## License

BSD 3-Clause. See [LICENSE](LICENSE).
