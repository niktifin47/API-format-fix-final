import importlib.util
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / "scripts" / "record_merge_summary.py"
spec = importlib.util.spec_from_file_location("record_merge_summary", SCRIPT)
assert spec is not None and spec.loader is not None
summary_script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary_script)


def event():
    return {
        "repository": {"full_name": "owner/repo", "default_branch": "main"},
        "pull_request": {
            "number": 12,
            "merged": True,
            "title": "Fix <markup>\n## unexpected heading",
            "milestone": {"title": "API stability"},
            "user": {"login": "contributor"},
            "head": {"ref": "fix", "repo": {"full_name": "owner/repo"}},
        },
    }


def test_summary_escapes_untrusted_metadata_and_records_unknowns():
    marker, entry, body = summary_script.summary(event())
    assert marker == "<!-- project-merge-summary:owner/repo#12 -->"
    assert "&lt;markup&gt;" in entry
    assert "\n## unexpected heading" not in entry
    assert "API stability" in body
    assert "not independently assessed" in body


def test_skill_update_is_idempotent_and_requires_section():
    marker, entry, _ = summary_script.summary(event())
    content = "# Skill\n\n## Recent merged work\n\nNo merge summaries recorded yet.\n"
    updated = summary_script.update_skill(content, marker, entry)
    assert updated.count(marker) == 1
    assert "No merge summaries recorded yet." not in updated
    assert summary_script.update_skill(updated, marker, entry) == updated
    with pytest.raises(ValueError, match="exactly one"):
        summary_script.update_skill("# Skill\n", marker, entry)


def test_only_bot_summary_branches_skip_followup():
    data = event()
    data["pull_request"]["head"]["ref"] = "automation/merge-summary/pr-12"
    assert not summary_script.is_summary_pr(data)
    data["pull_request"]["user"]["login"] = "github-actions[bot]"
    assert summary_script.is_summary_pr(data)
    data["pull_request"]["head"]["repo"]["full_name"] = "other/repo"
    assert not summary_script.is_summary_pr(data)


def test_rejects_unmerged_pull_request():
    data = event()
    data["pull_request"]["merged"] = False
    with pytest.raises(ValueError, match="merged pull request"):
        summary_script.summary(data)


def test_comment_retry_does_not_duplicate_bot_comment(monkeypatch):
    marker, _, body = summary_script.summary(event())
    calls = []

    def fake_run(*args):
        calls.append(args)
        return (
            '[[{"body":"'
            + marker
            + '","user":{"login":"github-actions[bot]"}}]]'
        )

    monkeypatch.setattr(summary_script, "run", fake_run)
    summary_script.record_comment("owner/repo", 12, marker, body)
    assert len(calls) == 1


def test_existing_open_update_pr_is_not_created_again(monkeypatch, tmp_path):
    skill = tmp_path / "SKILL.md"
    skill.write_text("## Recent merged work\n", encoding="utf-8")
    marker, entry, _ = summary_script.summary(event())
    calls = []

    def fake_run(*args):
        calls.append(args)
        return (
            '[[{"user":{"login":"github-actions[bot]"},'
            '"state":"open","html_url":"https://example.com/pr"}]]'
        )

    monkeypatch.setattr(summary_script, "SKILL_PATH", skill)
    monkeypatch.setattr(summary_script, "run", fake_run)
    summary_script.propose_update(event(), marker, entry)
    assert len(calls) == 1
    assert skill.read_text(encoding="utf-8") == "## Recent merged work\n"


def test_existing_unattached_branch_stops_without_overwriting(monkeypatch, tmp_path):
    skill = tmp_path / "SKILL.md"
    skill.write_text("## Recent merged work\n", encoding="utf-8")
    marker, entry, _ = summary_script.summary(event())
    monkeypatch.setattr(summary_script, "SKILL_PATH", skill)
    monkeypatch.setattr(summary_script, "run", lambda *args: "[[]]")
    monkeypatch.setattr(
        summary_script.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, "", ""),
    )
    with pytest.raises(RuntimeError, match="already exists without a PR"):
        summary_script.propose_update(event(), marker, entry)
    assert skill.read_text(encoding="utf-8") == "## Recent merged work\n"


def test_new_update_pr_includes_summary(monkeypatch, tmp_path):
    skill = tmp_path / "SKILL.md"
    skill.write_text("## Recent merged work\n", encoding="utf-8")
    marker, entry, _ = summary_script.summary(event())
    calls = []

    def fake_run(*args):
        calls.append(args)
        return "[[]]" if args[:2] == ("gh", "api") else ""

    monkeypatch.setattr(summary_script, "SKILL_PATH", skill)
    monkeypatch.setattr(summary_script, "run", fake_run)
    monkeypatch.setattr(
        summary_script.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args, 2, "", ""),
    )
    summary_script.propose_update(event(), marker, entry)
    assert marker in skill.read_text(encoding="utf-8")
    assert any(call[:3] == ("gh", "pr", "create") for call in calls)
