import type { HistoryPoint } from "./history.js";

const DAY_MS = 86_400_000;
const days = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;

/**
 * One day's return with flows: inflows count from the start of the day (they could be invested
 * that day), outflows at its end. Robust when a large deposit meets a tiny balance.
 */
function dayReturn(prev: number, cur: number, flow: number): number {
  const base = prev + Math.max(flow, 0);
  return base > 0 ? (cur - prev - flow) / base : 0;
}

/**
 * Time-weighted return over points[from+1 .. to]: how the investments did regardless of when money
 * went in or out (as fund returns are quoted). As a fraction, e.g. 0.12 = +12%.
 */
export function twr(points: HistoryPoint[], from: number, to: number): number {
  let growth = 1;
  for (let i = Math.max(from + 1, 1); i <= to; i++) {
    growth *= 1 + dayReturn(points[i - 1]!.totalEur, points[i]!.totalEur, points[i]!.flowEur);
  }
  return growth - 1;
}

/** Growth of 1 euro invested at the start, day by day (time-weighted), for charts. */
export function twrIndex(points: HistoryPoint[]): number[] {
  const out: number[] = [];
  let growth = 1;
  points.forEach((p, i) => {
    if (i > 0) growth *= 1 + dayReturn(points[i - 1]!.totalEur, p.totalEur, p.flowEur);
    out.push(growth);
  });
  return out;
}

export interface CashFlow {
  day: string;
  // From the investor's point of view: money put in is negative, money (or value) received positive.
  amount: number;
}

/**
 * Annualised internal rate of return of dated cash flows (XIRR), or null when there is none
 * (e.g. all flows have the same sign). Newton's method with a bisection fallback.
 */
export function xirr(flows: CashFlow[]): number | null {
  const fs = flows.filter((f) => f.amount !== 0);
  if (!fs.some((f) => f.amount > 0) || !fs.some((f) => f.amount < 0)) return null;
  const t0 = fs.reduce((m, f) => (f.day < m ? f.day : m), fs[0]!.day);
  const ts = fs.map((f) => ({ y: days(t0, f.day) / 365, a: f.amount }));
  const npv = (r: number) => ts.reduce((s, f) => s + f.a / (1 + r) ** f.y, 0);
  const dnpv = (r: number) => ts.reduce((s, f) => s - (f.y * f.a) / (1 + r) ** (f.y + 1), 0);

  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const v = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  // Bisection between -99.9999% and +100,000%: NPV falls as the rate rises for an
  // invest-then-receive pattern; find the sign change.
  let lo = -0.999999;
  let hi = 1000;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-9 || hi - lo < 1e-12) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface PeriodReturn {
  from: string; // value at the end of this day is the starting point
  to: string;
  startEur: number;
  endEur: number;
  flowsEur: number; // net money in (+) / out (−)
  resultEur: number; // end − start − flows
  twrPct: number | null;
  // Money-weighted return over the period (not annualised), so a year compares with its TWR.
  mwrPct: number | null;
}

const pct = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e4);

/** Index of the last point on or before `day`, or -1. */
function indexOn(points: HistoryPoint[], day: string): number {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.day <= day) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Cash flows of a period as the investor sees them: start value in, flows, end value out. */
export function periodCashFlows(points: HistoryPoint[], from: number, to: number): CashFlow[] {
  const out: CashFlow[] = [];
  if (from >= 0 && points[from]!.totalEur > 0) out.push({ day: points[from]!.day, amount: -points[from]!.totalEur });
  for (let i = from + 1; i <= to; i++)
    if (points[i]!.flowEur) out.push({ day: points[i]!.day, amount: -points[i]!.flowEur });
  out.push({ day: points[to]!.day, amount: points[to]!.totalEur });
  return out;
}

/** Returns between the end of `fromDay` (or the very start) and the end of `toDay`. */
export function periodReturn(points: HistoryPoint[], fromDay: string | null, toDay: string): PeriodReturn | null {
  const to = indexOn(points, toDay);
  if (to < 0) return null;
  const from = fromDay ? indexOn(points, fromDay) : -1;
  if (from >= to) return null;
  const startEur = from >= 0 ? points[from]!.totalEur : 0;
  const endEur = points[to]!.totalEur;
  let flowsEur = 0;
  for (let i = from + 1; i <= to; i++) flowsEur += points[i]!.flowEur;
  // Before the first point nothing was held; the first day's own flows start the series.
  const startIdx = from >= 0 ? from : 0;
  const twrValue = twr(points, startIdx, to);
  // From the very start (from = -1) the first day's flows are the starting investment.
  const rate = xirr(periodCashFlows(points, from, to));
  const span = days(from >= 0 ? points[from]!.day : points[0]!.day, points[to]!.day) / 365;
  const mwr = rate == null ? null : span > 0 ? (1 + rate) ** span - 1 : 0;
  return {
    from: from >= 0 ? points[from]!.day : points[0]!.day,
    to: points[to]!.day,
    startEur: Math.round(startEur * 100) / 100,
    endEur: Math.round(endEur * 100) / 100,
    flowsEur: Math.round(flowsEur * 100) / 100,
    resultEur: Math.round((endEur - startEur - flowsEur) * 100) / 100,
    twrPct: pct(twrValue),
    mwrPct: pct(mwr),
  };
}

/** Annualised version of a return over `years` years. */
export const annualise = (fraction: number, years: number) =>
  years > 0 ? (1 + fraction) ** (1 / years) - 1 : fraction;

export { indexOn, pct };
