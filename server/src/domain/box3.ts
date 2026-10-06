import { eq, min } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client.js";
import { accounts, accountYears, metalItems, settings, transactions } from "../db/schema.js";
import { D, Decimal, ZERO, money2 } from "../lib/decimal.js";
import { holdingsOn } from "./valuation.js";
import { localDay } from "../lib/time.js";
import { type AttributionNote, attribute, loadHousehold } from "./household.js";
import { loadYearly, yearlyClass, yearlyValue } from "./yearly.js";

/**
 * Dutch box 3 ("sparen en beleggen"), forfaitaire spaarvariant (tax years 2023 onwards):
 * wealth on 1 January is split into bank balances, other assets and debts, each with its own
 * deemed return. This module values holdings on the peildatum, maps them to categories, and
 * estimates the tax. Rates and rules change yearly, so both the rates and the mapping are editable.
 */

export const CATEGORIES = ["bank", "other", "exempt", "excluded"] as const;
export type Category = (typeof CATEGORIES)[number];

const decimalStr = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(",", "."))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), "Must be a number");

const ratesSchema = z.object({
  // Deemed returns, in percent.
  bankPct: decimalStr,
  otherPct: decimalStr,
  debtPct: decimalStr,
  // Per person; doubled for fiscal partners.
  allowanceEur: decimalStr,
  debtThresholdEur: decimalStr,
  taxRatePct: decimalStr,
  // Green investments (groene beleggingen): exempt up to this amount per person, plus a small tax
  // credit (heffingskorting) on the exempt part. Default 0 for custom years saved before these existed.
  greenExemptEur: decimalStr.default("0"),
  greenCreditPct: decimalStr.default("0"),
  final: z.boolean(),
});
export type Box3Rates = z.infer<typeof ratesSchema>;

/**
 * Official figures (belastingdienst.nl, "Hoe wordt mijn box 3-inkomen over <jaar> berekend?").
 * 2026 bank and debt percentages are provisional until early 2027. Green investment limits and
 * credit: 2023 €65,072 / 0.7%, 2024 €71,251 / 0.7%, 2025 €26,312 / 0.1%, 2026 €26,715 / 0.1%
 * (the exemption ends in 2027).
 */
export const DEFAULT_RATES: Record<string, Box3Rates> = {
  "2023": {
    bankPct: "0.92",
    otherPct: "6.17",
    debtPct: "2.46",
    allowanceEur: "57000",
    debtThresholdEur: "3400",
    taxRatePct: "32",
    greenExemptEur: "65072",
    greenCreditPct: "0.7",
    final: true,
  },
  "2024": {
    bankPct: "1.44",
    otherPct: "6.04",
    debtPct: "2.61",
    allowanceEur: "57000",
    debtThresholdEur: "3700",
    taxRatePct: "36",
    greenExemptEur: "71251",
    greenCreditPct: "0.7",
    final: true,
  },
  "2025": {
    bankPct: "1.37",
    otherPct: "5.88",
    debtPct: "2.70",
    allowanceEur: "57684",
    debtThresholdEur: "3800",
    taxRatePct: "36",
    greenExemptEur: "26312",
    greenCreditPct: "0.1",
    final: true,
  },
  "2026": {
    bankPct: "1.28",
    otherPct: "6.00",
    debtPct: "2.70",
    allowanceEur: "59357",
    debtThresholdEur: "3800",
    taxRatePct: "36",
    greenExemptEur: "26715",
    greenCreditPct: "0.1",
    final: false,
  },
};

const ACCOUNT_KINDS = [
  "broker",
  "exchange",
  "vault",
  "wallet",
  "bank",
  "physical",
  "other",
  "property",
  "receivable",
  "debt",
  "insurance",
] as const;
const NON_CASH_CLASSES = ["stock", "etf", "crypto", "metal", "other"] as const;

const category = z.enum(CATEGORIES);

