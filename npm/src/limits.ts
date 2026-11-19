import { ResourceLimitError } from "./errors.ts";
import type { Document, ResourceLimits } from "./models.ts";
import { codePointLength } from "./text.ts";

export function checkInputSize(
  size: number,
  suffix: string,
  limits: ResourceLimits | null | undefined,
): void {
  const max = limits?.maxInputBytes;
  if (max != null && size > max) {
    throw new ResourceLimitError(
      `${suffix.toUpperCase()} input exceeds configured maxInputBytes (${max}).`,
    );
  }
}

export function checkTextSize(
  size: number,
  suffix: string,
  limits: ResourceLimits | null | undefined,
): void {
  const max = limits?.maxTextChars;
  if (max != null && size > max) {
    throw new ResourceLimitError(
      `${suffix.toUpperCase()} input extracts more than the configured maxTextChars (${max}).`,
    );
  }
}

export function checkDocumentTextSize(
  document: Document,
  suffix: string,
  limits: ResourceLimits | null | undefined,
): void {
  if (limits?.maxTextChars == null) return;
  let size = 0;
  for (const block of document.blocks) size += codePointLength(block.text);
  checkTextSize(size, suffix, limits);
}
