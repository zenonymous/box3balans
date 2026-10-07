import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "./app.js";
import { seedDemo } from "./demo.js";
import { loadConfig } from "./config.js";
import { setTimeZone } from "./lib/time.js";
import { openDatabase } from "./db/client.js";
import { seed } from "./db/seed.js";
import { startScheduler } from "./jobs/scheduler.js";
import { PriceService } from "./prices/service.js";
import { SecretBox } from "./lib/secrets.js";
import { SyncService } from "./sync/service.js";
import { WalletService } from "./wallets/service.js";
import { BackfillService } from "./jobs/backfill.js";
import { APP_VERSION } from "./lib/version.js";

const config = loadConfig();
setTimeZone(config.TIME_ZONE);
if (config.DEMO) {
  // Nothing is kept: data in memory, backups in a temporary folder that goes with the process.
  config.BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "box3balans-demo-"));
}
const database = config.DEMO
  ? await openDatabase({})
  : await openDatabase({
      url: config.DATABASE_URL,
      pgEnv: !!config.PGHOST,
      password: config.PGPASSWORD,
      pgliteDir: config.PGLITE_DIR,
      lock: "take",
    });
await seed(database.db);

const prices = new PriceService(database.db);
const secrets = new SecretBox(config.APP_SECRET);
const sync = new SyncService(database.db, secrets, prices);
const wallets = new WalletService(database.db, prices);
const backfill = new BackfillService(database.db, prices.fx);
sync.onDone = () => backfill.request();
wallets.onDone = () => backfill.request();
// The demo's price history is made up and complete; fetching real history would mix the two.
if (config.DEMO) backfill.request = () => {};
const app = await buildApp({ db: database.db, config, prices, secrets, sync, wallets, backfill });
if (config.DEMO) await seedDemo(app, database.db);
const stopScheduler =
  config.SCHEDULER && !config.DEMO
    ? startScheduler(database.db, prices, sync, wallets, backfill, config, app.log)
    : () => {};

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  stopScheduler();
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

app.log.info({ version: APP_VERSION, demo: config.DEMO }, "Box3balans starting");
await app.listen({ port: config.PORT, host: config.HOST });