export const configSchema = z.object({
  mapping: z.object({
    // Cash balances: a bank or broker (whose cash sits at a bank) counts as a bank balance; cash on a
    // crypto exchange or in a wallet does not.
    cashByAccountKind: z.record(z.enum(ACCOUNT_KINDS), category),
    classCategory: z.record(z.enum(NON_CASH_CLASSES), category),
    // Whole-account overrides, e.g. a green fund account (exempt) or a pension account (excluded).
    accountOverrides: z.record(z.string().regex(/^\d+$/), category),
  }),
  // User changes to the built-in rates, or rates for years not built in.
  rates: z.record(z.string().regex(/^\d{4}$/), ratesSchema),
  years: z.record(
    z.string().regex(/^\d{4}$/),
    z.object({
      partner: z.boolean(),
      // Things the app doesn't track: debts, and other box 3 assets (e.g. a second home, loans given).
      debtsEur: decimalStr,
      extraOtherEur: decimalStr,
      extraBankEur: decimalStr,
      // For the actual return: interest paid on box 3 debts, and the return (income and value change)
      // on assets the app doesn't track. Added later, so older saved configs lack them.
      debtInterestEur: decimalStr.default("0"),
      extraReturnEur: decimalStr.default("0"),
      // Fiscal partners divide the joint grondslag freely; this is your part, in percent.
      allocationSelfPct: decimalStr.default("50"),
    }),
  ),
});
export type Box3Config = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: Box3Config = {
  mapping: {
    cashByAccountKind: {
      bank: "bank",
      broker: "bank",
      exchange: "other",
      wallet: "other",
      vault: "other",
      physical: "other",
      other: "bank",
      property: "other",
      receivable: "other",
      debt: "other",
      insurance: "other",
    },
    classCategory: { stock: "other", etf: "other", crypto: "other", metal: "other", other: "other" },
    accountOverrides: {},
  },
  rates: {},
  years: {},
};

const CONFIG_KEY = "box3_config";

export async function loadConfig(db: DB): Promise<Box3Config> {
  const [row] = await db.select().from(settings).where(eq(settings.key, CONFIG_KEY));
  const stored = configSchema.partial().safeParse(row?.value ?? {});
  const v = stored.success ? stored.data : {};
  return {
    mapping: {
      cashByAccountKind: { ...DEFAULT_CONFIG.mapping.cashByAccountKind, ...(v.mapping?.cashByAccountKind ?? {}) },
      classCategory: { ...DEFAULT_CONFIG.mapping.classCategory, ...(v.mapping?.classCategory ?? {}) },
      accountOverrides: { ...(v.mapping?.accountOverrides ?? {}) },
    },
    rates: { ...(v.rates ?? {}) },
    years: { ...(v.years ?? {}) },
  };
}

export async function saveConfig(db: DB, config: Box3Config): Promise<void> {
  await db
    .insert(settings)
    .values({ key: CONFIG_KEY, value: config })
    .onConflictDoUpdate({ target: settings.key, set: { value: config } });
}

export function ratesFor(config: Box3Config, year: number): (Box3Rates & { source: "default" | "custom" }) | null {
  const custom = config.rates[String(year)];
  if (custom) return { ...custom, source: "custom" };
  const def = DEFAULT_RATES[String(year)];
  return def ? { ...def, source: "default" } : null;
}

export function categoryOf(
  config: Box3Config,
  h: { accountId: number; accountKind: string; assetClass: string },
): Category {
  const override = config.mapping.accountOverrides[String(h.accountId)];
  if (override) return override;
  if (h.assetClass === "cash")
    return config.mapping.cashByAccountKind[h.accountKind as (typeof ACCOUNT_KINDS)[number]] ?? "bank";
  return config.mapping.classCategory[h.assetClass as (typeof NON_CASH_CLASSES)[number]] ?? "other";
}

export interface Box3Calculation {
  bankEur: string;
  otherEur: string;
  debtsEur: string;
  deductibleDebtsEur: string;
  deemedReturnEur: string;
  baseEur: string; // rendementsgrondslag
  allowanceEur: string;
  taxableBaseEur: string; // grondslag sparen en beleggen
  sharePct: string; // aandeel in de rendementsgrondslag
  benefitEur: string; // voordeel uit sparen en beleggen
  taxEur: string;
  // Green investments: the exempt part (up to the limit), the excess (taxed as other assets),
  // and the tax credit on the exempt part.
  greenEur: string;
  greenExemptEur: string;
  greenAboveLimitEur: string;
  greenCreditEur: string;
  // Box 3 tax after the green credit (the credit can't make it negative here).
  netTaxEur: string;
}

/**
 * The official steps: 1) deemed return per category (debts above the threshold reduce it);
 * 2) rendementsgrondslag = assets − deductible debts; 3) grondslag = that − heffingsvrij vermogen;
 * 4) aandeel = grondslag / rendementsgrondslag; 5) voordeel = deemed return × aandeel; 6) tax = voordeel × rate.
 */
