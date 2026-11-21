import { TextDecoder } from "node:util";

import { DocumentParseError } from "../errors.ts";
import { parseMarkdown } from "../parser.ts";
import type { Document } from "../models.ts";

// Windows code page number -> WHATWG label supported by Node's TextDecoder.
const CODE_PAGE_LABELS: Readonly<Record<number, string>> = {
  866: "ibm866",
  874: "windows-874",
  932: "shift_jis",
  936: "gbk",
  949: "euc-kr",
  950: "big5",
  1250: "windows-1250",
  1251: "windows-1251",
  1252: "windows-1252",
  1253: "windows-1253",
  1254: "windows-1254",
  1255: "windows-1255",
  1256: "windows-1256",
  1257: "windows-1257",
  1258: "windows-1258",
  10000: "macintosh",
  10007: "x-mac-cyrillic",
  20866: "koi8-r",
  21866: "koi8-u",
  28592: "iso-8859-2",
  28593: "iso-8859-3",
  28594: "iso-8859-4",
  28595: "iso-8859-5",
  28596: "iso-8859-6",
  28597: "iso-8859-7",
  28598: "iso-8859-8",
  28605: "iso-8859-15",
  65001: "utf-8",
};

function createDecoder(codePage: number): TextDecoder {
  try {
    return new TextDecoder(CODE_PAGE_LABELS[codePage] ?? "windows-1252");
  } catch {
    return new TextDecoder("windows-1252");
  }
}

// Control words that open a group whose content is metadata or non-body text.
const DESTINATIONS = new Set(
  (
    "aftncn aftnsep aftnsepc annotation atnauthor atndate atnicn atnid atnparent atnref atntime " +
    "atrfend atrfstart author background bkmkend bkmkstart blipuid buptim category " +
    "colorschememapping colortbl comment company creatim datafield datastore defchp defpap do " +
    "doccomm docvar dptxbxtext ebcend ebcstart factoidname falt fchars ffdeftext ffentrymcr " +
    "ffexitmcr ffformat ffhelptext ffl ffname ffstattext file filetbl fldinst fldtype fname " +
    "fontemb fontfile fonttbl footer footerf footerl footerr footnote formfield ftncn ftnsep " +
    "ftnsepc g generator gridtbl header headerf headerl headerr hl hlfr hlinkbase hlloc hlsrc " +
    "hsv htmltag info keycode keywords latentstyles lchars levelnumbers leveltext lfolevel " +
    "linkval list listlevel listname listoverride listoverridetable listpicture liststylename " +
    "listtable listtext lsdlockedexcept mailmerge manager mmath mmathpict nesttableprops " +
    "nextfile nonesttables objalias objclass objdata object objname objsect objtime oldcprops " +
    "oldpprops oldsprops oldtprops oleclsid operator panose password passwordhash pgp pgptbl " +
    "picprop pict pn pnseclvl pntext pntxta pntxtb printim private propname protend protstart " +
    "protusertbl pxe result revtbl revtim rsidtbl rxe shp shpgrp shpinst shppict shprslt shptxt " +
    "sn sp staticval stylesheet subject sv svb tc template themedata title txe ud upr " +
    "userprops wgrffmtfilter windowcaption writereservation writereservhash xe xform " +
    "xmlattrname xmlattrvalue xmlclose xmlname xmlnstbl xmlopen"
  ).split(" "),
);

const SPECIAL_WORDS: Readonly<Record<string, string>> = {
  par: "\n\n",
  sect: "\n\n",
  page: "\n\n",
  row: "\n\n",
  line: "\n",
  tab: "\t",
  cell: "\t",
  emdash: "\u2014",
  endash: "\u2013",
  emspace: "\u2003",
  enspace: "\u2002",
  qmspace: "\u2005",
  bullet: "\u2022",
  lquote: "\u2018",
  rquote: "\u2019",
  ldblquote: "\u201c",
  rdblquote: "\u201d",
};

const TOKEN =
  /\\([a-z]{1,32})(-?\d{1,10})?[ ]?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|[\r\n]+|(.)/gis;

function extractRtfText(rtf: string, decoder: TextDecoder): string {
  const out: string[] = [];
  const stack: Array<[number, boolean]> = [];
  let ignorable = false;
  let ucSkip = 1;
  let curSkip = 0;
  let pendingBytes: number[] = [];

  const flushBytes = (): void => {
    if (pendingBytes.length > 0) {
      out.push(decoder.decode(Uint8Array.from(pendingBytes)));
      pendingBytes = [];
    }
  };
  const emit = (text: string): void => {
    flushBytes();
    out.push(text);
  };

  for (const match of rtf.matchAll(TOKEN)) {
    const [, rawWord, arg, hex, symbol, brace, literal] = match;
    if (brace) {
      flushBytes();
      curSkip = 0;
      if (brace === "{") {
        stack.push([ucSkip, ignorable]);
      } else {
        const state = stack.pop();
        if (state) [ucSkip, ignorable] = state;
      }
    } else if (symbol) {
      curSkip = 0;
      if (symbol === "~") {
        if (!ignorable) emit("\u00a0");
      } else if (symbol === "{" || symbol === "}" || symbol === "\\") {
        if (!ignorable) emit(symbol);
      } else if (symbol === "-") {
        if (!ignorable) emit("\u00ad");
      } else if (symbol === "_") {
        if (!ignorable) emit("\u2011");
      } else if (symbol === "*") {
        ignorable = true;
      } else if (symbol === "\n" || symbol === "\r") {
        if (!ignorable) emit("\n\n");
      }
    } else if (rawWord) {
      curSkip = 0;
      const word = rawWord.toLowerCase();
      if (DESTINATIONS.has(word)) {
        ignorable = true;
      } else if (ignorable) {
        continue;
      } else if (Object.hasOwn(SPECIAL_WORDS, word)) {
        emit(SPECIAL_WORDS[word] as string);
      } else if (word === "uc") {
        if (arg !== undefined) ucSkip = Math.max(Number.parseInt(arg, 10), 0);
      } else if (word === "u" && arg !== undefined) {
        let unit = Number.parseInt(arg, 10);
        if (unit < 0) unit += 0x10000;
        emit(String.fromCharCode(unit & 0xffff));
        curSkip = ucSkip;
      }
    } else if (hex) {
      if (curSkip > 0) curSkip--;
      else if (!ignorable) pendingBytes.push(Number.parseInt(hex, 16));
    } else if (literal) {
      if (curSkip > 0) curSkip--;
      else if (!ignorable) emit(literal);
    }
  }
  flushBytes();
  return out.join("");
}

// Strips spaces and tabs before each newline without a regex, which would rescan long runs.
function stripTrailingBlanks(text: string): string {
  const lines = text.split("\n");
  const last = lines.length - 1;
  return lines
    .map((line, index) => {
      if (index === last) return line;
      let end = line.length;
      while (end > 0 && (line.charCodeAt(end - 1) === 0x20 || line.charCodeAt(end - 1) === 0x09)) end--;
      return line.slice(0, end);
    })
    .join("\n");
}

/** Extract text from RTF; formatting, images, and tables are dropped. */
export function readRtf(data: Uint8Array): Document {
  try {
    const declared = /\\ansicpg(\d+)/.exec(Buffer.from(data).toString("latin1"));
    const decoder = createDecoder(declared ? Number(declared[1]) : 1252);
    const text = stripTrailingBlanks(
      extractRtfText(decoder.decode(data), decoder).replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
    );
    return parseMarkdown(text);
  } catch (error) {
    throw new DocumentParseError(
      `Could not read RTF document: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
