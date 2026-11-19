import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  COLOR_SCHEMES,
  FONT_FAMILIES,
  InvalidOptionError,
  ResourceLimitError,
  SUPPORTED_INPUT_FORMATS,
  SUPPORTED_OUTPUT_FORMATS,
  UnsupportedFormatError,
  DocumentParseError,
  formatContent,
  formatFile,
  getFormatCapabilities,
  inspectDocument,
  inspectFile,
  parseMarkdown,
  removeSuspiciousCharacters,
  renderDocument,
} from "../src/index.ts";
import { collectWarnings, withTempDir } from "./helpers.ts";

const sorted = (values: ReadonlySet<string>): string[] => [...values].sort();

test("format capabilities describe supported operations and optional packages", () => {
  const capabilities = getFormatCapabilities();

  assert.deepEqual(sorted(SUPPORTED_INPUT_FORMATS), [
    ".cv", ".docx", ".html", ".md", ".odt", ".pdf", ".rst", ".rtf", ".tex", ".txt",
  ]);
  assert.deepEqual(sorted(SUPPORTED_OUTPUT_FORMATS), [".cv", ".docx", ".html", ".md", ".pdf"]);
  assert.deepEqual(capabilities[".txt"], {
    extension: ".txt",
    canRead: true,
    canWrite: false,
    readDependency: null,
    writeDependency: null,
  });
  assert.equal(capabilities[".pdf"]?.readDependency, "pdfjs-dist");
  assert.equal(capabilities[".pdf"]?.writeDependency, "pdfkit");
  assert.equal(capabilities[".docx"]?.readDependency, null);
  assert.throws(() => {
    (capabilities as Record<string, unknown>)[".custom"] = {};
  }, TypeError);
  assert.throws(() => (SUPPORTED_OUTPUT_FORMATS as Set<string>).add(".doc"), TypeError);
  assert.equal(SUPPORTED_OUTPUT_FORMATS.has(".doc"), false);
});

