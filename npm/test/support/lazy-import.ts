// Runs in a fresh process so a static import of an optional package would be detected.
let pdfkitBlocked = false;
try {
  await import("pdfkit");
} catch {
  pdfkitBlocked = true;
}

const { formatContent } = await import("../../src/index.ts");
const html = await formatContent("# Resume", ".md", ".html");
const docx = await formatContent("# Resume", ".md", ".docx");
const markdown = await formatContent(docx, ".docx", ".md");

console.log(
  JSON.stringify({ pdfkitBlocked, html: html.includes("<h1>Resume</h1>"), docx: markdown === "# Resume\n" }),
);
