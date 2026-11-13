import html
import math
import re
from collections.abc import Mapping
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from types import MappingProxyType
from typing import BinaryIO
from xml.sax.saxutils import escape
from zipfile import BadZipFile

from .errors import DocumentParseError, ResourceLimitError
from .models import (
    COLOR_SCHEMES,
    PRESETS,
    ColorScheme,
    Document,
    DocumentBlock,
    FormatCapability,
    ResourceLimits,
    Template,
)
from .parser import parse_html, parse_markdown, parse_rst, parse_tex
from .security import (
    HiddenCharacterFinding,
    inspect_document,
    remove_suspicious_characters,
    warn_if_suspicious,
)

_FORMAT_CAPABILITIES: Mapping[str, FormatCapability] = MappingProxyType(
    {
        ".md": FormatCapability(".md", can_read=True, can_write=True),
        ".cv": FormatCapability(".cv", can_read=True, can_write=True),
        ".txt": FormatCapability(".txt", can_read=True, can_write=False),
        ".html": FormatCapability(".html", can_read=True, can_write=True),
        ".rst": FormatCapability(".rst", can_read=True, can_write=False),
        ".tex": FormatCapability(".tex", can_read=True, can_write=False),
        ".rtf": FormatCapability(".rtf", can_read=True, can_write=False, read_extra="rtf"),
        ".odt": FormatCapability(".odt", can_read=True, can_write=False, read_extra="odt"),
        ".docx": FormatCapability(
            ".docx", can_read=True, can_write=True, read_extra="docx", write_extra="docx"
        ),
        ".pdf": FormatCapability(
            ".pdf", can_read=True, can_write=True, read_extra="pdf", write_extra="pdf"
        ),
    }
)
SUPPORTED_INPUT_FORMATS = frozenset(
    extension for extension, capability in _FORMAT_CAPABILITIES.items() if capability.can_read
)
SUPPORTED_OUTPUT_FORMATS = frozenset(
    extension for extension, capability in _FORMAT_CAPABILITIES.items() if capability.can_write
)
_SUPPORTED_INPUTS = SUPPORTED_INPUT_FORMATS
_SUPPORTED_OUTPUTS = SUPPORTED_OUTPUT_FORMATS


def get_format_capabilities() -> Mapping[str, FormatCapability]:
    """Return immutable capabilities keyed by normalized format extension."""
    return _FORMAT_CAPABILITIES


def _resolve_template(
    preset: str | Template,
    color_scheme: str | ColorScheme | None,
    font_family: str | None = None,
) -> tuple[Template, ColorScheme]:
    if isinstance(preset, Template):
        template = preset
    else:
        try:
            template = PRESETS[preset]
        except KeyError as error:
            raise ValueError(
                f"Unknown preset {preset!r}. Choose from: {', '.join(PRESETS)}"
            ) from error

    if font_family is not None:
        template = replace(template, font_family=font_family)
    if not template.font_family or not re.fullmatch(r"[A-Za-z0-9 ,'-]+", template.font_family):
        raise ValueError(
            "Font family must contain only letters, numbers, spaces, commas, apostrophes, or hyphens."
        )
    if (
        not math.isfinite(template.font_size_pt)
        or not math.isfinite(template.heading_size_pt)
        or template.font_size_pt <= 0
        or template.heading_size_pt <= 0
    ):
        raise ValueError("Font sizes must be positive finite numbers.")

    if isinstance(color_scheme, ColorScheme):
        colors = color_scheme
    else:
        scheme_name = color_scheme or template.color_scheme
        try:
            colors = COLOR_SCHEMES[scheme_name]
        except KeyError as error:
            raise ValueError(
                f"Unknown color scheme {scheme_name!r}. Choose from: {', '.join(COLOR_SCHEMES)}"
            ) from error
    for color in (colors.text, colors.heading, colors.accent, colors.background):
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ValueError("Color values must be six-digit hexadecimal colors, such as #17365d.")
    return template, colors


def _normalize_suffix(format_name: str) -> str:
    suffix = format_name.lower()
    if not suffix:
        return ""
    return suffix if suffix.startswith(".") else f".{suffix}"


def _check_input_size(size: int, suffix: str, limits: ResourceLimits | None) -> None:
    if limits and limits.max_input_bytes is not None and size > limits.max_input_bytes:
        raise ResourceLimitError(
            f"{suffix.upper()} input exceeds configured max_input_bytes "
            f"({limits.max_input_bytes})."
        )


