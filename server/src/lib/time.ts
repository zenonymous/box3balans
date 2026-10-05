/**
 * Calendar days in the user's time zone (default Europe/Amsterdam). A trade at 00:30 on
 * 1 January Dutch time is 23:30 UTC on 31 December; for the Box 3 peildatum and yearly results it
 * belongs to 1 January. Configured via TIME_ZONE (set at startup with setTimeZone).
 */
let zone = process.env.TIME_ZONE || "Europe/Amsterdam";
let fmt = dayFormat(zone);
let wallFmt = wallClockFormat(zone);

function dayFormat(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
}

function wallClockFormat(tz: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
}

export function setTimeZone(tz: string) {
  zone = tz;
  fmt = dayFormat(tz);
  wallFmt = wallClockFormat(tz);
}

/** YYYY-MM-DD of `d` in the configured time zone. */
export const localDay = (d: Date): string => fmt.format(d);

/** Today's date in the configured time zone. */
export const localToday = (): string => localDay(new Date());

/** Milliseconds the configured zone is ahead of UTC at instant `t`. */
function offsetAt(t: number): number {
  const p = Object.fromEntries(wallFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return wall - Math.floor(t / 1000) * 1000;
}

/**
 * The instant at wall-clock time y-m-d h:mi:s in the configured time zone (e.g. a time in a broker's
 * CSV export). Times skipped by a DST change resolve to the hour after.
 */
export function fromLocal(y: number, m: number, d: number, h = 12, mi = 0, s = 0): Date {
  const wall = Date.UTC(y, m - 1, d, h, mi, s);
  let t = wall - offsetAt(wall);
  // Second pass for instants near a DST change, where the first guess used the wrong offset.
  t = wall - offsetAt(t);
  return new Date(t);
}
