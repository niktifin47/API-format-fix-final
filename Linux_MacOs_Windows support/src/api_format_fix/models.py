from collections.abc import Mapping
from colorsys import hls_to_rgb
from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True)
class ColorScheme:
    name: str
    text: str
    heading: str
    accent: str
    background: str = "#ffffff"


@dataclass(frozen=True)
class FormatCapability:
    extension: str
    can_read: bool
    can_write: bool
    read_extra: str | None = None
    write_extra: str | None = None


@dataclass(frozen=True)
class ResourceLimits:
    max_input_bytes: int | None = None
    max_pdf_pages: int | None = None
    max_text_chars: int | None = None

    def __post_init__(self) -> None:
        for name in ("max_input_bytes", "max_pdf_pages", "max_text_chars"):
            value = getattr(self, name)
            if value is not None and (
                isinstance(value, bool) or not isinstance(value, int) or value <= 0
            ):
                raise ValueError(f"{name} must be a positive integer or None.")


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

_BUILTIN_COLOR_SCHEMES = {
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


FONT_FAMILIES = (
    "Alegreya",
    "Arial",
    "Atkinson Hyperlegible",
    "Carlito",
    "DejaVu Sans",
    "Fira Sans",
    "IBM Plex Sans",
    "Inter",
    "Lato",
    "Liberation Sans",
    "Merriweather",
    "Montserrat",
    "Noto Sans",
    "Noto Serif",
    "Nunito",
    "Open Sans",
    "PT Sans",
    "Poppins",
    "Roboto",
    "Source Sans 3",
    "Source Serif 4",
    "Times New Roman",
    "Ubuntu",
)


def _spectrum_color(hue: float, lightness: float) -> str:
    red, green, blue = hls_to_rgb(hue, lightness, 0.62)
    return f"#{round(red * 255):02x}{round(green * 255):02x}{round(blue * 255):02x}"


def _build_color_schemes() -> Mapping[str, ColorScheme]:
    schemes = dict(_BUILTIN_COLOR_SCHEMES)
    for index in range(100):
        hue = index / 100
        name = f"spectrum-{index + 1:03}"
        schemes[name] = ColorScheme(
            name=name,
            text="#202124",
            heading=_spectrum_color(hue, 0.28),
            accent=_spectrum_color((hue + 0.11) % 1, 0.28),
        )
    return MappingProxyType(schemes)


COLOR_SCHEMES = _build_color_schemes()
