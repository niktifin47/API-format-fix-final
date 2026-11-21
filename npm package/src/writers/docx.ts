import { strToU8, zipSync } from "fflate";

import type { Document } from "../models.ts";
import { headingSizePt } from "../style.ts";
import type { ResolvedStyle } from "../style.ts";

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PACKAGE_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOC_RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
// Date.UTC would shift with the time zone, because ZIP stores local-time fields. Local components
// keep the archive bytes identical everywhere; ZIP cannot store dates before 1980.
const ARCHIVE_TIME = new Date(1980, 0, 2, 12);

// XML 1.0 forbids most control characters and lone surrogates; they are replaced, not written.
const INVALID_XML_CHARACTER =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML_CHARACTER, "\ufffd")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function runs(text: string): string {
  let content = "";
  for (const part of text.split(/(\r\n|\r|\n|\t)/)) {
    if (part === "\t") content += "<w:tab/>";
    else if (part === "\n" || part === "\r" || part === "\r\n") content += "<w:br/>";
    else if (part) content += `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`;
  }
  return `<w:r>${content}</w:r>`;
}

const hex = (color: string): string => color.slice(1).toUpperCase();
const halfPoints = (points: number): number => Math.round(points * 2);

function stylesXml({ template, colors }: ResolvedStyle): string {
  const font = escapeXml(template.fontFamily);
  const fonts = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`;
  const size = halfPoints(template.fontSizePt);

  const headings = [1, 2, 3, 4, 5, 6]
    .map((level) => {
      const headingSize = halfPoints(headingSizePt(template, level));
      return (
        `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
        `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
        `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="80"/>` +
        `<w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
        `<w:rPr>${fonts}<w:b/><w:bCs/><w:color w:val="${hex(colors.heading)}"/>` +
        `<w:sz w:val="${headingSize}"/><w:szCs w:val="${headingSize}"/></w:rPr></w:style>`
      );
    })
    .join("");

  return (
    `${XML_HEADER}<w:styles xmlns:w="${WORD}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>${fonts}<w:color w:val="${hex(colors.text)}"/>` +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
    `</w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>` +
    `<w:rPr>${fonts}<w:color w:val="${hex(colors.text)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>` +
    headings +
    `<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/>` +
    `<w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/>` +
    `<w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>` +
    `</w:styles>`
  );
}

function numberingXml(orderedLists: number): string {
  const level = (format: string, text: string): string =>
    `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/>` +
    `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
  let numbers = `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
  for (let list = 0; list < orderedLists; list++) {
    numbers +=
      `<w:num w:numId="${list + 2}"><w:abstractNumId w:val="1"/>` +
      `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;
  }
  return (
    `${XML_HEADER}<w:numbering xmlns:w="${WORD}">` +
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${level("bullet", "\u2022")}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${level("decimal", "%1.")}</w:abstractNum>` +
    `${numbers}</w:numbering>`
  );
}

function listParagraph(style: string, numId: number, text: string): string {
  return (
    `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
    `${runs(text)}</w:p>`
  );
}

/** Build a DOCX archive containing the document text with the selected styles. */
export function renderDocx(document: Document, style: ResolvedStyle): Uint8Array {
  const body: string[] = [];
  let orderedLists = 0;
  let inOrderedList = false;
  for (const block of document.blocks) {
    if (block.kind === "ordered_item") {
      if (!inOrderedList) orderedLists++;
      inOrderedList = true;
      body.push(listParagraph("ListNumber", orderedLists + 1, block.text));
      continue;
    }
    inOrderedList = false;
    if (block.kind === "list_item") {
      body.push(listParagraph("ListBullet", 1, block.text));
    } else if (block.kind.startsWith("heading")) {
      const level = Math.min(Number(block.kind.slice("heading".length)), 6);
      body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>${runs(block.text)}</w:p>`);
    } else {
      body.push(`<w:p>${runs(block.text)}</w:p>`);
    }
  }

  const documentXml =
    `${XML_HEADER}<w:document xmlns:w="${WORD}"><w:body>${body.join("")}` +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
    `<w:pgMar w:top="1080" w:right="1800" w:bottom="1080" w:left="1800" w:header="720" w:footer="720" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`;

  const overrides = [
    ["/word/document.xml", "wordprocessingml.document.main"],
    ["/word/styles.xml", "wordprocessingml.styles"],
    ["/word/numbering.xml", "wordprocessingml.numbering"],
  ]
    .map(
      ([part, type]) =>
        `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`,
    )
    .join("");

  return zipSync(
    {
      "[Content_Types].xml": strToU8(
        `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`,
      ),
      "_rels/.rels": strToU8(
        `${XML_HEADER}<Relationships xmlns="${PACKAGE_RELS}">` +
          `<Relationship Id="rId1" Type="${DOC_RELS}/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
      "word/document.xml": strToU8(documentXml),
      "word/styles.xml": strToU8(stylesXml(style)),
      "word/numbering.xml": strToU8(numberingXml(orderedLists)),
      "word/_rels/document.xml.rels": strToU8(
        `${XML_HEADER}<Relationships xmlns="${PACKAGE_RELS}">` +
          `<Relationship Id="rId1" Type="${DOC_RELS}/styles" Target="styles.xml"/>` +
          `<Relationship Id="rId2" Type="${DOC_RELS}/numbering" Target="numbering.xml"/></Relationships>`,
      ),
    },
    { level: 6, mtime: ARCHIVE_TIME },
  );
}
