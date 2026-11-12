import builtins
from pathlib import Path

import pytest

from api_format_fix import ColorScheme, Template, format_content, format_file


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
    with pytest.raises(ImportError, match=dependency):
        format_content(input_data, input_format, output_format)
