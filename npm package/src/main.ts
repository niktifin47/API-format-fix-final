import { createInterface } from "node:readline";
import { extname } from "node:path";
import { parseArgs } from "node:util";

import { ApiFormatFixError } from "./errors.ts";
import { COLOR_SCHEMES, FONT_FAMILIES, PRESETS } from "./models.ts";
import type { ResourceLimits } from "./models.ts";
import {
  SUPPORTED_OUTPUT_FORMATS,
  formatFile,
  getFormatCapabilities,
  inspectFile,
} from "./renderer.ts";
import { VERSION } from "./version.ts";

export interface CliIo {
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  readonly stdinIsTTY: boolean;
  /** Resolves to the typed answer, `""` at end of input; rejects with {@link PromptCancelledError} on Ctrl+C. */
  prompt(question: string): Promise<string>;
}

export class PromptCancelledError extends Error {}

export function createPrompt(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  terminal?: boolean,
): (question: string) => Promise<string> {
  return (question) =>
    new Promise<string>((resolve, reject) => {
      const readline = createInterface({ input, output, terminal });
      readline.once("SIGINT", () => {
        reject(new PromptCancelledError("Cancelled."));
        readline.close();
      });
      readline.once("close", () => resolve(""));
      readline.question(question, (answer) => {
        resolve(answer);
        readline.close();
      });
    });
}

export function processIo(): CliIo {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    prompt: createPrompt(process.stdin, process.stdout),
  };
}

const USAGE = "Usage: api-format-fix [options] <input> <output>";

const HELP = `${USAGE}

Apply a reusable style to supported text-based document formats.

Options:
  -h, --help                      Show this help
  --version                       Print the package version
  --diagnostics                   Print runtime, format, and optional-dependency information as JSON
  --preset <name>                 Style preset (default: formal)
  --color-scheme <name>           Color scheme (see --list-presets)
  --font-family <name>            Font family (see --list-presets)
  --max-input-bytes <n>           Reject input larger than this many bytes
  --max-pdf-pages <n>             Reject PDFs containing more than this many pages
  --max-text-chars <n>            Reject documents extracting more than this many text characters
  --max-decompressed-bytes <n>    Reject DOCX/ODT XML parts larger than this many bytes once decompressed
  --remove-hidden-characters      Remove suspicious invisible/control characters found in extracted text
  --list-presets                  List built-in presets, color schemes, and font families
  --debug                         Show a stack trace if formatting fails
`;

const OPTIONAL_PACKAGES: Readonly<Record<string, readonly string[]>> = { pdf: ["pdfjs-dist", "pdfkit"] };

function isResolvable(packageName: string): boolean {
  try {
    import.meta.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

function diagnostics(): Record<string, unknown> {
  return {
    version: VERSION,
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    formats: Object.fromEntries(
      Object.entries(getFormatCapabilities())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([extension, capability]) => [
          extension,
          { read: capability.canRead, write: capability.canWrite },
        ]),
    ),
    optional_dependencies: Object.fromEntries(
      Object.entries(OPTIONAL_PACKAGES).map(([group, packages]) => [
        group,
        Object.fromEntries(packages.map((name) => [name, isResolvable(name)])),
      ]),
    ),
  };
}

function isOperationalError(error: unknown): boolean {
  if (error instanceof ApiFormatFixError) return true;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return error instanceof Error && typeof code === "string" && /^E[A-Z0-9]+$/.test(code);
}

class UsageError extends Error {}

function positiveInteger(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new UsageError(`argument --${name}: must be a positive integer`);
  }
  return parsed;
}

function choice(name: string, value: string | undefined, choices: readonly string[]): string | undefined {
  if (value === undefined || choices.includes(value)) return value;
  throw new UsageError(
    `argument --${name}: invalid choice: '${value}' (choose from ${choices.map((item) => `'${item}'`).join(", ")})`,
  );
}

