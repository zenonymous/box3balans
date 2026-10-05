/**
 * Calendar days in the user's time zone (default Europe/Amsterdam). A trade at 00:30 on
 * 1 January Dutch time is 23:30 UTC on 31 December; for the Box 3 peildatum and yearly results it
 * belongs to 1 January. Configured via TIME_ZONE (set at startup with setTimeZone).
 */
let zone = process.env.TIME_ZONE || "Europe/Amsterdam";
let fmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });

export function setTimeZone(tz: string) {
  zone = tz;
  fmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
}

/** YYYY-MM-DD of `d` in the configured time zone. */
export const localDay = (d: Date): string => fmt.format(d);

/** Today's date in the configured time zone. */
export const localToday = (): string => localDay(new Date());
