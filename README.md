# API Format Fix

API Format Fix is a small Python library and command-line tool for applying reusable styles to Markdown, CV, Word, and PDF documents. It starts with formal and friendly presets, supports custom color schemes, and converts documents to Markdown, HTML, DOCX, or PDF.

The first release focuses on reliable text extraction and consistent restyling. Converting an existing DOCX or PDF extracts its text; it does not preserve the original page layout, images, tables, or advanced formatting.

## Install

Python 3.10 or later is required. Install all document-format support with:

```shell
python -m pip install ".[all]"
```

For development:

```shell
python -m pip install -e ".[all,dev]"
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

Use the command line:

```shell
api-format-fix resume.md resume.docx --preset friendly
api-format-fix resume.pdf resume.html --color-scheme teal
api-format-fix --list-presets
```

Supported inputs: `.md`, `.cv`, `.txt`, `.docx`, and `.pdf`.

Supported outputs: `.md`, `.cv`, `.html`, `.docx`, and `.pdf`.

DOCX input/output uses `python-docx`; PDF input uses `pypdf`; PDF output uses ReportLab. Install the `all` extra to enable every format. If a format's optional dependency is missing, the library reports which extra to install.

## Presets and colors

Built-in presets:

| Preset | Font | Size | Default color scheme |
| --- | --- | ---: | --- |
| `formal` | Times New Roman | 11 pt | `navy` |
| `friendly` | Arial | 11 pt | `teal` |

Built-in color schemes are `navy` and `teal`. In Python, `format_file` also accepts custom `Template` and `ColorScheme` objects. HTML and DOCX apply the selected family; PDF uses ReportLab's built-in Helvetica or Times font family.

## Development

```shell
python -m pytest
python -m ruff check .
python -m build
```

Pull requests run the same checks in GitHub Actions. Pushing a `v*` tag builds source and wheel distributions and attaches them to a GitHub Release. Publishing to PyPI is not configured by default.

## License

BSD 3-Clause. See [LICENSE](LICENSE).
