import { asc } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { type accounts, persons } from "../db/schema.js";
import { D, type Decimal } from "../lib/decimal.js";

export type Person = typeof persons.$inferSelect;
type Account = typeof accounts.$inferSelect;

export interface Household {
  self: Person | null;
  partner: Person | null;
  children: Person[];
}

export async function loadHousehold(db: DB): Promise<Household> {
  const rows = await db.select().from(persons).orderBy(asc(persons.id));
  return {
    self: rows.find((p) => p.role === "self") ?? null,
    partner: rows.find((p) => p.role === "partner") ?? null,
    children: rows.filter((p) => p.role === "child"),
  };
}

/** Under 18 on `day` (a child without a birth date counts as a minor). */
export function isMinorOn(child: Pick<Person, "birthDate">, day: string): boolean {
  if (!child.birthDate) return true;
  const [y, m, d] = child.birthDate.split("-");
  return day < `${Number(y) + 18}-${m}-${d}`;
}

/**
 * Why an account (or part of it) doesn't count in your box 3 for a year:
 * - partner-not-fiscal: it's your partner's, who isn't your fiscal partner that year
 * - joint-partner-share: the part of a joint account that's your partner's (not your fiscal partner)
 * - child-adult: the child was 18 or older on 1 January, and files their own return
 * - child-other-parent: a child's half that counts for the other parent
 * - child-missing: the child was removed from the household; counted as yours
 */
export type AttributionNote =
  "partner-not-fiscal" | "joint-partner-share" | "child-adult" | "child-other-parent" | "child-missing";

/** The fractions of an account that count for you and for your fiscal partner. */
export interface Attribution {
  self: Decimal;
  partner: Decimal;
  note?: AttributionNote;
}

/**
 * Whose box 3 an account counts in for `year` (peildatum 1 January), from your side: yours, your
 * fiscal partner's (only when you have one that year), or neither. Minor children's assets count for
 * the parents with custody, half each; an adult child (18 on 1 January) files their own return.
 */
export function attribute(
  account: Pick<Account, "owner" | "ownerChildId" | "jointSelfPct">,
  household: Household,
  year: number,
  fiscalPartner: boolean,
): Attribution {
  const one = D(1);
  const half = D("0.5");
  const zero = D(0);
  switch (account.owner) {
    case "self":
      return { self: one, partner: zero };
    case "partner":
      return fiscalPartner ? { self: zero, partner: one } : { self: zero, partner: zero, note: "partner-not-fiscal" };
    case "joint": {
      const mine = D(account.jointSelfPct).div(100);
      return fiscalPartner
        ? { self: mine, partner: one.minus(mine) }
        : { self: mine, partner: zero, note: "joint-partner-share" };
    }
    case "child": {
      const child = household.children.find((c) => c.id === account.ownerChildId);
      if (!child) return { self: one, partner: zero, note: "child-missing" };
      if (!isMinorOn(child, `${year}-01-01`)) return { self: zero, partner: zero, note: "child-adult" };
      switch (child.custody) {
        case "together":
          return fiscalPartner
            ? { self: half, partner: half }
            : { self: half, partner: zero, note: "child-other-parent" };
        case "self":
          return { self: one, partner: zero };
        case "self_half":
          return { self: half, partner: zero, note: "child-other-parent" };
        case "partner":
          return fiscalPartner
            ? { self: zero, partner: one }
            : { self: zero, partner: zero, note: "child-other-parent" };
      }
    }
  }
  return { self: one, partner: zero };
}
