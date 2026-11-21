import { unzipSync } from "fflate";
import { SaxesParser } from "saxes";
import type { SaxesTagNS } from "saxes";

import { ApiFormatFixError, DocumentParseError, ResourceLimitError } from "./errors.ts";
import type { ResourceLimits } from "./models.ts";

export type { SaxesTagNS };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read selected entries from a ZIP archive. Only the requested entries are inflated, and a declared
 * size above `maxDecompressedBytes` is rejected before any allocation.
 */
export function readZipEntries(
  data: Uint8Array,
  wanted: readonly string[],
  format: string,
  limits?: ResourceLimits | null,
): Map<string, Uint8Array> {
  const limit = limits?.maxDecompressedBytes ?? undefined;
  try {
    const files = unzipSync(data, {
      filter(file) {
        if (!wanted.includes(file.name)) return false;
        if (limit !== undefined && file.originalSize > limit) {
          throw new ResourceLimitError(
            `${format} part ${file.name} exceeds configured maxDecompressedBytes (${limit}).`,
          );
        }
        return true;
      },
    });
    return new Map(Object.entries(files));
  } catch (error) {
    if (error instanceof ApiFormatFixError) throw error;
    throw new DocumentParseError(`Could not read ${format} document: ${describeError(error)}`, {
      cause: error,
    });
  }
}

const utf8 = new TextDecoder("utf-8");

// saxes resolves namespaces in time proportional to the nesting depth, so unbounded depth is quadratic.
const MAX_XML_DEPTH = 256;

export interface XmlHandlers {
  readonly opentag?: (tag: SaxesTagNS) => void;
  readonly closetag?: (tag: SaxesTagNS) => void;
  /** Called for both character data and CDATA sections. */
  readonly text?: (text: string) => void;
}

/** Stream XML through a namespace-aware parser; errors from handlers propagate unchanged. */
export function parseXml(source: Uint8Array, format: string, handlers: XmlHandlers): void {
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  parser.on("opentag", (tag) => {
    if (++depth > MAX_XML_DEPTH) {
      throw new DocumentParseError(
        `Could not read ${format} document: XML nesting is deeper than ${MAX_XML_DEPTH} levels.`,
      );
    }
    handlers.opentag?.(tag);
  });
  parser.on("closetag", (tag) => {
    handlers.closetag?.(tag);
    depth--;
  });
  if (handlers.text) {
    parser.on("text", handlers.text);
    parser.on("cdata", handlers.text);
  }
  try {
    parser.write(utf8.decode(source)).close();
  } catch (error) {
    if (error instanceof ApiFormatFixError) throw error;
    throw new DocumentParseError(`Could not read ${format} document: ${describeError(error)}`, {
      cause: error,
    });
  }
}

export function attribute(tag: SaxesTagNS, namespace: string, local: string): string | undefined {
  for (const candidate of Object.values(tag.attributes)) {
    if (candidate.uri === namespace && candidate.local === local) return candidate.value;
  }
  return undefined;
}
