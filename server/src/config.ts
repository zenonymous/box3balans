import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("production"),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default("0.0.0.0"),
  // Postgres connection string. When unset, an embedded PGlite database is used (dev/tests).
  DATABASE_URL: z.string().optional(),
  // Alternatively the standard libpq variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT).
  PGHOST: z.string().optional(),
  PGPASSWORD: z.string().optional(),
  // The Docker image keeps a generated database password here (see docker-entrypoint.sh).
  PGPASSWORD_FILE: z.string().optional(),
  PGLITE_DIR: z.string().default("./.data/pglite"),
  // Used to derive the key that encrypts exchange API secrets at rest. Either set directly, or
  // read from APP_SECRET_FILE (the Docker image generates one there on first start).
  APP_SECRET: z.string().optional(),
  APP_SECRET_FILE: z.string().optional(),
  // Set to true when served over HTTPS (e.g. behind a reverse proxy).
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  // Only behind a reverse proxy: lets the app use X-Forwarded-For for the client IP (rate limits).
  // "false" (default, the app is reached directly), "true", a hop count, or proxy IPs/CIDRs.
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v): boolean | number | string =>
      v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v,
    ),
  // Calendar used for "which day/year did this happen" (Box 3 peildatum, yearly results).
  TIME_ZONE: z
    .string()
    .default("Europe/Amsterdam")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone"),
  PRICE_REFRESH_MINUTES: z.coerce.number().int().min(1).default(15),
  // How often exchange/broker connections sync automatically. 0 disables automatic syncing.
  SYNC_INTERVAL_HOURS: z.coerce.number().min(0).default(6),
  // Disable the background scheduler (tests, one-off scripts).
  SCHEDULER: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  WEB_DIST: z.string().default("../web/dist"),
  // Automatic backups (gzipped JSON of all data). 0 disables the schedule; manual backups still work.
  BACKUP_DIR: z.string().default("./backups"),
  BACKUP_INTERVAL_HOURS: z.coerce.number().min(0).default(24),
  // How many automatic backups to keep (manual and pre-restore backups are never deleted).
  BACKUP_KEEP: z.coerce.number().int().min(1).default(14),
  // Encrypts backups (AES-256-GCM, key from scrypt) so they can be copied off-site safely.
  BACKUP_PASSPHRASE: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || v.length >= 12, "BACKUP_PASSPHRASE must be at least 12 characters"),
  LOG_LEVEL: z.string().default("info"),
  // Demo mode: an example household in an in-memory database, signed in automatically, nothing kept.
  DEMO: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Where the running code's source can be found (AGPL); the Docker build sets it.
  SOURCE_URL: z.string().default("https://github.com/OWNER/box3balans"),
});

export type Config = Omit<z.infer<typeof schema>, "APP_SECRET" | "PGPASSWORD"> & {
  APP_SECRET: string;
  PGPASSWORD?: string;
};

/** A value given directly, else the trimmed contents of its file (when that exists). */
function fromFile(value: string | undefined, file: string | undefined): string | undefined {
  if (value) return value;
  if (!file || !fs.existsSync(file)) return undefined;
  return fs.readFileSync(file, "utf8").trim() || undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  // The demo keeps nothing, so a throwaway secret will do.
  const appSecret = parsed.success
    ? (fromFile(parsed.data.APP_SECRET, parsed.data.APP_SECRET_FILE) ??
      (parsed.data.DEMO ? randomBytes(32).toString("hex") : undefined))
    : undefined;
  if (parsed.success && !appSecret)
    issues.push("  APP_SECRET: not set (nor a readable APP_SECRET_FILE); use at least 32 random characters");
  else if (appSecret && appSecret.length < 32) issues.push("  APP_SECRET: must be at least 32 characters");
  if (!parsed.success || issues.length) throw new Error(`Invalid configuration:\n${issues.join("\n")}`);
  return {
    ...parsed.data,
    APP_SECRET: appSecret!,
    PGPASSWORD: fromFile(parsed.data.PGPASSWORD, parsed.data.PGPASSWORD_FILE),
  };
}
