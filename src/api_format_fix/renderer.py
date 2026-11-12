import html
import math
import re
from io import BytesIO
from pathlib import Path
from typing import BinaryIO
from xml.sax.saxutils import escape

from .models import COLOR_SCHEMES, PRESETS, ColorScheme, Document, DocumentBlock, Template
from .parser import parse_markdown

_SUPPORTED_INPUTS = {".md", ".cv", ".txt", ".docx", ".pdf"}
_SUPPORTED_OUTPUTS = {".md", ".cv", ".html", ".docx", ".pdf"}


def _resolve_template(
    preset: str | Template, color_scheme: str | ColorScheme | None
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


def _safe_resolve_path(user_path: str | Path, root: Path) -> Path:
    candidate = Path(user_path)
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved_root = root.resolve()
    resolved_candidate = candidate.resolve()
    try:
        resolved_candidate.relative_to(resolved_root)
    except ValueError as error:
        raise ValueError(f"Path {user_path!r} is outside the allowed directory {str(root)!r}.") from error
    return resolved_candidate


def _load_binary_document(source: Path | BinaryIO, suffix: str) -> Document:
    if suffix == ".docx":
        try:
            from docx import Document as WordDocument
        except ImportError as error:
            raise ImportError(
                "Reading DOCX requires python-docx. Install it with `pip install python-docx`."
            ) from error

        word_document = WordDocument(source)
        blocks = []
        for paragraph in word_document.paragraphs:
            if not paragraph.text.strip():
                continue
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

    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise ImportError(
            "Reading PDF requires pypdf. Install it with `pip install pypdf`."
        ) from error

    reader = PdfReader(source)
    text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
    return parse_markdown(text)


def _load_document(path: Path) -> Document:
    suffix = path.suffix.lower()
    if suffix not in _SUPPORTED_INPUTS:
        raise ValueError(f"Unsupported input format {suffix or '(no extension)'!r}.")

    if suffix in {".md", ".cv", ".txt"}:
        return parse_markdown(path.read_text(encoding="utf-8"))
    return _load_binary_document(path, suffix)


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
) -> str | None:
    """Render a document as text/HTML, or return None for file-based formats."""
    suffix = _normalize_suffix(output_format) or "."
    if suffix not in _SUPPORTED_OUTPUTS:
        raise ValueError(
            f"Unsupported output format {suffix!r}. Choose from: {', '.join(sorted(_SUPPORTED_OUTPUTS))}"
        )

    template, colors = _resolve_template(preset, color_scheme)
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

    if isinstance(input_data, str):
        if input_suffix not in {".md", ".cv", ".txt"}:
            raise TypeError(f"Input for {input_suffix} must be bytes.")
        document = parse_markdown(input_data)
    elif isinstance(input_data, bytes):
        if input_suffix in {".md", ".cv", ".txt"}:
            document = parse_markdown(input_data.decode("utf-8"))
        else:
            document = _load_binary_document(BytesIO(input_data), input_suffix)
    else:
        raise TypeError("input_data must be str or bytes.")

    template, colors = _resolve_template(preset, color_scheme)
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
) -> Path:
    """Read a supported document, apply a preset, and write the requested format."""
    safe_root = Path.cwd()
    source = _safe_resolve_path(input_path, safe_root)
    destination = _safe_resolve_path(output_path, safe_root)
    suffix = _normalize_suffix(destination.suffix)
    if suffix not in _SUPPORTED_OUTPUTS:
        raise ValueError(f"Unsupported output format {suffix or '(no extension)'!r}.")

    document = _load_document(source)
    template, colors = _resolve_template(preset, color_scheme)
    if suffix in {".md", ".cv", ".html"}:
        rendered = render_document(document, suffix, template, colors)
        destination.write_text(rendered or "", encoding="utf-8")
    elif suffix == ".docx":
        _render_docx(document, template, colors, destination)
    else:
        _render_pdf(document, template, colors, destination)
    return destination
