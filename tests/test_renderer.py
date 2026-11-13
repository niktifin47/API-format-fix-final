import builtins
from io import BytesIO
from pathlib import Path

import pytest

from api_format_fix import (
    COLOR_SCHEMES,
    FONT_FAMILIES,
    SUPPORTED_INPUT_FORMATS,
    SUPPORTED_OUTPUT_FORMATS,
    ColorScheme,
    DocumentParseError,
    FormatCapability,
    ResourceLimitError,
    ResourceLimits,
    Template,
    format_content,
    format_file,
    get_format_capabilities,
    inspect_document,
    parse_markdown,
    remove_suspicious_characters,
)


def test_format_capabilities_describe_supported_operations_and_extras():
    capabilities = get_format_capabilities()

    assert SUPPORTED_INPUT_FORMATS == frozenset(
        {".md", ".cv", ".txt", ".html", ".rst", ".tex", ".rtf", ".odt", ".docx", ".pdf"}
    )
    assert SUPPORTED_OUTPUT_FORMATS == frozenset(
        {".md", ".cv", ".html", ".docx", ".pdf"}
    )
    assert capabilities[".txt"] == FormatCapability(".txt", can_read=True, can_write=False)
    assert capabilities[".html"] == FormatCapability(".html", can_read=True, can_write=True)
    assert capabilities[".docx"] == FormatCapability(
        ".docx", can_read=True, can_write=True, read_extra="docx", write_extra="docx"
    )
    assert capabilities[".pdf"] == FormatCapability(
        ".pdf", can_read=True, can_write=True, read_extra="pdf", write_extra="pdf"
    )
    assert capabilities[".rtf"].read_extra == "rtf"
    assert capabilities[".odt"].read_extra == "odt"
    with pytest.raises(TypeError):
        capabilities[".custom"] = FormatCapability(".custom", can_read=True, can_write=True)


def test_builtin_fonts_and_palettes_can_be_selected():
    assert len(set(FONT_FAMILIES) - {"Arial", "Times New Roman"}) >= 20
    assert len(COLOR_SCHEMES) >= 102
    palettes = [COLOR_SCHEMES[f"spectrum-{index:03}"] for index in range(1, 101)]
    assert len({(palette.heading, palette.accent) for palette in palettes}) == 100

    def white_contrast(hex_color: str) -> float:
        rgb = [int(hex_color[index : index + 2], 16) / 255 for index in (1, 3, 5)]
        linear = [
            channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4
            for channel in rgb
        ]
        luminance = sum(weight * channel for weight, channel in zip((0.2126, 0.7152, 0.0722), linear))
        return 1.05 / (luminance + 0.05)

    assert min(
        white_contrast(color)
        for palette in palettes
        for color in (palette.heading, palette.accent)
    ) >= 4.5

    source = "# Styled"

    rendered = format_content(
        source,
        ".md",
        ".html",
        color_scheme="spectrum-100",
        font_family="Inter",
    )

    assert "font-family: Inter" in rendered
    assert COLOR_SCHEMES["spectrum-100"].heading in rendered


def test_extended_text_formats_extract_content():
    html = format_content(
        "<h1>Visible</h1><script>hidden()</script><p>Text &amp; more</p>", ".html", ".md"
    )
    rst = format_content("Title\n=====\n\nParagraph", ".rst", ".md")
    tex = format_content(
        r"\section{Title}" + "\n" + r"\textbf{Paragraph}", ".tex", ".md"
    )

    assert html == "# Visible\n\nText & more\n"
    assert rst == "# Title\n\nParagraph\n"
    assert tex == "# Title\n\nParagraph\n"


def test_rtf_and_odt_inputs_extract_text(tmp_path: Path):
    from odf.opendocument import OpenDocumentText
    from odf.text import H, P

    rtf = format_content(b"{\\rtf1\\ansi {\\b Bold} text\\par}", ".rtf", ".md")
    odt_path = tmp_path / "input.odt"
    odt_document = OpenDocumentText()
    heading = H(outlinelevel="1")
    heading.addText("ODT title")
    paragraph = P()
    paragraph.addText("ODT text")
    odt_document.text.addElement(heading)
    odt_document.text.addElement(paragraph)
    odt_document.save(str(odt_path))

    rendered = format_content(odt_path.read_bytes(), ".odt", ".md")

    assert "Bold text" in rtf
    assert rendered == "# ODT title\n\nODT text\n"


def test_hidden_unicode_is_reported_and_only_removed_when_requested(tmp_path: Path):
    source = tmp_path / "input.md"
    destination = tmp_path / "output.md"
    source.write_text("Visible \u2066hidden\u2069\u00a0👩\u200d💻", encoding="utf-8")

    findings = inspect_document(parse_markdown(source.read_text(encoding="utf-8")))
    assert [finding.codepoint for finding in findings] == ["U+2066", "U+2069", "U+00A0"]

    with pytest.warns(UserWarning, match="Text is preserved"):
        format_file(source, destination)
    assert "\u2066" in destination.read_text(encoding="utf-8")

    format_file(source, destination, remove_hidden_characters=True)
    assert destination.read_text(encoding="utf-8") == "Visible hidden 👩\u200d💻\n"


