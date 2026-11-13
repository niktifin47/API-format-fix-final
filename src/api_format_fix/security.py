import unicodedata
import warnings
from dataclasses import dataclass

from .models import Document, DocumentBlock


@dataclass(frozen=True)
class HiddenCharacterFinding:
    block_index: int
    offset: int
    codepoint: str
    name: str


def _is_suspicious(character: str) -> bool:
    if character in "\t\n\r \u200d":
        return False
    return (
        character.isspace()
        or unicodedata.category(character) in {"Cc", "Cf", "Cs"}
    )


def inspect_document(document: Document) -> tuple[HiddenCharacterFinding, ...]:
    """Find invisible or control characters in extracted document text."""
    findings = []
    for block_index, block in enumerate(document.blocks):
        for offset, character in enumerate(block.text):
            if _is_suspicious(character):
                findings.append(
                    HiddenCharacterFinding(
                        block_index=block_index,
                        offset=offset,
                        codepoint=f"U+{ord(character):04X}",
                        name=unicodedata.name(character, "UNNAMED CONTROL CHARACTER"),
                    )
                )
    return tuple(findings)


def remove_suspicious_characters(document: Document) -> Document:
    """Return a copy with controls removed and unusual whitespace normalized."""
    return Document(
        tuple(
            DocumentBlock(
                block.kind,
                "".join(
                    " "
                    if character.isspace() and character not in "\t\n\r "
                    else character
                    for character in block.text
                    if not _is_suspicious(character)
                    or (character.isspace() and character not in "\t\n\r ")
                ),
            )
            for block in document.blocks
        )
    )


def warn_if_suspicious(document: Document) -> tuple[HiddenCharacterFinding, ...]:
    findings = inspect_document(document)
    if findings:
        locations = ", ".join(
            f"block {finding.block_index + 1} offset {finding.offset} ({finding.codepoint})"
            for finding in findings[:10]
        )
        suffix = " (additional occurrences omitted)" if len(findings) > 10 else ""
        warnings.warn(
            f"Document contains {len(findings)} suspicious invisible/control character(s): "
            f"{locations}{suffix}. Text is preserved unless explicitly removed.",
            UserWarning,
            stacklevel=2,
        )
    return findings
