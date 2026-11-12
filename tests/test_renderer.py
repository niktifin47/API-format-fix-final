from pathlib import Path

import pytest

from api_format_fix import ColorScheme, Template, format_file


def test_cv_input_can_be_styled_as_html(tmp_path: Path):
    source = tmp_path / "resume.cv"
    destination = tmp_path / "resume.html"
    source.write_text("# Experience\n\n- Built useful tools", encoding="utf-8")

    format_file(source, destination, preset="friendly", color_scheme="navy")

    rendered = destination.read_text(encoding="utf-8")
    assert "<h1>Experience</h1>" in rendered
    assert "<li>Built useful tools</li>" in rendered
    assert "#17365d" in rendered


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
