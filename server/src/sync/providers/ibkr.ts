import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { D, type Decimal } from "../../lib/decimal.js";
import {
  type AssetRef,
  type Balance,
  type ExchangeProvider,
  ProviderError,
  type ProviderContext,
  type SyncEvent,
} from "../types.js";
import { msg, tr, trn } from "../../i18n/index.js";

const BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";

const creds = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{10,30}$/, "The Flex Web Service token is a long number"),
  queryId: z
    .string()
    .trim()
    .regex(/^\d{3,12}$/, "The Query ID is a number"),
});
type Creds = z.infer<typeof creds>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) => ["FlexStatement", "Trade", "CashTransaction", "OpenPosition", "CashReportCurrency"].includes(name),
});

// GetStatement codes meaning "not ready yet / try again".
const RETRY_CODES = new Set(["1001", "1004", "1009", "1018", "1019", "1021"]);

async function getText(ctx: ProviderContext, url: string): Promise<string> {
  const res = await ctx.fetchFn(url, {
    headers: { "User-Agent": "box3balans/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new ProviderError(`IBKR: HTTP ${res.status}`);
  return res.text();
}

interface FlexStatusResponse {
  FlexStatementResponse?: {
    Status?: string;
    ReferenceCode?: string;
    Url?: string;
    ErrorCode?: string;
    ErrorMessage?: string;
  };
}

/** True for an https address on IBKR's own servers: the only place the token may go. */
function isIbkrUrl(url: string | undefined): url is string {
  try {
    const u = new URL(url ?? "");
    return (
      u.protocol === "https:" &&
      (u.hostname === "interactivebrokers.com" || u.hostname.endsWith(".interactivebrokers.com"))
    );
  } catch {
    return false;
  }
}

/** Runs the two-step Flex Web Service flow and returns the statement XML. */
async function fetchStatement(c: Creds, ctx: ProviderContext): Promise<string> {
  const send = parser.parse(
    await getText(ctx, `${BASE}/SendRequest?t=${c.token}&q=${c.queryId}&v=3`),
  ) as FlexStatusResponse;
  const s = send.FlexStatementResponse;
  if (s?.Status !== "Success" || !s.ReferenceCode) {
    throw new ProviderError(
      `IBKR: ${s?.ErrorMessage ?? "SendRequest failed"}${s?.ErrorCode ? ` (code ${s.ErrorCode})` : ""}`,
    );
  }
  // The statement address comes from IBKR's answer; anything not on IBKR's servers is ignored.
  const url = isIbkrUrl(s.Url) ? s.Url.split("?")[0]! : `${BASE}/GetStatement`;
  for (let attempt = 0; attempt < 12; attempt++) {
    if (attempt > 0) await ctx.sleep(5_000);
    const xml = await getText(ctx, `${url}?t=${c.token}&q=${encodeURIComponent(String(s.ReferenceCode))}&v=3`);
    if (xml.includes("<FlexQueryResponse")) return xml;
    const r = (parser.parse(xml) as FlexStatusResponse).FlexStatementResponse;
    if (r?.ErrorCode && RETRY_CODES.has(String(r.ErrorCode))) continue;
    throw new ProviderError(
      `IBKR: ${r?.ErrorMessage ?? "unexpected GetStatement response"}${r?.ErrorCode ? ` (code ${r.ErrorCode})` : ""}`,
    );
  }
  throw new ProviderError(tr("IBKR: the statement was not ready after a minute; try again later."));
}

type Attrs = Record<string, string | undefined>;

/** Parses IBKR date/time in any of the Flex formats (yyyyMMdd;HHmmss, yyyy-MM-dd;HH:mm:ss, …). */
export function parseIbDate(v: string | undefined): Date | null {
  if (!v) return null;
  const digits = v.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const [y, mo, d] = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)];
  const [h, mi, s] =
    digits.length >= 14 ? [digits.slice(8, 10), digits.slice(10, 12), digits.slice(12, 14)] : ["12", "00", "00"];
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const security = (a: Attrs): AssetRef => ({
  kind: "security",
  isin: a.isin || undefined,
  symbol: a.symbol ?? "?",
  currency: (a.currency ?? "USD").toUpperCase(),
  exchange: a.listingExchange || undefined,
  name: a.description || undefined,
  etf: a.subCategory === "ETF",
});

const SUPPORTED_CATEGORIES = new Set(["STK", "FUND", "ETF"]);

export interface ParsedFlex {
  events: SyncEvent[];
  balances: Balance[];
  hasCashReport: boolean;
  warnings: string[];
}

/** Turns a Flex Query XML statement into events and balances. */
export function parseFlexStatement(xml: string): ParsedFlex {
  const doc = parser.parse(xml) as {
    FlexQueryResponse?: { FlexStatements?: { FlexStatement?: Record<string, unknown>[] } };
  };
  const statements = doc.FlexQueryResponse?.FlexStatements?.FlexStatement ?? [];
  const events: SyncEvent[] = [];
  const balances: Balance[] = [];
  const warnings: string[] = [];
  const skipped = new Map<string, number>();
  let hasCashReport = false;

  for (const st of statements) {
    const section = <T>(name: string, item: string) => (st[name] as Record<string, T[]> | undefined)?.[item] ?? [];

    for (const t of section<Attrs>("Trades", "Trade")) {
      if (t.levelOfDetail && t.levelOfDetail !== "EXECUTION") continue;
      const at = parseIbDate(t.dateTime ?? t.tradeDate);
      const id = t.tradeID || t.transactionID || t.ibExecID;
      if (!at || !id) continue;
      const qty = D(t.quantity ?? 0).abs();
      const price = D(t.tradePrice ?? 0);
      const comm = D(t.ibCommission ?? 0).abs();
      const commCur = (t.ibCommissionCurrency ?? t.currency ?? "").toUpperCase();
      const cur = (t.currency ?? "").toUpperCase();
      const buy = (t.buySell ?? "").toUpperCase().startsWith("BUY") || D(t.quantity ?? 0).gt(0);

      if (t.assetCategory === "CASH") {
        // FX conversion, e.g. symbol EUR.USD: BUY q EUR at p USD per EUR.
        const [baseCur, quoteCur] = (t.symbol ?? "").split(".");
        if (!baseCur || !quoteCur) continue;
        const quoteAmt = qty.mul(price);
        const note = `FX conversion ${t.symbol}`;
        events.push(
          {
            kind: buy ? "deposit" : "withdrawal",
            id: `${id}:base`,
            at,
            asset: { kind: "fiat", currency: baseCur },
            quantity: qty.toFixed(),
            note,
          },
          {
            kind: buy ? "withdrawal" : "deposit",
            id: `${id}:quote`,
            at,
            asset: { kind: "fiat", currency: quoteCur },
            quantity: quoteAmt.toFixed(),
            note,
          },
        );
        if (!comm.isZero()) {
          events.push({
            kind: "withdrawal",
            id: `${id}:comm`,
            at,
            asset: { kind: "fiat", currency: commCur },
            quantity: comm.toFixed(),
            note: "IBKR commission",
          });
        }
        continue;
      }
      if (!SUPPORTED_CATEGORIES.has(t.assetCategory ?? "STK")) {
        skipped.set(t.assetCategory ?? "?", (skipped.get(t.assetCategory ?? "?") ?? 0) + 1);
        continue;
      }
      const gross = qty.mul(price);
      const sameCur = commCur === cur;
      events.push({
        kind: "trade",
        id,
        at,
        side: buy ? "buy" : "sell",
        asset: security(t),
        quantity: qty.toFixed(),
        quote: { amount: (sameCur ? (buy ? gross.plus(comm) : gross.minus(comm)) : gross).toFixed(), currency: cur },
        feeQuote: sameCur && !comm.isZero() ? comm.toFixed() : undefined,
      });
      if (!sameCur && !comm.isZero()) {
        events.push({
          kind: "withdrawal",
          id: `${id}:comm`,
          at,
          asset: { kind: "fiat", currency: commCur },
          quantity: comm.toFixed(),
          note: `IBKR commission ${t.symbol}`,
        });
      }
    }

    // Dividends and their withholding tax arrive as separate cash lines; merge per security/day.
    const divs = new Map<
      string,
      { id: string; at: Date; asset: AssetRef; currency: string; gross: Decimal; tax: Decimal }
    >();
    for (const ct of section<Attrs>("CashTransactions", "CashTransaction")) {
      if (ct.levelOfDetail && ct.levelOfDetail !== "DETAIL") continue;
      const at = parseIbDate(ct.dateTime ?? ct.settleDate ?? ct.reportDate);
      const id = ct.transactionID || ct.actionID;
      if (!at || !id) continue;
      const amount = D(ct.amount ?? 0);
      const cur = (ct.currency ?? "EUR").toUpperCase();
      const type = (ct.type ?? "").toLowerCase();
      if (type.includes("dividend") || type.includes("withholding")) {
        const key = `${ct.isin || ct.symbol}|${at.toISOString().slice(0, 10)}|${cur}`;
        const d = divs.get(key) ?? { id, at, asset: security(ct), currency: cur, gross: D(0), tax: D(0) };
        if (type.includes("withholding")) d.tax = d.tax.minus(amount);
        else {
          d.gross = d.gross.plus(amount);
          d.id = id; // prefer the dividend's own id for stability
        }
        divs.set(key, d);
        continue;
      }
      if (amount.isZero()) continue;
      const fiat: AssetRef = { kind: "fiat", currency: cur };
      if (type.includes("interest") && amount.gt(0)) {
        events.push({
          kind: "reward",
          id,
          at,
          asset: fiat,
          quantity: amount.toFixed(),
          note: ct.description || "IBKR interest",
        });
      } else {
        const plain = type.includes("deposit");
        events.push({
          kind: amount.gt(0) ? "deposit" : "withdrawal",
          id,
          at,
          asset: fiat,
          quantity: amount.abs().toFixed(),
          note: plain ? undefined : ct.description || ct.type,
        });
      }
    }
    for (const d of divs.values()) {
      events.push({
        kind: "dividend",
        id: d.id,
        at: d.at,
        asset: d.asset,
        currency: d.currency,
        gross: d.gross.toFixed(),
        tax: d.tax.toFixed(),
        note: "IBKR",
      });
    }

    for (const p of section<Attrs>("OpenPositions", "OpenPosition")) {
      if (p.levelOfDetail && p.levelOfDetail !== "SUMMARY") continue;
      if (!SUPPORTED_CATEGORIES.has(p.assetCategory ?? "STK")) continue;
      balances.push({ asset: security(p), quantity: D(p.position ?? 0).toFixed() });
    }
    for (const cr of section<Attrs>("CashReport", "CashReportCurrency")) {
      if (!cr.currency || cr.currency === "BASE_SUMMARY") continue;
      hasCashReport = true;
      balances.push({
        asset: { kind: "fiat", currency: cr.currency.toUpperCase() },
        quantity: D(cr.endingCash ?? 0).toFixed(),
      });
    }
  }
  for (const [cat, n] of skipped)
    warnings.push(
      trn(
        n,
        "Skipped {n} {category} trade: only stocks and ETFs are tracked.",
        "Skipped {n} {category} trades: only stocks and ETFs are tracked.",
        { category: cat },
      ),
    );
  return { events, balances, hasCashReport, warnings };
}

export const ibkr: ExchangeProvider<Creds> = {
  id: "ibkr",
  label: "Interactive Brokers (Flex)",
  accountKind: "broker",
  fields: [
    { name: "token", label: msg("Flex Web Service token"), secret: true },
    { name: "queryId", label: msg("Flex Query ID"), secret: false },
  ],
  instructions: [
    msg("Client Portal → Performance & Reports → Flex Queries → create an Activity Flex Query."),
    msg(
      "Sections: Trades (Execution level), Cash Transactions (Detail), Open Positions (Summary) and Cash Report. Select all fields in each.",
    ),
    msg("Format XML, period “Last 365 Calendar Days”. Save and note the Query ID."),
    msg("Flex Queries page → Flex Web Service Configuration → enable it and generate a token."),
    msg("The Flex service only covers up to 365 days per query; import older history via CSV."),
  ],
  credentials: creds,
  hint: (c) => `query ${c.queryId}`,

  async test(c, ctx) {
    const send = parser.parse(
      await getText(ctx, `${BASE}/SendRequest?t=${c.token}&q=${c.queryId}&v=3`),
    ) as FlexStatusResponse;
    const s = send.FlexStatementResponse;
    if (s?.Status !== "Success") throw new ProviderError(`IBKR: ${s?.ErrorMessage ?? "SendRequest failed"}`);
  },

  async fetch(c, ctx) {
    const parsed = parseFlexStatement(await fetchStatement(c, ctx));
    return {
      events: parsed.events,
      balances: parsed.balances,
      balanceScope: parsed.hasCashReport ? "all" : "securities",
      cursor: null,
      warnings: parsed.warnings,
    };
  },
};
