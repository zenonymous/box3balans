import { tr } from "../i18n/index.js";
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** `what` is already translated, e.g. notFound(tr("Account")). */
export const notFound = (what: string) => new HttpError(404, tr("{what} not found", { what }));
export const badRequest = (msg: string) => new HttpError(400, msg);
export const notInDemo = () => new HttpError(403, tr("Not available in the demo"));

/** Postgres SQLSTATE of a database error, looking through driver/ORM wrappers. */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}