def test_suspicious_character_removal_preserves_emoji_joiners():
    document = parse_markdown("👩\u200d💻")

    cleaned = remove_suspicious_characters(document)

    assert cleaned.blocks[0].text == "👩\u200d💻"


def test_resource_limits_reject_oversized_input_and_extracted_text():
    with pytest.raises(ResourceLimitError, match="max_input_bytes"):
        format_content(
            "# Resume",
            ".md",
            ".html",
            resource_limits=ResourceLimits(max_input_bytes=4),
        )

    with pytest.raises(ResourceLimitError, match="max_text_chars"):
        format_content(
            "# Resume",
            ".md",
            ".html",
            resource_limits=ResourceLimits(max_text_chars=4),
        )


def test_resource_limits_count_utf8_bytes_and_cover_file_inputs(tmp_path: Path):
    source = tmp_path / "input.md"
    destination = tmp_path / "output.md"
    source.write_text("é", encoding="utf-8")

    assert (
        format_content("é", ".md", ".md", resource_limits=ResourceLimits(max_input_bytes=2))
        == "é\n"
    )
    with pytest.raises(ResourceLimitError, match="max_input_bytes"):
        format_content("é", ".md", ".md", resource_limits=ResourceLimits(max_input_bytes=1))
    with pytest.raises(ResourceLimitError, match="max_input_bytes"):
        format_file(source, destination, resource_limits=ResourceLimits(max_input_bytes=1))


def test_extracted_text_limit_applies_to_docx_and_pdf():
    docx = format_content("# Summary", ".md", ".docx")
    pdf = format_content("# Summary", ".md", ".pdf")
    limits = ResourceLimits(max_text_chars=3)

    with pytest.raises(ResourceLimitError, match="max_text_chars"):
        format_content(docx, ".docx", ".md", resource_limits=limits)
    with pytest.raises(ResourceLimitError, match="max_text_chars"):
        format_content(pdf, ".pdf", ".md", resource_limits=limits)


def test_resource_limits_reject_pdf_page_count():
    pdf = format_content(
        "\n\n".join(f"Paragraph {index}" for index in range(120)),
        ".md",
        ".pdf",
    )

    with pytest.raises(ResourceLimitError, match="max_pdf_pages"):
        format_content(
            pdf,
            ".pdf",
            ".md",
            resource_limits=ResourceLimits(max_pdf_pages=1),
        )


def test_encrypted_pdf_is_rejected_with_format_context():
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.encrypt("secret")
    encrypted_pdf = BytesIO()
    writer.write(encrypted_pdf)

    with pytest.raises(DocumentParseError, match="encrypted PDFs are not supported"):
        format_content(encrypted_pdf.getvalue(), ".pdf", ".md")


def test_scanned_pdf_without_text_layer_returns_empty_text():
    from reportlab.pdfgen.canvas import Canvas

    output = BytesIO()
    pdf = Canvas(output)
    pdf.showPage()
    pdf.save()

    assert format_content(output.getvalue(), ".pdf", ".md") == ""


def test_malformed_pdf_error_includes_source_path(tmp_path: Path):
    source = tmp_path / "broken.pdf"
    source.write_bytes(b"not a PDF")

    with pytest.raises(DocumentParseError, match="broken.pdf"):
        format_file(source, tmp_path / "output.md")


def test_truncated_pdf_has_a_concise_error():
    with pytest.raises(DocumentParseError, match="missing %%EOF marker"):
        format_content(b"%PDF-1.7\n", ".pdf", ".md")


def test_malformed_docx_xml_has_a_concise_format_error():
    from zipfile import ZipFile

    from docx import Document as WordDocument

    original = BytesIO()
    WordDocument().save(original)
    malformed = BytesIO()
    with ZipFile(original) as source, ZipFile(malformed, "w") as destination:
        for item in source.infolist():
            contents = source.read(item.filename)
            if item.filename == "word/document.xml":
                contents = b"<broken"
            destination.writestr(item, contents)

    with pytest.raises(DocumentParseError, match="Could not read DOCX document"):
        format_content(malformed.getvalue(), ".docx", ".md")


def test_malformed_odt_is_reported_with_format_context():
    with pytest.raises(DocumentParseError, match="Could not read ODT document"):
        format_content(b"not an ODT archive", ".odt", ".md")


def test_cv_input_can_be_styled_as_html(tmp_path: Path):
    source = tmp_path / "resume.cv"
    destination = tmp_path / "resume.html"
    source.write_text("# Experience\n\n- Built useful tools", encoding="utf-8")

    format_file(source, destination, preset="friendly", color_scheme="navy")

    rendered = destination.read_text(encoding="utf-8")
    assert "<h1>Experience</h1>" in rendered
    assert "<li>Built useful tools</li>" in rendered
    assert "#17365d" in rendered


