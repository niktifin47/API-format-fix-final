import { attribute, parseXml, readZipEntries } from "../archive.ts";
import { DocumentParseError } from "../errors.ts";
import { checkTextSize } from "../limits.ts";
import { createDocument } from "../models.ts";
import type { BlockKind, Document, DocumentBlock, ResourceLimits } from "../models.ts";
import { codePointLength, stripPy } from "../text.ts";

const OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
// A single text:s element never needs to expand to more than this many spaces.
const MAX_SPACES_PER_ELEMENT = 1000;

interface Block {
  readonly depth: number;
  readonly kind: BlockKind;
  text: string;
}

function headingKind(value: string | undefined): BlockKind {
  const parsed = Number.parseInt(value ?? "1", 10);
  const level = Number.isNaN(parsed) ? 1 : Math.min(Math.max(parsed, 1), 6);
  return `heading${level}` as BlockKind;
}

function spaceCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isNaN(parsed) ? 1 : Math.min(Math.max(parsed, 0), MAX_SPACES_PER_ELEMENT);
}

/** Extract headings and paragraphs from an ODT file; layout and embedded content are dropped. */
export function readOdt(data: Uint8Array, limits?: ResourceLimits | null): Document {
  const entries = readZipEntries(data, ["content.xml"], "ODT", limits);
  const content = entries.get("content.xml");
  if (!content) throw new DocumentParseError("Could not read ODT document: missing content.xml.");

  const blocks: DocumentBlock[] = [];
  let textSize = 0;
  let depth = 0;
  let bodyDepth = 0;
  let bodyDone = false;
  let current: Block | null = null;

  parseXml(content, "ODT", {
    opentag(tag) {
      depth++;
      if (!bodyDepth) {
        if (!bodyDone && tag.uri === OFFICE && tag.local === "text") bodyDepth = depth;
        return;
      }
      if (tag.uri !== TEXT) return;
      switch (tag.local) {
        case "h":
          current ??= {
            depth,
            kind: headingKind(attribute(tag, TEXT, "outline-level")),
            text: "",
          };
          break;
        case "p":
          current ??= { depth, kind: "paragraph", text: "" };
          break;
        case "s":
          if (current) current.text += " ".repeat(spaceCount(attribute(tag, TEXT, "c")));
          break;
        case "tab":
          if (current) current.text += "\t";
          break;
        case "line-break":
          if (current) current.text += "\n";
          break;
      }
    },
    text(text) {
      if (current) current.text += text;
    },
    closetag() {
      if (current && depth === current.depth) {
        const text = stripPy(current.text);
        if (text) {
          textSize += codePointLength(text);
          checkTextSize(textSize, ".odt", limits);
          blocks.push({ kind: current.kind, text });
        }
        current = null;
      }
      if (depth === bodyDepth) {
        bodyDepth = 0;
        bodyDone = true;
      }
      depth--;
    },
  });

  return createDocument(blocks);
}
