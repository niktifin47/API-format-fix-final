import sys

import pytest

from api_format_fix import cli


def test_cli_reports_format_errors_concisely(monkeypatch: pytest.MonkeyPatch, capsys):
    monkeypatch.setattr(sys, "argv", ["api-format-fix", "input.md", "output.doc"])

    with pytest.raises(SystemExit) as error:
        cli.main()

    assert error.value.code == 2
    assert "Unsupported output format" in capsys.readouterr().err


def test_cli_debug_prints_traceback(monkeypatch: pytest.MonkeyPatch, capsys):
    monkeypatch.setattr(
        sys,
        "argv",
        ["api-format-fix", "--debug", "input.md", "output.html"],
    )

    def fail_formatting(*args, **kwargs):
        raise ValueError("Invalid input details")

    monkeypatch.setattr(cli, "format_file", fail_formatting)
    with pytest.raises(SystemExit) as error:
        cli.main()

    assert error.value.code == 1
    output = capsys.readouterr().err
    assert "Traceback (most recent call last)" in output
    assert "Invalid input details" in output
