import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link } from "react-router";
import { date, dateInputText, eur, getLocale, parseDateInput, parseNumberInput, pct, unambiguous } from "../format";
import { t } from "../i18n";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

interface ButtonLook {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}

const buttonCls = ({ variant = "secondary", size = "md" }: ButtonLook, className?: string) =>
  cx(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
    variant === "primary" && "bg-accent-fill text-accent-ink hover:opacity-90",
    variant === "secondary" && "border border-line bg-surface text-ink hover:bg-surface-2",
    variant === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink",
    variant === "danger" && "border border-line bg-surface text-loss hover:bg-danger-bg",
    className,
  );

export function Button({ variant, size, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & ButtonLook) {
  return <button type="button" {...props} className={buttonCls({ variant, size }, className)} />;
}

/** A link that looks like a Button: `to` for a page in the app, `href` for a file to download. */
export function ButtonLink({
  to,
  variant,
  size,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & ButtonLook & { to?: string }) {
  const cls = buttonCls({ variant, size }, className);
  return to ? <Link to={to} {...props} className={cls} /> : <a {...props} className={cls} />;
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
  const noteId = `${id}-note`;
  const note = error ?? hint;
  // The hint or error is read out with the control that got the id (WCAG 1.3.1).
  const child = children(id);
  const control =
    note && isValidElement<{ id?: string; "aria-describedby"?: string }>(child) && child.props.id === id
      ? cloneElement(child as ReactElement<Record<string, unknown>>, {
          "aria-describedby": [child.props["aria-describedby"], noteId].filter(Boolean).join(" "),
          ...(error ? { "aria-invalid": true } : {}),
        })
      : child;
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      {control}
      {note && (
        <p id={noteId} className={cx("text-xs", error ? "text-loss" : "text-muted")}>
          {note}
        </p>
      )}
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
        aria-invalid={parsed.value === null || props["aria-invalid"] || undefined}
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

/**
 * A date field that reads what you type day first (27-7-2020; see parseDateInput), with a calendar
 * button. The browser's own date field orders day and month by the browser's language, so in an
 * English browser "27" became month 2, day 7. Gives and takes an ISO day.
 */
export function DateInput({
  id,
  value,
  onChange,
  max,
  required,
}: {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  max?: string;
  required?: boolean;
}) {
  const [text, setText] = useState(() => dateInputText(value));
  const [seen, setSeen] = useState(value);
  // A new value from outside (a reset, another field) replaces what was typed.
  if (value !== seen) {
    setSeen(value);
    if (parseDateInput(text) !== value) setText(dateInputText(value));
  }
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const parsed = parseDateInput(text);
  const problem =
    parsed === null
      ? t("Enter a date as dd-mm-yyyy")
      : parsed && max && parsed > max
        ? t("Can't be after {date}", { date: date(max) })
        : "";
  useEffect(() => input.current?.setCustomValidity(problem), [problem]);
  const applyTyped = (s: string) => {
    setText(s);
    const iso = parseDateInput(s);
    if (iso !== null) onChange(iso);
  };
  return (
    <>
      <div className="relative">
        <input
          ref={input}
          id={id}
          value={text}
          onChange={(e) => applyTyped(e.target.value)}
          onBlur={() => parsed && setText(dateInputText(parsed))}
          placeholder={t("dd-mm-yyyy")}
          inputMode="numeric"
          autoComplete="off"
          required={required}
          aria-invalid={!!problem || undefined}
          className={cx(inputCls, "w-full pr-9", problem && "border-loss")}
        />
        <button
          type="button"
          onClick={() => {
            // Browsers may refuse the picker (old ones lack it); then typing is the way.
            try {
              picker.current!.showPicker();
            } catch {
              input.current?.focus();
            }
          }}
          aria-label={t("Choose from calendar")}
          title={t("Choose from calendar")}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-2 hover:text-ink"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="12" height="11" rx="1.5" />
            <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
          </svg>
        </button>
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={parsed || ""}
          max={max}
          onChange={(e) => e.target.value && applyTyped(dateInputText(e.target.value))}
          className="pointer-events-none absolute bottom-0 left-0 h-0 w-full opacity-0"
        />
      </div>
      {problem && text !== "" && <span className="text-xs text-loss">{problem}</span>}
      {!problem && parsed && text !== dateInputText(parsed) && (
        <span className="tabular text-xs text-muted">= {date(parsed)}</span>
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
  // The visible title is the dialog's name for screen readers.
  const titleId = useId();
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
      aria-labelledby={titleId}
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
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
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
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "bg-surface-2 text-ink-2",
        tone === "warn" && "bg-warn-bg text-warn",
        tone === "danger" && "bg-danger-bg text-loss",
        tone === "accent" && "bg-accent/15 text-accent-text",
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

/**
 * An ⓘ that explains a term: on mouse hover, on keyboard focus, and on tap (phones have no hover).
 * Placed with fixed coordinates kept inside the window, so a tile at the edge doesn't push it off.
 */
export function InfoTip({ text, label }: { text: string; label: string }) {
  // Hover and keyboard focus show it while they last; a click or tap pins it until the next one,
  // a tap elsewhere, Escape, scrolling or leaving the button.
  const [open, setOpen] = useState<{ left: number; top: number; width: number; pinned: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const id = useId();
  const show = (pinned: boolean) => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(272, window.innerWidth - 32);
    const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, 16), window.innerWidth - 16 - width);
    setOpen({ left, top: r.bottom + 6, width, pinned });
  };
  const hide = () => setOpen(null);
  const isOpen = open != null;
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    // Phones don't move focus to a tapped button, so blur alone wouldn't close it.
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!button.current?.contains(target) && !tip.current?.contains(target)) hide();
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [isOpen]);
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={t("Explanation of {term}", { term: label.toLowerCase() })}
        aria-describedby={open ? id : undefined}
        aria-expanded={isOpen}
        onClick={() => (open?.pinned ? hide() : show(true))}
        onPointerEnter={(e) => e.pointerType === "mouse" && !open && show(false)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setOpen((o) => (o?.pinned ? o : null))}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && !open && show(false)}
        onBlur={hide}
        className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted before:absolute before:-inset-1 before:content-[''] hover:text-ink"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7.2v4M8 4.6v.1" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <span
          ref={tip}
          role="tooltip"
          id={id}
          style={{ left: open.left, top: open.top, width: open.width }}
          className="fixed z-30 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-normal leading-relaxed text-ink-2 shadow-lg"
        >
          {text}
        </span>
      )}
    </>
  );
}

export function Stat({ label, value, sub, info }: { label: string; value: ReactNode; sub?: ReactNode; info?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center gap-1 text-xs font-medium text-ink-2">
        {label}
        {info && <InfoTip text={info} label={label} />}
      </div>
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
  // One Tab stop for the group; arrow keys, Home and End move between the options (ARIA tabs pattern).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = options.findIndex((o) => o.value === value);
    const to =
      e.key === "ArrowRight"
        ? (at + 1) % options.length
        : e.key === "ArrowLeft"
          ? (at - 1 + options.length) % options.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? options.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(options[to]!.value);
    (e.currentTarget.children[to] as HTMLElement | undefined)?.focus();
  };
  return (
    // Scrolls inside itself when the options don't fit, so a narrow screen doesn't scroll sideways.
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={cx(
            "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium",
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
