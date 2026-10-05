import { buildApp } from "./app.js";
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
const database = await openDatabase({ url: config.DATABASE_URL, pgEnv: !!config.PGHOST, pgliteDir: config.PGLITE_DIR });
await seed(database.db);

const prices = new PriceService(database.db);
const secrets = new SecretBox(config.APP_SECRET);
const sync = new SyncService(database.db, secrets, prices);
const wallets = new WalletService(database.db, prices);
const backfill = new BackfillService(database.db, prices.fx);
sync.onDone = () => backfill.request();
wallets.onDone = () => backfill.request();
const app = await buildApp({ db: database.db, config, prices, secrets, sync, wallets, backfill });
const stopScheduler = config.SCHEDULER
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

app.log.info({ version: APP_VERSION }, "Kluishuis starting");
await app.listen({ port: config.PORT, host: config.HOST });
