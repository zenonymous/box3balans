import { tr } from "../../i18n/index.js";
import { detectDelimiter, parseCsv } from "../parse.js";
import { binance } from "./binance.js";
import { bitstamp } from "./bitstamp.js";
import { bitvavo } from "./bitvavo.js";
import { bux } from "./bux.js";
import { coinbase } from "./coinbase.js";
import { coinTracking } from "./cointracking.js";
import { cryptoCom } from "./crypto-com.js";
import { delta } from "./delta.js";
import { etoro } from "./etoro.js";
import { krakenLedgers } from "./kraken.js";
import { lightyear } from "./lightyear.js";
import { rabobank } from "./rabobank.js";
import { revolut, revolutCrypto } from "./revolut.js";
import { saxo } from "./saxo.js";
import { scalableCapital } from "./scalable-capital.js";
import { schwabEquityAwards } from "./schwab.js";
import { tradeRepublic } from "./trade-republic.js";
import { trading212 } from "./trading212.js";
import { xtb } from "./xtb.js";
import { degiroAccount, degiroTransactions } from "./degiro.js";
import { goldrepublicStatement } from "./goldrepublic.js";
import type { StatementPage } from "../yearStatement.js";
import { type BrokerFormat, type Converted, templateCsv } from "./types.js";

/** Exports Box3balans recognises and converts to its own template. */
export const FORMATS: BrokerFormat[] = [
  degiroAccount,
  degiroTransactions,
  bitvavo,
  coinbase,
  krakenLedgers,
  cryptoCom,
  revolutCrypto,
  bitstamp,
  binance,
  rabobank,
  tradeRepublic,
  trading212,
  bux,
  saxo,
  lightyear,
  scalableCapital,
  revolut,
  etoro,
  xtb,
  schwabEquityAwards,
  coinTracking,
  delta,
];

export interface Recognised {
  format: Pick<BrokerFormat, "id" | "label">;
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

/** Statements read from a PDF (in the browser) that list transactions, read like an export. */
const PDF_FORMATS = [goldrepublicStatement];

export function recognisePdf(pages: StatementPage[]): Recognised | null {
  for (const format of PDF_FORMATS) {
    const statement = format.read(pages);
    if (!statement) continue;
    const result = format.convert(statement);
    const notes = [
      ...result.warnings,
      ...[...result.skipped].map(([reason, n]) => tr("Left out: {reason} ({n})", { reason, n })),
    ];
    return { format, result, content: templateCsv(result.rows), notes };
  }
  return null;
}
