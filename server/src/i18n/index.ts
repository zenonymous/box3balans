import { z } from "zod";
import type { Language } from "../domain/settings.js";
import { NL } from "./nl.js";

export type Params = Record<string, string | number>;

// Box3balans has one user, so one language for every message; settings.ts keeps it current.
let current: Language = "nl";
z.config(z.locales.nl());

/** Follows the app's language setting; also switches zod's validation messages. */
export function useMessageLanguage(lang: Language) {
  if (lang === current) return;
  current = lang;
  z.config(lang === "nl" ? z.locales.nl() : z.locales.en());
}

export const messageLanguage = () => current;

const fill = (s: string, p?: Params) =>
  p ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m)) : s;

/**
 * Server messages people see (warnings, attention items, errors): written in English in the code,
 * translated with the dictionary in nl.ts. `{name}` placeholders are filled from `params`.
 * Messages stored with a sync result keep the language they were made in until the next sync.
 */
export function tr(text: string, params?: Params): string {
  return fill(current === "nl" ? (NL[text] ?? text) : text, params);
}

/** Marks a text kept in a constant (labels, instructions) for translation where it's shown: tr(value). */
export const msg = (text: string) => text;

/** Singular or plural; `{n}` is the count. */
export function trn(n: number, one: string, other: string, params?: Params): string {
  return tr(n === 1 ? one : other, { n, ...params });
}
