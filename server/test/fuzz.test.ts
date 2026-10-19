import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseBankExport } from "../src/import/bank.js";
import { goldrepublicTransactions, readGoldrepublic } from "../src/import/formats/goldrepublic.js";
import { recognise } from "../src/import/formats/index.js";
import { looseNum } from "../src/import/formats/types.js";
import { detectDelimiter, parseCsv, parseNumber } from "../src/import/parse.js";
import { amounts, readYearStatement } from "../src/import/yearStatement.js";
import { toCsv } from "../src/lib/csv.js";

/**
 * Property-based tests (fuzzing) for what reads files from outside: thousands of generated inputs,
 * junk as well as valid documents in every variation. A wrong result or a crash is a bug; a refusal
 * with a message for the user (an Error) is fine. FUZZ_SCALE=20 npx vitest run test/fuzz.test.ts tries
 * twenty times as many.
 */
const SCALE = Math.max(1, Number(process.env.FUZZ_SCALE) || 1);
const runs = (n: number) => ({ numRuns: n * SCALE });

/** Fails on programming errors (TypeError, RangeError …), not on refusals meant for the user. */
function noCrash(f: () => unknown) {
  try {
    f();
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(RangeError);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect((err as Error).message).not.toBe("");
  }
}

// Characters that trip up parsers: delimiters, quotes, line breaks, accents, currency signs.
const tricky = fc.constantFrom(..."aZ09 ,;|\t\"'\n\r.-+=@é€$()%:/".split(""));
const text = fc.oneof(fc.string(), fc.string({ unit: tricky, maxLength: 60 }));

