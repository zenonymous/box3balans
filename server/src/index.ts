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
import { NetworkLog, loadTurnedOff } from "./domain/networkLog.js";
import { allowConfiguredUrl, installNetworkGuard, setTurnedOff } from "./lib/net.js";
import { newSetupCode, userCount } from "./auth/service.js";
import { ensureBackupPassphrase } from "./backup/passphrase.js";

const config = loadConfig();
setTimeZone(config.TIME_ZONE);

// Before anything else, every request to the internet passes the list of destinations (lib/net.ts)
// and is logged for Settings → Network; anything else is refused.
const network = new NetworkLog();
allowConfiguredUrl("wallets", process.env.SOLANA_RPC_URL);
installNetworkGuard(network.record);
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

// What you turned off under Settings → Network stays off, and earlier counts are kept.
if (!config.DEMO) {
  network.attach(database.db);
  await network.load();
  setTurnedOff(await loadTurnedOff(database.db));
}

// A fresh install takes its first account only with a one-time code from this log, so nobody else
// on the network (or a website, via DNS rebinding) can claim it first.
const setup = {
  code: !config.DEMO && (await userCount(database.db)) === 0 ? (config.SETUP_CODE ?? newSetupCode()) : null,
};

// Backups are encrypted by default: with a passphrase made now if there's none yet.
const madePassphrase = ensureBackupPassphrase(config);

const prices = new PriceService(database.db);
const secrets = new SecretBox(config.APP_SECRET);
const sync = new SyncService(database.db, secrets, prices);
const wallets = new WalletService(database.db, prices);
const backfill = new BackfillService(database.db, prices.fx);
sync.onDone = () => backfill.request();
wallets.onDone = () => backfill.request();
// The demo's price history is made up and complete; fetching real history would mix the two.
if (config.DEMO) backfill.request = () => {};
const app = await buildApp({ db: database.db, config, prices, secrets, sync, wallets, backfill, network, setup });
if (config.DEMO) await seedDemo(app, database.db);
if (madePassphrase)
  app.log.warn(
    `Backups are now encrypted with a passphrase made for them, kept in ${madePassphrase}. Store it in your password manager (Settings → Backups shows it): without it, a backup can't be restored once this folder is lost.`,
  );
const stopScheduler =
  config.SCHEDULER && !config.DEMO
    ? startScheduler(database.db, prices, sync, wallets, backfill, config, app.log)
    : () => {};

const saveNetwork = setInterval(
  () => void network.flush().catch((err: unknown) => app.log.warn({ err }, "Saving the network log failed")),
  5 * 60_000,
);
saveNetwork.unref();

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  stopScheduler();
  clearInterval(saveNetwork);
  await network.flush().catch(() => {});
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

app.log.info({ version: APP_VERSION, demo: config.DEMO }, "Box3balans starting");
await app.listen({ port: config.PORT, host: config.HOST });
if (setup.code) app.log.warn(`No account yet. Open Box3balans in your browser and use this setup code: ${setup.code}`);