def _check_text_size(size: int, suffix: str, limits: ResourceLimits | None) -> None:
    if limits and limits.max_text_chars is not None and size > limits.max_text_chars:
        raise ResourceLimitError(
            f"{suffix.upper()} input extracts more than the configured "
            f"max_text_chars ({limits.max_text_chars})."
        )


def _check_document_text_size(
    document: Document, suffix: str, limits: ResourceLimits | None
) -> None:
    _check_text_size(sum(len(block.text) for block in document.blocks), suffix, limits)


def _decode_text_input(data: bytes, suffix: str) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise DocumentParseError(
            f"Could not decode {suffix.upper()} document as UTF-8 at byte offset {error.start}."
        ) from error


def _read_text_input(path: Path, suffix: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise DocumentParseError(
            f"Could not decode {suffix.upper()} document as UTF-8 at byte offset {error.start}."
        ) from error


def _validate_pdf_envelope(source: Path | BinaryIO) -> None:
    if isinstance(source, Path):
        with source.open("rb") as stream:
            header = stream.read(1024)
            size = stream.seek(0, 2)
            stream.seek(max(0, size - 1024))
            trailer = stream.read()
    else:
        position = source.tell()
        try:
            header = source.read(1024)
            source.seek(0, 2)
            source.seek(max(0, source.tell() - 1024))
            trailer = source.read()
        finally:
            source.seek(position)

    if b"%PDF-" not in header:
        raise DocumentParseError("Could not read PDF document: missing %PDF- header.")
    if b"%%EOF" not in trailer:
        raise DocumentParseError("Could not read PDF document: missing %%EOF marker.")


def _load_binary_document(
    source: Path | BinaryIO, suffix: str, limits: ResourceLimits | None = None
) -> Document:
    if suffix == ".docx":
        try:
            from docx import Document as WordDocument
            from docx.opc.exceptions import PackageNotFoundError
            from lxml.etree import XMLSyntaxError
        except ImportError as error:
            raise ImportError(
                "Reading DOCX requires python-docx. Install it with `pip install python-docx`."
            ) from error

        try:
            word_document = WordDocument(source)
        except (BadZipFile, PackageNotFoundError, XMLSyntaxError) as error:
            raise DocumentParseError(f"Could not read DOCX document: {error}") from error
        blocks = []
        text_size = 0
        for paragraph in word_document.paragraphs:
            if not paragraph.text.strip():
                continue
            text_size += len(paragraph.text)
            _check_text_size(text_size, suffix, limits)
            style = paragraph.style.name.lower()
            if style.startswith("heading"):
                match = re.search(r"\d+", style)
                level = min(int(match.group()) if match else 1, 6)
                kind = f"heading{level}"
            elif (
                "list" in style
                or paragraph._p.pPr is not None
                and paragraph._p.pPr.numPr is not None
            ):
                kind = "list_item"
            else:
                kind = "paragraph"
            blocks.append(DocumentBlock(kind, paragraph.text))
        return Document(tuple(blocks))

    if suffix == ".rtf":
        try:
            from striprtf.striprtf import rtf_to_text
        except ImportError as error:
            raise ImportError(
                "Reading RTF requires striprtf. Install it with `pip install api-format-fix[rtf]`."
            ) from error
        raw = source.read_bytes() if isinstance(source, Path) else source.read()
        return parse_markdown(rtf_to_text(raw.decode("ascii", errors="replace")))

    if suffix == ".odt":
        try:
            from odf.opendocument import load
            from odf.teletype import extractText
            from xml.parsers.expat import ExpatError
        except ImportError as error:
            raise ImportError(
                "Reading ODT requires odfpy. Install it with `pip install api-format-fix[odt]`."
            ) from error
        try:
            odt_document = load(str(source)) if isinstance(source, Path) else load(source)
        except (BadZipFile, ExpatError, KeyError) as error:
            raise DocumentParseError(f"Could not read ODT document: {error}") from error
        blocks = []

        def append_text_blocks(element: object) -> None:
            for child in getattr(element, "childNodes", ()):
                tag = getattr(child, "qname", (None, None))[1]
                if tag in {"h", "p"}:
                    text = extractText(child).strip()
                    if text:
                        if tag == "h":
                            level = int(child.getAttribute("outlinelevel") or "1")
                            kind = f"heading{min(level, 6)}"
                        else:
                            kind = "paragraph"
                        blocks.append(DocumentBlock(kind, text))
                else:
                    append_text_blocks(child)

        append_text_blocks(odt_document.text)
        return Document(tuple(blocks))

    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ImportError as error:
        raise ImportError(
            "Reading PDF requires pypdf. Install it with `pip install pypdf`."
        ) from error

    try:
        _validate_pdf_envelope(source)
        reader = PdfReader(source)
        if reader.is_encrypted:
            raise DocumentParseError(
                "Could not read PDF document: encrypted PDFs are not supported."
            )
        pages = reader.pages
        if limits and limits.max_pdf_pages is not None and len(pages) > limits.max_pdf_pages:
            raise ResourceLimitError(
                f"PDF contains {len(pages)} pages; configured max_pdf_pages is "
                f"{limits.max_pdf_pages}."
            )
        page_text = []
        text_size = 0
        for page in pages:
            extracted = page.extract_text() or ""
            text_size += len(extracted)
            _check_text_size(text_size, suffix, limits)
            page_text.append(extracted)
        text = "\n\n".join(page_text)
    except DocumentParseError:
        raise
    except ResourceLimitError:
        raise
    except PdfReadError as error:
        raise DocumentParseError(f"Could not read PDF document: {error}") from error
    return parse_markdown(text)


def _load_document(path: Path, limits: ResourceLimits | None = None) -> Document:
    suffix = path.suffix.lower()
    if suffix not in _SUPPORTED_INPUTS:
        raise ValueError(f"Unsupported input format {suffix or '(no extension)'!r}.")

    try:
        if limits and limits.max_input_bytes is not None:
            with path.open("rb") as source:
                data = source.read(limits.max_input_bytes + 1)
            _check_input_size(len(data), suffix, limits)
            if suffix in {".md", ".cv", ".txt", ".html", ".rst", ".tex"}:
                document = _parse_text_input(_decode_text_input(data, suffix), suffix)
            else:
                document = _load_binary_document(BytesIO(data), suffix, limits)
        elif suffix in {".md", ".cv", ".txt", ".html", ".rst", ".tex"}:
            document = _parse_text_input(_read_text_input(path, suffix), suffix)
        else:
            document = _load_binary_document(path, suffix, limits)
    except DocumentParseError as error:
        raise DocumentParseError(f"{error} (input: {path})") from error
    except ResourceLimitError as error:
        raise ResourceLimitError(f"{error} (input: {path})") from error
    try:
        _check_document_text_size(document, suffix, limits)
    except ResourceLimitError as error:
        raise ResourceLimitError(f"{error} (input: {path})") from error
    return document


def inspect_file(
    path: str | Path, resource_limits: ResourceLimits | None = None
) -> tuple[HiddenCharacterFinding, ...]:
    """Scan extracted document text for suspicious invisible/control characters."""
    return inspect_document(_load_document(Path(path), resource_limits))


def _inline_html(text: str) -> str:
    escaped = html.escape(text)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"\*(.+?)\*", r"<em>\1</em>", escaped)
    escaped = re.sub(r"`(.+?)`", r"<code>\1</code>", escaped)
    return escaped