export function calculateBox3(
  input: { bank: Decimal; other: Decimal; green?: Decimal; debts: Decimal; partner: boolean },
  r: Box3Rates,
): Box3Calculation {
  const persons = input.partner ? 2 : 1;
  // Green investments above the limit count as ordinary other assets.
  const green = input.green ?? ZERO;
  const greenExempt = Decimal.min(green, D(r.greenExemptEur ?? 0).mul(persons));
  const greenAbove = green.minus(greenExempt);
  const other = input.other.plus(greenAbove);
  const threshold = D(r.debtThresholdEur).mul(persons);
  const allowance = D(r.allowanceEur).mul(persons);
  const deductible = Decimal.max(input.debts.minus(threshold), ZERO);
  const deemed = input.bank
    .mul(D(r.bankPct).div(100))
    .plus(other.mul(D(r.otherPct).div(100)))
    .minus(deductible.mul(D(r.debtPct).div(100)));
  const base = input.bank.plus(other).minus(deductible);
  const taxable = Decimal.max(base.minus(allowance), ZERO);
  const share = base.gt(0) ? taxable.div(base) : ZERO;
  const benefit = Decimal.max(deemed.mul(share), ZERO);
  const tax = benefit.mul(D(r.taxRatePct).div(100));
  const credit = greenExempt.mul(D(r.greenCreditPct ?? 0).div(100));
  return {
    bankEur: money2(input.bank),
    otherEur: money2(other),
    debtsEur: money2(input.debts),
    deductibleDebtsEur: money2(deductible),
    deemedReturnEur: money2(deemed),
    baseEur: money2(base),
    allowanceEur: money2(allowance),
    taxableBaseEur: money2(taxable),
    sharePct: share.mul(100).toFixed(2),
    benefitEur: money2(benefit),
    taxEur: money2(tax),
    greenEur: money2(green),
    greenExemptEur: money2(greenExempt),
    greenAboveLimitEur: money2(greenAbove),
    greenCreditEur: money2(credit),
    netTaxEur: money2(Decimal.max(tax.minus(credit), ZERO)),
  };
}

export interface Box3Row {
  accountId: number;
  accountName: string;
  accountKind: string;
  // "transactions": from the account's history; "yearly": a value entered per year.
  source: "transactions" | "yearly";
  assetId: number;
  symbol: string;
  name: string;
  assetClass: string;
  physical: boolean;
  quantity: string;
  unit: string;
  priceEur: string | null;
  priceDay: string | null;
  // The whole value; `countedEur` is the part that counts for you and your fiscal partner.
  valueEur: string;
  countedEur: string;
  category: Category | "debt";
  missingPrice: boolean;
  owner: string;
  ownerChildId: number | null;
  countedPct: string;
  note?: AttributionNote;
}

interface PersonTotals {
  bank: string;
  other: string;
  green: string;
  debts: string;
}

export interface Box3Year {
  year: number;
  peildatum: string; // 1 January of the tax year
  valuedAt: string; // closes of the last day before it
  partner: boolean;
  rates: (Box3Rates & { source: "default" | "custom" }) | null;
  totals: Record<Category, string>;
  // "other" split by kind of asset, which is how the aangifte asks for it.
  otherBreakdown: { investments: string; crypto: string; metals: string; cash: string; other: string };
  extra: { bankEur: string; otherEur: string; debtsEur: string };
  // Debts: entered for the year plus debt accounts.
  debtsEur: string;
  calculation: Box3Calculation | null;
  // What counts for each of you (before the allowance), and how the grondslag is divided.
  perPerson: { self: PersonTotals; partner: PersonTotals | null };
  allocation: {
    selfPct: string;
    self: { taxableBaseEur: string; benefitEur: string; taxEur: string };
    partner: { taxableBaseEur: string; benefitEur: string; taxEur: string };
  } | null;
  rows: Box3Row[];
  warnings: string[];
}

/** First and last tax years with something to report: the year after the first activity, until now. */
export async function availableYears(db: DB): Promise<number[]> {
  const [[t], [m], [y]] = await Promise.all([
    db.select({ first: min(transactions.occurredAt) }).from(transactions),
    db.select({ first: min(metalItems.purchaseDate) }).from(metalItems),
    db.select({ first: min(accountYears.year) }).from(accountYears),
  ]);
  const froms = [
    t?.first ? Number(localDay(new Date(t.first)).slice(0, 4)) + 1 : null,
    m?.first ? Number(String(m.first).slice(0, 4)) + 1 : null,
    // A value per year is a value on 1 January of that tax year.
    y?.first ?? null,
  ].filter((x): x is number => x != null);
  if (froms.length === 0) return [];
  const from = Math.min(...froms);
  const to = new Date().getUTCFullYear();
  const out: number[] = [];
  for (let y = to; y >= from; y--) out.push(y);
  return out;
}

