import type { AccountKind, AccountOwner, AttributionNote, Box3Category, Custody, Person } from "./api";
import { t } from "./i18n";

/** Names for account kinds, with an example, in the current language. */
export const kindLabel = (k: string): string =>
  ({
    broker: t("Broker"),
    exchange: t("Crypto exchange"),
    wallet: t("Crypto wallet"),
    vault: t("Metal vault"),
    physical: t("Physical storage"),
    bank: t("Bank account"),
    other: t("Other"),
    property: t("Home or other property"),
    receivable: t("Money lent to others"),
    debt: t("Debt"),
    insurance: t("Capital insurance"),
  })[k] ?? k;

export const kindHint = (k: AccountKind): string =>
  ({
    broker: t("DEGIRO, Trade Republic, Interactive Brokers"),
    exchange: t("Bitvavo, Kraken, Coinbase"),
    wallet: t("Hardware or software wallet"),
    vault: t("Goldrepublic, BullionVault"),
    physical: t("Home safe, safe deposit box"),
    bank: t("Savings or current account"),
    other: "",
    property: t("A second home, a home you let, land: not the home you live in (that's box 1)"),
    receivable: t("A loan to family or friends"),
    debt: t("A consumer loan, study debt or a loan for a second home: not your main mortgage"),
    insurance: t("A kapitaalverzekering or other policy with a surrender value"),
  })[k];

export const KIND_ORDER: AccountKind[] = [
  "bank",
  "broker",
  "exchange",
  "wallet",
  "vault",
  "physical",
  "property",
  "receivable",
  "insurance",
  "debt",
  "other",
];

export const categoryLabel = (c: Box3Category | "debt"): string =>
  ({
    bank: t("Bank balances"),
    other: t("Other assets"),
    exempt: t("Green investments"),
    excluded: t("Not in box 3"),
    debt: t("Debts"),
  })[c];

/** Whose an account is, e.g. "You", "Sam", "Joint (60% you)", "Kim". */
export function ownerLabel(
  a: { owner: AccountOwner; ownerChildId: number | null; jointSelfPct?: string },
  people: Person[],
): string {
  const name = (role: Person["role"]) => people.find((p) => p.role === role)?.name;
  switch (a.owner) {
    case "self":
      return t("You");
    case "partner":
      return name("partner") ?? t("Partner");
    case "joint":
      return a.jointSelfPct && Number(a.jointSelfPct) !== 50
        ? t("Joint ({pct}% yours)", { pct: Number(a.jointSelfPct) })
        : t("Joint");
    case "child":
      return people.find((p) => p.id === a.ownerChildId)?.name ?? t("Child");
  }
}

/** Why (part of) an account doesn't count in your box 3. */
export const noteLabel = (n: AttributionNote): string =>
  ({
    "partner-not-fiscal": t("Your partner's, who isn't your fiscal partner this year: in their own return"),
    "joint-partner-share": t("Only your share counts: your partner isn't your fiscal partner this year"),
    "child-adult": t("Was 18 or older on 1 January: files their own return"),
    "child-other-parent": t("Half counts for the other parent"),
    "child-missing": t("The child was removed from the household; counted as yours"),
  })[n];

export const custodyLabel = (c: Custody): string =>
  ({
    together: t("Both of us (half each)"),
    self: t("Only me"),
    self_half: t("Me and someone outside the household (half counts for me)"),
    partner: t("Only my partner"),
  })[c];
