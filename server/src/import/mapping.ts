import { z } from "zod";
import { currencyCode } from "../lib/validation.js";

/** Transaction types a CSV row can become. Transfers are found afterwards by matching. */
export const CSV_TYPES = ["buy", "sell", "deposit", "withdrawal", "dividend", "reward", "fee", "split"] as const;
export type CsvType = (typeof CSV_TYPES)[number];

/** Fields a column can be mapped to, in the order the UI shows them. */
export const FIELDS = [
  "date",
  "time",
  "type",
  "symbol",
  "isin",
  "name",
  "assetType",
  "quantity",
  "price",
  "total",
  "currency",
  "fee",
  "amount",
  "tax",
  "notes",
  "id",
] as const;
export type Field = (typeof FIELDS)[number];

const col = z.number().int().min(0).max(500).nullable().default(null);

export const mappingSchema = z.object({
  // Lines before the header row (some exports start with a title or account details).
  skipRows: z.number().int().min(0).max(50).default(0),
  delimiter: z.enum([",", ";", "\t", "|"]).nullable().default(null),
  decimal: z.enum(["auto", ".", ","]).default("auto"),
  dateOrder: z.enum(["auto", "YMD", "DMY", "MDY"]).default("auto"),
  // Column index per field (null = not in the file).
  columns: z
    .object(Object.fromEntries(FIELDS.map((f) => [f, col])) as Record<Field, typeof col>)
    .default(Object.fromEntries(FIELDS.map((f) => [f, null])) as Record<Field, null>),
  // Where the transaction type comes from: a column (with `typeValues`), one type for every row,
  // or buy/sell by the sign of the quantity (negative = sell).
  typeMode: z.enum(["column", "fixed", "sign"]).default("column"),
  fixedType: z.enum(CSV_TYPES).default("buy"),
  // Values found in the type column → transaction type, or "skip" to leave those rows out.
  typeValues: z.record(z.string(), z.enum([...CSV_TYPES, "skip"])).default({}),
  // How to read the symbol column when a row doesn't say: "auto" goes by the account kind.
  assetKind: z.enum(["auto", "security", "crypto", "metal"]).default("auto"),
  // Currency for rows without a currency column.
  defaultCurrency: currencyCode.default("EUR"),
  // Fees in the file are in the trade's currency, or always in EUR.
  feeCurrency: z.enum(["trade", "EUR"]).default("trade"),
  // Book buys, sells and dividends against the account's cash balance.
  settleCash: z.boolean().default(false),
  // Asset key (see assetKey) → existing asset chosen by the user.
  assetOverrides: z.record(z.string(), z.number().int().positive()).default({}),
});
export type Mapping = z.infer<typeof mappingSchema>;

/** Kluishuis's own CSV template: one row per transaction, documented in the README. */
export const TEMPLATE_HEADERS = [
  "date",
  "time",
  "type",
  "symbol",
  "isin",
  "name",
  "asset_type",
  "quantity",
  "price",
  "total",
  "currency",
  "fee",
  "amount",
  "tax_withheld",
  "notes",
  "id",
] as const;

export const TEMPLATE_CSV = [
  TEMPLATE_HEADERS.join(","),
  "2024-01-02,,deposit,EUR,,,cash,2000,,,EUR,,,,Monthly deposit,",
  "2024-01-15,10:30,buy,IWDA,IE00B4L5Y983,iShares Core MSCI World,etf,10,85.20,,EUR,2.00,,,,",
  "2024-02-01,,buy,BTC,,Bitcoin,crypto,0.01,42000,,EUR,1.50,,,,",
  "2024-03-20,,dividend,VWRL,IE00B3RBWM25,Vanguard FTSE All-World,etf,,,,USD,,12.50,1.88,,",
  "2024-05-10,,sell,IWDA,IE00B4L5Y983,iShares Core MSCI World,etf,2,90.10,,EUR,1.00,,,,",
  "2024-06-01,,reward,ETH,,Ethereum,crypto,0.002,,,EUR,,,,Staking reward,",
  "2024-07-01,,split,AAPL,US0378331005,Apple,stock,4,,,USD,,,,4-for-1 split,",
].join("\r\n");

const norm = (h: string) =>
  h
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Header names (normalised) per field, English and Dutch. Only exact matches are used.
const SYNONYMS: Record<Field, string[]> = {
  date: [
    "date",
    "datum",
    "trade date",
    "transaction date",
    "transactiedatum",
    "boekingsdatum",
    "timestamp",
    "time utc",
  ],
  time: ["time", "tijd"],
  type: ["type", "transaction type", "transactietype", "soort", "side", "action", "kind", "operation"],
  symbol: ["symbol", "ticker", "asset", "coin", "currency pair", "instrument", "symbool"],
  isin: ["isin", "isin code"],
  name: ["name", "naam", "product", "asset name", "security", "description of security"],
  assetType: ["asset type", "asset_type", "asset class", "categorie", "category"],
  quantity: ["quantity", "qty", "aantal", "units", "shares", "stuks", "number of shares"],
  price: ["price", "koers", "prijs", "unit price", "price per unit", "execution price"],
  total: ["total", "totaal", "value", "waarde", "lokale waarde", "net amount", "proceeds"],
  currency: ["currency", "valuta", "ccy", "munt"],
  fee: ["fee", "fees", "kosten", "transactiekosten", "commission", "transactiekosten en of"],
  // Not plain "amount": crypto exports use that for the quantity.
  amount: ["gross amount", "bruto", "bruto bedrag", "dividend", "dividend amount"],
  tax: ["tax", "tax withheld", "tax_withheld", "withholding tax", "bronbelasting", "dividendbelasting"],
  notes: ["notes", "note", "description", "omschrijving", "comment", "memo"],
  id: ["id", "order id", "transaction id", "txid", "tx id", "reference", "referentie", "trade id"],
};

/** A first guess at the mapping from header names; the user reviews and corrects it. */
export function guessColumns(headers: string[]): Record<Field, number | null> {
  const out = Object.fromEntries(FIELDS.map((f) => [f, null])) as Record<Field, number | null>;
  const taken = new Set<number>();
  for (const field of FIELDS) {
    const i = headers.findIndex((h, idx) => !taken.has(idx) && SYNONYMS[field].includes(norm(h)));
    if (i >= 0) {
      out[field] = i;
      taken.add(i);
    }
  }
  return out;
}

/** True when the headers are exactly the Kluishuis template's. */
export const isTemplate = (headers: string[]) =>
  headers.length >= TEMPLATE_HEADERS.length && TEMPLATE_HEADERS.every((h, i) => norm(headers[i] ?? "") === norm(h));

/** Type column values Kluishuis understands without a mapping (template, English, Dutch). */
const TYPE_WORDS: Record<string, CsvType> = {
  buy: "buy",
  bought: "buy",
  koop: "buy",
  aankoop: "buy",
  sell: "sell",
  sold: "sell",
  verkoop: "sell",
  deposit: "deposit",
  storting: "deposit",
  withdrawal: "withdrawal",
  withdraw: "withdrawal",
  opname: "withdrawal",
  dividend: "dividend",
  reward: "reward",
  staking: "reward",
  "staking reward": "reward",
  interest: "reward",
  rente: "reward",
  fee: "fee",
  split: "split",
};

/** Default type for a value found in the type column, if it's a known word. */
export const knownType = (value: string): CsvType | undefined => TYPE_WORDS[norm(value)];

/** Header signature used to recognise a saved preset when the same kind of file comes back. */
export const headerSignature = (headers: string[]) => headers.map(norm).join("|");
