# Box3balans

_Your box 3, in balance._ · [box3balans.nl](https://box3balans.nl) · _Nederlands: [README.md](README.md)_

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/zenonymous/box3balans/badge)](https://scorecard.dev/viewer/?uri=github.com/zenonymous/box3balans) [![OpenSSF Best Practices](https://www.bestpractices.dev/projects/15856/badge)](https://www.bestpractices.dev/projects/15856)

Box3balans keeps track of your **box 3** (the Dutch tax on savings and investments) and everything in it: savings, **stocks and ETFs, crypto, gold and silver** (at home or in a vault), a second home, money lent to others and debts, all in **euros**. With an estimate of your tax, your actual return and an overview for the tax return. You run it yourself, on your NAS, a home server or your laptop. So your amounts and transactions stay with you: Box3balans sends nothing to its makers and collects no usage data. It only connects to price sources, to the exchanges, brokers and block explorers you link, and to GitHub if you turn on the check for new versions. Those hosts are on a fixed list; the app refuses everything else. A price source does see which assets you request (symbols and ISINs), and a block explorer the addresses of wallets you add, and so their balances. What exactly goes out (never amounts) is in [What Box3balans sends](docs/en/privacy.md), and _Settings → Network_ shows it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/overzicht-dark.webp">
  <img src="docs/images/overzicht-light.webp" alt="The overview in the demo: wealth, result, and wealth over time per asset class" width="800">
</picture>

> **Not tax advice.** Box3balans makes estimates. Check the amounts against the annual statements of your bank and broker before you use them in your tax return. Use at your own risk; there's no warranty (see the [licence](LICENSE)).

**Status:** in development and usable. The app is in Dutch, with the terms from the tax return; English is available too (_Settings → Appearance → Language_). What's still coming is on the [roadmap](docs/en/ROADMAP.md).

**Look first?** Look around the [online demo](https://box3balans.nl/demo/?lang=en), or start the [demo](#demo) yourself: an example household with made-up prices, without setting anything up.

**Questions?** Ask them in [Discussions](https://github.com/zenonymous/box3balans/discussions/categories/q-a), in English or Dutch. Report a bug or a concrete proposal as an [issue](https://github.com/zenonymous/box3balans/issues/new/choose).

## What it does

- **Overview:** wealth over time, the split across asset classes, positions and accounts, and per position the cost price and the realised and unrealised result.
- **Transactions** by hand, via a **CSV import** from almost any broker or exchange (exports from DEGIRO, Bitvavo, Crypto.com, eToro, Rabobank Beleggen, Trade Republic, Trading 212, Lightyear and Scalable Capital, among others, are recognised by themselves), via **connections** with Bitvavo, Kraken, Coinbase, Bitpanda and Interactive Brokers, and for **wallets** by address: Bitcoin, Ethereum and L2s, BNB Chain, Solana, Cardano, Dogecoin, Litecoin, XRP and Tron.
- **Precious metal:** coins and bars with weight, purity, photos and a printable inventory (for example for your home contents insurance).
- **Returns:** time- and money-weighted return against a benchmark, a cost overview and expected dividends.
- **Box 3 for your whole household:** you, your fiscal partner and minor children; savings accounts, investments, a second or let home, money lent to others and debts. Per account you track transactions, or only the value on 1 January, which you can also have taken from your bank's export. Per year the deemed-return system (with the Belastingdienst's rounding), your **actual return** for the rebuttal scheme (tegenbewijsregeling), an overview **for the tax return** in the order you fill it in, and a preview of the system from 2028. A start wizard gets you going in four steps.
- **Kept safe:** encrypted backups in a folder your NAS can copy elsewhere, two-step verification, a complete change history, and a list of what needs attention.

### What it looks like

With the made-up data of the [demo](#demo).

**Box 3 over a year:** the deemed-return calculation, and the actual return for the rebuttal scheme, with what it saves you.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/box3-dark.webp">
  <img src="docs/images/box3-light.webp" alt="Box 3 over 2025 in the demo: the deemed-return calculation and the actual return, which comes out lower than the deemed return" width="800">
</picture>

**For the tax return:** per part, per account and per owner, in the order of the form.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/aangifte-dark.webp">
  <img src="docs/images/aangifte-light.webp" alt="The overview for the 2025 tax return, per part, account and owner" width="800">
</picture>

**Precious metal:** coins and bars with fine weight, value and the premium paid, at home or in a vault.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/edelmetaal-dark.webp">
  <img src="docs/images/edelmetaal-light.webp" alt="Precious metal in the demo: totals per metal, physical items and gold in a vault" width="800">
</picture>

## Installing

You need a computer with Docker and Docker Compose v2 (`docker compose version` works). That can be a NAS (Synology, QNAP, Unraid, TrueNAS), a Raspberry Pi 4 or 5, a home server or a laptop with Docker Desktop. Intel/AMD (x86-64) and ARM64 are both supported. Step-by-step instructions per system are in [docs/en/installatie.md](docs/en/installatie.md).

1. Create a folder and put [`docker-compose.yml`](docker-compose.yml) in it:

   ```bash
   mkdir box3balans && cd box3balans
   curl -fsSLO https://raw.githubusercontent.com/zenonymous/box3balans/main/docker-compose.yml
   ```

2. Start Box3balans:

   ```bash
   docker compose up -d
   ```

   The first time, the images are downloaded. After about half a minute `docker compose ps` shows both containers as `healthy`.

3. Open `http://<your-server>:8080` and create your user, with a password of at least 12 characters. For that you need the **setup code** Box3balans writes to its log on first start (`docker compose logs app`, or the container's log on your NAS): that way nobody else on your network can take over your installation. _Get started_ (on the empty overview) then gets you going in four steps. Also turn on two-step verification right away (_Settings_).

4. **Recommended:** next to `docker-compose.yml`, create a `.env` file (example: [`.env.example`](.env.example)) with at least:

   ```bash
   PUID=1000   # your user ID (command: id)
   PGID=1000   # your group ID
   ```

   Backups are encrypted by themselves, with a passphrase Box3balans makes on first start. Put it in your password manager (_Settings → Backups_ shows it): without it you can't restore an encrypted backup.

   Then run `docker compose up -d` again.

A `.env` isn't required. On first start Box3balans creates a key for encrypting API keys and a database password itself, in the `app-data` volume.

**Checking:** `docker compose logs app --tail 50`. The first lines show `Box3balans starting` with the version. After a restart of your NAS, `Database not reachable yet…, waiting for it` may appear once: the app then waits until the database is ready.

### In one container

To try it out, or on a laptop with Docker Desktop, Box3balans can also run in one container, with the database built in (PGlite):

```bash
curl -fsSLO https://raw.githubusercontent.com/zenonymous/box3balans/main/docker-compose.lite.yml
docker compose -f docker-compose.lite.yml up -d
```

For a NAS or server the standard setup with its own PostgreSQL is the sturdier choice. Switching goes with a backup and restore. In this variant, make backups from the app (_Settings → Backups & export_): the command line can't reach the database while the app has it open. If it must go via the command line (restoring, turning off two-step verification), stop the app first and run the command with `run --rm` instead of `exec`:

```bash
docker compose -f docker-compose.lite.yml stop
docker compose -f docker-compose.lite.yml run --rm app node dist/cli.js disable-2fa
docker compose -f docker-compose.lite.yml start
```

### Demo

Look around first? The demo runs Box3balans with an example household: Sanne, her fiscal partner Daan and their daughter Noor, with savings accounts, investments, crypto, precious metal, a holiday home, money lent and a student debt. The prices are made up. You're signed in right away and nothing is stored; connections, wallets and fetching prices are off.

```bash
docker run --rm -p 8080:8080 -e DEMO=true ghcr.io/zenonymous/box3balans:latest
```

Open `http://localhost:8080`. Ctrl+C stops the demo, and everything is gone.

It also works without installing: the [online demo](https://box3balans.nl/demo/?lang=en) ([in Dutch](https://box3balans.nl/demo/)) shows the same household, with all pages, years and filters. There you can only look: saving, importing and connecting aren't possible. It's the demo's answers, recorded at every release (see [ADR 0010](docs/en/adr/0010-online-demo-zonder-server.md)).

### Building it yourself

To run your own changes, build the image from the source code:

```bash
git clone https://github.com/zenonymous/box3balans.git && cd box3balans
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

If you work on a different computer than your server, `scripts/deploy.sh user@nas` copies the latest commit over SSH to `~/box3balans` on the server and builds it there. Give a second argument for a different folder. If `docker` needs `sudo` there (as on Synology): `DOCKER="sudo docker" scripts/deploy.sh user@nas`. Only committed files go along, never `.env`, data or backups.

### Updating

```bash
docker compose pull
docker compose up -d
```

Your settings, database and backups stay as they are; database migrations run by themselves at startup. To hear when there's a new version, turn on _Settings → About → Check for new versions_: Box3balans then asks GitHub once a day for the newest version (GitHub sees your IP address) and reports a new version under _Needs attention_. It's off by default. Want a backup first: `docker compose exec app node dist/cli.js backup`. To stay on a fixed version, put for example `BOX3BALANS_VERSION=1.2.0` in `.env`. What changes per version is listed with the [releases](https://github.com/zenonymous/box3balans/releases).

### Upgrading PostgreSQL

Minor updates (18.x) come along with `docker compose pull`. A new major version (for example 18 → 19) can't read the old data files; you then move the data with a backup. This was tried with PostgreSQL 17 → 18: all pages showed the same data afterwards.

1. Make a backup: `docker compose exec app node dist/cli.js backup`.
2. `docker compose down`.
3. In `docker-compose.yml`, set the `db` image to the new version (for example `postgres:19-alpine`) **and** rename the volume (`db-data` → `db-data-19`, in both places). That leaves the old volume untouched as a fallback.
4. `docker compose up -d`. The app starts with an empty database and creates the tables.
5. Restore: `docker compose exec app node dist/cli.js restore /backups/<the backup from step 1>`, then `docker compose restart app`, and sign in again.
6. If everything is right, remove the old volume: `docker volume rm box3balans_db-data`.

### Access away from home (VPN)

Don't expose Box3balans to the internet: don't forward port 8080 in your router. If you want to reach it from your phone or laptop away from home, use a VPN:

- **WireGuard or Tailscale, plain:** open `http://<vpn-address-of-your-server>:8080`. The VPN already encrypts the traffic. Leave `COOKIE_SECURE=false`.
- **Tailscale with HTTPS** (a real `https://` address): turn on MagicDNS and HTTPS certificates in the Tailscale admin console and run on the server (with `sudo` if needed):

  ```bash
  tailscale serve --bg 8080
  ```

  Box3balans is then at `https://<servername>.<tailnet>.ts.net`. Set `COOKIE_SECURE=true` in `.env` and run `docker compose up -d`. From then on only use the https address: via the plain `http://` address you won't stay signed in. Leave `TRUST_PROXY=false`. All requests then share one limit for login attempts; for one user that's fine.

  If you want the https address to be the only way in, publish the port only on the server itself: set `HTTP_BIND=127.0.0.1` in `.env` and run `docker compose up -d`.

## Backups and restoring

A backup is a gzip file with **all** data except login sessions: accounts, transactions, precious metal with photos, prices, settings, connections and wallets. They go into the **`backups` folder next to `docker-compose.yml`**:

- **Automatically**, every `BACKUP_INTERVAL_HOURS` (24 by default). The newest `BACKUP_KEEP` (14 by default) automatic backups are kept.
- **Manually**, via _Settings → Backups & export → Back up now_, or `docker compose exec app node dist/cli.js backup`. Manual backups are never deleted automatically.
- **Before every restore**, as a safety net (`…-prerestore…`).

**Encrypted, by themselves.** Backups are encrypted (`….json.gz.enc`, AES-256-GCM with a key derived via scrypt). Without `BACKUP_PASSPHRASE`, Box3balans makes a passphrase on first start and keeps it in the `app-data` volume (`/data/backup-passphrase`); _Settings → Backups_ shows it after your password, and _Needs attention_ reminds you to put it in your password manager. **Without the passphrase you can't restore an encrypted backup**, for example on a new server if the volume is gone. Prefer your own passphrase: set `BACKUP_PASSPHRASE` in `.env` (at least 12 characters). A wrong passphrase or a damaged file is recognised; nothing is ever half restored. With `BACKUP_ENCRYPT=false` backups stay plain gzip files, with your password hash and all your financial data readable in them. Unencrypted backups from before 0.1.37 can still be restored.

**Copies elsewhere.** Let your NAS's backup tool (Hyper Backup, rclone, a cloud sync …) include the `backups` folder. The files belong to `PUID`/`PGID` from `.env`: set those to your own user (the `id` command on the NAS shows them), so you and your backup tool can reach them. Or use _Download_ next to a backup in Settings.

**The app key.** Exchange API keys and the key of your two-step verification are stored encrypted in the database, with a key Box3balans creates on first start in the `app-data` volume. That key isn't in the backups. If you move to another server, keep it in your password manager and set it there as `APP_SECRET` in `.env`:

```bash
docker compose exec app cat /data/app-secret
```

Restoring also works without that key, but then you have to enter the API keys again and set up two-step verification again (turn it off first with `docker compose exec app node dist/cli.js disable-2fa`).

**Restoring** replaces all current data with that from the backup, in one database transaction: everything is restored or nothing changes. Backups from older versions work fine; backups from a newer version are refused. Afterwards everyone is signed out; sign in with the user from the backup.

- From the app: _Settings → Backups & export → Restore…_ next to a backup, and type `RESTORE`. If the backup was made with an earlier passphrase, fill that in there.
- From a file, for example on a new server: put it in the `backups` folder and run:

  ```bash
  docker compose exec app node dist/cli.js restore /backups/box3balans-20261002-030000-auto.json.gz.enc
  docker compose restart app
  ```

  This uses `BACKUP_PASSPHRASE` from `.env`; for another one: `docker compose exec -e BACKUP_PASSPHRASE='…' app node dist/cli.js restore …`.

- Reading an encrypted backup outside the app: `docker compose exec app node dist/cli.js decrypt /backups/<file>.enc` puts the plain `.json.gz` next to it.
- `docker compose exec app node dist/cli.js list` shows the backups with size and date.

**Extra safety net (optional).** A raw database dump; restoring it needs the same PostgreSQL version:

```bash
docker compose exec db pg_dump -U box3balans box3balans | gzip > box3balans-db.sql.gz
```

**Exports.** _Settings → Backups & export_ also downloads **all transactions** and the **current positions** as CSV. _Performance_, _Income_ and _Box 3_ each have their own CSV export.

### Settings (`.env`)

Everything is optional. Only put what you want to change in `.env` next to `docker-compose.yml` and then run `docker compose up -d`.

| Variable                | Default            | What for                                                                                                                                              |
| ----------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTP_PORT`             | `8080`             | Port on the server                                                                                                                                    |
| `HTTP_BIND`             | `0.0.0.0`          | Network address of that port; `127.0.0.1` for only the server itself (behind a reverse proxy). Docker opens the port bypassing a firewall such as ufw |
| `BOX3BALANS_VERSION`    | `latest`           | Which version you run, for example `1.2.0`                                                                                                            |
| `BACKUP_PASSPHRASE`     | made               | Your own passphrase for the backups (at least 12 characters); without it, Box3balans makes one. Needed to restore: keep it safe                       |
| `BACKUP_ENCRYPT`        | `true`             | `false`: unencrypted backups                                                                                                                          |
| `PUID` / `PGID`         | `1000`             | Owner of the backup files: your user and group ID                                                                                                     |
| `BACKUP_INTERVAL_HOURS` | `24`               | Hours between automatic backups; `0` = off                                                                                                            |
| `BACKUP_KEEP`           | `14`               | Number of automatic backups kept                                                                                                                      |
| `COOKIE_SECURE`         | `false`            | Set to `true` if you open Box3balans via HTTPS                                                                                                        |
| `TRUST_PROXY`           | `false`            | Only behind a reverse proxy: `true`, the number of proxies, or their IP address(es)                                                                   |
| `SESSION_DAYS`          | `30`               | How long you stay signed in                                                                                                                           |
| `TIME_ZONE`             | `Europe/Amsterdam` | Calendar for "which day or which year" (box 3 reference date, yearly results)                                                                         |
| `PRICE_REFRESH_MINUTES` | `15`               | Minutes between price updates                                                                                                                         |
| `SYNC_INTERVAL_HOURS`   | `6`                | Hours between syncs of connections and wallets; `0` = by hand only                                                                                    |
| `SOLANA_RPC_URL`        | public RPC         | Your own Solana RPC (for example a free Helius key) for faster first imports                                                                          |
| `MEMPOOL_URL`           | mempool.space      | Your own mempool or Electrs server for Bitcoin wallets (the address of the API; http is allowed on your own network)                                  |
| `ANKR_API_KEY`          | —                  | Free Ankr Advanced API key; needed for BNB Chain wallets                                                                                              |
| `LOG_LEVEL`             | `info`             | `debug` also logs every request                                                                                                                       |
| `DEMO`                  | `false`            | `true`: the [demo](#demo), with an example household in memory; nothing is stored                                                                     |
| `APP_SECRET`            | created            | Your own key (at least 32 characters) for API keys, instead of the created one                                                                        |
| `POSTGRES_PASSWORD`     | created            | Your own database password, only on the very first start; after that it's in the database                                                             |

## Using

0. **Get started** (_/start_, also reachable via the empty overview and _Settings_): in four steps your household, your accounts and their values on 1 January, with an estimate of your box 3 right away. What you fill in there can be adjusted later on the other pages.
1. **Overview and Holdings:** your wealth over time, today's change, the split per asset class, per position or per account, and every position per account with cost price and open and realised result.
2. **Needs attention:** at the top of the sidebar a red or orange link appears when something needs attention: a failed sync, balances that don't match an exchange or wallet, prices that couldn't be updated, a negative balance, deposits without a value, withdrawals not linked to a deposit, backups that failed, are too long ago or aren't encrypted, tax rules more than a year old, or (if you turn it on) a new version. Every item links to where you fix it; you can dismiss a warning until something changes.
3. **History** (_Settings → History_): every change to transactions, assets, accounts, precious metal, imports, connections and wallets, field by field, whether you or a sync or import did it. You restore deleted transactions and precious-metal items there.
4. **Household** (_Settings → Household_): your name, your partner and your children, with date of birth and who has custody. With that Box3balans knows which accounts count in your box 3, and for how much.
5. **Accounts:** create one per place where you hold something: banks (ING savings account), brokers (DEGIRO), exchanges (Bitvavo), wallets (Ledger), vaults (Goldrepublic), at home (the safe), and also a second or let home, money lent, a capital insurance policy or a debt. Per account you choose:
   - **whose:** yours, your partner's, joint (with your share, usually 50%) or a child's;
   - **how you track it:** with **transactions** (buys, sells, dividends: by hand, from a CSV or via a connection; then you get prices, returns and history), or with **values per year**: only the value on 1 January and what came in, went out and was earned in the year. That's enough for box 3. Homes, money lent, debts and insurance always go this way.
6. **Assets:** search Yahoo Finance by name, ticker or ISIN, or CoinGecko by coin. Choose the listing you actually trade (for example `IWDA.AS` instead of `IWDA.L`). Gold, silver, platinum, palladium and euros are already there.
7. **Transactions:** buy, sell, deposit, withdrawal, dividend (gross plus tax withheld), staking reward, fee paid in the asset itself, split, and **transfers** between accounts, which take the cost price along. Transactions in a foreign currency automatically get that day's ECB rate; you can adjust it.
8. **Precious metals:** add coins and bars with weight and purity, or choose a preset (Krugerrand, Maple Leaf, Gouden Tientje, standard bars …). Items are valued at the spot price of their fine weight. If you fill in the spot value at purchase, you see the premium paid. Metal in a vault (Goldrepublic, BullionVault, Holland Gold) you book as purchases in **grams** on Gold or Silver; Goldrepublic's account statement (PDF) you read in under _Import CSV_. Every item can have up to 8 **photos** (shrunk in the browser, without location data). _Inventory_ prints a list per storage place, or saves it as PDF, with photos, weights, purchase data and value.

### Values per year and bank exports

For an account with **values per year** (_Accounts → Values per year_) you fill in, per year, the value on 1 January, with the money in and out, the income and the costs. For a bank account, _Read a bank export_ takes that from your bank's export (CAMT.053, MT940 or CSV, also from Revolut and Wise in foreign currencies). In January, _Needs attention_ reminds you to fill in the values on 1 January of the new year.

Which file to choose per bank, and how to track providers without a usable export (Brand New Day, crowdfunding, managed investing, capital insurance, green funds, bank savings): see [Bringing data in](docs/en/importeren.md#values-per-year-and-bank-exports).

#### Annual statement as PDF

For every account with values per year, except a home, _Read a year statement (PDF)_ reads the annual statement of your bank, broker or platform. The PDF is read in your browser and not stored ([ADR 0009](docs/en/adr/0009-pdf-lezen-in-de-browser.md)). ING's annual statement and Goldrepublic's account statement are recognised; for other providers Box3balans offers the amounts next to a reference date or a word such as _beginwaarde_, and you tick what's right yourself. More: [Bringing data in](docs/en/importeren.md#annual-statement-as-pdf).

**Help recognise a statement or export.** If Box3balans doesn't know your annual statement or your broker's CSV yet, _Help others read this …_ makes a file to share, without your data:

- **A CSV:** made-up rows in the layout of yours.
- **An annual statement:** the text with made-up numbers and struck-out names.

You see exactly what's in it. Then you share it yourself with the [_Share a format_](https://github.com/zenonymous/box3balans/issues/new?template=formaat-delen.yml) form. More: [Sharing your format](docs/en/importeren.md#sharing-your-format).

### CSV import

_Transactions → Import CSV_ reads exports from almost any broker, exchange or spreadsheet. Over twenty exports are recognised by themselves, among others from DEGIRO, Bitvavo, Coinbase, Kraken, Bitstamp, Crypto.com, Rabobank Beleggen, Trade Republic, Trading 212, Lightyear, Scalable Capital, eToro, XTB, Revolut and Schwab Equity Awards, and Goldrepublic's account statement (PDF); with CoinTracking's or Delta's export you bring in your whole history in one go. For other files you choose the columns yourself. Nothing is saved before you've seen everything, and you can undo an import.

The list of recognised exports, which file to choose per provider and how the import works: see [Bringing data in](docs/en/importeren.md#csv-import).

### Connections with exchanges and brokers

Read-only **connections** fetch your history by themselves and compare the balances with what the exchange reports: **Bitvavo**, **Kraken**, **Coinbase**, **Bitpanda** and **Interactive Brokers** (also for LYNX). Keys are checked, stored encrypted and never sent back or logged. How a sync works, staking per exchange and known limitations: see [Bringing data in](docs/en/importeren.md#connections-with-exchanges-and-brokers).

### Wallets (self-custody, by address)

**Wallets** follows addresses read-only via public block explorers: Bitcoin (including xpub), Ethereum and L2s, BNB Chain (with a free Ankr key), Solana, Cardano, Dogecoin, Litecoin, XRP and Tron. Box3balans never asks for your seed phrase or private keys. Per chain what's read, and how a sync works: see [Bringing data in](docs/en/importeren.md#wallets-self-custody-by-address).

### Box 3

The **Box 3** page estimates your box 3 using the deemed-return savings variant (tax years from 2023), for every year since your first transaction.

- **Reference date 1 January:** your assets at the end of 31 December, valued at that day's closing price or the last one before. Wallets, vaults and physical metal count.
- **Categories:** every position counts as _bank balance_ (banktegoed), _other asset_ (overige bezitting), _green investment_ or _not in box 3_. By default cash at a bank or broker is a bank balance, cash on a crypto exchange or in a wallet another asset, and investments, crypto and metals are other assets. You can classify whole accounts differently, for example a fund with a green certificate as a green investment or a pension account as not in box 3. If that changes over the years, like a green fund that loses its green certificate, you give the category from that year under _From a year on_; the years before stay as they were. Green investments are only exempt up to the yearly limit (2023 €65,072; 2024 €71,251; 2025 €26,312; 2026 €26,715 per person, double with a fiscal partner); what's above it counts as another asset, and the small tax credit for green investments (0.7% up to and including 2024, then 0.1%) comes off. The exemption ends on 1 January 2028 (see [box3-sources.md](docs/en/box3-sources.md)). Other assets are also split into investments, crypto and metals, as the tax return asks.
- **Who counts:** every account counts for its owner (_Accounts_). If you have a fiscal partner that year (_Your situation_), your assets count together, with twice the tax-free allowance and the debt threshold; if not, only what's yours counts (and your share of joint accounts). Assets of a child under 18 on 1 January count for the parents with custody: half each, or all if you alone have custody. A child of 18 files their own return. Every position shows which part counts, and why.
- **Split between partners:** fiscal partners may split the joint savings and investment base as they like, as long as it's 100% together. Choose your share under _Your situation_; the _Per person_ card shows what each owns and each one's share of the base and the tax. Together you pay the same; a split can matter elsewhere in the tax return, such as for the general tax credit.
- **Your situation per year:** fiscal partner, and debts, bank balances or other assets you don't track as an account (such as cash above the exemption: that counts as a bank balance).
- **Calculation:** follows the Belastingdienst's steps (deemed return → return base → savings and investment base → share → benefit → tax). The official figures for 2023–2026 are included (the 2026 percentages for bank balances and debts are provisional), and every rate can be adjusted under _Rules & rates_.
- **For the tax return** (button on the Box 3 page): per year what you fill in under box 3, in the order of the tax return: bank accounts, shares and funds, cryptocurrencies, real estate, money lent, other assets, green investments and debts, per account and per owner, in whole euros. With that year's interest, rent and dividend, the dividend tax withheld (Dutch and per country) and the actual return. Also printable.
- **Rounding:** as in the Belastingdienst's worked examples (whole euros, the share rounded down to two decimals). The five examples for 2025 are tests and come out exactly.
- **Actual return (tegenbewijsregeling):** per year the actual return as the Belastingdienst asks for it (for 2024 and earlier with the _Opgaaf werkelijk rendement_ form, from 2025 in the tax return itself), per category: value on 1 January, money in and out, value on 31 December, change in value and income. Dividends count gross, costs can't be deducted, interest paid on debts can, and there's no tax-free part. It's compared with the tax under the deemed-return system, with whether the statement saves you money, and roughly how much. Fill in per year, under _Your situation_, the interest paid on debts and the return on assets the app doesn't track.
- **From 2028 (preview):** the planned system based on actual return (bill 36.748, **not law yet**) applied to your past years: result after costs, the tax-free result, losses carried forward (and with the amendment, back), and the tax compared with the current system. Rate, tax-free result, loss threshold and carrying losses back can be adjusted, with settings for the bill as the House of Representatives adopted it and for the announced amendment.
- **Sources:** the rules used, with links, are in [`docs/en/box3-sources.md`](docs/en/box3-sources.md). The figures themselves are in [`server/src/rules/box3.json`](server/src/rules/box3.json), with the date they were last checked; you also see that date and the source per year in the app. How they're updated every year: [`docs/en/belastingregels.md`](docs/en/belastingregels.md). 2027 is included as a proposal, with the figures from the cabinet letter of 29 September 2026, and the app says so with the calculation; they'll be checked once the Belastingplan is adopted in December.
- **Export:** CSV of all positions on the reference date, and _Print / PDF_ (a print view without the rest of the app).
- **Dossier** (button on the Box 3 page): per year one document to print or keep as PDF, with the overview, the calculation, the actual return and per account where every amount comes from: a connection, a wallet, a CSV import, entered by hand or your bank's export, and for every price the date and the source (for example Bitvavo BTC-EUR). For your own records, and for when the Belastingdienst asks questions.

It remains an estimate: check the values against the annual statements of your banks and brokers. Accounts with values per year count in box 3, but not in the investment overviews (_Overview_, _Performance_, _Income_): those need a history with prices.

### How the numbers are calculated

- **Entering numbers** follows the notation you choose under _Settings → Appearance_. With the Dutch notation "5.000" is five thousand and "1,5" one and a half; "1.234,56" works too. As soon as you type a separator, the field shows how it was read (for example "= 5 000"), and a value that can be read two ways is marked. Numbers from English-language sites, such as "0.0015", are read correctly too.
- **Cost price** is per account, by default with the **average cost price**, or **FIFO** (_Settings → Cost_). Costs on a purchase add to the cost price, costs on a sale come off the proceeds. Transfers take their cost price along.
- **Network fees paid in a coin** (gas, Bitcoin transaction fees) are a realised loss equal to the cost price of the coins spent. They're listed as "network fees" with the realised results.
- **Realised result** = sale proceeds − costs − cost price of the items sold. Because the cost price is in euros at the transaction's rate, the currency effect is in it. For positions bought in a foreign currency, the open result is also split into a **price effect** (valued at the exchange rate you paid) and a **currency effect**.
- **Rewards** (staking) come in with a cost price equal to their market value and count as income. **Dividends** count as income after tax withheld.
- **Cash** is valued at nominal value (foreign currencies at the ECB rate) and doesn't count as "invested". Manual buys, sells and dividends can optionally adjust an account's cash balance; synced ones always do.
- **Wealth over time** is calculated from your transactions: every day your positions are valued at that day's closing price, with the last closing price over weekends and holidays. Positions without price history count at cost price, and the chart says so. Changes per period (1W, 1M, YTD) are changes of your wealth, deposits included.
- **Result per year** = realised result + income + change in open (unrealised) result over the year. Deposits and withdrawals aren't a result, and the years add up to the total result. Costs and tax withheld are already in it and shown for information.
- **Income** = dividends after tax withheld, staking and other rewards at their euro value on receipt, and interest (rewards on cash). The _Income_ and _Performance_ pages export CSV.
- **Money in and out.** For returns, money comes into or leaves your portfolio with deposits and withdrawals, assets going in or out (at that day's market value), buys and sells that don't go through a tracked cash balance, dividends that go to a bank account outside Box3balans, and physical metal bought or sold. Rewards, costs and transfers between your accounts stay inside: those are results.
- **Time-weighted return** (_Performance → Returns %_) chains every day's returns together, with deposits from the start of their day and withdrawals at the end: how the investments did, regardless of when you put money in or took it out, as funds report it. **Money-weighted return** (XIRR) is your own return including that timing: per year over that year, over the whole period as an annual return. Per position and per account it's an annual return if you've held it for a year or longer, otherwise the return over the holding period.
- **Benchmark:** the same money in and out, but invested in MSCI World (IWDA), FTSE All-World (VWCE), S&P 500 (CSPX), gold or bitcoin. These funds reinvest dividends, so their price return is their whole return. The benchmark's prices are kept as a hidden asset.
- **Costs** (_Performance → Costs_): transaction and account costs, network and vault costs paid in an asset (at what those items cost), dividend tax withheld, the premium above the spot price for physical metal, and the ongoing costs of funds, estimated as the fund's daily value × the TER ÷ 365. Fill in a fund's TER (from the factsheet) under _Assets_. Ongoing costs come off the fund's price and are therefore already in your results; the overview only makes them visible.
- **Expected dividends** (_Income_): per position the dividend per share of the past 12 months (Yahoo), moved a year forward, for what you hold now, at today's exchange rate. The tax is estimated with the percentage actually withheld on that position, otherwise the usual percentage for the country (NL and US 15%, Irish and Luxembourg funds 0%).
- **Tax withheld per country** (_Income_): per year and country (from the ISIN), with what it means for your tax return. Dutch dividend tax is set off completely, foreign tax up to the treaty rate; US tax above 15% usually means your broker doesn't have a W-8BEN form from you.
- **Daily change** comes from each source's 24-hour change. Where a source doesn't have one (metals), it's derived from the previous stored closing price.

### Price sources (free, no keys)

| Asset         | Source                                                    | Fallback                                                     |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Stocks / ETFs | Yahoo Finance chart API (prices in GBp/ZAc are converted) | Tradegate by ISIN (EUR, converted to the listing's currency) |
| Crypto        | CoinGecko `simple/price` (EUR); Bitvavo coins: Bitvavo    | Bitvavo's public ticker, then Yahoo `SYM-EUR`                |
| Metals        | gold-api.com spot (USD/oz → EUR/g)                        | Yahoo COMEX futures (`GC=F`, `SI=F`, …)                      |
| Currencies    | ECB reference rates via Frankfurter                       | last known rate                                              |

A fallback source is only used if the main source gives no price, and only if that price is between half and double the last known one (a token without a known price never gets a price by symbol, because that could be another coin). _Settings → Prices_ shows when that happened. Every update stores the latest price, today's closing price in `price_history`, and a snapshot of your wealth.

**Price history** loads daily closing prices in euros for every asset, from the first transaction to today: Yahoo (stocks, ETFs, crypto pairs `SYM-EUR`), Bitvavo (crypto, daily prices from 2019), CoinGecko (crypto, the last 365 days, as a fallback), Yahoo futures for metals and ECB rates for foreign currencies. Bitvavo's or Yahoo's `SYM-EUR` pair is only used for a coin from another source if the current price is between half and double that coin's own price, because another coin can have the same symbol; otherwise the history comes from CoinGecko. Days older than what those sources cover (CoinGecko's free year, a market Bitvavo has closed) come from Binance's `SYMUSDT` pair, in euros at the ECB dollar rate, but only if your own buys and sells confirm it's the same coin. Loading happens 30 seconds after startup, daily, and a few seconds after transactions change or a sync finishes. Every asset is fully loaded once and topped up after that; after an update that adds new sources, once more in full. If the history starts later than when you held the asset, the missing start is retried once a week. `POST /api/prices/backfill` forces a full check. One failed asset doesn't hold up the rest; failures are shown on _Overview_ and under _Settings → Prices_.

**Coins an exchange no longer trades** (without a price source, so manual) get their history from Yahoo's `SYM-EUR` pair or Binance's `SYMUSDT` pair (in euros at the ECB dollar rate). That only happens when it's certain to be the same coin: the closing prices on the days of your own buys and sells are between half and double what you paid or received, or (without buys and sells) Yahoo names the pair by the coin's name.

**Swapped coins** such as NU and KEEP (now T), MATIC (POL), FTM (S) and EUROC (EURC) have their own price until the swap, and after that the price of their successor times the fixed swap ratio (1 NU = 3.259242 T). That also applies to the current price, unless you enter a price yourself. You see it under _Assets_ ("swapped for 3.259242 T"). The list is in `server/src/prices/migrations.ts`; a missing swap is a welcome pull request.

## Developing

Contributions are welcome: read [CONTRIBUTING.en.md](CONTRIBUTING.en.md). You need Node 22 or newer. Without `DATABASE_URL` the server uses a built-in PostgreSQL (PGlite) in `server/.data/`, so Docker isn't needed.

```bash
npm install
echo "APP_SECRET=$(openssl rand -hex 32)" > server/.env
npm run dev:server            # API on :8080 (also serves web/dist when it's built)
npm run dev:web               # Vite on :5173, forwards /api to :8080
```

| Command                                                         | What it does                                                                                                                                                                           |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                      | Server unit tests (calculations) and API integration tests (PostgreSQL in memory, simulated price APIs)                                                                                |
| `npm run typecheck`                                             | TypeScript check of server and web                                                                                                                                                     |
| `npm run lint` / `npm run format`                               | ESLint / Prettier                                                                                                                                                                      |
| `npm run build`                                                 | Builds the server to `server/dist` and the web app to `web/dist`                                                                                                                       |
| `npm run db:generate -w server`                                 | Creates a migration after a change in `server/src/db/schema.ts`                                                                                                                        |
| `npm run dev:live -w server`                                    | A second instance on `http://127.0.0.1:8081` with its own empty database, to try real API keys and wallets without mixing them with sample data. Remove `server/.data/live` afterwards |
| `npm run demo`                                                  | The demo on `http://127.0.0.1:8082` (build the web app first with `npm run build -w web`)                                                                                              |
| `npm run build:online-demo`                                     | Builds the online demo to `web/dist-demo`; view it with `npm run preview:online-demo -w web` on `http://localhost:4173/demo/`                                                          |
| `FUZZ_SCALE=20 npx vitest run test/fuzz.test.ts` (in `server/`) | The parsers (CSV, amounts, bank exports, annual statements, Goldrepublic) with twenty times as much generated input as in `npm test`                                                   |
| `npx tsx scripts/bench.ts [scale]` (in `server/`)               | Measures the main pages with a large simulated history (scale 1 ≈ 20,000 transactions)                                                                                                 |

Sample data: create a user and then run `SESSION=<pd_session cookie> npx tsx server/scripts/sample-data.ts`.

**Texts and translations.** Texts are in English in the code, in `t("…")` (web) or `tr("…")` (server), and are translated with `web/src/i18n/nl.ts` and `server/src/i18n/nl.ts`. Use the terms from the tax return (banktegoeden, overige bezittingen, peildatum …). A test fails if a text has no Dutch translation, or if the `{placeholders}` don't match.

Making releases (for maintainers): see [docs/en/releasen.md](docs/en/releasen.md).

### Built with AI assistance

Box3balans is made with the help of an AI coding assistant: Claude, by Anthropic. Most of the code, the tests and the documentation (including the English version) were written with Claude, directed and reviewed by the maintainer, who makes the decisions and is responsible for the result. Every commit Claude helped write says so in a `Co-Authored-By: Claude …` line, so it can be traced per change. The calculations are checked with tests, including the Belastingdienst's worked examples, and every change goes through the same checks (tests, ESLint, CodeQL). Contributions with AI help are welcome on the same terms; see [CONTRIBUTING.en.md](CONTRIBUTING.en.md#agreements).

### Technology and why

- **Fastify + TypeScript** (server): fast, fits schemas well, little overhead. One language for server and web app.
- **PostgreSQL + Drizzle ORM**: `NUMERIC` columns for exact amounts and quantities (decimal.js in the code, never plain numbers), typed queries and generated SQL migrations. PGlite runs the same migrations in tests, during development and in the single-container variant.
- **React + Vite + Tailwind + TanStack Query + Recharts** (web): a responsive app with a light and dark theme, served by the same container.
- **pdf.js** (web): reads an annual statement as PDF in the browser; only loads when you choose a PDF.
- **One app container** with a built-in scheduler. For one user at home, a separate worker or queue would only add parts.

### Security

- Passwords are hashed with argon2id. Sessions are random 256-bit tokens, stored hashed, in `HttpOnly; SameSite=Strict` cookies.
- **Two-step verification** (_Settings_): after the password, a code from an authenticator app (TOTP, such as Aegis, 2FAS or Google Authenticator). Every code works once. You get ten recovery codes for when you lose your phone; they're shown only once and stored as an HMAC with the app key, so a copy of the database or a backup isn't enough to guess them. The secret is stored encrypted, just like API keys. After five wrong codes in a row the app checks no codes for your account for fifteen minutes, and after every following series twice as long (up to a day), from whatever IP address the attempts come. Turning it off needs your password and a code. Locked out: `docker compose exec app node dist/cli.js disable-2fa` turns it off (in the single-container variant: see [In one container](#in-one-container)).
- CSRF: every API request that changes something must have the `X-Requested-With: portfolio` header, which other sites can't send along without a CORS preflight the server never allows.
- Signing in, the first installation, changing the password and setting up two-step verification are limited per IP address. The app only trusts `X-Forwarded-For` if `TRUST_PROXY` is set, so a forged header doesn't bypass the limit. Behind a reverse proxy you set `TRUST_PROXY` (for example `true`, or the proxy's IP address). The first installation is atomic: only one user can be created. Passwords and cookies aren't logged.
- CSV exports defuse cells that would otherwise run as a spreadsheet formula (for example a token named `=HYPERLINK(…)`).
- Every addition, change and deletion is recorded in `audit_log`, with the situation before and after.
- Responses have a strict Content-Security-Policy (scripts only from the site itself, can't be loaded in a frame), `nosniff`, `no-referrer` and a restrictive Permissions-Policy. With `COOKIE_SECURE=true` HSTS is added.
- The app runs as a normal user, not as root. Backups are only readable by their owner, and backup names are checked so requests can't get outside the backup folder.
- A new installation only accepts its first user with the one-time setup code from the app's log. That way nobody else on your network can create it, not even a website you visit (via DNS rebinding).
- We advise against putting Box3balans on the internet; use a VPN (see [Access away from home](#access-away-from-home-vpn)). If you do anyway, put it behind a reverse proxy with HTTPS and set `COOKIE_SECURE=true`.
- Exchange API keys are stored encrypted (AES-256-GCM, HKDF of the app key) and never sent back or logged. If the app key changes, you have to enter them again.
- Found a vulnerability? Report it privately: see [SECURITY.md](SECURITY.md#security-in-english).

## Troubleshooting

| What you see                                         | What you can do                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A synced coin has the wrong price                    | After a sync, _New assets added_ shows which price source each new coin is linked to (for example "LUNA → CoinGecko terra-luna-2"). If that's not right, edit the asset under _Assets_ and fill in the right CoinGecko ID.                                |
| A price shows "stale price" or "no price yet"        | _Settings → Prices_ shows what failed. Free APIs rate-limit; prices are retried at the next update. For a wrong ticker: edit the asset (_Assets_) and correct the Yahoo ticker or CoinGecko ID.                                                           |
| The chart says "valued at cost"                      | The price history is still loading (that happens in the background after changes), or there's no free history for that asset. `POST /api/prices/backfill` forces a new check.                                                                             |
| A connection or wallet shows balance differences     | History the API doesn't show (very old transactions, staking moves). Complete the history, or use _Adjust_ for a correcting deposit or withdrawal.                                                                                                        |
| "Stored credentials cannot be decrypted"             | The app key changed (for example a new `app-data` volume or another `APP_SECRET`). Put the old key back, or enter the API keys again.                                                                                                                     |
| The container is unhealthy                           | `docker compose logs app`. The health check (`/api/health`) also fails if the database can't be reached.                                                                                                                                                  |
| Pages are slow                                       | Set `LOG_LEVEL=debug` and run `docker compose up -d`; every request then logs its `responseTime` in milliseconds (`docker compose logs app \| grep responseTime`). Set it back to `info` afterwards.                                                      |
| The `db` container keeps restarting after an update  | The log mentions old databases or incompatible data files: PostgreSQL's major version changed. Go back to the previous image tag and follow [Upgrading PostgreSQL](#upgrading-postgresql).                                                                |
| "The database … is in use by the running Box3balans" | In the single-container variant the command line can't make or restore a backup while the app runs. Use _Settings → Backups & export_, or stop the app first (see [In one container](#in-one-container)).                                                 |
| Lost the phone with the authenticator app            | Sign in with one of your recovery codes and set up two-step verification again. No recovery codes left: `docker compose exec app node dist/cli.js disable-2fa` turns it off (in the single-container variant: see [In one container](#in-one-container)). |
| Locked out                                           | There's one user and no recovery by email. Restore a backup, or delete the user in the database: `docker compose exec db psql -U box3balans -c "delete from users"`, and open the app to do the first installation again (your data stays).               |

Is your problem not listed, or can't you figure it out? Ask your question in [Discussions](https://github.com/zenonymous/box3balans/discussions/categories/q-a).

## Licence

Box3balans is free software under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). You may use, study, change and distribute it. If you distribute a changed version, or let others use it over a network, you must offer them the source code of that version, under the same licence. The app therefore links to its own source code (_Settings → About_). There's no warranty.

The name "Box3balans" isn't covered by the licence: give a changed version you distribute a name of its own.
