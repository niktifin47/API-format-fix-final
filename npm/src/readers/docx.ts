import { attribute, parseXml, readZipEntries } from "../archive.ts";
import { DocumentParseError } from "../errors.ts";
import { checkTextSize } from "../limits.ts";
import { createDocument } from "../models.ts";
import type { BlockKind, Document, DocumentBlock, ResourceLimits } from "../models.ts";
import { codePointLength, stripPy } from "../text.ts";

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

interface Styles {
  readonly names: Map<string, string>;
  defaultName: string;
}

function isOn(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "on";
}

function readStyles(xml: Uint8Array | undefined): Styles {
  const styles: Styles = { names: new Map(), defaultName: "normal" };
  if (!xml) return styles;

  let current: { id: string; isDefault: boolean } | null = null;
  parseXml(xml, "DOCX", {
    opentag(tag) {
      if (tag.uri !== WORD) return;
      if (tag.local === "style") {
        current =
          attribute(tag, WORD, "type") === "paragraph"
            ? {
                id: attribute(tag, WORD, "styleId") ?? "",
                isDefault: isOn(attribute(tag, WORD, "default")),
              }
            : null;
      } else if (tag.local === "name" && current) {
        const name = attribute(tag, WORD, "val");
        if (name !== undefined) {
          styles.names.set(current.id, name);
          if (current.isDefault) styles.defaultName = name;
        }
      }
    },
    closetag(tag) {
      if (tag.uri === WORD && tag.local === "style") current = null;
    },
  });
  return styles;
}

interface Paragraph {
  readonly depth: number;
  styleId: string | undefined;
  list: boolean;
  text: string;
}

/** Extract paragraphs, headings, and list items from a DOCX file; layout and embedded content are dropped. */
export function readDocx(data: Uint8Array, limits?: ResourceLimits | null): Document {
  const entries = readZipEntries(data, ["word/document.xml", "word/styles.xml"], "DOCX", limits);
  const documentXml = entries.get("word/document.xml");
  if (!documentXml) {
    throw new DocumentParseError("Could not read DOCX document: missing word/document.xml.");
  }
  const styles = readStyles(entries.get("word/styles.xml"));

  const blocks: DocumentBlock[] = [];
  let textSize = 0;
  const path: string[] = [];
  let current: Paragraph | null = null;
  let inPPr = false;
  let inText = false;
  let skipDepth = 0;

  const finish = (paragraph: Paragraph): void => {
    if (!stripPy(paragraph.text)) return;
    textSize += codePointLength(paragraph.text);
    checkTextSize(textSize, ".docx", limits);

    const styleName = (
      paragraph.styleId === undefined
        ? styles.defaultName
        : (styles.names.get(paragraph.styleId) ?? paragraph.styleId)
    ).toLowerCase();
    let kind: BlockKind = "paragraph";
    if (styleName.startsWith("heading")) {
      const level = Math.min(Number.parseInt(/\d+/.exec(styleName)?.[0] ?? "1", 10), 6);
      kind = `heading${level}` as BlockKind;
    } else if (styleName.includes("list") || paragraph.list) {
      kind = "list_item";
    }
    blocks.push({ kind, text: paragraph.text });
  };

  parseXml(documentXml, "DOCX", {
    opentag(tag) {
      path.push(tag.uri === WORD ? tag.local : "");
      if (skipDepth || tag.uri !== WORD) return;
      const depth = path.length;
      const insideRun = path[depth - 2] === "r";
      switch (tag.local) {
        case "txbxContent":
          skipDepth = depth;
          break;
        case "p":
          current ??= { depth, styleId: undefined, list: false, text: "" };
          break;
        case "pPr":
          if (current && depth === current.depth + 1) inPPr = true;
          break;
        case "pStyle":
          if (current && inPPr && depth === current.depth + 2) {
            current.styleId = attribute(tag, WORD, "val");
          }
          break;
        case "numPr":
          if (current && inPPr && depth === current.depth + 2) current.list = true;
          break;
        case "t":
          if (current && insideRun) inText = true;
          break;
        case "tab":
        case "ptab":
          if (current && insideRun) current.text += "\t";
          break;
        case "br":
          if (current && insideRun) {
            const type = attribute(tag, WORD, "type");
            if (type === undefined || type === "textWrapping") current.text += "\n";
          }
          break;
        case "cr":
          if (current && insideRun) current.text += "\n";
          break;
        case "noBreakHyphen":
          if (current && insideRun) current.text += "-";
          break;
      }
    },
    text(text) {
      if (inText && current && !skipDepth) current.text += text;
    },
    closetag(tag) {
      const depth = path.length;
      if (skipDepth) {
        if (depth === skipDepth) skipDepth = 0;
      } else if (tag.uri === WORD) {
        if (tag.local === "t") {
          inText = false;
        } else if (tag.local === "pPr" && current && depth === current.depth + 1) {
          inPPr = false;
        } else if (tag.local === "p" && current && depth === current.depth) {
          finish(current);
          current = null;
        }
      }
      path.pop();
    },
  });

  return createDocument(blocks);
}
