import re
from html.parser import HTMLParser
from typing import ClassVar

from .models import Document, DocumentBlock

_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_LIST_ITEM = re.compile(r"^\s*(?P<marker>[-*+]|\d+[.)])\s+(?P<text>.+?)\s*$")


def parse_markdown(text: str) -> Document:
    """Parse headings, paragraphs, and simple list items into document blocks."""
    blocks: list[DocumentBlock] = []
    paragraph: list[str] = []

    def flush_paragraph() -> None:
        if paragraph:
            blocks.append(DocumentBlock("paragraph", " ".join(paragraph)))
            paragraph.clear()

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            flush_paragraph()
            continue

        heading = _HEADING.match(stripped)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            blocks.append(DocumentBlock(f"heading{level}", heading.group(2)))
            continue

        list_item = _LIST_ITEM.match(line)
        if list_item:
            flush_paragraph()
            kind = "ordered_item" if list_item.group("marker")[0].isdigit() else "list_item"
            blocks.append(DocumentBlock(kind, list_item.group("text")))
            continue

        paragraph.append(stripped)

    flush_paragraph()
    return Document(tuple(blocks))


class _HTMLTextExtractor(HTMLParser):
    _BLOCK_TAGS: ClassVar[set[str]] = {
        "address",
        "article",
        "blockquote",
        "br",
        "div",
        "footer",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "li",
        "main",
        "p",
        "section",
        "tr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "template", "head"}:
            self.ignored_depth += 1
        elif not self.ignored_depth and re.fullmatch(r"h[1-6]", tag):
            self.parts.append(f"\n{'#' * int(tag[1])} ")
        elif not self.ignored_depth and tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "template", "head"} and self.ignored_depth:
            self.ignored_depth -= 1
        elif not self.ignored_depth and tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.ignored_depth:
            self.parts.append(data)


def parse_html(text: str) -> Document:
    """Extract visible text from HTML without interpreting markup as document content."""
    extractor = _HTMLTextExtractor()
    extractor.feed(text)
    extractor.close()
    return parse_markdown("".join(extractor.parts))


def parse_rst(text: str) -> Document:
    """Parse common reStructuredText sections and list markers as plain document blocks."""
    lines = text.splitlines()
    converted: list[str] = []
    heading_level = 0
    index = 0
    while index < len(lines):
        line = lines[index]
        if index + 1 < len(lines):
            underline = lines[index + 1].strip()
            if (
                line.strip()
                and underline
                and len(set(underline)) == 1
                and underline[0] in "=-~^\"`:+#*"
            ):
                heading_level += 1
                converted.append(f"{'#' * min(heading_level, 6)} {line.strip()}")
                index += 2
                continue
        converted.append(line)
        index += 1
    return parse_markdown("\n".join(converted))


def parse_tex(text: str) -> Document:
    """Extract plain prose and common section/list commands from a TeX source file."""
    text = re.sub(r"(?<!\\)%.*", "", text)
    text = re.sub(r"\\(?:documentclass|usepackage|begin|end)\s*(?:\[[^\]]*\])?\s*\{[^}]*\}", "", text)
    text = re.sub(
        r"\\(section|subsection|subsubsection|paragraph)\*?\s*\{([^}]*)\}",
        lambda match: f"{'#' * {'section': 1, 'subsection': 2, 'subsubsection': 3, 'paragraph': 4}[match.group(1)]} {match.group(2)}",
        text,
    )
    text = re.sub(r"\\item(?:\s*\[[^\]]*\])?\s*", "- ", text)
    text = re.sub(r"\\(?:textbf|textit|emph|underline)\s*\{([^{}]*)\}", r"\1", text)
    text = re.sub(r"\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?", "", text)
    text = text.replace("{", "").replace("}", "")
    text = re.sub(r"(?<!\\)~", " ", text).replace(r"\%", "%").replace(r"\&", "&")
    return parse_markdown(text)
