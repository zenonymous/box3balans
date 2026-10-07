import { z } from "zod";
import data from "./box3.json" with { type: "json" };

/**
 * The box 3 rules this version ships with, kept as data (box3.json) so a yearly update doesn't
 * touch the code. Checked when the app starts: a typo fails loudly instead of skewing the tax.
 */
const amount = z.string().regex(/^\d+(\.\d+)?$/);
const schema = z.object({
  checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  about: z.string(),
  years: z.record(
    z.string().regex(/^\d{4}$/),
    z.object({
      bankPct: amount,
      otherPct: amount,
      debtPct: amount,
      allowanceEur: amount,
      debtThresholdEur: amount,
      taxRatePct: amount,
      greenExemptEur: amount,
      greenCreditPct: amount,
      final: z.boolean(),
      source: z.string().url(),
    }),
  ),
  // Bands from low to high rent; a rent above the last band counts at 100%.
  leegwaarderatio: z
    .array(z.object({ upToRentPct: z.number().positive(), valuePct: z.number().min(0).max(100) }))
    .refine((b) => b.every((x, i) => i === 0 || x.upToRentPct > b[i - 1]!.upToRentPct), "Bands must go up"),
});

export const RULES = schema.parse(data);
export type YearRules = (typeof RULES.years)[string];
