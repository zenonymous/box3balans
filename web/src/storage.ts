import { useState } from "react";

/**
 * An on/off choice remembered in this browser, such as a checkbox. Without stored choice, or when the
 * browser blocks storage, it is `fallback`.
 */
export function useStoredFlag(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v === "true";
    } catch {
      return fallback;
    }
  });
  const set = (v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(key, String(v));
    } catch {}
  };
  return [value, set];
}