describe("CSV", () => {
  it("reads back exactly what the export writes", () => {
    // Trimmed cells that don't start like a formula (the export puts a quote before those).
    const plain = (raw: string) => {
      let c = raw;
      for (let prev = ""; prev !== c;) [prev, c] = [c, c.trim().replace(/^[=+\-@'\t\r]+/, "")];
      return c;
    };
    const cell = fc.string({ unit: tricky, maxLength: 12 }).map(plain);
    const table = fc.integer({ min: 1, max: 5 }).chain((n) =>
      fc.record({
        header: fc.array(
          cell.filter((c) => c !== ""),
          { minLength: n, maxLength: n },
        ),
        rows: fc.array(fc.array(cell, { minLength: n, maxLength: n }), { maxLength: 8 }),
      }),
    );
    fc.assert(
      fc.property(table, ({ header, rows }) => {
        const csv = toCsv(
          rows,
          header.map((h, i) => ({ header: h, value: (r: string[]) => r[i] })),
        );
        const expected = [header, ...rows.filter((r) => r.some((c) => c !== ""))];
        expect(parseCsv(csv, ",")).toEqual(expected);
      }),
      runs(500),
    );
  });

  it("never crashes on junk", () => {
    fc.assert(
      fc.property(text, (s) => {
        noCrash(() => parseCsv(s, detectDelimiter(s)));
      }),
      runs(1000),
    );
  });
});

/** An amount in cents written the Dutch way ("1.234,56") or the English way ("1,234.56"). */
function written(cents: number, style: "nl" | "en") {
  const abs = Math.abs(cents);
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, style === "nl" ? "." : ",");
  const frac = String(abs % 100).padStart(2, "0");
  return `${int}${style === "nl" ? "," : "."}${frac}`;
}
const canonical = (cents: number) =>
  `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
const cents = fc.integer({ min: -99_999_999_999, max: 99_999_999_999 }).filter((n) => n !== 0);

describe("numbers", () => {
  it("parses amounts in either notation, with currency signs and minus signs", () => {
    const wrap = fc.constantFrom(
      (s: string, neg: boolean) => `${neg ? "-" : ""}${s}`,
      (s: string, neg: boolean) => `€ ${neg ? "-" : ""}${s}`,
      (s: string, neg: boolean) => `${neg ? "-" : ""}${s} EUR`,
      (s: string, neg: boolean) => (neg ? `(${s})` : s),
      (s: string, neg: boolean) => `${s}${neg ? "-" : ""}`,
    );
    fc.assert(
      fc.property(cents, fc.constantFrom("nl" as const, "en" as const), wrap, (n, style, w) => {
        const raw = w(written(n, style), n < 0);
        expect(parseNumber(raw, style === "nl" ? "," : ".")).toBe(canonical(n));
      }),
      runs(1000),
    );
  });

  it("finds amounts in a line of a statement", () => {
    const line = fc.constantFrom(
      (a: string) => `Saldo op 01-01-2025   € ${a}`,
      (a: string) => `Total   €${a}`,
      (a: string) => `Rente, ontvangen in 2025 ${a} EUR`,
    );
    fc.assert(
      fc.property(cents, fc.constantFrom("nl" as const, "en" as const), line, (n, style, l) => {
        const a = `${n < 0 ? "-" : ""}${written(n, style)}`;
        expect(amounts(l(a)).at(-1)?.value).toBe(canonical(n));
      }),
      runs(1000),
    );
  });

  it("never crash on junk", () => {
    fc.assert(
      fc.property(text, (s) => {
        noCrash(() => parseNumber(s, ","));
        noCrash(() => parseNumber(s, "."));
        noCrash(() => looseNum(s));
        noCrash(() => amounts(s));
      }),
      runs(1000),
    );
  });
});

// Column names the recognised exports look for, so junk reaches their detection and conversion.
const HEADERS = [
  "Date",
  "Datum",
  "Time",
  "Type",
  "Amount",
  "Bedrag",
  "Currency",
  "Quantity",
  "Price",
  "Product",
  "ISIN",
  "Symbol",
  "Fee",
  "Total",
  "Description",
  "utc_time",
  "account",
  "operation",
  "coin",
  "change",
  "Timestamp",
  "Transaction Description",
  "Native Amount",
  "Transaction Kind",
  "Value",
  "Rate",
  "Subtype",
  "Datetime",
  "Asset",
  "Market",
  "Side",
  "Order ID",
  "Status",
  "Mutatie",
  "Omschrijving",
  "Saldo na mutatie",
  "Naam",
  "Valuta",
  "Koers",
  "Aantal",
  "Totaal",
  "Operation",
  "Comment",
  "ID",
  "Action",
  "Shares",
];

describe("exports, bank statements and annual statements", () => {
  it("never crash on junk, also with real column names", () => {
    const row = (n: number) => fc.array(text, { minLength: n, maxLength: n });
    const csv = fc
      .integer({ min: 1, max: 8 })
      .chain((n) =>
        fc
          .tuple(
            fc.array(fc.constantFrom(...HEADERS), { minLength: n, maxLength: n }),
            fc.array(row(n), { maxLength: 6 }),
            fc.constantFrom(",", ";"),
          )
          .map(([h, rows, d]) =>
            [h, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(d)).join("\n"),
          ),
      );
    fc.assert(
      fc.property(csv, (s) => {
        noCrash(() => recognise(s));
        noCrash(() => parseBankExport(s));
      }),
      runs(500),
    );
  });

  it("read annual statements of junk without crashing", () => {
    const page = fc.array(fc.oneof(text, fc.constantFrom("Saldo op 01-01-2025   € 1.234,56", "Jaaroverzicht 2025")), {
      maxLength: 20,
    });
    fc.assert(
      fc.property(fc.array(page, { minLength: 1, maxLength: 3 }), (pages) => {
        const r = readYearStatement(pages.map((lines, i) => ({ page: i + 1, text: lines.join("\n") })));
        for (const f of r.found) expect(f.amount).toMatch(/^-?\d+\.\d{2}$/);
      }),
      runs(500),
    );
  });
});

// ---- Goldrepublic: random statements that add up must read completely and add up ----

const euro = (c: number) => `€${c < 0 ? "-" : ""}${written(c, "en")}`;
function gramText(mg: number) {
  const int = String(Math.floor(mg / 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${int}.${String(mg % 1000).padStart(3, "0")}`;
}
const METALS = ["Gold", "Silver", "Platinum"] as const;

type Event =
  | { kind: "deposit" | "withdrawal" | "cost" | "refund"; cents: number }
  | { kind: "buy" | "sell"; metal: number; mg: number; value: number; fee: number; handling: number };

const event: fc.Arbitrary<Event> = fc.oneof(
  fc.record({
    kind: fc.constantFrom("deposit" as const, "withdrawal" as const, "cost" as const, "refund" as const),
    cents: fc.integer({ min: 1, max: 5_000_000 }),
  }),
  fc.record({
    kind: fc.constantFrom("buy" as const, "sell" as const),
    metal: fc.integer({ min: 0, max: 2 }),
    mg: fc.integer({ min: 1, max: 2_000_000 }),
    value: fc.integer({ min: 1, max: 5_000_000 }),
    fee: fc.integer({ min: 0, max: 50_000 }),
    handling: fc.integer({ min: 0, max: 2_000 }),
  }),
);

/** The statement as the PDF reader gives it, with page breaks anywhere. */
function render(opening: { cash: number; mg: number[] }, events: Event[], breaks: number[], wide: boolean) {
  const sep = wide ? "      " : "   ";
  const row = (...cols: string[]) => cols.join(sep);
  let cash = opening.cash;
  const mg = [...opening.mg];
  const balance = (label: string, date: string, c: number, m: number[]) => [
    row(label, date),
    row("Cash", euro(c)),
    ...METALS.map((name, i) =>
      row(name, `${gramText(m[i]!)} gr`, "€80,000.00/ kg", euro(Math.round((m[i]! * 80) / 10))),
    ),
    row("Total", euro(c + m.reduce((a, x) => a + Math.round((x * 80) / 10), 0))),
  ];
  const lines = [
    "T: +31 20 – 000 00 00",
    "Account Statement",
    row("Account Number", "12345"),
    ...balance("Opening balance", "Jan 1 2025", cash, mg),
    "Transactions",
    row("Transaction Type", "Date", "Description", "Bullion", "Amount", "Balance"),
  ];
  const kept: Event[] = [];
  events.forEach((e, i) => {
    const day = `${String((i % 28) + 1).padStart(2, "0")}-${String((Math.floor(i / 28) % 12) + 1).padStart(2, "0")}-2025`;
    if (e.kind === "buy" || e.kind === "sell") {
      const m = METALS[e.metal]!;
      // Never sell more than there is.
      const amountMg = e.kind === "sell" ? Math.min(e.mg, mg[e.metal]!) : e.mg;
      if (amountMg === 0) return;
      const total = e.kind === "buy" ? e.value + e.fee + e.handling : e.value - e.fee - e.handling;
      const delta = e.kind === "buy" ? -total : total;
      cash += delta;
      mg[e.metal] = mg[e.metal]! + (e.kind === "buy" ? amountMg : -amountMg);
      kept.push({ ...e, mg: amountMg });
      lines.push(
        row(
          e.kind === "buy" ? "Savings Order" : "Market Order",
          day,
          `Processing order ${100000 + i}`,
          m,
          euro(delta),
          euro(cash),
        ),
        row("Product", `${m}, Zurich`),
        row("Date Submitted", `${day} 09:00:00`),
        row("Execution Date", `${day} 13:05:02`),
        row("Action", e.kind === "buy" ? "Buy" : "Sell"),
        row("Transaction Value", euro(e.value)),
        row("Fee", euro(e.fee)),
        ...(e.handling ? [row("Handling Costs", euro(e.handling))] : []),
        row("Volume", gramText(amountMg)),
        row("Total", euro(Math.abs(total))),
      );
      return;
    }
    const amount = (e as Extract<Event, { cents: number }>).cents;
    const delta = e.kind === "deposit" || e.kind === "refund" ? amount : -amount;
    cash += delta;
    kept.push(e);
    const [type, description] = {
      deposit: ["Direct Debit", "Deposit for savingsplan goud"],
      withdrawal: ["Withdrawal", `Client withdrawal of ${euro(amount)}`],
      cost: ["Cost Order", "Opslagkosten maart 2025"],
      refund: ["Cost Order", "Correctie opslagkosten"],
    }[e.kind];
    lines.push(row(type!, day, description!, "-", euro(delta), euro(cash)));
  });
  lines.push(
    ...balance("Closing balance", "Dec 31 2025", cash, mg).flatMap((l, i) =>
      i === 0 ? [l.split(sep)[0]!, "Dec 31 2025"] : [l],
    ),
  );
  // Split into pages at the given positions, each with a footer.
  const cuts = [...new Set(breaks.map((b) => Math.floor(b * lines.length)))].sort((a, b) => a - b);
  const pages: { page: number; text: string }[] = [];
  let start = 0;
  for (const cut of [...cuts, lines.length]) {
    if (cut <= start) continue;
    pages.push({
      page: pages.length + 1,
      text: [...lines.slice(start, cut), "GOLDREPUBLIC BV | AMSTERDAM"].join("\n"),
    });
    start = cut;
  }
  return { pages, kept };
}

describe("Goldrepublic account statements", () => {
  it("read completely and add up, whatever is on them", () => {
    fc.assert(
      fc.property(
        fc.record({
          cash: fc.integer({ min: 0, max: 1_000_000 }),
          mg: fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 3, maxLength: 3 }),
        }),
        fc.array(event, { maxLength: 40 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 4 }),
        fc.boolean(),
        (opening, events, breaks, wide) => {
          const { pages, kept } = render(opening, events, breaks, wide);
          const s = readGoldrepublic(pages)!;
          expect(s.opening?.date).toBe("2025-01-01");
          expect(s.closing?.date).toBe("2025-12-31");
          expect(s.entries).toHaveLength(kept.length);
          expect(s.gaps).toEqual([]);
          const c = goldrepublicTransactions(s);
          expect(c.rows).toHaveLength(kept.length);
          expect(c.warnings).toEqual([]);
        },
      ),
      runs(300),
    );
  });

  it("never crash on junk, also when it looks like one", () => {
    const line = fc.oneof(
      text,
      fc.constantFrom(
        "Account Statement",
        "Opening balance   Jan 1 2025",
        "Closing balance",
        "Total   €12.34",
        "Savings Order   07-01-2025   Processing order 1   Gold   €-1.00   €0.00",
        "Volume   1.000",
        "Action   Buy",
        "Cash   €1.00",
        "Gold   1.000 gr   €80,000.00/ kg   €80.00",
        "GoldRepublic",
      ),
    );
    fc.assert(
      fc.property(fc.array(line, { maxLength: 40 }), (lines) => {
        noCrash(() => {
          const s = readGoldrepublic([
            { page: 1, text: ["Account Statement", "Opening balance", "goldrepublic", ...lines].join("\n") },
          ]);
          if (s) goldrepublicTransactions(s);
        });
      }),
      runs(1000),
    );
  });
});
