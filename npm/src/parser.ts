import { Parser } from "htmlparser2";

import { DocumentParseError } from "./errors.ts";
import { createDocument } from "./models.ts";
import type { BlockKind, Document, DocumentBlock } from "./models.ts";
import { isPySpace, splitLines, stripPy } from "./text.ts";

const HASH = 0x23;
const DECIMAL_DIGIT = /^\p{Nd}$/u;

function isDecimalDigit(codePoint: number): boolean {
  if (codePoint >= 0x30 && codePoint <= 0x39) return true;
  return codePoint > 0x7f && DECIMAL_DIGIT.test(String.fromCodePoint(codePoint));
}

// Equivalent to /^(#{1,6})\s+(.+?)\s*#*\s*$/ without regex backtracking on long whitespace runs.
function matchHeading(stripped: string): { level: number; text: string } | null {
  let level = 0;
  while (level < stripped.length && stripped.charCodeAt(level) === HASH) level++;
  if (level < 1 || level > 6 || !isPySpace(stripped.charCodeAt(level))) return null;

  let start = level;
  while (start < stripped.length && isPySpace(stripped.charCodeAt(start))) start++;
  if (start >= stripped.length) return null;

  let end = stripped.length;
  while (end > start && isPySpace(stripped.charCodeAt(end - 1))) end--;
  while (end > start && stripped.charCodeAt(end - 1) === HASH) end--;
  while (end > start && isPySpace(stripped.charCodeAt(end - 1))) end--;
  if (end === start) end = start + 1;
  return { level, text: stripped.slice(start, end) };
}

// Equivalent to /^\s*([-*+]|\d+[.)])\s+(.+?)\s*$/ without regex backtracking on long whitespace runs.
function matchListItem(line: string): { ordered: boolean; text: string } | null {
  let index = 0;
  while (index < line.length && isPySpace(line.charCodeAt(index))) index++;

  let ordered = false;
  const first = line[index];
  if (first === "-" || first === "*" || first === "+") {
    index++;
  } else {
    const digitsStart = index;
    while (index < line.length) {
      const codePoint = line.codePointAt(index) as number;
      if (!isDecimalDigit(codePoint)) break;
      index += codePoint > 0xffff ? 2 : 1;
    }
    const marker = line[index];
    if (index === digitsStart || (marker !== "." && marker !== ")")) return null;
    index++;
    ordered = true;
  }

  if (!isPySpace(line.charCodeAt(index))) return null;
  const markerEnd = index;
  while (index < line.length && isPySpace(line.charCodeAt(index))) index++;
  let end = line.length;
  while (end > index && isPySpace(line.charCodeAt(end - 1))) end--;
  if (end <= index) {
    // The Python regex lets a marker followed by 2+ whitespace characters keep the last one as text.
    return index - markerEnd >= 2 ? { ordered, text: line.charAt(index - 1) } : null;
  }
  return { ordered, text: line.slice(index, end) };
}

/** Parse headings, paragraphs, and simple list items into document blocks. */
export function parseMarkdown(text: string): Document {
  const blocks: DocumentBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  for (const line of splitLines(text)) {
    const stripped = stripPy(line);
    if (!stripped) {
      flushParagraph();
      continue;
    }

    const heading = matchHeading(stripped);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: `heading${heading.level}` as BlockKind, text: heading.text });
      continue;
    }

    const listItem = matchListItem(line);
    if (listItem) {
      flushParagraph();
      blocks.push({ kind: listItem.ordered ? "ordered_item" : "list_item", text: listItem.text });
      continue;
    }

    paragraph.push(stripped);
  }

  flushParagraph();
  return createDocument(blocks);
}

const HTML_BLOCK_TAGS = new Set([
  "address",
  "article",
  "blockquote",
  "br",
  "div",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "p",
  "section",
  "tr",
]);
const HTML_IGNORED_TAGS = new Set(["script", "style", "template", "head"]);
const HTML_HEADING_TAG = /^h[1-6]$/;
// htmlparser2 does work proportional to the open-element depth for every tag, so unbounded
// nesting is quadratic. Browsers also stop nesting at this depth.
const MAX_HTML_DEPTH = 512;

/** Extract visible text from HTML without interpreting markup as document content. */
export function parseHtml(text: string): Document {
  const parts: string[] = [];
  let ignoredDepth = 0;
  let depth = 0;

  const parser = new Parser({
    onopentag(name) {
      if (++depth > MAX_HTML_DEPTH) {
        throw new DocumentParseError(
          `Could not read HTML document: element nesting is deeper than ${MAX_HTML_DEPTH} levels.`,
        );
      }
      if (HTML_IGNORED_TAGS.has(name)) {
        ignoredDepth++;
      } else if (!ignoredDepth && HTML_HEADING_TAG.test(name)) {
        parts.push(`\n${"#".repeat(Number(name[1]))} `);
      } else if (!ignoredDepth && HTML_BLOCK_TAGS.has(name)) {
        parts.push("\n");
      }
    },
    onclosetag(name, isImplied) {
      depth--;
      if (HTML_IGNORED_TAGS.has(name) && ignoredDepth) {
        ignoredDepth--;
      } else if (!ignoredDepth && !isImplied && HTML_BLOCK_TAGS.has(name)) {
        parts.push("\n");
      }
    },
    ontext(data) {
      if (!ignoredDepth) parts.push(data);
    },
  });
  parser.write(text);
  parser.end();
  return parseMarkdown(parts.join(""));
}

const RST_ADORNMENTS = "=-~^\"`:+#*";

/** Parse common reStructuredText sections and list markers as plain document blocks. */
export function parseRst(text: string): Document {
  const lines = splitLines(text);
  const converted: string[] = [];
  let headingLevel = 0;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    if (index + 1 < lines.length) {
      const underline = stripPy(lines[index + 1] as string);
      if (
        stripPy(line) &&
        underline &&
        new Set(underline).size === 1 &&
        RST_ADORNMENTS.includes(underline[0] as string)
      ) {
        headingLevel++;
        converted.push(`${"#".repeat(Math.min(headingLevel, 6))} ${stripPy(line)}`);
        index += 2;
        continue;
      }
    }
    converted.push(line);
    index++;
  }
  return parseMarkdown(converted.join("\n"));
}

const TEX_SECTION_LEVELS: Readonly<Record<string, number>> = {
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
};

/** Extract plain prose and common section/list commands from a TeX source file. */
export function parseTex(source: string): Document {
  let text = source.replace(/(?<!\\)%[^\n]*/g, "");
  // Arguments are bounded so that an unclosed bracket or brace cannot rescan the rest of the file
  // from every command, which would make the patterns quadratic.
  text = text.replace(
    /\\(?:documentclass|usepackage|begin|end)\s*(?:\[[^\]]{0,1000}\]\s*)?\{[^}]{0,1000}\}/g,
    "",
  );
  text = text.replace(
    /\\(section|subsection|subsubsection|paragraph)\*?\s*\{([^}]{0,1000})\}/g,
    (_match, name: string, title: string) => `${"#".repeat(TEX_SECTION_LEVELS[name] as number)} ${title}`,
  );
  text = text.replace(/\\item(?:\s*\[[^\]]{0,1000}\])?\s*/g, "- ");
  text = text.replace(/\\(?:textbf|textit|emph|underline)\s*\{([^{}]{0,1000})\}/g, "$1");
  text = text.replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]{0,1000}\])?/g, "");
  text = text.replaceAll("{", "").replaceAll("}", "");
  text = text.replace(/(?<!\\)~/g, " ").replaceAll("\\%", "%").replaceAll("\\&", "&");
  return parseMarkdown(text);
}
