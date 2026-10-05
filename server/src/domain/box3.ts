import { eq, min } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client.js";
import { metalItems, settings, transactions } from "../db/schema.js";
import { D, Decimal, ZERO, money2 } from "../lib/decimal.js";
import { holdingsOn } from "./valuation.js";
import { localDay } from "../lib/time.js";

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

const ACCOUNT_KINDS = ["broker", "exchange", "vault", "wallet", "bank", "physical", "other"] as const;
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
  assetId: number;
  symbol: string;
  name: string;
  assetClass: string;
  physical: boolean;
  quantity: string;
  unit: string;
  priceEur: string | null;
  priceDay: string | null;
  valueEur: string;
  category: Category;
  missingPrice: boolean;
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
  calculation: Box3Calculation | null;
  rows: Box3Row[];
  warnings: string[];
}

/** First and last tax years with something to report: the year after the first activity, until now. */
export async function availableYears(db: DB): Promise<number[]> {
  const [[t], [m]] = await Promise.all([
    db.select({ first: min(transactions.occurredAt) }).from(transactions),
    db.select({ first: min(metalItems.purchaseDate) }).from(metalItems),
  ]);
  const firsts = [
    t?.first ? localDay(new Date(t.first)).slice(0, 4) : null,
    m?.first ? String(m.first).slice(0, 4) : null,
  ].filter((x): x is string => !!x);
  if (firsts.length === 0) return [];
  const from = Math.min(...firsts.map(Number)) + 1;
  const to = new Date().getUTCFullYear();
  const out: number[] = [];
  for (let y = to; y >= from; y--) out.push(y);
  return out;
}

export async function computeBox3Year(db: DB, year: number, config: Box3Config): Promise<Box3Year> {
  const valuedAt = `${year - 1}-12-31`;
  const holdings = await holdingsOn(db, valuedAt);
  const totals: Record<Category, Decimal> = { bank: ZERO, other: ZERO, exempt: ZERO, excluded: ZERO };
  const other = { investments: ZERO, crypto: ZERO, metals: ZERO, cash: ZERO, other: ZERO };
  const warnings: string[] = [];
  const rows: Box3Row[] = holdings.map((h) => {
    const cat = categoryOf(config, h);
    totals[cat] = totals[cat].plus(h.valueEur);
    if (cat === "other") {
      const k =
        h.assetClass === "stock" || h.assetClass === "etf"
          ? "investments"
          : h.assetClass === "crypto"
            ? "crypto"
            : h.assetClass === "metal"
              ? "metals"
              : h.assetClass === "cash"
                ? "cash"
                : "other";
      other[k] = other[k].plus(h.valueEur);
    }
    const missing = h.priceEur === null;
    if (missing) warnings.push(`No price for ${h.symbol} on or before ${valuedAt}; it is counted as €0.`);
    else if (h.priceDay && Date.parse(valuedAt) - Date.parse(h.priceDay) > 10 * 86_400_000) {
      warnings.push(`${h.symbol} is valued at its close of ${h.priceDay}, the latest price before ${valuedAt}.`);
    }
    if (h.quantity.lt(0))
      warnings.push(`${h.accountName} has a negative ${h.symbol} balance on ${valuedAt}; check its history.`);
    return {
      accountId: h.accountId,
      accountName: h.accountName,
      accountKind: h.accountKind,
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
      category: cat,
      missingPrice: missing,
    };
  });

  const input = config.years[String(year)];
  const extraBank = D(input?.extraBankEur ?? 0);
  const extraOther = D(input?.extraOtherEur ?? 0);
  const debts = D(input?.debtsEur ?? 0);
  const partner = input?.partner ?? false;
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
          partner,
        },
        rates,
      )
    : null;

  return {
    year,
    peildatum: `${year}-01-01`,
    valuedAt,
    partner,
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
    extra: { bankEur: money2(extraBank), otherEur: money2(extraOther), debtsEur: money2(debts) },
    calculation,
    rows,
    warnings: [...new Set(warnings)],
  };
}
