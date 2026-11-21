import { createDocument } from "./models.ts";
import type { Document } from "./models.ts";
import { SUSPICIOUS_CHARACTER_NAMES } from "./unicodeNames.ts";
import { isPySpace } from "./text.ts";

export interface HiddenCharacterFinding {
  readonly blockIndex: number;
  /** Offset in Unicode code points within the block text. */
  readonly offset: number;
  /** For example `U+2066`. */
  readonly codepoint: string;
  readonly name: string;
}

const CONTROL_OR_FORMAT = /^[\p{Cc}\p{Cf}\p{Cs}]$/u;
const ZERO_WIDTH_JOINER = 0x200d;

function isSuspicious(codePoint: number, character: string): boolean {
  if (codePoint >= 0x21 && codePoint <= 0x7e) return false;
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d || codePoint === 0x20) return false;
  if (codePoint === ZERO_WIDTH_JOINER) return false;
  return isPySpace(codePoint) || CONTROL_OR_FORMAT.test(character);
}

function isUnusualSpace(codePoint: number): boolean {
  return isPySpace(codePoint) && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d && codePoint !== 0x20;
}

function describe(codePoint: number): string {
  return SUSPICIOUS_CHARACTER_NAMES.get(codePoint) ?? "UNNAMED CONTROL CHARACTER";
}

/** Find invisible or control characters in extracted document text. */
export function inspectDocument(document: Document): readonly HiddenCharacterFinding[] {
  const findings: HiddenCharacterFinding[] = [];
  document.blocks.forEach((block, blockIndex) => {
    let offset = 0;
    for (const character of block.text) {
      const codePoint = character.codePointAt(0) as number;
      if (isSuspicious(codePoint, character)) {
        findings.push({
          blockIndex,
          offset,
          codepoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
          name: describe(codePoint),
        });
      }
      offset++;
    }
  });
  return findings;
}

/** Return a copy with controls removed and unusual whitespace normalized to a space. */
export function removeSuspiciousCharacters(document: Document): Document {
  return createDocument(
    document.blocks.map((block) => {
      let cleaned = "";
      for (const character of block.text) {
        const codePoint = character.codePointAt(0) as number;
        if (isUnusualSpace(codePoint)) cleaned += " ";
        else if (!isSuspicious(codePoint, character)) cleaned += character;
      }
      return { kind: block.kind, text: cleaned };
    }),
  );
}

export function warnIfSuspicious(document: Document): readonly HiddenCharacterFinding[] {
  const findings = inspectDocument(document);
  if (findings.length > 0) {
    const locations = findings
      .slice(0, 10)
      .map((finding) => `block ${finding.blockIndex + 1} offset ${finding.offset} (${finding.codepoint})`)
      .join(", ");
    const suffix = findings.length > 10 ? " (additional occurrences omitted)" : "";
    process.emitWarning(
      `Document contains ${findings.length} suspicious invisible/control character(s): ` +
        `${locations}${suffix}. Text is preserved unless explicitly removed.`,
      { type: "HiddenCharacterWarning", code: "API_FORMAT_FIX_HIDDEN_CHARACTERS" },
    );
  }
  return findings;
}
