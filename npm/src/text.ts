// Helpers that reproduce Python's str.isspace/strip/splitlines so extraction matches the Python library.

const PY_WHITESPACE = new Set<number>([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000,
]);

export function isPySpace(codeUnit: number): boolean {
  return PY_WHITESPACE.has(codeUnit);
}

export function stripPy(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isPySpace(text.charCodeAt(start))) start++;
  while (end > start && isPySpace(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

export function trimEndPy(text: string): string {
  let end = text.length;
  while (end > 0 && isPySpace(text.charCodeAt(end - 1))) end--;
  return text.slice(0, end);
}

const LINE_BOUNDARY = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

export function splitLines(text: string): string[] {
  const lines = text.split(LINE_BOUNDARY);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Number of Unicode code points, which is how Python's len() counts characters. */
export function codePointLength(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index++;
    }
    length++;
  }
  return length;
}
