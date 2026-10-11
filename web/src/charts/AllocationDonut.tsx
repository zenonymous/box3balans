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

const R = 50;
const INNER = 34;

// One ring segment from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise).
function arc(a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(60 + r * Math.sin(a)).toFixed(3)} ${(60 - r * Math.cos(a)).toFixed(3)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(INNER, a1)} A ${INNER} ${INNER} 0 ${large} 0 ${p(INNER, a0)} Z`;
}

/**
 * Part-to-whole as a donut with a 2px surface gap between segments. The centre shows the total, or
 * the hovered segment; the legend carries labels, amounts and shares (never colour alone).
 */
export function AllocationDonut({ slices }: { slices: Slice[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <p className="text-sm text-muted">{t("Nothing to show yet.")}</p>;
  const active = shown.find((s) => s.key === hover);

  const angle = (v: number) => (v / total) * 2 * Math.PI;
  const segments = shown.map((s, i) => {
    const before = shown.slice(0, i).reduce((a, x) => a + x.value, 0);
    return { ...s, a0: angle(before), a1: angle(before + s.value) };
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 120 120" className="size-full" role="img" aria-label={t("Allocation")}>
          {segments.length === 1 ? (
            <circle
              cx="60"
              cy="60"
              r={(R + INNER) / 2}
              fill="none"
              stroke={segments[0]!.color}
              strokeWidth={R - INNER}
            />
          ) : (
            segments.map((s) => (
              <path
                key={s.key}
                d={arc(s.a0, s.a1)}
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth="1.5"
                strokeLinejoin="round"
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
                className="transition-opacity"
                style={{ opacity: hover && hover !== s.key ? 0.45 : 1 }}
              />
            ))
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="max-w-24 truncate text-xs text-ink-2">{active ? active.label : t("Total")}</div>
          <div className="tabular text-sm font-semibold text-ink">
            {active ? pct((active.value / total) * 100, { sign: false }) : eur(total, { decimals: 0 })}
          </div>
        </div>
      </div>
      <ul className="flex w-full flex-col gap-2">
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
