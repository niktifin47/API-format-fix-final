import { InvalidOptionError } from "./errors.ts";

export interface ColorScheme {
  readonly name: string;
  readonly text: string;
  readonly heading: string;
  readonly accent: string;
  /** Defaults to `#ffffff`. */
  readonly background?: string;
}

export interface Template {
  readonly name: string;
  readonly fontFamily: string;
  readonly fontSizePt: number;
  readonly headingSizePt: number;
  readonly colorScheme: string;
}

export type BlockKind =
  | "paragraph"
  | "list_item"
  | "ordered_item"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6";

export interface DocumentBlock {
  readonly kind: BlockKind;
  readonly text: string;
}

export interface Document {
  readonly blocks: readonly DocumentBlock[];
}

export interface FormatCapability {
  readonly extension: string;
  readonly canRead: boolean;
  readonly canWrite: boolean;
  /** Optional npm package required to read this format, or `null`. */
  readonly readDependency: string | null;
  /** Optional npm package required to write this format, or `null`. */
  readonly writeDependency: string | null;
}

/** Limits are unset (unlimited) by default and are not a parser sandbox. */
export interface ResourceLimits {
  /** Maximum input size in bytes (UTF-8 bytes for string input). */
  readonly maxInputBytes?: number | null;
  readonly maxPdfPages?: number | null;
  /** Maximum extracted text, counted in Unicode code points. */
  readonly maxTextChars?: number | null;
  /** Maximum decompressed size of each XML part read from a DOCX or ODT archive. */
  readonly maxDecompressedBytes?: number | null;
}

const LIMIT_NAMES = ["maxInputBytes", "maxPdfPages", "maxTextChars", "maxDecompressedBytes"] as const;

export function validateResourceLimits(limits: ResourceLimits | null | undefined): void {
  if (limits == null) return;
  for (const name of LIMIT_NAMES) {
    const value = limits[name];
    if (value != null && (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)) {
      throw new InvalidOptionError(`${name} must be a positive integer or undefined.`);
    }
  }
}

export function createDocument(blocks: readonly DocumentBlock[]): Document {
  return Object.freeze({ blocks: Object.freeze(blocks.map((block) => Object.freeze({ ...block }))) });
}

export const PRESETS: Readonly<Record<string, Template>> = Object.freeze({
  formal: Object.freeze({
    name: "formal",
    fontFamily: "Times New Roman",
    fontSizePt: 11,
    headingSizePt: 16,
    colorScheme: "navy",
  }),
  friendly: Object.freeze({
    name: "friendly",
    fontFamily: "Arial",
    fontSizePt: 11,
    headingSizePt: 16,
    colorScheme: "teal",
  }),
});

export const FONT_FAMILIES: readonly string[] = Object.freeze([
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
]);

const ONE_THIRD = 1 / 3;
const ONE_SIXTH = 1 / 6;
const TWO_THIRD = 2 / 3;

// Python's float modulo keeps the sign of the divisor.
function modOne(value: number): number {
  const remainder = value % 1;
  return remainder < 0 ? remainder + 1 : remainder;
}

function hueToChannel(m1: number, m2: number, hueValue: number): number {
  const hue = modOne(hueValue);
  if (hue < ONE_SIXTH) return m1 + (m2 - m1) * hue * 6;
  if (hue < 0.5) return m2;
  if (hue < TWO_THIRD) return m1 + (m2 - m1) * (TWO_THIRD - hue) * 6;
  return m1;
}

function hlsToRgb(hue: number, lightness: number, saturation: number): [number, number, number] {
  if (saturation === 0) return [lightness, lightness, lightness];
  const m2 =
    lightness <= 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const m1 = 2 * lightness - m2;
  return [
    hueToChannel(m1, m2, hue + ONE_THIRD),
    hueToChannel(m1, m2, hue),
    hueToChannel(m1, m2, hue - ONE_THIRD),
  ];
}

// Python's round() rounds halves to the nearest even integer.
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const difference = value - floor;
  if (difference < 0.5) return floor;
  if (difference > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function spectrumColor(hue: number, lightness: number): string {
  return `#${hlsToRgb(hue, lightness, 0.62)
    .map((channel) => roundHalfEven(channel * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function buildColorSchemes(): Readonly<Record<string, ColorScheme>> {
  const schemes: Record<string, ColorScheme> = {
    navy: Object.freeze({
      name: "navy",
      text: "#202124",
      heading: "#17365d",
      accent: "#345f8c",
      background: "#ffffff",
    }),
    teal: Object.freeze({
      name: "teal",
      text: "#263238",
      heading: "#00695c",
      accent: "#ef6c57",
      background: "#ffffff",
    }),
  };
  for (let index = 0; index < 100; index++) {
    const hue = index / 100;
    const name = `spectrum-${String(index + 1).padStart(3, "0")}`;
    schemes[name] = Object.freeze({
      name,
      text: "#202124",
      heading: spectrumColor(hue, 0.28),
      accent: spectrumColor((hue + 0.11) % 1, 0.28),
      background: "#ffffff",
    });
  }
  return Object.freeze(schemes);
}

export const COLOR_SCHEMES: Readonly<Record<string, ColorScheme>> = buildColorSchemes();
