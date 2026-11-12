import re

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
