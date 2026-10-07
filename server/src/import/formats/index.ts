import { tr } from "../../i18n/index.js";
import { detectDelimiter, parseCsv } from "../parse.js";
import { bux, rabobank, revolut, saxo, trading212, tradeRepublic } from "./brokers.js";
import { bitvavo, coinbase, krakenLedgers } from "./crypto.js";
import { degiroAccount, degiroTransactions } from "./degiro.js";
import { type BrokerFormat, type Converted, templateCsv } from "./types.js";

/** Exports Box3balans recognises and converts to its own template. */
export const FORMATS: BrokerFormat[] = [
  degiroAccount,
  degiroTransactions,
  bitvavo,
  coinbase,
  krakenLedgers,
  rabobank,
  tradeRepublic,
  trading212,
  bux,
  saxo,
  revolut,
];

export interface Recognised {
  format: BrokerFormat;
  result: Converted;
  /** The converted file, in the Box3balans template. */
  content: string;
  /** What was left out and why, for the preview. */
  notes: string[];
}

/**
 * The format of an export, found from its header row (which may come after a few title lines),
 * converted to the template. Null when the file isn't one of the known exports.
 */
export function recognise(content: string): Recognised | null {
  const text = content.replace(/^\uFEFF/, "");
  const table = parseCsv(text, detectDelimiter(text));
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    const headers = table[i]!.map((h) => h.trim());
    const format = FORMATS.find((f) => f.detect(headers));
    if (!format) continue;
    const result = format.convert([headers, ...table.slice(i + 1)]);
    const notes = [
      ...result.warnings,
      ...[...result.skipped].map(([reason, n]) => tr("Left out: {reason} ({n})", { reason, n })),
    ];
    return { format, result, content: templateCsv(result.rows), notes };
  }
  return null;
}
