import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("production"),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default("0.0.0.0"),
  // Postgres connection string. When unset, an embedded PGlite database is used (dev/tests).
  DATABASE_URL: z.string().optional(),
  // Alternatively the standard libpq variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT).
  PGHOST: z.string().optional(),
  PGLITE_DIR: z.string().default("./.data/pglite"),
  // Used to derive the key that encrypts exchange API secrets at rest.
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
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
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
