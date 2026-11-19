import { DocumentParseError, ResourceLimitError } from "../errors.ts";
import { checkTextSize } from "../limits.ts";
import { importOptional } from "../optional.ts";
import { parseMarkdown } from "../parser.ts";
import type { Document, ResourceLimits } from "../models.ts";
import { codePointLength } from "../text.ts";

const ENCRYPTED = "Could not read PDF document: encrypted PDFs are not supported.";

function validateEnvelope(data: Uint8Array): void {
  const header = Buffer.from(data.subarray(0, 1024)).toString("latin1");
  const trailer = Buffer.from(data.subarray(Math.max(0, data.length - 1024))).toString("latin1");
  if (!header.includes("%PDF-")) {
    throw new DocumentParseError("Could not read PDF document: missing %PDF- header.");
  }
  if (!trailer.includes("%%EOF")) {
    throw new DocumentParseError("Could not read PDF document: missing %%EOF marker.");
  }
}

/** Extract the text layer of a PDF. Scanned PDFs without text produce an empty document; there is no OCR. */
export async function readPdf(data: Uint8Array, limits?: ResourceLimits | null): Promise<Document> {
  validateEnvelope(data);
  const pdfjs = await importOptional(
    () => import("pdfjs-dist/legacy/build/pdf.mjs"),
    "Reading PDF",
    "pdfjs-dist",
  );

  // isEvalSupported only exists in pdfjs-dist 5.x; it is disabled there to avoid dynamic code evaluation.
  const parameters = {
    data: new Uint8Array(data),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    verbosity: 0,
  };
  const task = pdfjs.getDocument(parameters);
  try {
    const pdf = await task.promise;
    if ((await pdf.getPermissions()) !== null) throw new DocumentParseError(ENCRYPTED);

    const maxPages = limits?.maxPdfPages;
    if (maxPages != null && pdf.numPages > maxPages) {
      throw new ResourceLimitError(
        `PDF contains ${pdf.numPages} pages; configured maxPdfPages is ${maxPages}.`,
      );
    }

    const pages: string[] = [];
    let textSize = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) {
          text += item.str;
          if (item.hasEOL) text += "\n";
        }
      }
      page.cleanup();
      textSize += codePointLength(text);
      checkTextSize(textSize, ".pdf", limits);
      pages.push(text);
    }
    return parseMarkdown(pages.join("\n\n"));
  } catch (error) {
    if (error instanceof DocumentParseError || error instanceof ResourceLimitError) throw error;
    if (error instanceof Error && error.name === "PasswordException") {
      throw new DocumentParseError(ENCRYPTED, { cause: error });
    }
    throw new DocumentParseError(
      `Could not read PDF document: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    await task.destroy();
  }
}
