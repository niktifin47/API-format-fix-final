import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { unzipSync, strFromU8 } from "fflate";
import { SaxesParser } from "saxes";

import {
  DocumentParseError,
  MissingDependencyError,
  ResourceLimitError,
  formatContent,
  formatFile,
} from "../src/index.ts";
import { blockPackages, docx, makePdf, odt, withTempDir, zip } from "./helpers.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const support = (name: string): string => new URL(`./support/${name}`, import.meta.url).href;
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const run = (text: string, extra = ""): string => `<w:r>${extra}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (inner: string, properties = ""): string =>
  `<w:p>${properties && `<w:pPr>${properties}</w:pPr>`}${inner}</w:p>`;

async function elapsed(operation: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await operation().catch(() => undefined);
  return performance.now() - started;
}

// --- DOCX ---

test("DOCX output round-trips headings, lists, and styles", async () => {
  const source = "# Summary\n\nBody text.\n\n- First item\n\n1. One\n2. Two";

  const bytes = await formatContent(source, ".md", ".docx", { preset: "friendly" });

  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes.subarray(0, 2)], [0x50, 0x4b]);
  assert.equal(
    await formatContent(bytes, ".docx", ".md"),
    "# Summary\n\nBody text.\n\n- First item\n- One\n- Two\n",
  );
  const html = await formatContent(bytes, ".docx", ".html");
  assert.match(html, /<h1>Summary<\/h1>/);
  assert.match(html, /<li>First item<\/li>/);
});

test("DOCX output is well-formed, styled, and restarts each ordered list", async () => {
  const bytes = await formatContent("1. A\n2. B\n\nBreak\n\n1. C", ".md", ".docx", {
    preset: "friendly",
    colorScheme: "navy",
    fontFamily: "Inter",
  });

  const parts = unzipSync(bytes);
  assert.deepEqual(Object.keys(parts), [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/styles.xml",
    "word/numbering.xml",
    "word/_rels/document.xml.rels",
  ]);
  for (const [name, content] of Object.entries(parts)) {
    assert.doesNotThrow(() => new SaxesParser({ xmlns: true }).write(strFromU8(content)).close(), name);
  }
  const body = strFromU8(parts["word/document.xml"] as Uint8Array);
  assert.deepEqual([...body.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((match) => match[1]), ["2", "2", "3"]);
  const styles = strFromU8(parts["word/styles.xml"] as Uint8Array);
  assert.match(styles, /w:ascii="Inter"/);
  assert.match(styles, /w:color w:val="17365D"/);
});

test("DOCX output is reproducible and replaces characters XML cannot hold", async () => {
  const first = await formatContent("A\u0001B\ud800C & <d>\ttab", ".md", ".docx");
  const second = await formatContent("A\u0001B\ud800C & <d>\ttab", ".md", ".docx");

  assert.deepEqual(first, second);
  const body = strFromU8(unzipSync(first)["word/document.xml"] as Uint8Array);
  assert.match(body, /A\ufffdB\ufffdC &amp; &lt;d&gt;/);
  assert.match(body, /<w:tab\/>/);
  assert.equal(await formatContent(first, ".docx", ".md"), "A\ufffdB\ufffdC & <d>\ttab\n");
});

test("DOCX output bytes do not depend on the time zone", () => {
  const hashes = ["UTC", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati", "Etc/GMT+12"].map((zone) => {
    const result = spawnSync(process.execPath, [fileURLToPath(support("docx-hash.ts"))], {
      env: { ...process.env, TZ: zone },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  });

  assert.equal(new Set(hashes).size, 1, `hashes differ: ${hashes.join(", ")}`);
});

test("DOCX split runs preserve Unicode and HTML is escaped", async () => {
  const bytes = docx(paragraph(run("caf\u00e9 ") + run("&lt;script&gt;alert(1)&lt;/script&gt;")));

  const rendered = await formatContent(bytes, ".docx", ".html");

  assert.match(rendered, /<p>café &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/p>/);
  assert.doesNotMatch(rendered, /<script>/);
});

test("DOCX styles map to headings and lists", async () => {
  const styles =
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="H2"><w:name w:val="heading 2"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Bullets"><w:name w:val="List Bullet"/></w:style>' +
    '<w:style w:type="character" w:styleId="Strong"><w:name w:val="heading 9"/></w:style>';
  const bytes = docx(
    paragraph(run("Section"), '<w:pStyle w:val="H2"/>') +
      paragraph(run("Item"), '<w:pStyle w:val="Bullets"/>') +
      paragraph(run("Numbered"), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr>') +
      paragraph(run("Heading10"), '<w:pStyle w:val="Heading10"/>') +
      paragraph(run("Plain")) +
      paragraph(run("   ")),
    styles,
  );

  assert.equal(
    await formatContent(bytes, ".docx", ".md"),
    "## Section\n\n- Item\n- Numbered\n\n###### Heading10\n\nPlain\n",
  );
});

test("DOCX text keeps tabs and breaks but not tab stops, text boxes, or deleted text", async () => {
  const bytes = docx(
    paragraph(
      run("A") + "<w:r><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t><w:br w:type=\"page\"/><w:noBreakHyphen/></w:r>",
      '<w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>',
    ) +
      paragraph(
        run("Anchor") +
          "<w:r><w:pict><w:txbxContent><w:p><w:r><w:t>BoxText</w:t></w:r></w:p></w:txbxContent></w:pict></w:r>" +
          "<w:del><w:r><w:delText>Removed</w:delText></w:r></w:del>",
      ) +
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
  );

  const { readDocx } = await import("../src/readers/docx.ts");

  assert.deepEqual(
    readDocx(bytes).blocks.map((block) => block.text),
    ["A\tB\nC-", "Anchor", "Cell"],
  );
});

test("malformed DOCX files have concise format errors", async () => {
  await assert.rejects(
    formatContent(encode("not a DOCX"), ".docx", ".md"),
    (error) => error instanceof DocumentParseError && /^Could not read DOCX document/.test(error.message),
  );
  await assert.rejects(
    formatContent(docx("<w:p>"), ".docx", ".md"),
    /Could not read DOCX document/,
  );
  await assert.rejects(
    formatContent(
      zip({
        "word/document.xml":
          `<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]>` +
          `<w:document xmlns:w="${WORD_NS}"><w:body><w:p><w:r><w:t>&b;</w:t></w:r></w:p></w:body></w:document>`,
      }),
      ".docx",
      ".md",
    ),
    (error) => error instanceof DocumentParseError && /^Could not read DOCX document/.test(error.message),
  );
  await assert.rejects(
    formatContent(zip({ "other.xml": "<a/>" }), ".docx", ".md"),
    /missing word\/document\.xml/,
  );
});

test("deeply nested XML is rejected quickly instead of parsing in quadratic time", async () => {
  const depth = 100_000;
  const nestedDocx = docx("<w:p>".repeat(depth) + "</w:p>".repeat(depth));
  const nestedOdt = odt("<text:span>".repeat(depth) + "</text:span>".repeat(depth));

  for (const [bytes, format] of [[nestedDocx, ".docx"], [nestedOdt, ".odt"]] as const) {
    const time = await elapsed(() =>
      assert.rejects(
        formatContent(bytes, format, ".md"),
        (error) => error instanceof DocumentParseError && /nesting is deeper than 256 levels/.test(error.message),
      ),
    );
    assert.ok(time < 2000, `${format} took ${time} ms`);
  }
  const allowed = docx("<w:p>".repeat(200) + run("deep") + "</w:p>".repeat(200));
  assert.equal(await formatContent(allowed, ".docx", ".md"), "deep\n");
});

test("extracted text and decompressed size limits apply to DOCX", async () => {
  const bytes = await formatContent("# Summary", ".md", ".docx");

  await assert.rejects(
    formatContent(bytes, ".docx", ".md", { resourceLimits: { maxTextChars: 3 } }),
    /maxTextChars/,
  );
  await assert.rejects(
    formatContent(docx(paragraph(run("x".repeat(5000)))), ".docx", ".md", {
      resourceLimits: { maxDecompressedBytes: 1000 },
    }),
    (error) => error instanceof ResourceLimitError && /maxDecompressedBytes \(1000\)/.test(error.message),
  );
});

// --- ODT ---

test("ODT input extracts headings, paragraphs, spaces, tabs, and breaks", async () => {
  const bytes = odt(
    '<text:h text:outline-level="1">ODT title</text:h>' +
      '<text:h text:outline-level="9">Deep</text:h>' +
      "<text:p>ODT <text:span>text</text:span></text:p>" +
      '<text:p>a<text:s text:c="3"/>b<text:tab/>c<text:line-break/>d</text:p>' +
      "<text:list><text:list-item><text:p>Listed</text:p></text:list-item></text:list>" +
      "<text:p>   </text:p>",
  );

  const { readOdt } = await import("../src/readers/odt.ts");

  assert.deepEqual(
    readOdt(bytes).blocks.map((block) => [block.kind, block.text]),
    [
      ["heading1", "ODT title"],
      ["heading6", "Deep"],
      ["paragraph", "ODT text"],
      ["paragraph", "a   b\tc\nd"],
      ["paragraph", "Listed"],
    ],
  );
  assert.equal(await formatContent(bytes, ".odt", ".md"), "# ODT title\n\n###### Deep\n\nODT text\n\na   b\tc\nd\n\nListed\n");
});

test("ODT input ignores non-text bodies and bounds space expansion", async () => {
  const { readOdt } = await import("../src/readers/odt.ts");

  assert.equal(readOdt(odt("<text:p>Cell</text:p>", "office:spreadsheet")).blocks.length, 0);
  const [bomb] = readOdt(odt('<text:p>x<text:s text:c="999999999"/>y</text:p>')).blocks;
  assert.ok((bomb?.text.length ?? Infinity) <= 1002);
});

test("malformed ODT is reported with format context", async () => {
  await assert.rejects(
    formatContent(encode("not an ODT archive"), ".odt", ".md"),
    (error) => error instanceof DocumentParseError && /^Could not read ODT document/.test(error.message),
  );
  await assert.rejects(formatContent(odt("<text:p>"), ".odt", ".md"), /Could not read ODT document/);
  await assert.rejects(
    formatContent(odt("<text:p>abcdef</text:p>"), ".odt", ".md", { resourceLimits: { maxDecompressedBytes: 50 } }),
    ResourceLimitError,
  );
});

// --- RTF ---

test("RTF input extracts text and drops formatting and metadata groups", async () => {
  assert.match(await formatContent(encode("{\\rtf1\\ansi {\\b Bold} text\\par}"), ".rtf", ".md"), /^Bold text\n$/);
  assert.equal(
    await formatContent(
      encode(
        "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0;}{\\*\\generator Word}{\\info{\\title Secret}}" +
          "First\\par Second \\{braced\\} \\\\ \\u8364? \\uc0\\u233 \\par}",
      ),
      ".rtf",
      ".md",
    ),
    "First\n\nSecond {braced} \\ € é\n",
  );
});

for (const [name, header, bytes, text] of [
  ["Windows-1252", "\\ansi\\ansicpg1252 ", [0x63, 0x61, 0x66, 0xe9], "café"],
  ["Windows-1251", "\\ansi\\ansicpg1251 ", [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2], "Привет"],
  ["default code page", "\\ansi ", [0x63, 0x61, 0x66, 0xe9], "café"],
] as const) {
  test(`RTF input decodes ${name} text`, async () => {
    const source = new Uint8Array([...encode(`{\\rtf1${header}`), ...bytes, ...encode("}")]);

    assert.equal(await formatContent(source, ".rtf", ".md"), `${text}\n`);
  });
}

test("RTF hex escapes use the declared code page, including inside groups", async () => {
  const hex = [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2].map((byte) => `\\'${byte.toString(16)}`).join("");

  assert.equal(
    await formatContent(encode(`{\\rtf1\\ansi\\ansicpg1251 {\\b ${hex}}\\par}`), ".rtf", ".md"),
    "Привет\n",
  );
});

