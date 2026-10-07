import { useState } from "react";
import { Swatch } from "../components/ui";
import { eur, pct } from "../format";
import { t } from "../i18n";

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface RankedRow {
  key: string;
  label: string;
  sub?: string;
  value: number;
  // Parts of the row, coloured by what they are (e.g. asset class). One segment for a plain bar.
  segments: Segment[];
}

/**
 * Part-to-whole across many items: one horizontal bar per row, longest first, all on one scale
 * (the largest row), so lengths compare directly. Segments are separated by a 2px surface gap and
 * have rounded outer ends; each has a hover tooltip. Labels and values are text, never colour alone.
 */
export function RankedBars({ rows, legend }: { rows: RankedRow[]; legend?: { label: string; color: string }[] }) {
  const [hover, setHover] = useState<{ row: string; seg: string } | null>(null);
  const shown = rows.filter((r) => r.value > 0);
  const total = shown.reduce((a, r) => a + r.value, 0);
  const max = Math.max(0, ...shown.map((r) => r.value));
  if (total <= 0) return <p className="text-sm text-muted">Nothing to show yet.</p>;

  return (
    <div>
      {legend && legend.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2" aria-label={t("Legend")}>
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <Swatch color={l.color} /> {l.label}
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-3">
        {shown.map((r) => {
          const segs = r.segments.filter((s) => s.value > 0);
          const active = hover?.row === r.key ? segs.find((s) => s.key === hover.seg) : undefined;
          return (
            <li key={r.key} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 truncate text-ink">{r.label}</span>
                {r.sub && <span className="shrink-0 text-xs text-muted">{r.sub}</span>}
                <span className="tabular ml-auto shrink-0 text-ink-2">{eur(r.value, { decimals: 0 })}</span>
                <span className="tabular w-14 shrink-0 text-right text-muted">
                  {pct((r.value / total) * 100, { sign: false })}
                </span>
              </div>
              <div className="relative mt-1">
                <div className="flex h-2.5 gap-[2px]" style={{ width: `${(r.value / max) * 100}%` }}>
                  {segs.map((s) => (
                    <div
                      key={s.key}
                      onMouseEnter={() => setHover({ row: r.key, seg: s.key })}
                      onMouseLeave={() => setHover(null)}
                      className="h-full min-w-[3px] first:rounded-l last:rounded-r transition-opacity"
                      style={{
                        width: `${(s.value / r.value) * 100}%`,
                        background: s.color,
                        opacity: hover && (hover.row !== r.key || hover.seg !== s.key) ? 0.45 : 1,
                      }}
                    />
                  ))}
                </div>
                {active && (
                  <div className="pointer-events-none absolute left-0 top-4 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                    <div className="flex items-center gap-1.5 font-medium text-ink">
                      <Swatch color={active.color} /> {active.label}
                    </div>
                    <div className="tabular mt-0.5 text-ink-2">
                      {eur(active.value)} ·{" "}
                      {t("{pct} of {label}", {
                        pct: pct((active.value / r.value) * 100, { sign: false }),
                        label: r.label,
                      })}
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
