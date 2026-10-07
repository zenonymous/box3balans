import { useState } from "react";
import { eur, pct } from "../format";
import { Swatch } from "../components/ui";
import { t } from "../i18n";

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * Part-to-whole as a single 100% stacked bar with a 2px surface gap between segments,
 * a hover tooltip per segment, and a legend that carries labels and values (never colour alone).
 */
export function AllocationBar({ slices }: { slices: Slice[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <p className="text-sm text-muted">Nothing to show yet.</p>;
  const active = shown.find((s) => s.key === hover);

  return (
    <div>
      <div className="relative">
        <div className="flex h-7 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={t("Allocation")}>
          {shown.map((s) => (
            <div
              key={s.key}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              className="h-full min-w-[3px] first:rounded-l last:rounded-r transition-opacity"
              style={{
                width: `${(s.value / total) * 100}%`,
                background: s.color,
                opacity: hover && hover !== s.key ? 0.45 : 1,
              }}
            />
          ))}
        </div>
        {active && (
          <div className="pointer-events-none absolute left-1/2 top-9 z-10 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
            <div className="flex items-center gap-1.5 font-medium text-ink">
              <Swatch color={active.color} /> {active.label}
            </div>
            <div className="tabular mt-0.5 text-ink-2">
              {eur(active.value)} · {pct((active.value / total) * 100, { sign: false })}
            </div>
          </div>
        )}
      </div>
      <ul className="mt-4 flex flex-col gap-2">
        {shown.map((s) => (
          <li
            key={s.key}
            className="flex items-center gap-2 text-sm"
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
          >
            <Swatch color={s.color} />
            <span className="text-ink">{s.label}</span>
            <span className="tabular ml-auto text-ink-2">{eur(s.value, { decimals: 0 })}</span>
            <span className="tabular w-14 text-right text-muted">{pct((s.value / total) * 100, { sign: false })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
