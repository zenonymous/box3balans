import { describe, expect, it } from "vitest";
import { toLines, type Piece } from "./pdfText";

// Text 10 points high: a character is about 5 wide.
const at = (str: string, x: number, y: number): Piece => ({ str, x, y, w: str.length * 5, h: 10 });

describe("PDF text into lines", () => {
  it("puts pieces back in reading order, keeping columns apart", () => {
    const text = toLines([
      // Out of order, as PDFs often have them; the amount sits a little lower than its label.
      at("€ 12.345,67", 300, 699.5),
      at("Jaaropgaaf 2025", 100, 740),
      at("Waarde per 1 januari 2025", 50, 700),
      at("Rente", 50, 680),
      at("ontvangen", 82, 680),
      at("€ 812,40", 300, 680),
    ]);
    expect(text).toBe(
      ["Jaaropgaaf 2025", "Waarde per 1 januari 2025   € 12.345,67", "Rente ontvangen   € 812,40"].join("\n"),
    );
  });

  it("joins the pieces of a word that touch, and skips empty ones", () => {
    expect(toLines([at("Begin", 50, 700), at("waarde", 75, 700), at(" ", 105, 700), at("", 0, 0)])).toBe("Beginwaarde");
  });
});