type OtherKind = "investments" | "crypto" | "metals" | "cash" | "other";
const otherKind = (assetClass: string): OtherKind =>
  assetClass === "stock" || assetClass === "etf"
    ? "investments"
    : assetClass === "crypto"
      ? "crypto"
      : assetClass === "metal"
        ? "metals"
        : assetClass === "cash"
          ? "cash"
          : "other";

export async function computeBox3Year(db: DB, year: number, config: Box3Config): Promise<Box3Year> {
  const valuedAt = `${year - 1}-12-31`;
  const input = config.years[String(year)];
  const fiscalPartner = input?.partner ?? false;
  const [holdings, household, accountRows, yearly] = await Promise.all([
    holdingsOn(db, valuedAt),
    loadHousehold(db),
    db.select().from(accounts),
    loadYearly(db),
  ]);
  const accountById = new Map(accountRows.map((a) => [a.id, a]));

  const totals: Record<Category, Decimal> = { bank: ZERO, other: ZERO, exempt: ZERO, excluded: ZERO };
  const other: Record<OtherKind, Decimal> = { investments: ZERO, crypto: ZERO, metals: ZERO, cash: ZERO, other: ZERO };
  const blank = () => ({ bank: ZERO, other: ZERO, green: ZERO, debts: ZERO });
  const person = { self: blank(), partner: blank() };
  let accountDebts = ZERO;
  const warnings: string[] = [];
  const rows: Box3Row[] = [];

  /** Adds a value to the totals, per person, as it counts for this account's owner. */
  const count = (accountId: number, cat: Category | "debt", assetClass: string, value: Decimal) => {
    const acc = accountById.get(accountId);
    const a = acc ? attribute(acc, household, year, fiscalPartner) : { self: D(1), partner: ZERO, note: undefined };
    const counted = value.mul(a.self.plus(a.partner));
    const bucket = cat === "debt" ? "debts" : cat === "bank" ? "bank" : cat === "exempt" ? "green" : "other";
    if (cat === "debt") accountDebts = accountDebts.plus(counted);
    else {
      totals[cat] = totals[cat].plus(counted);
      if (cat === "other") {
        const k = otherKind(assetClass);
        other[k] = other[k].plus(counted);
      }
    }
    if (cat !== "excluded") {
      person.self[bucket] = person.self[bucket].plus(value.mul(a.self));
      person.partner[bucket] = person.partner[bucket].plus(value.mul(a.partner));
    }
    return {
      counted,
      owner: acc?.owner ?? "self",
      ownerChildId: acc?.ownerChildId ?? null,
      countedPct: a.self.plus(a.partner).mul(100).toDecimalPlaces(2).toFixed(),
      note: a.note,
    };
  };

  for (const h of holdings) {
    const acc = accountById.get(h.accountId);
    // An account kept as values per year is counted from those values only.
    if (acc?.tracking === "yearly") continue;
    const cat = categoryOf(config, h);
    const c = count(h.accountId, cat, h.assetClass, h.valueEur);
    const missing = h.priceEur === null;
    if (missing) warnings.push(`No price for ${h.symbol} on or before ${valuedAt}; it is counted as €0.`);
    else if (h.priceDay && Date.parse(valuedAt) - Date.parse(h.priceDay) > 10 * 86_400_000) {
      warnings.push(`${h.symbol} is valued at its close of ${h.priceDay}, the latest price before ${valuedAt}.`);
    }
    if (h.quantity.lt(0))
      warnings.push(`${h.accountName} has a negative ${h.symbol} balance on ${valuedAt}; check its history.`);
    rows.push({
      accountId: h.accountId,
      accountName: h.accountName,
      accountKind: h.accountKind,
      source: "transactions",
      assetId: h.assetId,
      symbol: h.symbol,
      name: h.name,
      assetClass: h.assetClass,
      physical: h.physical,
      quantity: h.quantity.toFixed(),
      unit: h.unit,
      priceEur: h.priceEur ? h.priceEur.toFixed(6) : null,
      priceDay: h.priceDay,
      valueEur: money2(h.valueEur),
      countedEur: money2(c.counted),
      category: cat,
      missingPrice: missing,
      owner: c.owner,
      ownerChildId: c.ownerChildId,
      countedPct: c.countedPct,
      note: c.note,
    });
  }

  // Accounts kept as values per year: their value on 1 January.
  for (const acc of accountRows) {
    if (acc.tracking !== "yearly") continue;
    const byYear = yearly.get(acc.id);
    const row = byYear?.get(year);
    const value = yearlyValue(acc.kind, row);
    if (value == null) {
      // Only worth a warning while the account existed: it has values for this year's neighbours.
      if (byYear && [...byYear.keys()].some((y) => y < year) && !acc.archived)
        warnings.push(`${acc.name}: no value on 1 January ${year}. Enter it under Accounts → Values per year.`);
      continue;
    }
    const cls = yearlyClass(acc.kind);
    const cat: Category | "debt" =
      cls === "debt" ? "debt" : categoryOf(config, { accountId: acc.id, accountKind: acc.kind, assetClass: cls });
    const c = count(acc.id, cat, cls, value);
    rows.push({
      accountId: acc.id,
      accountName: acc.name,
      accountKind: acc.kind,
      source: "yearly",
      assetId: 0,
      symbol: "",
      name: acc.name,
      assetClass: cls,
      physical: false,
      quantity: "1",
      unit: "",
      priceEur: null,
      priceDay: null,
      valueEur: money2(value),
      countedEur: money2(c.counted),
      category: cat,
      missingPrice: false,
      owner: c.owner,
      ownerChildId: c.ownerChildId,
      countedPct: c.countedPct,
      note: c.note,
    });
  }
  rows.sort((x, y) => x.accountName.localeCompare(y.accountName) || Number(y.valueEur) - Number(x.valueEur));

  const extraBank = D(input?.extraBankEur ?? 0);
  const extraOther = D(input?.extraOtherEur ?? 0);
  const extraDebts = D(input?.debtsEur ?? 0);
  const debts = extraDebts.plus(accountDebts);
  // Entered for the year as a whole: yours (shared with a fiscal partner by the allocation below).
  person.self.bank = person.self.bank.plus(extraBank);
  person.self.other = person.self.other.plus(extraOther);
  person.self.debts = person.self.debts.plus(extraDebts);
  other.other = other.other.plus(extraOther);
  const rates = ratesFor(config, year);
  if (!rates) warnings.push(`No box 3 rates for ${year}. Add them under "Rules & rates" to estimate the tax.`);
  else if (!rates.final)
    warnings.push(`The ${year} rates are provisional; the final bank and debt percentages follow after the year.`);
  const calculation = rates
    ? calculateBox3(
        {
          bank: totals.bank.plus(extraBank),
          other: totals.other.plus(extraOther),
          green: totals.exempt,
          debts,
          partner: fiscalPartner,
        },
        rates,
      )
    : null;

  const selfPct = D(input?.allocationSelfPct ?? 50);
  const part = (v: string, pct: Decimal) => money2(D(v).mul(pct).div(100));
  const allocation =
    fiscalPartner && calculation
      ? {
          selfPct: selfPct.toFixed(),
          self: {
            taxableBaseEur: part(calculation.taxableBaseEur, selfPct),
            benefitEur: part(calculation.benefitEur, selfPct),
            taxEur: part(calculation.netTaxEur, selfPct),
          },
          partner: {
            taxableBaseEur: part(calculation.taxableBaseEur, D(100).minus(selfPct)),
            benefitEur: part(calculation.benefitEur, D(100).minus(selfPct)),
            taxEur: part(calculation.netTaxEur, D(100).minus(selfPct)),
          },
        }
      : null;
  const personOut = (p: ReturnType<typeof blank>): PersonTotals => ({
    bank: money2(p.bank),
    other: money2(p.other),
    green: money2(p.green),
    debts: money2(p.debts),
  });

  return {
    year,
    peildatum: `${year}-01-01`,
    valuedAt,
    partner: fiscalPartner,
    rates,
    totals: {
      bank: money2(totals.bank.plus(extraBank)),
      other: money2(totals.other.plus(extraOther)),
      exempt: money2(totals.exempt),
      excluded: money2(totals.excluded),
    },
    otherBreakdown: {
      investments: money2(other.investments),
      crypto: money2(other.crypto),
      metals: money2(other.metals),
      cash: money2(other.cash),
      other: money2(other.other),
    },
    extra: { bankEur: money2(extraBank), otherEur: money2(extraOther), debtsEur: money2(extraDebts) },
    debtsEur: money2(debts),
    calculation,
    perPerson: { self: personOut(person.self), partner: fiscalPartner ? personOut(person.partner) : null },
    allocation,
    rows,
    warnings: [...new Set(warnings)],
  };
}
