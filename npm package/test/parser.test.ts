import assert from "node:assert/strict";
import { test } from "node:test";

import { DocumentParseError, parseHtml, parseMarkdown, parseRst, parseTex, renderDocument } from "../src/index.ts";
import type { Document } from "../src/index.ts";
import "./helpers.ts";

const blocks = (document: Document): Array<[string, string]> =>
  document.blocks.map((block) => [block.kind, block.text]);

test("parseMarkdown builds headings, paragraphs, and list items", () => {
  assert.deepEqual(blocks(parseMarkdown("# Resume\n\nTwo lines\ncontinued.\n\n- First\n- Second")), [
    ["heading1", "Resume"],
    ["paragraph", "Two lines continued."],
    ["list_item", "First"],
    ["list_item", "Second"],
  ]);
});

test("Markdown rendering round-trips supported blocks", () => {
  const document = parseMarkdown("# Profile\n\nExperienced engineer.\n\n- Python");

  assert.equal(
    renderDocument(document, ".md"),
    "# Profile\n\nExperienced engineer.\n\n- Python\n",
  );
});

test("ordered lists keep ordered markers", () => {
  assert.equal(renderDocument(parseMarkdown("1. First\n2) Second"), ".md"), "1. First\n2. Second\n");
});

test("heading syntax follows closing-hash and spacing rules", () => {
  assert.deepEqual(blocks(parseMarkdown("## Title ##\n#######  too deep\n#NoSpace\n# C#")), [
    ["heading2", "Title"],
    ["paragraph", "#######  too deep #NoSpace"],
    ["heading1", "C"],
  ]);
});

test("HTML output escapes document content and uses the selected palette", () => {
  const document = parseMarkdown("# <script>alert(1)</script>\n\n**Safe**");
  const rendered = renderDocument(document, "html", { preset: "friendly" });

  assert.doesNotMatch(rendered, /<script\b/i);
  assert.match(rendered, /&lt;script&gt;/);
  assert.match(rendered, /#00695c/);
  assert.match(rendered, /<strong>Safe<\/strong>/);
});

test("HTML input keeps visible text and drops scripts, styles, head, and comments", () => {
  const document = parseHtml(
    "<head><title>Hidden</title></head><h1>Visible</h1><script>hidden()</script>" +
      "<style>p{}</style><!-- note --><p>Text &amp; more<br>next line</p><template><p>no</p></template>",
  );

  assert.deepEqual(blocks(document), [
    ["heading1", "Visible"],
    ["paragraph", "Text & more next line"],
  ]);
});

test("reStructuredText and TeX inputs extract headings and prose", () => {
  assert.deepEqual(blocks(parseRst("Title\n=====\n\nParagraph")), [
    ["heading1", "Title"],
    ["paragraph", "Paragraph"],
  ]);
  assert.deepEqual(
    blocks(parseTex("\\section{Title}\n\\textbf{Paragraph} 50\\% of A\\&B % comment\n\\item Listed")),
    [
      ["heading1", "Title"],
      ["paragraph", "Paragraph 50% of A&B"],
      ["list_item", "Listed"],
    ],
  );
});

test("pathological whitespace does not cause quadratic parsing", () => {
  const padding = " ".repeat(200_000);
  const started = performance.now();

  const document = parseMarkdown(`# a${padding}x\n- b${padding}y\n#${padding}\n${padding}- z`);

  assert.ok(performance.now() - started < 2000, "parsing took too long");
  assert.deepEqual(
    document.blocks.map((block) => block.kind),
    ["heading1", "list_item", "paragraph", "list_item"],
  );
});

test("unclosed TeX arguments and deeply nested HTML do not cause quadratic parsing", () => {
  for (const source of ["\\a[".repeat(100_000), "\\section{".repeat(100_000), "\\begin[".repeat(100_000)]) {
    const started = performance.now();
    parseTex(source);
    assert.ok(performance.now() - started < 2000, `TeX parsing took ${performance.now() - started} ms`);
  }

  const started = performance.now();
  assert.throws(
    () => parseHtml("<div>".repeat(100_000) + "</b>".repeat(100_000)),
    (error) => error instanceof DocumentParseError && /nesting is deeper than 512 levels/.test(error.message),
  );
  assert.ok(performance.now() - started < 2000);
  assert.equal(parseHtml("<div>".repeat(500) + "text" + "</div>".repeat(500)).blocks.length, 1);
});
