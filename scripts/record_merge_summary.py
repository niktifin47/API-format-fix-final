"""Record a merged pull request and propose a planning-skill update."""

import html
import json
import os
import re
import subprocess
from pathlib import Path

SKILL_PATH = Path(".github/skills/project-milestone-planning/SKILL.md")
BRANCH_PREFIX = "automation/merge-summary/pr-"
PLACEHOLDER = "No merge summaries recorded yet.\n"
SECTION = "## Recent merged work\n"


def run(*command: str) -> str:
    return subprocess.run(
        command, check=True, stdout=subprocess.PIPE, text=True
    ).stdout.strip()


def safe_text(value: str) -> str:
    text = " ".join(value.split())[:200]
    text = html.escape(text, quote=False)
    return re.sub(r"([\\`*_{}\[\]()#+.!|~>-])", r"\\\1", text)


def summary(event: dict) -> tuple[str, str, str]:
    pr = event["pull_request"]
    number = pr["number"]
    repository = event["repository"]["full_name"]
    if (
        pr["merged"] is not True
        or not isinstance(number, int)
        or isinstance(number, bool)
        or number < 1
        or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository)
    ):
        raise ValueError("Expected a merged pull request and a valid repository and PR number")
    marker = f"<!-- project-merge-summary:{repository}#{number} -->"
    url = f"https://github.com/{repository}/pull/{number}"
    title = safe_text(pr["title"])
    milestone = safe_text(pr["milestone"]["title"]) if pr.get("milestone") else "None assigned"
    entry = (
        f"- [#{number}]({url}): {title}. Milestone: {milestone}. "
        f"API impact and validation not independently assessed. {marker}\n"
    )
    body = (
        f"{marker}\n### Merge summary\n\n"
        f"- Merged: [#{number}]({url}) - {title}\n"
        f"- Milestone: {milestone}\n"
        "- API impact and validation: not independently assessed; see the PR diff and checks.\n"
    )
    return marker, entry, body


def is_summary_pr(event: dict) -> bool:
    pr = event["pull_request"]
    head = pr["head"]
    return (
        pr["user"]["login"] == "github-actions[bot]"
        and head["repo"] is not None
        and head["repo"]["full_name"] == event["repository"]["full_name"]
        and re.fullmatch(rf"{re.escape(BRANCH_PREFIX)}[1-9][0-9]*", head["ref"]) is not None
    )


def record_comment(repository: str, number: int, marker: str, body: str) -> None:
    pages = json.loads(
        run("gh", "api", "--paginate", "--slurp", f"repos/{repository}/issues/{number}/comments")
    )
    if any(
        marker in comment["body"] and comment["user"]["login"] == "github-actions[bot]"
        for page in pages
        for comment in page
    ):
        print(f"Merge summary comment already exists for #{number}.")
        return
    run("gh", "api", "--method", "POST", f"repos/{repository}/issues/{number}/comments", "-f", f"body={body}")
    print(f"Added merge summary comment for #{number}.")


def update_skill(content: str, marker: str, entry: str) -> str:
    if marker in content:
        return content
    if content.count(SECTION) != 1:
        raise ValueError("Planning skill must contain exactly one Recent merged work section")
    content = content.replace(PLACEHOLDER, "", 1)
    return content.replace(SECTION, f"{SECTION}\n{entry}", 1)


def propose_update(event: dict, marker: str, entry: str) -> None:
    pr = event["pull_request"]
    repository = event["repository"]["full_name"]
    number = pr["number"]
    content = SKILL_PATH.read_text(encoding="utf-8")
    updated = update_skill(content, marker, entry)
    if updated == content:
        print(f"Planning skill already records #{number}.")
        return

    branch = f"{BRANCH_PREFIX}{number}"
    owner = repository.split("/", 1)[0]
    endpoint = f"repos/{repository}/pulls?state=all&head={owner}:{branch}&per_page=100"
    pages = json.loads(run("gh", "api", "--paginate", "--slurp", endpoint))
    for existing in (item for page in pages for item in page):
        if existing["user"]["login"] != "github-actions[bot]":
            raise RuntimeError(f"Summary branch is already used by {existing['html_url']}")
        if existing["state"] == "open":
            print(f"Planning update already proposed: {existing['html_url']}")
            return
        raise RuntimeError(f"Existing summary PR is closed but the entry is absent: {existing['html_url']}")

    remote = subprocess.run(
        ["git", "ls-remote", "--exit-code", "--heads", "origin", branch],
        check=False,
        capture_output=True,
        text=True,
    )
    if remote.returncode == 0:
        raise RuntimeError(f"Summary branch {branch} already exists without a PR; inspect it before retrying")
    if remote.returncode != 2:
        raise RuntimeError(f"Could not check summary branch: {remote.stderr.strip()}")

    run("git", "switch", "-c", branch)
    SKILL_PATH.write_text(updated, encoding="utf-8")
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "add", str(SKILL_PATH))
    run(
        "git", "commit", "-m", f"docs: record merge of PR #{number}",
        "-m", "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
    )
    run("git", "push", "origin", branch)
    url = run(
        "gh", "pr", "create", "--repo", repository, "--base",
        event["repository"]["default_branch"], "--head", branch,
        "--title", f"docs: record merge of PR #{number}",
        "--body", f"Records the verified merge of #{number} in the planning skill.\n\n{marker}",
    )
    print(f"Planning update proposed: {url}")


def main() -> None:
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    marker, entry, body = summary(event)
    repository = event["repository"]["full_name"]
    number = event["pull_request"]["number"]
    record_comment(repository, number, marker, body)
    if is_summary_pr(event):
        print("Automation-only summary PR: no further planning update proposed.")
    else:
        propose_update(event, marker, entry)


if __name__ == "__main__":
    main()
