/** Standard CSV (comma separated, dot decimals, RFC 4180 quoting) with a UTF-8 BOM for Excel. */
export function toCsv<T>(
  rows: T[],
  columns: { header: string; value: (row: T) => string | number | null | undefined }[],
): string {
  const esc = (v: string | number | null | undefined) => {
    let s = v == null ? "" : String(v);
    // Text starting with = + - @ (or tab/CR) would run as a formula in Excel/Sheets; numbers are left alone.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map((c) => esc(c.header)).join(","),
    ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(",")),
  ];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
