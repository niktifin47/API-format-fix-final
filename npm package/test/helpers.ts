import { mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { strToU8, zipSync } from "fflate";
import PDFDocument from "pdfkit";

// Hidden-character warnings are expected in tests; keep them out of the test output.
process.removeAllListeners("warning");

export async function withTempDir<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "api-format-fix-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function collectWarnings<T>(
  run: () => Promise<T>,
): Promise<{ result: T; warnings: Error[] }> {
  const warnings: Error[] = [];
  const listener = (warning: Error): void => {
    warnings.push(warning);
  };
  process.on("warning", listener);
  try {
    const result = await run();
    await new Promise((resolve) => setImmediate(resolve));
    return { result, warnings };
  } finally {
    process.off("warning", listener);
  }
}

export function zip(entries: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, text]) => [name, strToU8(text)])));
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export function docx(bodyXml: string, stylesXml?: string): Uint8Array {
  return zip({
    "word/document.xml": `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    ...(stylesXml === undefined
      ? {}
      : { "word/styles.xml": `<w:styles xmlns:w="${W}">${stylesXml}</w:styles>` }),
  });
}

const OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";

export function odt(bodyXml: string, bodyElement = "office:text"): Uint8Array {
  return zip({
    mimetype: "application/vnd.oasis.opendocument.text",
    "content.xml":
      `<office:document-content xmlns:office="${OFFICE}" xmlns:text="${TEXT}">` +
      `<office:body><${bodyElement}>${bodyXml}</${bodyElement}></office:body></office:document-content>`,
  });
}

export function makePdf(
  draw: (pdf: InstanceType<typeof PDFDocument>) => void,
  options: ConstructorParameters<typeof PDFDocument>[0] = {},
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "LETTER", margin: 72, ...options });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    draw(pdf);
    pdf.end();
  });
}

/** Make `import()` of the named packages fail as if they were not installed. */
export function blockPackages(...names: string[]): () => void {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const blocked = names.find((name) => specifier === name || specifier.startsWith(`${name}/`));
      if (blocked) {
        throw Object.assign(
          new Error(`Cannot find package '${blocked}' imported from ${context.parentURL}`),
          { code: "ERR_MODULE_NOT_FOUND" },
        );
      }
      return nextResolve(specifier, context);
    },
  });
  return () => hooks.deregister();
}
