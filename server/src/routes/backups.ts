import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { backupPath, decodeBackup, listBackups, restoreBackup, writeBackupFile } from "../backup/backup.js";
import { SESSION_COOKIE } from "../auth/service.js";
import { HttpError } from "../lib/errors.js";

export async function backupRoutes(app: FastifyInstance) {
  const { db, config, sync, wallets } = app.deps;
  const dir = config.BACKUP_DIR;

  app.get("/", async () => ({
    dir,
    intervalHours: config.BACKUP_INTERVAL_HOURS,
    keep: config.BACKUP_KEEP,
    backups: listBackups(dir),
  }));

  app.post("/", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async () =>
    writeBackupFile(db, dir, "manual"),
  );

  app.get("/:name", async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    let file: string;
    try {
      file = backupPath(dir, name);
    } catch {
      throw new HttpError(400, "Invalid backup name");
    }
    if (!fs.existsSync(file)) throw new HttpError(404, "Backup not found");
    return reply
      .header("content-type", "application/gzip")
      .header("content-disposition", `attachment; filename="${name}"`)
      .send(fs.createReadStream(file));
  });

  // Replaces ALL data with a backup from the backup folder. A safety backup is taken first.
  app.post("/:name/restore", { config: { rateLimit: { max: 3, timeWindow: "5 minutes" } } }, async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const body = z.object({ confirm: z.literal("RESTORE") }).safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Type RESTORE to confirm");
    let file: string;
    try {
      file = backupPath(dir, name);
    } catch {
      throw new HttpError(400, "Invalid backup name");
    }
    if (!fs.existsSync(file)) throw new HttpError(404, "Backup not found");
    if (sync.anyRunning() || wallets.anyRunning()) throw new HttpError(409, "Wait for running syncs to finish");
    let backup;
    try {
      backup = decodeBackup(fs.readFileSync(file));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    const safety = await writeBackupFile(db, dir, "prerestore");
    try {
      const counts = await restoreBackup(db, backup);
      // Sessions are not part of a backup, so everyone (including this browser) is signed out.
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true, restoredFrom: name, safetyBackup: safety.name, counts };
    } catch (err) {
      throw new HttpError(400, `Restore failed, nothing was changed: ${(err as Error).message}`);
    }
  });
}