def test_format_file_accepts_paths_outside_the_working_directory(tmp_path: Path):
    source = tmp_path / "input.md"
    destination = tmp_path / "output.html"
    source.write_text("# Summary", encoding="utf-8")

    result = format_file(source, destination)

    assert result == destination
    assert "<h1>Summary</h1>" in destination.read_text(encoding="utf-8")


def test_custom_template_and_palette_are_supported(tmp_path: Path):
    source = tmp_path / "input.md"
    destination = tmp_path / "output.html"
    source.write_text("A document.", encoding="utf-8")
    template = Template("custom", "Georgia", 12, 18, "custom")
    colors = ColorScheme("custom", "#111111", "#222222", "#333333")

    format_file(source, destination, preset=template, color_scheme=colors)

    rendered = destination.read_text(encoding="utf-8")
    assert "Georgia" in rendered
    assert "#222222" in rendered


def test_unknown_preset_fails_explicitly(tmp_path: Path):
    source = tmp_path / "input.md"
    source.write_text("A document.", encoding="utf-8")

    with pytest.raises(ValueError, match="Unknown preset"):
        format_file(source, tmp_path / "output.html", preset="unlisted")


def test_custom_template_rejects_unsafe_css_values(tmp_path: Path):
    source = tmp_path / "input.md"
    source.write_text("A document.", encoding="utf-8")
    unsafe_colors = ColorScheme("unsafe", "#111111", "</style><script>", "#333333")

    with pytest.raises(ValueError, match="six-digit hexadecimal"):
        format_file(source, tmp_path / "output.html", color_scheme=unsafe_colors)


def test_unsupported_output_fails_explicitly(tmp_path: Path):
    source = tmp_path / "input.md"
    source.write_text("A document.", encoding="utf-8")

    with pytest.raises(ValueError, match="Unsupported output format"):
        format_file(source, tmp_path / "output.doc", preset="formal")


def test_docx_and_pdf_outputs_are_created(tmp_path: Path):
    source = tmp_path / "input.md"
    source.write_text("# Summary\n\n- First item", encoding="utf-8")
    docx_path = tmp_path / "output.docx"
    pdf_path = tmp_path / "output.pdf"

    format_file(source, docx_path)
    format_file(source, pdf_path)

    assert docx_path.read_bytes().startswith(b"PK")
    assert pdf_path.read_bytes().startswith(b"%PDF")

    docx_html = tmp_path / "docx.html"
    pdf_html = tmp_path / "pdf.html"
    format_file(docx_path, docx_html)
    format_file(pdf_path, pdf_html)
    assert "Summary" in docx_html.read_text(encoding="utf-8")
    assert "First item" in docx_html.read_text(encoding="utf-8")
    assert "Summary" in pdf_html.read_text(encoding="utf-8")
    assert "First item" in pdf_html.read_text(encoding="utf-8")


def test_in_memory_api_round_trips_docx_and_pdf_bytes():
    html = format_content("# Summary", "md", "html")
    assert isinstance(html, str)
    assert "<h1>Summary</h1>" in html

    source = b"# Summary\n\n- First item"

    docx_data = format_content(source, "md", ".docx")
    assert isinstance(docx_data, bytes)
    docx_html = format_content(docx_data, "docx", "html")
    assert isinstance(docx_html, str)
    assert "<h1>Summary</h1>" in docx_html
    assert "<li>First item</li>" in docx_html

    pdf_data = format_content(source, ".md", "pdf")
    assert isinstance(pdf_data, bytes)
    pdf_markdown = format_content(pdf_data, ".pdf", "md")
    assert isinstance(pdf_markdown, str)
    assert "Summary" in pdf_markdown
    assert "First item" in pdf_markdown


@pytest.mark.parametrize(
    ("module", "input_data", "input_format", "output_format", "dependency"),
    [
        ("docx", b"document", "docx", "md", "python-docx"),
        ("pypdf", b"document", "pdf", "md", "pypdf"),
        ("reportlab", b"# Resume", "md", "pdf", "ReportLab"),
        ("striprtf", b"{\\rtf1 text}", "rtf", "md", "striprtf"),
        ("odf", b"document", "odt", "md", "odfpy"),
    ],
)
def test_in_memory_api_reports_missing_optional_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    module: str,
    input_data: bytes,
    input_format: str,
    output_format: str,
    dependency: str,
):
    original_import = builtins.__import__

    def import_without_optional_dependency(name, *args, **kwargs):
        if name == module or name.startswith(f"{module}."):
            raise ModuleNotFoundError(f"No module named {name!r}")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", import_without_optional_dependency)
    with pytest.raises(ImportError) as error:
        format_content(input_data, input_format, output_format)
    assert dependency in str(error.value)
    if module in {"striprtf", "odf"}:
        assert f"api-format-fix[{input_format}]" in str(error.value)
