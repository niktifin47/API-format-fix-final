import argparse
import sys
import traceback
from pathlib import Path

from .models import COLOR_SCHEMES, FONT_FAMILIES, PRESETS, ResourceLimits
from .renderer import SUPPORTED_OUTPUT_FORMATS, format_file, inspect_file


def _positive_integer(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a positive integer") from error
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="api-format-fix",
        description="Apply a reusable style to supported text-based document formats.",
    )
    parser.add_argument("input", nargs="?", help="Input document path")
    parser.add_argument("output", nargs="?", help="Output document path")
    parser.add_argument("--preset", choices=sorted(PRESETS), default="formal")
    parser.add_argument("--color-scheme", choices=sorted(COLOR_SCHEMES))
    parser.add_argument("--font-family", choices=FONT_FAMILIES)
    parser.add_argument(
        "--max-input-bytes",
        type=_positive_integer,
        help="Reject input larger than this many bytes",
    )
    parser.add_argument(
        "--max-pdf-pages",
        type=_positive_integer,
        help="Reject PDFs containing more than this many pages",
    )
    parser.add_argument(
        "--max-text-chars",
        type=_positive_integer,
        help="Reject documents extracting more than this many text characters",
    )
    parser.add_argument(
        "--remove-hidden-characters",
        action="store_true",
        help="Explicitly remove suspicious invisible/control characters found in extracted text",
    )
    parser.add_argument(
        "--list-presets", action="store_true", help="List built-in presets and color schemes"
    )
    parser.add_argument("--debug", action="store_true", help="Show a traceback if formatting fails")
    args = parser.parse_args()

    if args.list_presets:
        for name, template in PRESETS.items():
            print(
                f"{name}: {template.font_family}, {template.font_size_pt:g} pt, colors={template.color_scheme}"
            )
        print(f"Color schemes: {', '.join(COLOR_SCHEMES)}")
        print(f"Font families: {', '.join(FONT_FAMILIES)}")
        return
    if not args.input or not args.output:
        parser.error("input and output paths are required unless --list-presets is used")
    output_suffix = Path(args.output).suffix.lower()
    if output_suffix not in SUPPORTED_OUTPUT_FORMATS:
        parser.error(f"Unsupported output format {output_suffix or '(no extension)'!r}.")

    resource_limits = ResourceLimits(
        max_input_bytes=args.max_input_bytes,
        max_pdf_pages=args.max_pdf_pages,
        max_text_chars=args.max_text_chars,
    )
    try:
        remove_hidden = args.remove_hidden_characters
        if not remove_hidden:
            findings = inspect_file(args.input, resource_limits=resource_limits)
            if findings and sys.stdin.isatty():
                answer = input(
                    f"Found {len(findings)} suspicious invisible/control character(s). "
                    "Remove them before formatting? [y/N] "
                )
                remove_hidden = answer.strip().lower() in {"y", "yes"}
        format_file(
            args.input,
            args.output,
            preset=args.preset,
            color_scheme=args.color_scheme,
            font_family=args.font_family,
            remove_hidden_characters=remove_hidden,
            resource_limits=resource_limits,
        )
    except (ImportError, OSError, ValueError) as error:
        if args.debug:
            traceback.print_exc()
            raise SystemExit(1) from error
        parser.error(str(error))
    print(f"Formatted {args.input} -> {args.output}")


if __name__ == "__main__":
    sys.exit(main())
