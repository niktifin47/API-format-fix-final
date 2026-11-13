import sys

import pytest

from api_format_fix import cli


def test_cli_reports_format_errors_concisely(monkeypatch: pytest.MonkeyPatch, capsys):
    monkeypatch.setattr(sys, "argv", ["api-format-fix", "input.md", "output.doc"])

    with pytest.raises(SystemExit) as error:
        cli.main()

    assert error.value.code == 2
    assert "Unsupported output format" in capsys.readouterr().err


def test_cli_prompts_before_removing_hidden_characters(
    tmp_path, monkeypatch: pytest.MonkeyPatch
):
    source = tmp_path / "input.md"
    destination = tmp_path / "output.md"
    source.write_text("Visible\u2066hidden\u2069", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["api-format-fix", str(source), str(destination)])
    monkeypatch.setattr(sys, "stdin", type("Terminal", (), {"isatty": lambda self: True})())
    monkeypatch.setattr("builtins.input", lambda prompt: "yes")

    cli.main()

    assert destination.read_text(encoding="utf-8") == "Visiblehidden\n"


def test_cli_reports_malformed_pdf_concisely(
    tmp_path, monkeypatch: pytest.MonkeyPatch, capsys
):
    source = tmp_path / "input.pdf"
    source.write_bytes(b"not a PDF")
    monkeypatch.setattr(sys, "argv", ["api-format-fix", str(source), str(tmp_path / "output.md")])

    with pytest.raises(SystemExit) as error:
        cli.main()

    output = capsys.readouterr().err
    assert error.value.code == 2
    assert "Could not read PDF document" in output
    assert str(source) in output
    assert "invalid pdf header" not in output
    assert "EOF marker not found" not in output
    assert "Traceback" not in output


def test_cli_reports_malformed_docx_concisely(
    tmp_path, monkeypatch: pytest.MonkeyPatch, capsys
):
    source = tmp_path / "input.docx"
    source.write_bytes(b"not a DOCX")
    monkeypatch.setattr(sys, "argv", ["api-format-fix", str(source), str(tmp_path / "output.md")])

    with pytest.raises(SystemExit) as error:
        cli.main()

    output = capsys.readouterr().err
    assert error.value.code == 2
    assert "Could not read DOCX document" in output
    assert "Traceback" not in output


def test_cli_reports_encrypted_pdf_concisely(
    tmp_path, monkeypatch: pytest.MonkeyPatch, capsys
):
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.encrypt("secret")
    source = tmp_path / "encrypted.pdf"
    with source.open("wb") as target:
        writer.write(target)
    monkeypatch.setattr(
        sys,
        "argv",
        ["api-format-fix", str(source), str(tmp_path / "output.md")],
    )

    with pytest.raises(SystemExit) as error:
        cli.main()

    output = capsys.readouterr().err
    assert error.value.code == 2
    assert "encrypted PDFs are not supported" in output
    assert str(source) in output
    assert "Traceback" not in output


def test_cli_enforces_explicit_input_limit_concisely(
    tmp_path, monkeypatch: pytest.MonkeyPatch, capsys
):
    source = tmp_path / "input.md"
    source.write_text("Resume", encoding="utf-8")
    destination = tmp_path / "output.md"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "api-format-fix",
            "--max-input-bytes",
            "4",
            str(source),
            str(destination),
        ],
    )

    with pytest.raises(SystemExit) as error:
        cli.main()

    output = capsys.readouterr().err
    assert error.value.code == 2
    assert "max_input_bytes" in output
    assert "Traceback" not in output
    assert not destination.exists()


def test_cli_debug_prints_traceback(monkeypatch: pytest.MonkeyPatch, capsys):
    monkeypatch.setattr(
        sys,
        "argv",
        ["api-format-fix", "--debug", "input.md", "output.html"],
    )

    def fail_formatting(*args, **kwargs):
        raise ValueError("Invalid input details")

    monkeypatch.setattr(cli, "inspect_file", lambda path, **kwargs: ())
    monkeypatch.setattr(cli, "format_file", fail_formatting)
    with pytest.raises(SystemExit) as error:
        cli.main()

    assert error.value.code == 1
    output = capsys.readouterr().err
    assert "Traceback (most recent call last)" in output
    assert "Invalid input details" in output