test("RTF input is tolerant of unknown code pages and unbalanced groups", async () => {
  assert.equal(await formatContent(encode("{\\rtf1\\ansi\\ansicpg999999 text}"), ".rtf", ".md"), "text\n");
  assert.equal(await formatContent(encode("{\\rtf1 a}}}b"), ".rtf", ".md"), "ab\n");
});

test("RTF input ignores control words that match Object.prototype names", async () => {
  assert.equal(
    await formatContent(encode("{\\rtf1\\ansi Hello \\constructor \\CONSTRUCTOR world}"), ".rtf", ".md"),
    "Hello world\n",
  );
});

test("RTF input with long whitespace runs is parsed in linear time", async () => {
  const source = encode(`{\\rtf1 a${" ".repeat(200_000)}b\\par ${"\t".repeat(100_000)}c}`);

  const time = await elapsed(() => formatContent(source, ".rtf", ".md"));

  assert.ok(time < 2000, `took ${time} ms`);
});

test("RTF input respects maxInputBytes", async () => {
  await assert.rejects(
    formatContent(encode("{\\rtf1\\ansi text}"), ".rtf", ".md", { resourceLimits: { maxInputBytes: 4 } }),
    /maxInputBytes/,
  );
});

// --- PDF ---

test("PDF output and input round-trip text", async () => {
  const pdf = await formatContent("# Summary\n\n- First item\n\nParagraph text.", ".md", ".pdf", {
    preset: "friendly",
  });

  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString("latin1"), "%PDF-");
  const markdown = await formatContent(pdf, ".pdf", ".md");
  assert.match(markdown, /Summary/);
  assert.match(markdown, /First item/);
  assert.match(markdown, /Paragraph text\./);
});

