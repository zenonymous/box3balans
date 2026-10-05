import { z } from "zod";

/** A non-negative decimal given as string or number, normalised to a plain decimal string. */
export const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(",", "."))
  .refine((v) => /^\d+(\.\d+)?$/.test(v), "Must be a non-negative number");

export const currencyCode = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z]{3}$/.test(v), "Must be a 3-letter currency code");

export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");

export const idParam = z.object({ id: z.coerce.number().int().positive() });