def _render_html(document: Document, template: Template, colors: ColorScheme) -> str:
    output = []
    list_kind = None
    for block in document.blocks:
        if block.kind in {"list_item", "ordered_item"}:
            next_list_kind = "ol" if block.kind == "ordered_item" else "ul"
            if list_kind != next_list_kind:
                if list_kind:
                    output.append(f"</{list_kind}>")
                output.append(f"<{next_list_kind}>")
                list_kind = next_list_kind
            output.append(f"<li>{_inline_html(block.text)}</li>")
            continue
        if list_kind:
            output.append(f"</{list_kind}>")
            list_kind = None
        if block.kind.startswith("heading"):
            level = int(block.kind.removeprefix("heading"))
            output.append(f"<h{level}>{_inline_html(block.text)}</h{level}>")
        else:
            output.append(f"<p>{_inline_html(block.text)}</p>")
    if list_kind:
        output.append(f"</{list_kind}>")

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Formatted document</title>
  <style>
    body {{ background: {colors.background}; color: {colors.text}; font-family: {template.font_family}, sans-serif;
           font-size: {template.font_size_pt}pt; line-height: 1.5; max-width: 760px; margin: 3rem auto; padding: 0 1rem; }}
    h1, h2, h3, h4, h5, h6 {{ color: {colors.heading}; font-family: {template.font_family}, sans-serif; }}
    a, strong {{ color: {colors.accent}; }}
    code {{ background: #f3f4f6; padding: 0.1em 0.25em; }}
  </style>
</head>
<body>
{chr(10).join(output)}
</body>
</html>
"""


def _render_markdown(document: Document) -> str:
    output = []
    list_kind = None
    ordered_number = 0
    for block in document.blocks:
        if block.kind in {"list_item", "ordered_item"}:
            next_list_kind = block.kind
            if list_kind != next_list_kind:
                if list_kind:
                    output.append("")
                list_kind = next_list_kind
                ordered_number = 0
            if block.kind == "ordered_item":
                ordered_number += 1
                output.append(f"{ordered_number}. {block.text}")
            else:
                output.append(f"- {block.text}")
            continue
        if list_kind:
            output.append("")
            list_kind = None
        if block.kind.startswith("heading"):
            level = int(block.kind.removeprefix("heading"))
            output.extend(("#" * level + " " + block.text, ""))
        else:
            output.extend((block.text, ""))
    return "\n".join(output).rstrip() + ("\n" if output else "")


def _render_docx(
    document: Document, template: Template, colors: ColorScheme, output_path: Path | BinaryIO
) -> None:
    try:
        from docx import Document as WordDocument
        from docx.shared import Inches, Pt, RGBColor
    except ImportError as error:
        raise ImportError(
            "Writing DOCX requires python-docx. Install it with `pip install python-docx`."
        ) from error

    word_document = WordDocument()
    section = word_document.sections[0]
    section.top_margin = Inches(0.75)
    section.bottom_margin = Inches(0.75)
    style = word_document.styles["Normal"]
    style.font.name = template.font_family
    style.font.size = Pt(template.font_size_pt)
    style.font.color.rgb = RGBColor.from_string(colors.text.lstrip("#"))
    for level in range(1, 7):
        heading_style = word_document.styles[f"Heading {level}"]
        heading_style.font.name = template.font_family
        heading_style.font.size = Pt(
            max(template.heading_size_pt - 2 * (level - 1), template.font_size_pt)
        )
        heading_style.font.color.rgb = RGBColor.from_string(colors.heading.lstrip("#"))

    for block in document.blocks:
        if block.kind == "list_item":
            word_document.add_paragraph(block.text, style="List Bullet")
        elif block.kind == "ordered_item":
            word_document.add_paragraph(block.text, style="List Number")
        elif block.kind.startswith("heading"):
            level = min(int(block.kind.removeprefix("heading")), 6)
            word_document.add_paragraph(block.text, style=f"Heading {level}")
        else:
            word_document.add_paragraph(block.text)
    word_document.save(output_path)


def _render_pdf(
    document: Document, template: Template, colors: ColorScheme, output_path: Path | BinaryIO
) -> None:
    try:
        from reportlab.lib import colors as pdf_colors
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    except ImportError as error:
        raise ImportError(
            "Writing PDF requires ReportLab. Install it with `pip install reportlab`."
        ) from error

    font_name = "Times-Roman" if "times" in template.font_family.lower() else "Helvetica"
    bold_font_name = "Times-Bold" if font_name == "Times-Roman" else "Helvetica-Bold"
    styles = getSampleStyleSheet()
    body_style = ParagraphStyle(
        "DocumentBody",
        parent=styles["BodyText"],
        fontName=font_name,
        fontSize=template.font_size_pt,
        textColor=pdf_colors.HexColor(colors.text),
        leading=template.font_size_pt * 1.4,
        alignment=TA_LEFT,
    )
    story = []
    ordered_number = 0
    for block in document.blocks:
        if block.kind.startswith("heading"):
            ordered_number = 0
            level = min(int(block.kind.removeprefix("heading")), 6)
            heading_style = ParagraphStyle(
                f"DocumentHeading{level}",
                parent=body_style,
                fontName=bold_font_name,
                fontSize=max(template.heading_size_pt - 2 * (level - 1), template.font_size_pt),
                textColor=pdf_colors.HexColor(colors.heading),
                spaceBefore=10,
                spaceAfter=6,
            )
            story.append(Paragraph(escape(block.text), heading_style))
        elif block.kind in {"list_item", "ordered_item"}:
            if block.kind == "ordered_item":
                ordered_number += 1
                marker = f"{ordered_number}."
            else:
                ordered_number = 0
                marker = "&bull;"
            story.append(Paragraph(f"{marker} {escape(block.text)}", body_style))
            story.append(Spacer(1, 3))
        else:
            ordered_number = 0
            story.append(Paragraph(escape(block.text), body_style))
            story.append(Spacer(1, 6))
    target = str(output_path) if isinstance(output_path, Path) else output_path
    SimpleDocTemplate(target, pagesize=LETTER).build(story)


def render_document(
    document: Document,
    output_format: str,
    preset: str | Template = "formal",
    color_scheme: str | ColorScheme | None = None,
    font_family: str | None = None,
) -> str | None:
    """Render a document as text/HTML, or return None for file-based formats."""
    suffix = _normalize_suffix(output_format) or "."
    if suffix not in _SUPPORTED_OUTPUTS:
        raise ValueError(
            f"Unsupported output format {suffix!r}. Choose from: {', '.join(sorted(_SUPPORTED_OUTPUTS))}"
        )

    template, colors = _resolve_template(preset, color_scheme, font_family)
    if suffix in {".md", ".cv"}:
        return _render_markdown(document)
    if suffix == ".html":
        return _render_html(document, template, colors)
    raise ValueError(f"Output format {suffix!r} requires a destination path. Use format_file().")


def format_content(
    input_data: str | bytes,
    input_format: str,
    output_format: str,
    preset: str | Template = "formal",
    color_scheme: str | ColorScheme | None = None,
    font_family: str | None = None,
    remove_hidden_characters: bool = False,
    resource_limits: ResourceLimits | None = None,
) -> str | bytes:
    """Format in-memory content; text outputs are strings and DOCX/PDF outputs are bytes."""
    input_suffix = _normalize_suffix(input_format)
    output_suffix = _normalize_suffix(output_format)
    if input_suffix not in _SUPPORTED_INPUTS:
        raise ValueError(f"Unsupported input format {input_suffix or '(no extension)'!r}.")
    if output_suffix not in _SUPPORTED_OUTPUTS:
        raise ValueError(
            f"Unsupported output format {output_suffix or '(no extension)'!r}. "
            f"Choose from: {', '.join(sorted(_SUPPORTED_OUTPUTS))}"
        )

    if not isinstance(input_data, (str, bytes)):
        raise TypeError("input_data must be str or bytes.")
    input_size = len(input_data.encode("utf-8")) if isinstance(input_data, str) else len(input_data)
    _check_input_size(input_size, input_suffix, resource_limits)
    text_formats = {".md", ".cv", ".txt", ".rst", ".tex", ".html"}
    if isinstance(input_data, str):
        if input_suffix not in text_formats:
            raise TypeError(f"Input for {input_suffix} must be bytes.")
        document = _parse_text_input(input_data, input_suffix)
    elif isinstance(input_data, bytes):
        if input_suffix in text_formats:
            document = _parse_text_input(_decode_text_input(input_data, input_suffix), input_suffix)
        else:
            document = _load_binary_document(BytesIO(input_data), input_suffix, resource_limits)
    _check_document_text_size(document, input_suffix, resource_limits)
    warn_if_suspicious(document)
    if remove_hidden_characters:
        document = remove_suspicious_characters(document)
    template, colors = _resolve_template(preset, color_scheme, font_family)
    if output_suffix in {".md", ".cv"}:
        return _render_markdown(document)
    if output_suffix == ".html":
        return _render_html(document, template, colors)

    output = BytesIO()
    if output_suffix == ".docx":
        _render_docx(document, template, colors, output)
    else:
        _render_pdf(document, template, colors, output)
    return output.getvalue()


def format_file(
    input_path: str | Path,
    output_path: str | Path,
    preset: str | Template = "formal",
    color_scheme: str | ColorScheme | None = None,
    font_family: str | None = None,
    remove_hidden_characters: bool = False,
    resource_limits: ResourceLimits | None = None,
) -> Path:
    """Format a file at the requested paths; constrain untrusted paths in the caller."""
    source = Path(input_path)
    destination = Path(output_path)
    suffix = _normalize_suffix(destination.suffix)
    if suffix not in _SUPPORTED_OUTPUTS:
        raise ValueError(f"Unsupported output format {suffix or '(no extension)'!r}.")

    document = _load_document(source, resource_limits)
    warn_if_suspicious(document)
    if remove_hidden_characters:
        document = remove_suspicious_characters(document)
    template, colors = _resolve_template(preset, color_scheme, font_family)
    if suffix in {".md", ".cv", ".html"}:
        rendered = render_document(document, suffix, template, colors)
        destination.write_text(rendered or "", encoding="utf-8")
    elif suffix == ".docx":
        _render_docx(document, template, colors, destination)
    else:
        _render_pdf(document, template, colors, destination)
    return destination


def _parse_text_input(text: str, suffix: str) -> Document:
    if suffix == ".html":
        return parse_html(text)
    if suffix == ".rst":
        return parse_rst(text)
    if suffix == ".tex":
        return parse_tex(text)
    return parse_markdown(text)
