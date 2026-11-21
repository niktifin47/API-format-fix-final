import { importOptional } from "../optional.ts";
import type { Document } from "../models.ts";
import { headingSizePt } from "../style.ts";
import type { ResolvedStyle } from "../style.ts";

const PAGE_MARGIN = 72;
// Code points above Latin-1 that Windows-1252 (the encoding of PDF's built-in fonts) can represent.
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

// PDF's built-in fonts cannot draw other characters, so they are replaced instead of drawn as garbage.
function toBuiltInFontText(text: string): string {
  let output = "";
  for (const character of text.replace(/[\t\n\v\f\r ]+/g, " ").trim()) {
    const codePoint = character.codePointAt(0) as number;
    const drawable =
      (codePoint >= 0x20 && codePoint <= 0x7e) ||
      (codePoint >= 0xa0 && codePoint <= 0xff) ||
      WIN_ANSI_EXTRAS.has(codePoint);
    output += drawable ? character : "?";
  }
  return output;
}

/** Draw the document text with PDF's built-in Helvetica or Times fonts. */
export async function renderPdf(document: Document, style: ResolvedStyle): Promise<Uint8Array> {
  const { default: PDFDocument } = await importOptional(
    () => import("pdfkit"),
    "Writing PDF",
    "pdfkit",
  );
  const { template, colors } = style;
  const serif = template.fontFamily.toLowerCase().includes("times");
  const bodyFont = serif ? "Times-Roman" : "Helvetica";
  const boldFont = serif ? "Times-Bold" : "Helvetica-Bold";

  const pdf = new PDFDocument({ size: "LETTER", margin: PAGE_MARGIN });
  const chunks: Buffer[] = [];
  const finished = new Promise<Uint8Array>((resolve, reject) => {
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  const write = (
    text: string,
    font: string,
    size: number,
    color: string,
    spaceBefore: number,
    spaceAfter: number,
  ): void => {
    const content = toBuiltInFontText(text);
    if (!content) return;
    pdf.font(font).fontSize(size);
    if (spaceBefore && pdf.y > pdf.page.margins.top) pdf.y += spaceBefore;
    pdf.fillColor(color).text(content, {
      align: "left",
      lineGap: Math.max(0, size * 1.4 - pdf.currentLineHeight(true)),
    });
    pdf.y += spaceAfter;
  };

  try {
    let orderedNumber = 0;
    for (const block of document.blocks) {
      if (block.kind.startsWith("heading")) {
        orderedNumber = 0;
        const level = Math.min(Number(block.kind.slice("heading".length)), 6);
        write(block.text, boldFont, headingSizePt(template, level), colors.heading, 10, 6);
      } else if (block.kind === "list_item" || block.kind === "ordered_item") {
        let marker = "\u2022";
        if (block.kind === "ordered_item") marker = `${++orderedNumber}.`;
        else orderedNumber = 0;
        write(`${marker} ${block.text}`, bodyFont, template.fontSizePt, colors.text, 0, 3);
      } else {
        orderedNumber = 0;
        write(block.text, bodyFont, template.fontSizePt, colors.text, 0, 6);
      }
    }
  } catch (error) {
    finished.catch(() => undefined);
    pdf.end();
    throw error;
  }
  pdf.end();
  return finished;
}
