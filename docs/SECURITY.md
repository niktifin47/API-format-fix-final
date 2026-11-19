# Security notes

## Threat model and limits
- **Input is untrusted.** Parsers run on caller-provided files/bytes; malformed or hostile documents can trigger excessive CPU/memory use in third-party libraries (python-docx, pypdf, striprtf, odfpy, ReportLab, PDFBox on Android).
- **ResourceLimits are guardrails, not a sandbox.** They can reject oversized inputs/pages/text early, but they do not guarantee bounded intermediate allocations for every parser or format. For hostile files, run conversions in an isolated process/container with OS-level CPU, memory, and filesystem constraints.
- **Hidden-character scanning is not malware detection.** Findings highlight suspicious invisible/control characters for review; cleanup is opt-in. The library does not verify authenticity, detect exploits, or inspect images/signatures/embedded objects.
- **Path safety is the caller's responsibility.** ormat_file uses supplied paths; applications exposed to untrusted path input must constrain paths to allowed directories.

## Safe usage recommendations
- Set max_input_bytes, max_pdf_pages, and max_text_chars (and Android maxDecompressedBytes where applicable) for untrusted inputs.
- Install only required optional extras and keep dependencies updated; monitor upstream advisories.
- Disable interactive prompts in automation (--remove-hidden-characters when cleanup is intended) and handle errors without exposing sensitive paths/content.
- Review CodeQL and CI results independently; passing tests/builds are not a security guarantee.
