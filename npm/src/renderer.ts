import { open, readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";

import {
  DocumentParseError,
  ResourceLimitError,
  UnsupportedFormatError,
} from "./errors.ts";
import { checkDocumentTextSize, checkInputSize } from "./limits.ts";
import { validateResourceLimits } from "./models.ts";
import type {
  ColorScheme,
  Document,
  FormatCapability,
  ResourceLimits,
  Template,
} from "./models.ts";
import { parseHtml, parseMarkdown, parseRst, parseTex } from "./parser.ts";
import {
  inspectDocument,
  removeSuspiciousCharacters,
  warnIfSuspicious,
} from "./security.ts";
import type { HiddenCharacterFinding } from "./security.ts";
import { resolveStyle } from "./style.ts";
import type { ResolvedStyle } from "./style.ts";
import { trimEndPy } from "./text.ts";

export interface StyleOptions {
  /** A built-in preset name or a custom template. Defaults to `formal`. */
  readonly preset?: string | Template;
  /** A built-in color scheme name or a custom scheme. Defaults to the preset's scheme. */
  readonly colorScheme?: string | ColorScheme | null;
  readonly fontFamily?: string | null;
}

export interface FormatOptions extends StyleOptions {
  /** Remove invisible/control characters from extracted text. Text is preserved by default. */
  readonly removeHiddenCharacters?: boolean;
  readonly resourceLimits?: ResourceLimits | null;
}

export type TextOutputFormat = "md" | ".md" | "cv" | ".cv" | "html" | ".html";
export type BinaryOutputFormat = "docx" | ".docx" | "pdf" | ".pdf";

const CAPABILITIES: Readonly<Record<string, FormatCapability>> = Object.freeze(
  Object.fromEntries(
    (
      [
        [".md", true, true, null, null],
        [".cv", true, true, null, null],
        [".txt", true, false, null, null],
        [".html", true, true, null, null],
        [".rst", true, false, null, null],
        [".tex", true, false, null, null],
        [".rtf", true, false, null, null],
        [".odt", true, false, null, null],
        [".docx", true, true, null, null],
        [".pdf", true, true, "pdfjs-dist", "pdfkit"],
      ] as const
    ).map(([extension, canRead, canWrite, readDependency, writeDependency]) => [
      extension,
      Object.freeze({ extension, canRead, canWrite, readDependency, writeDependency }),
    ]),
  ),
);

function readOnlySet(values: Iterable<string>): ReadonlySet<string> {
  const set = new Set(values);
  const refuse = (): never => {
    throw new TypeError("This set is read-only.");
  };
  Object.defineProperties(set, {
    add: { value: refuse },
    delete: { value: refuse },
    clear: { value: refuse },
  });
  return Object.freeze(set);
}

const capabilityList = Object.values(CAPABILITIES);
export const SUPPORTED_INPUT_FORMATS: ReadonlySet<string> = readOnlySet(
  capabilityList.filter((capability) => capability.canRead).map((capability) => capability.extension),
);
export const SUPPORTED_OUTPUT_FORMATS: ReadonlySet<string> = readOnlySet(
  capabilityList.filter((capability) => capability.canWrite).map((capability) => capability.extension),
);

const TEXT_FORMATS: ReadonlySet<string> = new Set([".md", ".cv", ".txt", ".html", ".rst", ".tex"]);

/** Immutable format capabilities keyed by normalized extension. */
export function getFormatCapabilities(): Readonly<Record<string, FormatCapability>> {
  return CAPABILITIES;
}

function normalizeSuffix(format: string): string {
  const suffix = format.toLowerCase();
  if (!suffix) return "";
  return suffix.startsWith(".") ? suffix : `.${suffix}`;
}

const describeSuffix = (suffix: string): string => `'${suffix || "(no extension)"}'`;

function canRead(suffix: string): boolean {
  return Object.hasOwn(CAPABILITIES, suffix) && (CAPABILITIES[suffix] as FormatCapability).canRead;
}

function canWrite(suffix: string): boolean {
  return Object.hasOwn(CAPABILITIES, suffix) && (CAPABILITIES[suffix] as FormatCapability).canWrite;
}

function unsupportedOutput(suffix: string): UnsupportedFormatError {
  return new UnsupportedFormatError(
    `Unsupported output format ${describeSuffix(suffix)}. Choose from: ${[...SUPPORTED_OUTPUT_FORMATS].sort().join(", ")}`,
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^\n]+?)\*/g, "<em>$1</em>")
    .replace(/`([^\n]+?)`/g, "<code>$1</code>");
}