test("PDF output draws document text literally and replaces unsupported characters", async () => {
  const pdf = await formatContent(
    "<b>x</b> & <script>alert(1)</script> café — “quoted” Привет 😀",
    ".md",
    ".pdf",
    { preset: "formal" },
  );

  assert.equal(
    await formatContent(pdf, ".pdf", ".md"),
    "<b>x</b> & <script>alert(1)</script> café — “quoted” ?????? ?\n",
  );
});

test("extracted text and page limits apply to PDF", async () => {
  const pdf = await formatContent("# Summary", ".md", ".pdf");
  const long = await formatContent(
    Array.from({ length: 120 }, (_, index) => `Paragraph ${index}`).join("\n\n"),
    ".md",
    ".pdf",
  );

  await assert.rejects(
    formatContent(pdf, ".pdf", ".md", { resourceLimits: { maxTextChars: 3 } }),
    /maxTextChars/,
  );
  await assert.rejects(
    formatContent(long, ".pdf", ".md", { resourceLimits: { maxPdfPages: 1 } }),
    (error) => error instanceof ResourceLimitError && /PDF contains \d+ pages; configured maxPdfPages is 1/.test(error.message),
  );
});

test("encrypted PDFs are rejected with format context", async () => {
  const withPassword = await makePdf((pdf) => pdf.text("secret"), {
    userPassword: "secret",
    ownerPassword: "secret",
  });
  const ownerOnly = await makePdf((pdf) => pdf.text("restricted"), {
    ownerPassword: "owner",
    permissions: { copying: false },
  });

  for (const encrypted of [withPassword, ownerOnly]) {
    await assert.rejects(
      formatContent(encrypted, ".pdf", ".md"),
      (error) => error instanceof DocumentParseError && /encrypted PDFs are not supported/.test(error.message),
    );
  }
});

