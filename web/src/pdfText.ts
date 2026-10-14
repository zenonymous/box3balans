// The text of a PDF, read in the browser: the file itself never leaves it. pdf.js is loaded only
// when a PDF is chosen.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { t } from "./i18n";

export interface PdfPage {
  page: number;
  text: string;
}

/** A piece of text on a page: where it starts (x, y up from the bottom), its width and its height. */
export interface Piece {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_PAGES = 100;

/**
 * Puts a page's pieces of text back into lines, top to bottom and left to right. A wide gap becomes
 * a few spaces, so columns stay apart (as with `pdftotext -layout`).
 */
export function toLines(pieces: Piece[]): string {
  const sorted = pieces.filter((p) => p.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Piece[][] = [];
  for (const p of sorted) {
    const line = lines.at(-1);
    // On the same line: less than half a line height apart.
    if (line && Math.abs(line[0]!.y - p.y) < Math.max(1, Math.min(line[0]!.h, p.h) / 2)) line.push(p);
    else lines.push([p]);
  }
  return lines
    .map((line) => {
      line.sort((a, b) => a.x - b.x);
      let out = "";
      let end: number | null = null;
      for (const p of line) {
        if (end != null) {
          const gap = p.x - end;
          // About the width of a character: half the text height.
          const char = Math.max(1, p.h / 2);
          if (gap > char * 1.5) out = out.trimEnd() + "   ";
          else if (gap > char * 0.15 && !out.endsWith(" ") && !p.str.startsWith(" ")) out += " ";
        }
        out += p.str;
        end = p.x + p.w;
      }
      return out.trim();
    })
    .join("\n");
}

/** The text of each page. Throws a message for the user when the PDF can't be read. */
export async function readPdf(file: File): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // Only the text is needed: no fonts, scripts or forms.
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (err) {
      if ((err as Error).name === "PasswordException")
        throw new Error(t("This PDF is protected with a password. Save a copy without one and choose that."), {
          cause: err,
        });
      throw new Error(t("This file can't be read as a PDF."), { cause: err });
    }
    const pages: PdfPage[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const pieces: Piece[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        const [a, b, c, d, x, y] = item.transform as number[];
        pieces.push({
          str: item.str,
          x: x!,
          y: y!,
          w: item.width,
          h: item.height || Math.hypot(c!, d!) || Math.hypot(a!, b!),
        });
      }
      pages.push({ page: n, text: toLines(pieces) });
    }
    if (!pages.some((p) => p.text.trim()))
      throw new Error(t("This PDF has no text, only images (a scan?). Fill in the values by hand."));
    return pages;
  } finally {
    await task.destroy();
  }
}