function renderHtml(document: Document, { template, colors }: ResolvedStyle): string {
  const output: string[] = [];
  let listTag: "ul" | "ol" | null = null;
  for (const block of document.blocks) {
    if (block.kind === "list_item" || block.kind === "ordered_item") {
      const nextTag = block.kind === "ordered_item" ? "ol" : "ul";
      if (listTag !== nextTag) {
        if (listTag) output.push(`</${listTag}>`);
        output.push(`<${nextTag}>`);
        listTag = nextTag;
      }
      output.push(`<li>${inlineHtml(block.text)}</li>`);
      continue;
    }
    if (listTag) {
      output.push(`</${listTag}>`);
      listTag = null;
    }
    if (block.kind.startsWith("heading")) {
      const level = Number(block.kind.slice("heading".length));
      output.push(`<h${level}>${inlineHtml(block.text)}</h${level}>`);
    } else {
      output.push(`<p>${inlineHtml(block.text)}</p>`);
    }
  }
  if (listTag) output.push(`</${listTag}>`);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Formatted document</title>
  <style>
    body { background: ${colors.background}; color: ${colors.text}; font-family: ${template.fontFamily}, sans-serif;
           font-size: ${template.fontSizePt}pt; line-height: 1.5; max-width: 760px; margin: 3rem auto; padding: 0 1rem; }
    h1, h2, h3, h4, h5, h6 { color: ${colors.heading}; font-family: ${template.fontFamily}, sans-serif; }
    a, strong { color: ${colors.accent}; }
    code { background: #f3f4f6; padding: 0.1em 0.25em; }
  </style>
</head>
<body>
${output.join("\n")}
</body>
</html>
`;
}

function renderMarkdown(document: Document): string {
  const output: string[] = [];
  let listKind: string | null = null;
  let orderedNumber = 0;
  for (const block of document.blocks) {
    if (block.kind === "list_item" || block.kind === "ordered_item") {
      if (listKind !== block.kind) {
        if (listKind) output.push("");
        listKind = block.kind;
        orderedNumber = 0;
      }
      output.push(block.kind === "ordered_item" ? `${++orderedNumber}. ${block.text}` : `- ${block.text}`);
      continue;
    }
    if (listKind) {
      output.push("");
      listKind = null;
    }
    if (block.kind.startsWith("heading")) {
      const level = Number(block.kind.slice("heading".length));
      output.push(`${"#".repeat(level)} ${block.text}`, "");
    } else {
      output.push(block.text, "");
    }
  }
  return trimEndPy(output.join("\n")) + (output.length > 0 ? "\n" : "");
}

/** Render a document as Markdown/CV or HTML text. Use {@link formatContent} for DOCX and PDF. */
export function renderDocument(
  document: Document,
  outputFormat: string,
  options: StyleOptions = {},
): string {
  const suffix = normalizeSuffix(outputFormat) || ".";
  if (!canWrite(suffix)) throw unsupportedOutput(suffix);

  const style = resolveStyle(options.preset, options.colorScheme, options.fontFamily);
  if (suffix === ".md" || suffix === ".cv") return renderMarkdown(document);
  if (suffix === ".html") return renderHtml(document, style);
  throw new UnsupportedFormatError(
    `Output format '${suffix}' produces binary data. Use formatContent() or formatFile().`,
  );
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

// Locate the first invalid byte so the error matches Python's UnicodeDecodeError.start.
function invalidUtf8Offset(bytes: Uint8Array): number {
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index] as number;
    if (lead < 0x80) {
      index++;
      continue;
    }
    let length: number;
    let codePoint: number;
    let minimum: number;
    if (lead >= 0xc2 && lead <= 0xdf) {
      [length, codePoint, minimum] = [2, lead & 0x1f, 0x80];
    } else if (lead >= 0xe0 && lead <= 0xef) {
      [length, codePoint, minimum] = [3, lead & 0x0f, 0x800];
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      [length, codePoint, minimum] = [4, lead & 0x07, 0x10000];
    } else {
      return index;
    }
    if (index + length > bytes.length) return index;
    for (let offset = 1; offset < length; offset++) {
      const continuation = bytes[index + offset] as number;
      if ((continuation & 0xc0) !== 0x80) return index;
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    if (
      codePoint < minimum ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return index;
    }
    index += length;
  }
  return 0;
}

function decodeText(data: Uint8Array, suffix: string): string {
  try {
    return strictUtf8.decode(data);
  } catch (error) {
    throw new DocumentParseError(
      `Could not decode ${suffix.toUpperCase()} document as UTF-8 at byte offset ${invalidUtf8Offset(data)}.`,
      { cause: error },
    );
  }
}

function parseText(text: string, suffix: string): Document {
  if (suffix === ".html") return parseHtml(text);
  if (suffix === ".rst") return parseRst(text);
  if (suffix === ".tex") return parseTex(text);
  return parseMarkdown(text);
}

async function parseBytes(
  data: Uint8Array,
  suffix: string,
  limits: ResourceLimits | null | undefined,
): Promise<Document> {
  if (TEXT_FORMATS.has(suffix)) return parseText(decodeText(data, suffix), suffix);
  if (suffix === ".rtf") return (await import("./readers/rtf.ts")).readRtf(data);
  if (suffix === ".docx") return (await import("./readers/docx.ts")).readDocx(data, limits);
  if (suffix === ".odt") return (await import("./readers/odt.ts")).readOdt(data, limits);
  return (await import("./readers/pdf.ts")).readPdf(data, limits);
}

async function readAtMost(path: string, limit: number): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= limit) {
      const chunk = Buffer.allocUnsafe(Math.min(65536, limit + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    return Buffer.concat(chunks);
  } finally {
    await handle.close();
  }
}

async function loadDocument(
  inputPath: string,
  limits: ResourceLimits | null | undefined,
): Promise<Document> {
  const suffix = normalizeSuffix(extname(inputPath));
  if (!canRead(suffix)) {
    throw new UnsupportedFormatError(`Unsupported input format ${describeSuffix(suffix)}.`);
  }

  try {
    const maxBytes = limits?.maxInputBytes;
    const data = maxBytes != null ? await readAtMost(inputPath, maxBytes) : await readFile(inputPath);
    checkInputSize(data.byteLength, suffix, limits);
    const document = await parseBytes(data, suffix, limits);
    checkDocumentTextSize(document, suffix, limits);
    return document;
  } catch (error) {
    if (error instanceof DocumentParseError) {
      throw new DocumentParseError(`${error.message} (input: ${inputPath})`, { cause: error });
    }
    if (error instanceof ResourceLimitError) {
      throw new ResourceLimitError(`${error.message} (input: ${inputPath})`, { cause: error });
    }
    throw error;
  }
}

/** Scan extracted document text for suspicious invisible/control characters. */
export async function inspectFile(
  path: string,
  resourceLimits?: ResourceLimits | null,
): Promise<readonly HiddenCharacterFinding[]> {
  validateResourceLimits(resourceLimits);
  return inspectDocument(await loadDocument(path, resourceLimits));
}

async function renderBinary(document: Document, suffix: string, style: ResolvedStyle): Promise<Uint8Array> {
  if (suffix === ".docx") return (await import("./writers/docx.ts")).renderDocx(document, style);
  return (await import("./writers/pdf.ts")).renderPdf(document, style);
}

/**
 * Format in-memory content. Markdown, CV, and HTML outputs are strings; DOCX and PDF outputs are
 * bytes. Markdown, CV, TXT, HTML, RST, and TeX inputs accept strings or bytes; other inputs need bytes.
 */
export async function formatContent(
  input: string | Uint8Array,
  inputFormat: string,
  outputFormat: TextOutputFormat,
  options?: FormatOptions,
): Promise<string>;
export async function formatContent(
  input: string | Uint8Array,
  inputFormat: string,
  outputFormat: BinaryOutputFormat,
  options?: FormatOptions,
): Promise<Uint8Array>;
export async function formatContent(
  input: string | Uint8Array,
  inputFormat: string,
  outputFormat: string,
  options?: FormatOptions,
): Promise<string | Uint8Array>;
export async function formatContent(
  input: string | Uint8Array,
  inputFormat: string,
  outputFormat: string,
  options: FormatOptions = {},
): Promise<string | Uint8Array> {
  const inputSuffix = normalizeSuffix(inputFormat);
  const outputSuffix = normalizeSuffix(outputFormat);
  if (!canRead(inputSuffix)) {
    throw new UnsupportedFormatError(`Unsupported input format ${describeSuffix(inputSuffix)}.`);
  }
  if (!canWrite(outputSuffix)) throw unsupportedOutput(outputSuffix);
  if (typeof input !== "string" && !(input instanceof Uint8Array)) {
    throw new TypeError("input must be a string or Uint8Array.");
  }

  const limits = options.resourceLimits;
  validateResourceLimits(limits);
  checkInputSize(
    typeof input === "string" ? Buffer.byteLength(input, "utf8") : input.byteLength,
    inputSuffix,
    limits,
  );
  let document: Document;
  if (typeof input === "string") {
    if (!TEXT_FORMATS.has(inputSuffix)) throw new TypeError(`Input for ${inputSuffix} must be bytes.`);
    document = parseText(input, inputSuffix);
  } else {
    document = await parseBytes(input, inputSuffix, limits);
  }
  checkDocumentTextSize(document, inputSuffix, limits);
  warnIfSuspicious(document);
  if (options.removeHiddenCharacters) document = removeSuspiciousCharacters(document);

  const style = resolveStyle(options.preset, options.colorScheme, options.fontFamily);
  if (outputSuffix === ".md" || outputSuffix === ".cv") return renderMarkdown(document);
  if (outputSuffix === ".html") return renderHtml(document, style);
  return renderBinary(document, outputSuffix, style);
}

/**
 * Format a file; the output format comes from the destination extension. Paths are used as given,
 * so applications handling untrusted paths must constrain them before calling.
 */
export async function formatFile(
  inputPath: string,
  outputPath: string,
  options: FormatOptions = {},
): Promise<string> {
  const suffix = normalizeSuffix(extname(outputPath));
  if (!canWrite(suffix)) {
    throw new UnsupportedFormatError(`Unsupported output format ${describeSuffix(suffix)}.`);
  }

  validateResourceLimits(options.resourceLimits);
  let document = await loadDocument(inputPath, options.resourceLimits);
  warnIfSuspicious(document);
  if (options.removeHiddenCharacters) document = removeSuspiciousCharacters(document);

  const style = resolveStyle(options.preset, options.colorScheme, options.fontFamily);
  if (suffix === ".md" || suffix === ".cv") {
    await writeFile(outputPath, renderMarkdown(document), "utf8");
  } else if (suffix === ".html") {
    await writeFile(outputPath, renderHtml(document, style), "utf8");
  } else {
    await writeFile(outputPath, await renderBinary(document, suffix, style));
  }
  return outputPath;
}