test("built-in fonts and palettes can be selected", async () => {
  assert.ok(FONT_FAMILIES.filter((font) => font !== "Arial" && font !== "Times New Roman").length >= 20);
  assert.ok(Object.keys(COLOR_SCHEMES).length >= 102);
  const palettes = Array.from({ length: 100 }, (_, index) => {
    return COLOR_SCHEMES[`spectrum-${String(index + 1).padStart(3, "0")}`];
  });
  assert.equal(new Set(palettes.map((palette) => `${palette?.heading}${palette?.accent}`)).size, 100);

  const whiteContrast = (color: string): number => {
    const linear = [1, 3, 5].map((index) => {
      const channel = Number.parseInt(color.slice(index, index + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * (linear[0] as number) + 0.7152 * (linear[1] as number) + 0.0722 * (linear[2] as number);
    return 1.05 / (luminance + 0.05);
  };
  for (const palette of palettes) {
    assert.ok(whiteContrast(palette?.heading as string) >= 4.5);
    assert.ok(whiteContrast(palette?.accent as string) >= 4.5);
  }

  const rendered = await formatContent("# Styled", ".md", ".html", {
    colorScheme: "spectrum-100",
    fontFamily: "Inter",
  });

  assert.match(rendered, /font-family: Inter/);
  assert.ok(rendered.includes((COLOR_SCHEMES["spectrum-100"] as { heading: string }).heading));
});

test("extended text formats extract content", async () => {
  assert.equal(
    await formatContent("<h1>Visible</h1><script>hidden()</script><p>Text &amp; more</p>", ".html", ".md"),
    "# Visible\n\nText & more\n",
  );
  assert.equal(await formatContent("Title\n=====\n\nParagraph", ".rst", ".md"), "# Title\n\nParagraph\n");
  assert.equal(
    await formatContent("\\section{Title}\n\\textbf{Paragraph}", ".tex", ".md"),
    "# Title\n\nParagraph\n",
  );
});

test("hidden Unicode is reported and only removed when requested", async () => {
  await withTempDir(async (directory) => {
    const source = join(directory, "input.md");
    const destination = join(directory, "output.md");
    await writeFile(source, "Visible \u2066hidden\u2069\u00a0👩\u200d💻", "utf8");

    const findings = inspectDocument(parseMarkdown(await readFile(source, "utf8")));
    assert.deepEqual(
      findings.map((finding) => [finding.codepoint, finding.name]),
      [
        ["U+2066", "LEFT-TO-RIGHT ISOLATE"],
        ["U+2069", "POP DIRECTIONAL ISOLATE"],
        ["U+00A0", "NO-BREAK SPACE"],
      ],
    );
    assert.equal((await inspectFile(source)).length, 3);

    const { warnings } = await collectWarnings(() => formatFile(source, destination));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]?.message ?? "", /3 suspicious invisible\/control character\(s\).*Text is preserved/);
    assert.match(await readFile(destination, "utf8"), /\u2066/);

    await formatFile(source, destination, { removeHiddenCharacters: true });
    assert.equal(await readFile(destination, "utf8"), "Visible hidden 👩\u200d💻\n");
  });
});

test("suspicious character removal preserves emoji joiners and reports control characters", () => {
  assert.equal(removeSuspiciousCharacters(parseMarkdown("👩\u200d💻")).blocks[0]?.text, "👩\u200d💻");
  const [finding] = inspectDocument(parseMarkdown("a\u0007b"));
  assert.deepEqual(finding, {
    blockIndex: 0,
    offset: 1,
    codepoint: "U+0007",
    name: "UNNAMED CONTROL CHARACTER",
  });
});

test("resource limits reject oversized input and extracted text", async () => {
  await assert.rejects(
    formatContent("# Resume", ".md", ".html", { resourceLimits: { maxInputBytes: 4 } }),
    (error) => error instanceof ResourceLimitError && /maxInputBytes/.test(error.message),
  );
  await assert.rejects(
    formatContent("# Resume", ".md", ".html", { resourceLimits: { maxTextChars: 4 } }),
    (error) => error instanceof ResourceLimitError && /maxTextChars/.test(error.message),
  );
});

test("resource limits count UTF-8 bytes, code points, and cover file inputs", async () => {
  await withTempDir(async (directory) => {
    const source = join(directory, "input.md");
    await writeFile(source, "é", "utf8");

    assert.equal(await formatContent("é", ".md", ".md", { resourceLimits: { maxInputBytes: 2 } }), "é\n");
    await assert.rejects(
      formatContent("é", ".md", ".md", { resourceLimits: { maxInputBytes: 1 } }),
      ResourceLimitError,
    );
    await assert.rejects(
      formatFile(source, join(directory, "output.md"), { resourceLimits: { maxInputBytes: 1 } }),
      (error) => error instanceof ResourceLimitError && error.message.endsWith(`(input: ${source})`),
    );
    assert.equal(
      await formatContent("😀", ".md", ".md", { resourceLimits: { maxTextChars: 1 } }),
      "😀\n",
    );
  });
});

test("invalid resource limit values are rejected", async () => {
  for (const limit of [0, -1, 1.5, Number.NaN, "5" as unknown as number]) {
    await assert.rejects(
      formatContent("x", ".md", ".md", { resourceLimits: { maxTextChars: limit } }),
      InvalidOptionError,
    );
  }
});

test("CV input can be styled as HTML", async () => {
  await withTempDir(async (directory) => {
    const source = join(directory, "resume.cv");
    const destination = join(directory, "resume.html");
    await writeFile(source, "# Experience\n\n- Built useful tools", "utf8");

    await formatFile(source, destination, { preset: "friendly", colorScheme: "navy" });

    const rendered = await readFile(destination, "utf8");
    assert.match(rendered, /<h1>Experience<\/h1>/);
    assert.match(rendered, /<li>Built useful tools<\/li>/);
    assert.match(rendered, /#17365d/);
  });
});

test("formatFile accepts paths outside the working directory and returns the destination", async () => {
  await withTempDir(async (directory) => {
    const source = join(directory, "input.md");
    const destination = join(directory, "output.html");
    await writeFile(source, "# Summary", "utf8");

    assert.equal(await formatFile(source, destination), destination);
    assert.match(await readFile(destination, "utf8"), /<h1>Summary<\/h1>/);
  });
});

test("custom templates and palettes are supported", async () => {
  const rendered = await formatContent("A document.", ".md", ".html", {
    preset: { name: "custom", fontFamily: "Georgia", fontSizePt: 12.5, headingSizePt: 18, colorScheme: "custom" },
    colorScheme: { name: "custom", text: "#111111", heading: "#222222", accent: "#333333" },
  });

  assert.match(rendered, /font-family: Georgia, sans-serif/);
  assert.match(rendered, /font-size: 12.5pt/);
  assert.match(rendered, /#222222/);
  assert.match(rendered, /background: #ffffff/);
});

test("unknown presets and unsafe style values fail explicitly", async () => {
  await assert.rejects(formatContent("x", ".md", ".html", { preset: "unlisted" }), /Unknown preset 'unlisted'/);
  await assert.rejects(formatContent("x", ".md", ".html", { preset: "__proto__" }), InvalidOptionError);
  await assert.rejects(
    formatContent("x", ".md", ".html", { colorScheme: "constructor" }),
    /Unknown color scheme 'constructor'/,
  );
  await assert.rejects(
    formatContent("x", ".md", ".html", {
      colorScheme: { name: "unsafe", text: "#111111", heading: "</style><script>", accent: "#333333" },
    }),
    /six-digit hexadecimal/,
  );
  await assert.rejects(
    formatContent("x", ".md", ".html", { fontFamily: "Arial;} body{display:none" }),
    /Font family must contain only/,
  );
  await assert.rejects(
    formatContent("x", ".md", ".html", {
      preset: { name: "bad", fontFamily: "Arial", fontSizePt: 0, headingSizePt: 16, colorScheme: "navy" },
    }),
    /Font sizes must be positive finite numbers/,
  );
});

test("unsupported formats and wrong input types fail explicitly", async () => {
  await withTempDir(async (directory) => {
    const source = join(directory, "input.md");
    await writeFile(source, "A document.", "utf8");

    await assert.rejects(
      formatFile(source, join(directory, "output.doc")),
      (error) => error instanceof UnsupportedFormatError && /Unsupported output format '.doc'/.test(error.message),
    );
    await assert.rejects(formatFile(join(directory, "input.xyz"), join(directory, "o.md")), /Unsupported input format '.xyz'/);
    await assert.rejects(formatFile(source, join(directory, "output")), /\(no extension\)/);
  });
  await assert.rejects(formatContent("x", ".md", ".odt"), UnsupportedFormatError);
  await assert.rejects(formatContent("x", ".exe", ".md"), UnsupportedFormatError);
  await assert.rejects(formatContent("x", ".docx", ".md"), /Input for .docx must be bytes/);
  await assert.rejects(formatContent(42 as unknown as string, ".md", ".md"), TypeError);
  assert.throws(() => renderDocument(parseMarkdown("x"), ".docx"), UnsupportedFormatError);
});

test("invalid UTF-8 reports the byte offset", async () => {
  await assert.rejects(
    formatContent(new Uint8Array([0x61, 0x62, 0xff, 0x63]), ".md", ".md"),
    (error) => error instanceof DocumentParseError && /UTF-8 at byte offset 2/.test(error.message),
  );
  await assert.rejects(
    formatContent(new Uint8Array([0x61, 0xe2, 0x82]), ".txt", ".md"),
    /byte offset 1/,
  );
  assert.equal(await formatContent(new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41]), ".md", ".md"), "# A\n");
});

test("missing input files surface the file system error", async () => {
  await withTempDir(async (directory) => {
    await assert.rejects(
      formatFile(join(directory, "missing.md"), join(directory, "out.md")),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    await assert.rejects(stat(join(directory, "out.md")), { code: "ENOENT" });
  });
});
