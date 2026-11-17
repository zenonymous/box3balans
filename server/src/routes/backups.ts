import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  backupPath,
  checkRestorable,
  listBackups,
  readBackupFile,
  restoreBackup,
  writeBackupFile,
} from "../backup/backup.js";
import { getBackupStatus } from "../backup/status.js";
import { SESSION_COOKIE } from "../auth/service.js";
import { HttpError, notInDemo } from "../lib/errors.js";
import { tr } from "../i18n/index.js";

export async function backupRoutes(app: FastifyInstance) {
  const { db, config, sync, wallets } = app.deps;
  const dir = config.BACKUP_DIR;

  app.get("/", async () => ({
    dir,
    intervalHours: config.BACKUP_INTERVAL_HOURS,
    keep: config.BACKUP_KEEP,
    encrypted: !!config.BACKUP_PASSPHRASE,
    // "file": a passphrase Box3balans made (shown with the password below); "env": your own.
    passphrase: config.BACKUP_PASSPHRASE_SOURCE ?? null,
    status: await getBackupStatus(db),
    backups: listBackups(dir),
  }));

  // The passphrase backups are encrypted with, for the user's password manager; it takes the password.
  app.post("/passphrase", { config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } }, async (req) => {
    if (config.DEMO) throw notInDemo();
    const { password } = z.object({ password: z.string().min(1).max(256) }).parse(req.body);
    await app.identity.checkPassword(req.user!.id, password);
    if (!config.BACKUP_PASSPHRASE) throw new HttpError(404, tr("Backups aren't encrypted"));
    return { passphrase: config.BACKUP_PASSPHRASE, source: config.BACKUP_PASSPHRASE_SOURCE ?? null };
  });

  app.post("/", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async () =>
    writeBackupFile(db, dir, "manual", config.BACKUP_PASSPHRASE),
  );

  app.get("/:name", async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    let file: string;
    try {
      file = backupPath(dir, name);
    } catch {
      throw new HttpError(400, tr("Invalid backup name"));
    }
    if (!fs.existsSync(file)) throw new HttpError(404, tr("Backup not found"));
    return reply
      .header("content-type", name.endsWith(".enc") ? "application/octet-stream" : "application/gzip")
      .header("content-disposition", `attachment; filename="${name}"`)
      .send(fs.createReadStream(file));
  });

  // Replaces ALL data with a backup from the backup folder. A safety backup is taken first. The limit
  // leaves room for a mistyped password, passphrase or code; wrong codes also count per user.
  app.post("/:name/restore", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req, reply) => {
    // The demo's user has a password nobody knows, and the demo keeps nothing anyway.
    if (config.DEMO) throw notInDemo();
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const body = z
      .object({
        confirm: z.literal("RESTORE"),
        passphrase: z.string().max(500).optional(),
        password: z.string().max(256).default(""),
        code: z.string().trim().max(20).optional(),
      })
      .safeParse(req.body);
    if (!body.success) throw new HttpError(400, tr("Type RESTORE to confirm"));
    // A restore brings back the user as it was in the backup: an older password, or two-step
    // verification off. So it takes what turning that off takes, not just a session: the password
    // now, and the code last, once the backup is known to be restorable and the safety backup is
    // made, so a refusal or a failure there doesn't spend a recovery code.
    await app.identity.checkPassword(req.user!.id, body.data.password);
    let file: string;
    try {
      file = backupPath(dir, name);
    } catch {
      throw new HttpError(400, tr("Invalid backup name"));
    }
    if (!fs.existsSync(file)) throw new HttpError(404, tr("Backup not found"));
    if (sync.anyRunning() || wallets.anyRunning()) throw new HttpError(409, tr("Wait for running syncs to finish"));
    let backup;
    try {
      // A backup made with an earlier passphrase can be restored by entering that one.
      backup = await readBackupFile(file, body.data.passphrase || config.BACKUP_PASSPHRASE);
      checkRestorable(backup);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    const safety = await writeBackupFile(db, dir, "prerestore", config.BACKUP_PASSPHRASE);
    try {
      await app.identity.checkSecondFactor(req.user!.id, body.data.code);
    } catch (err) {
      // Nothing gets restored, so the safety backup has no use: don't leave one per wrong code.
      fs.rmSync(backupPath(dir, safety.name), { force: true });
      throw err;
    }
    try {
      const counts = await restoreBackup(db, backup);
      // Sessions are not part of a backup, so everyone (including this browser) is signed out.
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true, restoredFrom: name, safetyBackup: safety.name, counts };
    } catch (err) {
      throw new HttpError(400, tr("Restore failed, nothing was changed: {error}", { error: (err as Error).message }));
    }
  });
}
