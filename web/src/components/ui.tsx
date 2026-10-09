import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { eur, getLocale, parseNumberInput, pct, unambiguous } from "../format";
import { t } from "../i18n";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:opacity-90",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-surface-2",
        variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "border border-line bg-surface text-loss hover:bg-danger-bg",
        className,
      )}
    />
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4" : undefined}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-loss">{error}</p>}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

/**
 * A number field that reads input in the user's number format (see parseNumberInput) and, as soon
 * as a separator is typed, shows how it was read ("= 5 000"), so 5.000 can't silently become 5.
 */
export function AmountInput(props: InputHTMLAttributes<HTMLInputElement> & { value: string }) {
  const raw = props.value ?? "";
  const parsed = parseNumberInput(raw);
  const showReading = /[.,]/.test(raw) && parsed.value !== null && parsed.value !== "";
  return (
    <>
      <input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={parsed.value === null || undefined}
        className={cx(inputCls, parsed.value === null && "border-loss", props.className)}
      />
      {parsed.value === null && <span className="text-xs text-loss">{t("Not a number")}</span>}
      {showReading && (
        <span className={cx("tabular text-xs", parsed.ambiguous ? "text-warn" : "text-muted")}>
          = {unambiguous(parsed.value!)}
          {parsed.ambiguous &&
            ` ${getLocale().startsWith("en") ? t("(thousands; for decimals use a dot)") : t("(thousands; for decimals use a comma)")}`}
        </span>
      )}
    </>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, "pr-8", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={2} {...props} className={cx(inputCls, props.className)} />;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Start in the first field, not on the close button the browser picks.
      d.querySelector<HTMLElement>(
        "[data-modal-body] :is(input:not([type=hidden]), select, textarea):not([disabled])",
      )?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50",
        wide ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-ink-2 hover:bg-surface-2"
              aria-label={t("Close")}
            >
              ✕
            </button>
          </header>
          <div data-modal-body className="overflow-y-auto px-5 py-4">
            {children}
          </div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Gain/loss: sign + arrow carry the meaning; colour reinforces it. */
export function Delta({
  value,
  percent,
  className,
}: {
  value?: string | null;
  percent?: string | null;
  className?: string;
}) {
  const basis = Number(value ?? percent ?? 0);
  const tone = basis > 0 ? "text-gain" : basis < 0 ? "text-loss" : "text-ink-2";
  const arrow = basis > 0 ? "▲" : basis < 0 ? "▼" : "";
  if (value == null && percent == null) return <span className="text-muted">—</span>;
  return (
    <span className={cx("tabular whitespace-nowrap", tone, className)}>
      {arrow && (
        <span aria-hidden className="mr-0.5 text-[0.7em]">
          {arrow}
        </span>
      )}
      {value != null && eur(value, { sign: true })}
      {value != null && percent != null && " "}
      {percent != null && (
        <span className={value != null ? "opacity-80" : undefined}>
          {value != null ? `(${pct(percent)})` : pct(percent)}
        </span>
      )}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warn" | "danger" | "accent";
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "bg-surface-2 text-ink-2",
        tone === "warn" && "bg-warn-bg text-warn",
        tone === "danger" && "bg-danger-bg text-loss",
        tone === "accent" && "bg-accent/15 text-accent",
      )}
    >
      {children}
    </span>
  );
}

export function Alert({ tone = "warn", children }: { tone?: "warn" | "danger"; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={cx(
        "rounded-lg px-3 py-2 text-sm",
        tone === "warn" ? "bg-warn-bg text-warn" : "bg-danger-bg text-loss",
      )}
    >
      <span aria-hidden className="mr-1.5">
        {tone === "warn" ? "⚠" : "⛔"}
      </span>
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-sm text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function Spinner() {
  return <div className="py-10 text-center text-sm text-muted">{t("Loading…")}</div>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs">{sub}</div>}
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: color }} />;
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md px-2.5 py-1 text-xs font-medium",
            value === o.value ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export { cx };
