import { Fragment, cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { NL } from "./nl";

/**
 * Texts are written in English in the code and translated with the dictionary in nl.ts, keyed by
 * the English text. The app is Dutch unless the language is set to English (Settings). The language
 * is stored on the server (server messages use it too) and cached here, so the first paint is right.
 */
export type Lang = "nl" | "en";
const KEY = "lang";

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "nl" || v === "en") return v;
  } catch {
    // storage unavailable
  }
  return "nl";
}

const current: Lang = initial();
document.documentElement.lang = current;

export const getLang = () => current;

/** Locale for dates and month names (numbers have their own setting). */
export const dateLocale = () => (current === "nl" ? "nl-NL" : "en-GB");

/** Follows the server's setting; switching reloads the page so every text follows. */
export function followLanguage(lang: Lang | undefined) {
  if (!lang || lang === current) return;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // keeps the old language until storage works
    return;
  }
  location.reload();
}

export type Params = Record<string, string | number>;

const fill = (s: string, p?: Params) =>
  p ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m)) : s;

/** A text in the current language; `{name}` placeholders are filled from `params`. */
export function t(text: string, params?: Params): string {
  return fill(current === "nl" ? (NL[text] ?? text) : text, params);
}

/** Singular or plural; `{n}` is the count. */
export function tn(n: number, one: string, other: string, params?: Params): string {
  return t(n === 1 ? one : other, { n, ...params });
}

/**
 * A sentence with elements inside, kept whole for translation: tj("Read <0>the guide</0>.",
 * [<a href="…" />]) puts "the guide" (translated) inside the link.
 */
export function tj(text: string, elements: ReactElement[], params?: Params): ReactNode {
  const s = t(text, params);
  const out: ReactNode[] = [];
  const re = /<(\d+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const el = elements[Number(m[1])];
    out.push(el ? cloneElement(el, { key: out.length }, m[2]) : m[2]);
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return createElement(Fragment, null, ...out);
}
