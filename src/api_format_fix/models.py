from dataclasses import dataclass


@dataclass(frozen=True)
class ColorScheme:
    name: str
    text: str
    heading: str
    accent: str
    background: str = "#ffffff"


@dataclass(frozen=True)
class Template:
    name: str
    font_family: str
    font_size_pt: float
    heading_size_pt: float
    color_scheme: str


@dataclass(frozen=True)
class DocumentBlock:
    kind: str
    text: str


@dataclass(frozen=True)
class Document:
    blocks: tuple[DocumentBlock, ...]


PRESETS = {
    "formal": Template(
        name="formal",
        font_family="Times New Roman",
        font_size_pt=11,
        heading_size_pt=16,
        color_scheme="navy",
    ),
    "friendly": Template(
        name="friendly",
        font_family="Arial",
        font_size_pt=11,
        heading_size_pt=16,
        color_scheme="teal",
    ),
}

COLOR_SCHEMES = {
    "navy": ColorScheme(
        name="navy",
        text="#202124",
        heading="#17365d",
        accent="#345f8c",
    ),
    "teal": ColorScheme(
        name="teal",
        text="#263238",
        heading="#00695c",
        accent="#ef6c57",
    ),
}
