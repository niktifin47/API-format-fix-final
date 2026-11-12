import argparse
import sys

from .models import COLOR_SCHEMES, PRESETS
from .renderer import format_file


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="api-format-fix",
        description="Apply a reusable style to Markdown, CV, DOCX, or PDF documents.",
    )
    parser.add_argument("input", nargs="?", help="Input document path")
    parser.add_argument("output", nargs="?", help="Output document path")
    parser.add_argument("--preset", choices=sorted(PRESETS), default="formal")
    parser.add_argument("--color-scheme", choices=sorted(COLOR_SCHEMES))
    parser.add_argument(
        "--list-presets", action="store_true", help="List built-in presets and color schemes"
    )
    args = parser.parse_args()

    if args.list_presets:
        for name, template in PRESETS.items():
            print(
                f"{name}: {template.font_family}, {template.font_size_pt:g} pt, colors={template.color_scheme}"
            )
        print(f"Color schemes: {', '.join(COLOR_SCHEMES)}")
        return
    if not args.input or not args.output:
        parser.error("input and output paths are required unless --list-presets is used")

    try:
        format_file(args.input, args.output, preset=args.preset, color_scheme=args.color_scheme)
    except (ImportError, OSError, ValueError) as error:
        parser.error(str(error))
    print(f"Formatted {args.input} -> {args.output}")


if __name__ == "__main__":
    sys.exit(main())
