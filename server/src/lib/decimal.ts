import { Decimal } from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export { Decimal };

export const D = (v: Decimal.Value | null | undefined): Decimal => new Decimal(v ?? 0);

export const ZERO = new Decimal(0);

// Serialise for NUMERIC columns / JSON responses.
export const str = (d: Decimal): string => d.toFixed();

// Rounded string for API responses where full precision is noise.
export const money2 = (d: Decimal): string => d.toFixed(2);

export const TROY_OUNCE_G = new Decimal("31.1034768");
