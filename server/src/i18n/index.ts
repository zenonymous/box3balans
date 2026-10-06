import type { Language } from "../domain/settings.js";
import { NL } from "./nl.js";

export type Params = Record<string, string | number>;

const fill = (s: string, p?: Params) =>
  p ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m)) : s;

/**
 * Server messages people see (warnings, attention items, errors): written in English in the code,
 * translated with the dictionary in nl.ts. `{name}` placeholders are filled from `params`.
 */
export function tr(lang: Language, text: string, params?: Params): string {
  return fill(lang === "nl" ? (NL[text] ?? text) : text, params);
}

/** Singular or plural; `{n}` is the count. */
export function trn(lang: Language, n: number, one: string, other: string, params?: Params): string {
  return tr(lang, n === 1 ? one : other, { n, ...params });
}