/** Run the command line interface and return the process exit code. */
export async function main(argv: readonly string[], io: CliIo = processIo()): Promise<number> {
  const fail = (message: string): number => {
    io.stderr.write(`${USAGE}\napi-format-fix: error: ${message}\n`);
    return 2;
  };

  let parsed: ReturnType<typeof parseArguments>;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    if (error instanceof UsageError || error instanceof TypeError) return fail(error.message);
    throw error;
  }
  const { values, positionals } = parsed;

  if (values.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout.write(`api-format-fix ${VERSION}\n`);
    return 0;
  }
  if (values.diagnostics) {
    io.stdout.write(`${JSON.stringify(diagnostics(), null, 2)}\n`);
    return 0;
  }
  if (values["list-presets"]) {
    for (const [name, template] of Object.entries(PRESETS)) {
      io.stdout.write(
        `${name}: ${template.fontFamily}, ${template.fontSizePt} pt, colors=${template.colorScheme}\n`,
      );
    }
    io.stdout.write(`Color schemes: ${Object.keys(COLOR_SCHEMES).join(", ")}\n`);
    io.stdout.write(`Font families: ${FONT_FAMILIES.join(", ")}\n`);
    return 0;
  }

  const [input, output, ...extra] = positionals;
  if (extra.length > 0) return fail(`unrecognized arguments: ${extra.join(" ")}`);
  if (!input || !output) {
    return fail("input and output paths are required unless --list-presets is used");
  }
  const outputSuffix = extname(output).toLowerCase();
  if (!SUPPORTED_OUTPUT_FORMATS.has(outputSuffix)) {
    return fail(`Unsupported output format '${outputSuffix || "(no extension)"}'.`);
  }

  let limits: ResourceLimits;
  let preset: string | undefined;
  let colorScheme: string | undefined;
  let fontFamily: string | undefined;
  try {
    preset = choice("preset", values.preset, Object.keys(PRESETS));
    colorScheme = choice("color-scheme", values["color-scheme"], Object.keys(COLOR_SCHEMES));
    fontFamily = choice("font-family", values["font-family"], FONT_FAMILIES);
    limits = {
      maxInputBytes: positiveInteger("max-input-bytes", values["max-input-bytes"]),
      maxPdfPages: positiveInteger("max-pdf-pages", values["max-pdf-pages"]),
      maxTextChars: positiveInteger("max-text-chars", values["max-text-chars"]),
      maxDecompressedBytes: positiveInteger("max-decompressed-bytes", values["max-decompressed-bytes"]),
    };
  } catch (error) {
    if (error instanceof UsageError) return fail(error.message);
    throw error;
  }

  try {
    let removeHiddenCharacters = Boolean(values["remove-hidden-characters"]);
    if (!removeHiddenCharacters) {
      const findings = await inspectFile(input, limits);
      if (findings.length > 0 && io.stdinIsTTY) {
        const answer = await io.prompt(
          `Found ${findings.length} suspicious invisible/control character(s). ` +
            "Remove them before formatting? [y/N] ",
        );
        removeHiddenCharacters = ["y", "yes"].includes(answer.trim().toLowerCase());
      }
    }
    await formatFile(input, output, {
      preset,
      colorScheme,
      fontFamily,
      removeHiddenCharacters,
      resourceLimits: limits,
    });
  } catch (error) {
    if (error instanceof PromptCancelledError) {
      io.stderr.write("\nCancelled.\n");
      return 130;
    }
    if (values.debug) {
      io.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      return 1;
    }
    if (isOperationalError(error)) return fail((error as Error).message);
    throw error;
  }
  io.stdout.write(`Formatted ${input} -> ${output}\n`);
  return 0;
}

function parseArguments(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
      diagnostics: { type: "boolean" },
      preset: { type: "string" },
      "color-scheme": { type: "string" },
      "font-family": { type: "string" },
      "max-input-bytes": { type: "string" },
      "max-pdf-pages": { type: "string" },
      "max-text-chars": { type: "string" },
      "max-decompressed-bytes": { type: "string" },
      "remove-hidden-characters": { type: "boolean" },
      "list-presets": { type: "boolean" },
      debug: { type: "boolean" },
    },
  });
}
