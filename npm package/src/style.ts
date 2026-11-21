import { InvalidOptionError } from "./errors.ts";
import { COLOR_SCHEMES, PRESETS } from "./models.ts";
import type { ColorScheme, Template } from "./models.ts";

export interface ResolvedColors {
  readonly name: string;
  readonly text: string;
  readonly heading: string;
  readonly accent: string;
  readonly background: string;
}

export interface ResolvedStyle {
  readonly template: Template;
  readonly colors: ResolvedColors;
}

const FONT_FAMILY = /^[A-Za-z0-9 ,'-]+$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Validate and combine a preset, color scheme, and font into concrete render settings. */
export function resolveStyle(
  preset: string | Template = "formal",
  colorScheme?: string | ColorScheme | null,
  fontFamily?: string | null,
): ResolvedStyle {
  let template: Template;
  if (typeof preset === "string") {
    if (!Object.hasOwn(PRESETS, preset)) {
      throw new InvalidOptionError(
        `Unknown preset '${preset}'. Choose from: ${Object.keys(PRESETS).join(", ")}`,
      );
    }
    template = PRESETS[preset] as Template;
  } else {
    template = preset;
  }
  if (fontFamily != null) template = { ...template, fontFamily };

  if (typeof template.fontFamily !== "string" || !FONT_FAMILY.test(template.fontFamily)) {
    throw new InvalidOptionError(
      "Font family must contain only letters, numbers, spaces, commas, apostrophes, or hyphens.",
    );
  }
  if (
    !Number.isFinite(template.fontSizePt) ||
    !Number.isFinite(template.headingSizePt) ||
    template.fontSizePt <= 0 ||
    template.headingSizePt <= 0
  ) {
    throw new InvalidOptionError("Font sizes must be positive finite numbers.");
  }

  let scheme: ColorScheme;
  if (colorScheme != null && typeof colorScheme === "object") {
    scheme = colorScheme;
  } else {
    const name = colorScheme || template.colorScheme;
    if (!Object.hasOwn(COLOR_SCHEMES, name)) {
      throw new InvalidOptionError(
        `Unknown color scheme '${name}'. Choose from: ${Object.keys(COLOR_SCHEMES).join(", ")}`,
      );
    }
    scheme = COLOR_SCHEMES[name] as ColorScheme;
  }
  const background = scheme.background ?? "#ffffff";
  for (const color of [scheme.text, scheme.heading, scheme.accent, background]) {
    if (typeof color !== "string" || !HEX_COLOR.test(color)) {
      throw new InvalidOptionError(
        "Color values must be six-digit hexadecimal colors, such as #17365d.",
      );
    }
  }
  return {
    template,
    colors: {
      name: scheme.name,
      text: scheme.text,
      heading: scheme.heading,
      accent: scheme.accent,
      background,
    },
  };
}

export function headingSizePt(template: Template, level: number): number {
  return Math.max(template.headingSizePt - 2 * (level - 1), template.fontSizePt);
}