test("scanned PDFs without a text layer produce empty text", async () => {
  assert.equal(await formatContent(await makePdf(() => undefined), ".pdf", ".md"), "");
});

test("malformed PDFs have concise errors that include the source path", async () => {
  await withTempDir(async (directory) => {
    const source = join(directory, "broken.pdf");
    await writeFile(source, "not a PDF");

    await assert.rejects(
      formatFile(source, join(directory, "output.md")),
      (error) =>
        error instanceof DocumentParseError &&
        /missing %PDF- header/.test(error.message) &&
        error.message.includes("broken.pdf"),
    );
  });
  await assert.rejects(formatContent(encode("%PDF-1.7\n"), ".pdf", ".md"), /missing %%EOF marker/);
  await assert.rejects(
    formatContent(encode("%PDF-1.7\nbroken\n%%EOF"), ".pdf", ".md"),
    (error) => error instanceof DocumentParseError && /^Could not read PDF document/.test(error.message),
  );
});

// --- Optional dependencies ---

test("missing optional packages produce actionable errors", async () => {
  const pdf = await formatContent("# Resume", ".md", ".pdf");

  for (const [packageName, operation] of [
    ["pdfkit", () => formatContent("# Resume", ".md", ".pdf")],
    ["pdfjs-dist", () => formatContent(pdf, ".pdf", ".md")],
  ] as const) {
    const restore = blockPackages(packageName);
    try {
      await assert.rejects(
        operation(),
        (error) =>
          error instanceof MissingDependencyError &&
          error.packageName === packageName &&
          error.message.includes(`npm install ${packageName}`),
      );
    } finally {
      restore();
    }
  }
  assert.match(await formatContent(pdf, ".pdf", ".md"), /Resume/);
});

test("Markdown, HTML, and DOCX work without the optional PDF packages installed", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", support("block-pdf-packages.ts"), fileURLToPath(support("lazy-import.ts"))],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { pdfkitBlocked: true, html: true, docx: true });
});
