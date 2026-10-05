/** Builds a standard CSV (comma separated, dot decimals, RFC 4180 quoting) and triggers a download. */
export function downloadCsv<T>(
  filename: string,
  rows: T[],
  columns: { header: string; value: (row: T) => string | number | null }[],
) {
  const esc = (v: string | number | null) => {
    let s = v == null ? "" : String(v);
    // Text starting with = + - @ (or tab/CR) would run as a formula in Excel/Sheets; numbers are left alone.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map((c) => esc(c.header)).join(","),
    ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(",")),
  ];
  // BOM so Excel detects UTF-8 (accented names, €).
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
