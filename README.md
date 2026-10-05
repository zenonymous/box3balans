# Kluishuis

_Your vault lives at home._

A self-hosted dashboard for tracking investments in **stocks/ETFs, crypto, and gold & silver** (physical and vaulted) in **EUR**. It runs as a single `docker compose` stack and has one user.

## Status

The work follows the 8 milestones in [`docs/PROMPT.md`](docs/PROMPT.md).

| #   | Milestone                                                               | Status                                                                                  |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Compose stack, auth, DB, manual entry, live prices, overview & holdings | ✅ done                                                                                 |
| 2   | Physical/vaulted metals and metals view                                 | ✅ done (built together with 1)                                                         |
| 3   | CSV importers (DEGIRO, Trade Republic, IBKR, Goldrepublic, generic)     | 🟡 generic import with column mapping done; built-in broker formats need sample exports |
| 4   | Exchange API sync (Bitvavo, Kraken, Coinbase, IBKR Flex)                | ✅ done (not yet tried against live accounts)                                           |
| 5   | Wallet tracking (BTC incl. xpub, EVM, Solana, more)                     | ✅ done (BTC verified live; other chains against stubs)                                 |
| 6   | History backfill, P&L reports, dividends/income views                   | ✅ done                                                                                 |
| 7   | Dutch Box 3 overview & exports                                          | ✅ done                                                                                 |
| 8   | Backups, polish                                                         | ✅ done                                                                                 |

## Install on your NAS

You need an x86-64 machine with Docker and Docker Compose v2 (`docker compose version` works), and SSH access to it from the computer that has this repository.

1. **Copy the code** (on your computer, in this repository):

   ```bash
   scripts/deploy.sh you@nas
   ```

   This sends the last commit to `~/kluishuis` on the NAS. Give a second argument for another folder, e.g. `scripts/deploy.sh you@nas /volume1/docker/kluishuis`. If `docker` needs `sudo` there (as on Synology), use `DOCKER="sudo docker" scripts/deploy.sh you@nas`. Only committed files are sent: never `.env`, data or backups.

2. **Configure** (on the NAS):

   ```bash
   cd ~/kluishuis
   cp .env.example .env
   chmod 600 .env
   # fill in POSTGRES_PASSWORD and APP_SECRET, each e.g. with: openssl rand -hex 32
   ```

   Also set `BACKUP_PASSPHRASE` (encrypts backups) and `PUID`/`PGID` (your NAS user, so you and your NAS backup tool can reach the `backups` folder). Store `APP_SECRET` and `BACKUP_PASSPHRASE` in your password manager: restoring needs them (see [Backups](#backups-and-restore)).

3. **Start** with `docker compose up -d --build`. The first build takes a few minutes. After about 30 seconds `docker compose ps` should show both containers as `healthy`.

4. **Open** `http://<nas>:8080` and create your user (a password of 12 or more characters). The sidebar shows the version you're running.

No SSH? Run `git archive -o kluishuis.tar HEAD`, copy the file over (e.g. with the NAS's file manager), unpack it into the folder, and continue with step 2.

**Checking on it:** `docker compose logs app --tail 50`. The first lines show `Kluishuis starting` with the version, followed by `price refresh done`. After a NAS reboot you may see `Database not reachable yet…, waiting for it` once: the app waits for PostgreSQL to come up.

### Updating

Commit your changes, then run the same command:

```bash
scripts/deploy.sh you@nas
```

It copies the new code and runs `docker compose up -d --build` on the NAS. Your `.env`, database and backups stay as they are, and database migrations run automatically on startup. For a backup first: `docker compose exec app node dist/cli.js backup`.

To also pick up security updates of the Node and PostgreSQL base images, run on the NAS: `docker compose pull db && docker compose build --pull && docker compose up -d`.

### Upgrading PostgreSQL

Patch updates (18.x) come with `docker compose pull db && docker compose up -d`. A new major version (e.g. 18 → 19) can't read the old data files directly; move the data with a backup instead. This was rehearsed on real PostgreSQL 17 → 18: every page showed identical data afterwards.

1. Make a backup: `docker compose exec app node dist/cli.js backup`.
2. `docker compose down`.
3. In `docker-compose.yml`, change the `db` image tag (e.g. `postgres:19-alpine`) **and** rename the volume (`db-data` → `db-data-19`, in both places). The old volume stays untouched as a fallback.
4. `docker compose up -d`. The app starts on an empty database and creates the tables.
5. Restore: `docker compose exec app node dist/cli.js restore /backups/<the backup from step 1>`, then `docker compose restart app` and sign in again.
6. Once everything looks right, remove the old volume: `docker volume rm kluishuis_db-data`.

### Access away from home (VPN)

Keep Kluishuis off the internet: don't forward port 8080 on your router. To reach it from your phone or laptop elsewhere, use a VPN:

- **WireGuard or Tailscale, plain:** open `http://<nas-vpn-address>:8080`. The VPN already encrypts the traffic. Keep `COOKIE_SECURE=false`.
- **Tailscale with HTTPS** (a proper `https://` address): turn on MagicDNS and HTTPS certificates in the Tailscale admin console, then run on the NAS (with `sudo` if needed):

  ```bash
  tailscale serve --bg 8080
  ```

  Kluishuis is now at `https://<nas-name>.<tailnet>.ts.net`. Set `COOKIE_SECURE=true` in `.env` and run `docker compose up -d`. From then on, use only the https address: the plain `http://` one won't keep you signed in. Leave `TRUST_PROXY=false`. All requests then share one login rate limit, which is fine for a single user.

  To make the https address the only way in, publish the port on the NAS itself only: in `docker-compose.yml`, change the `ports` line to `"127.0.0.1:${HTTP_PORT:-8080}:8080"`.

## Backups and restore

Backups are gzipped JSON of **all** data except login sessions: accounts, transactions, metals and their photos, prices, settings, connections and wallets. They are written to the **`backups` folder next to `docker-compose.yml`** on the NAS:

- **Automatically**, every `BACKUP_INTERVAL_HOURS` (default 24). The newest `BACKUP_KEEP` (default 14) automatic backups are kept.
- **Manually**, with _Settings → Backups & export → Back up now_, or `docker compose exec app node dist/cli.js backup`. Manual backups are never deleted automatically.
- **Before every restore**, as a safety copy (`…-prerestore…`).

**Encrypt them.** Set `BACKUP_PASSPHRASE` in `.env` (at least 12 characters, e.g. a few random words) and new backups are encrypted (`….json.gz.enc`, AES-256-GCM with a key derived by scrypt). A wrong passphrase or a damaged file is detected, never half-restored. Keep the passphrase in your password manager: **without it an encrypted backup can't be restored**. Without a passphrase, backups are plain gzip and contain your password hash and all financial data in readable form; _Needs attention_ reminds you.

**Off-site copies.** Point your NAS's own backup tool (Hyper Backup, rclone, a cloud sync…) at the `backups` folder. Files belong to `PUID`/`PGID` from `.env`: set those to your NAS user (`id` on the NAS shows them) so the tool and you can reach them. Or use _Download_ next to each backup in Settings.

Exchange API keys inside a backup are encrypted with `APP_SECRET` as well. **Keep `APP_SECRET` in your password manager too**: without it, a restore works but the API keys must be re-entered.

**Restoring** replaces all current data with the backup's, in one database transaction: either everything is restored or nothing changes. Backups from older app versions restore fine; backups from a newer version are refused. Everyone is signed out afterwards; sign in with the account from the backup.

- From the UI: _Settings → Backups & export → Restore…_ next to a backup, then type `RESTORE`. For a backup made with an earlier passphrase, enter that passphrase there.
- From a file, e.g. on a new server: put it in the `backups` folder, then

  ```bash
  docker compose exec app node dist/cli.js restore /backups/kluishuis-20261002-030000-auto.json.gz.enc
  docker compose restart app
  ```

  It uses `BACKUP_PASSPHRASE` from `.env`; for another one: `docker compose exec -e BACKUP_PASSPHRASE='…' app node dist/cli.js restore …`.

- To read an encrypted backup outside the app: `docker compose exec app node dist/cli.js decrypt /backups/<file>.enc` writes the plain `.json.gz` next to it.

**Extra safety net (optional).** A raw database dump, which needs a matching PostgreSQL version to restore:

```bash
docker compose exec db pg_dump -U kluishuis kluishuis | gzip > kluishuis-db.sql.gz
```

**Exports.** _Settings → Backups & export_ also downloads **all transactions** and **current holdings** as CSV. Performance, Income and Box 3 each have their own CSV export.

### Configuration (`.env`)

| Variable                | Default                 | Purpose                                                                   |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`     | — (required)            | Password for the bundled PostgreSQL                                       |
| `APP_SECRET`            | — (required, ≥32 chars) | Key material for encrypting exchange API keys at rest                     |
| `HTTP_PORT`             | `8080`                  | Host port                                                                 |
| `COOKIE_SECURE`         | `false`                 | Set to `true` when served over HTTPS (reverse proxy)                      |
| `TRUST_PROXY`           | `false`                 | Only behind a reverse proxy: `true`, a hop count, or the proxy's IP(s)    |
| `TIME_ZONE`             | `Europe/Amsterdam`      | Calendar for "which day/year" (Box 3 peildatum, yearly results)           |
| `SESSION_DAYS`          | `30`                    | Login lifetime                                                            |
| `PRICE_REFRESH_MINUTES` | `15`                    | Price refresh interval                                                    |
| `SYNC_INTERVAL_HOURS`   | `6`                     | Exchange, broker and wallet sync interval; `0` = manual only              |
| `SOLANA_RPC_URL`        | public mainnet RPC      | Optional own Solana RPC (e.g. a free Helius key) for faster first imports |
| `BACKUP_INTERVAL_HOURS` | `24`                    | Automatic backup interval; `0` = off                                      |
| `BACKUP_KEEP`           | `14`                    | Automatic backups to keep                                                 |
| `BACKUP_PASSPHRASE`     | —                       | Encrypts backups (12+ characters). Keep it safe: needed to restore        |
| `PUID` / `PGID`         | `1000`                  | Owner of the backup files: your NAS user and group ids                    |
| `LOG_LEVEL`             | `info`                  | `debug` also logs every request                                           |

## Using it

1. **Accounts**: add one per place you hold assets: brokers (DEGIRO), exchanges (Bitvavo), wallets (Ledger), vaults (Goldrepublic), physical storage (Home safe).
2. **Assets**: search Yahoo Finance by name, ticker or ISIN, or CoinGecko by coin. Pick the listing you actually trade (e.g. `IWDA.AS` rather than `IWDA.L`). Gold, silver, platinum, palladium and EUR cash exist already.
3. **Transactions**: buy, sell, deposit, withdrawal, dividend (gross plus tax withheld), staking reward, fee paid in the asset, split, and **transfers** between accounts, which carry the cost basis along. Foreign-currency trades get the ECB rate for that date automatically; you can override it.
4. **Metals**: add coins and bars with weight and purity, or pick a preset (Krugerrand, Maple Leaf, Gouden Tientje, standard bars …). Items are valued at spot by fine weight. If you enter the spot value at purchase, the premium you paid is tracked. Vaulted metal (Goldrepublic) is recorded as buy transactions in **grams** on the Gold/Silver asset. Each item can have up to 8 **photos** (resized in the browser; location data is removed). _Inventory_ prints or saves as PDF a list per storage location with photos, weights, purchase details and value at spot, e.g. for your home insurance.

### CSV import

_Transactions → Import CSV_ reads exports from any broker, exchange or spreadsheet:

1. **Choose the account and the file.** Semicolons or commas, decimal commas or points, a byte order mark, title lines above the header and Windows-encoded files are all handled.
2. **Check the columns.** Kluishuis guesses which column is what from common English and Dutch headers (Datum, Aantal, Koers, Valuta…) and shows an example value for each. The transaction type comes from a type column, is the same for every row, or follows the sign of the quantity (negative = sell, as in some broker exports). Each value of a type column ("Koop", "Staking", "Airdrop"…) is mapped to a type or skipped. Save the settings under a name: files with the same columns then use them automatically.
3. **Review before importing.** Nothing is written until you press _Import_. The preview shows:
   - **New**: will be imported.
   - **Already imported**: the same row from an earlier import of this or an overlapping export.
   - **Possible duplicate**: same asset, type, day and quantity as a transaction from another source (an API sync, manual entry or an import with different settings). Skipped unless you tick _Import anyway_.
   - **Problem**: a row that can't be read, with the reason (e.g. a date or number it doesn't understand).
   - **Assets**: what each symbol or ISIN is booked on. Existing assets are reused; new ones are looked up on Yahoo (by ISIN, preferring a euro listing) or CoinGecko (by symbol) and created when you import. Pick another asset for any of them if the match is wrong.

Times without a time zone are read as local time (`TIME_ZONE`). Prices in a foreign currency get the ECB rate of that day. Rewards and crypto deposits without a price are valued at that day's close. Crypto withdrawals and deposits are linked to matching transfers in your other accounts, as with syncs.

**Undo:** _Earlier imports_ lists every import with an _Undo_ that deletes exactly the transactions it created. Transactions you delete one by one stay deleted when you import the same file again.

**Template:** for anything without a usable export, fill in [the template](server/src/import/mapping.ts) (_↓ Template_ on the import page). Columns: `date` (YYYY-MM-DD), `time`, `type` (buy, sell, deposit, withdrawal, dividend, reward, fee, split), `symbol`, `isin`, `name`, `asset_type` (stock, etf, crypto, metal, cash), `quantity` (for a split: the ratio, e.g. 4), `price`, `total`, `currency`, `fee`, `amount` and `tax_withheld` (dividends), `notes`, `id`.

### Connections (exchange & broker sync)

**Connections** imports history over read-only APIs: **Bitvavo**, **Kraken**, **Coinbase** (CDP ECDSA key) and **Interactive Brokers** (Flex Web Service). The connect dialog lists the exact permissions to grant for each one. Keys are checked with a live read-only call, encrypted with AES-256-GCM using a key derived from `APP_SECRET`, and never returned by the API or written to logs.

Each sync:

1. **Imports** trades, deposits, withdrawals, staking rewards, dividends (with withholding tax) and interest as normal transactions (`source: api`). Missing assets are created automatically: coins via CoinGecko (highest market cap match for the symbol), and securities via Yahoo by ISIN on the listing exchange IBKR reports.
2. **Settles cash**: buys draw down and sales credit the account's cash balance in the trade currency, so exchange EUR balances add up.
3. **Values in EUR**: fiat trades use the ECB rate of the day. Staking rewards, crypto deposits and crypto-to-crypto trades use the daily EUR close (Yahoo `SYM-EUR`, with CoinGecko as fallback). Coinbase provides EUR values itself, provided your Coinbase native currency is EUR.
4. **Links transfers**: a crypto withdrawal from one account and a matching deposit into another (within 5 days, at least 95% of the amount arriving) become one transfer, so the cost basis moves along with it. If a link is wrong, open either leg under _Transactions_ and choose **Unlink**; those two rows are then never linked automatically again.
5. **Reconciles** the computed balances against what the exchange reports. Differences are listed on the Connections page with a one-click adjustment.

Re-syncs are idempotent. You can edit imported transactions, and a re-sync never overwrites your edits. Imported transactions you delete stay deleted.

Known limits: the Bitvavo fee handling assumes fees are charged on top of the sent amount (reconciliation will flag it if that is wrong). Coinbase doesn't report trade fees separately. IBKR Flex covers at most 365 days per query, skips options and futures, and doesn't apply stock splits (reconciliation flags those).

### Wallets (self-custody, by public address)

**Wallets** tracks addresses read-only, from free public explorers with no API keys. It never asks for or stores seed phrases or private keys.

| Chain                                       | Source                           | Notes                                                                                                                                                                                                                            |
| ------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bitcoin                                     | mempool.space                    | Addresses or **xpub/ypub/zpub**. Extended keys are scanned with a gap limit of 20 on both the receive and change chains. Legacy, nested SegWit, native SegWit and **Taproot** (choose "Taproot" for a BIP86 xpub)                |
| Litecoin                                    | litecoinspace.org                | Addresses or Ltub/Mtub/xpub-style keys                                                                                                                                                                                           |
| Ethereum, Arbitrum, Optimism, Base, Polygon | Blockscout                       | Native coin, internal transfers and ERC-20 tokens. The add dialog can track the same address on several chains at once                                                                                                           |
| Solana                                      | public RPC (or `SOLANA_RPC_URL`) | SOL and SPL tokens. Large histories import gradually (~1,500 transactions per sync) because of the public rate limit                                                                                                             |
| XRP Ledger                                  | xrplcluster.com                  | XRP payments; issued tokens are skipped                                                                                                                                                                                          |
| Tron                                        | TronGrid                         | TRX and TRC-20 tokens (e.g. USDT)                                                                                                                                                                                                |
| Cardano                                     | Koios (free public API)          | ADA, native tokens and **staking rewards** (dated when they become spendable; deposit refunds are not income). Paste the stake address (stake1…) or any receive address: Kluishuis tracks the whole wallet through its stake key |
| Dogecoin                                    | BlockCypher (free tier)          | Addresses or **dgub/xpub** (BIP44, gap limit 20). The free tier allows 100 requests an hour: a big history or a fresh xpub can take a few syncs                                                                                  |

How a wallet sync works:

- **All addresses of a wallet on one chain are netted together**, so moving coins between your own addresses (or change outputs) only costs the network fee. Adding or removing an address re-imports that chain.
- **Fees** become `fee` transactions, and **swaps** (one token out, another in) become a sale plus a purchase at the same EUR value.
- **Tokens** are identified by contract through CoinGecko, so USDC on Ethereum, Base and Solana is one asset. Tokens CoinGecko doesn't list, or that the explorer flags as spam, are **skipped**: usually they are airdrop spam. Each wallet lists them and has an "include them anyway" switch, which adds them as manually priced assets. Lookups are cached and capped per sync; on a rate limit the rest wait for the next sync.
- **Transfers** to and from your exchanges are linked automatically, so the purchase cost carries over. **Reconciliation** compares the result with the on-chain balance once the full history is in.
- Syncs run in the background. Pages show progress, and dialogs can be closed while an import continues.

Adding another chain means implementing `ChainAdapter` (`server/src/wallets/types.ts`): validate an address, then fetch per-transaction movements, fees paid and current balances. Netting, token lookup, import, transfer matching and reconciliation are shared.

Not covered yet: Ethereum validator withdrawals; Solana stake accounts and staking rewards; frozen TRX; XRP issued tokens; Cardano Byron-era addresses.

### Box 3 (Dutch wealth tax)

The **Box 3** page estimates box 3 under the forfaitaire spaarvariant (tax years 2023 onwards) for each tax year since your first activity.

- **Peildatum 1 January:** holdings at the end of 31 December, valued at that day's close or the last close before it. Wallets, vaults and physical metal are included.
- **Categories:** each holding counts as _banktegoeden_, _overige bezittingen_, _groene beleggingen_ (green investments) or _niet in box 3_. By default, cash at a bank or broker is a bank balance, cash on a crypto exchange or in a wallet is another asset, and investments, crypto and metals are other assets. Whole accounts can be overridden, e.g. a fund with a groenverklaring as green investments, or a pension account as not in box 3. Green investments are exempt only up to the yearly limit (2023 €65,072; 2024 €71,251; 2025 €26,312; 2026 €26,715 per person, doubled for partners); the excess counts as other assets, and the small green tax credit (0.7% through 2024, 0.1% after) is deducted. The exemption ends in 2027. Other assets are also split into investments, crypto and metals, matching how the aangifte asks for them.
- **Your situation per year:** fiscal partner (doubles the allowance and debt threshold), debts, and bank balances or other assets the app doesn't track.
- **Calculation:** follows the Belastingdienst steps (deemed return → rendementsgrondslag → grondslag → share → voordeel → tax). The official 2023–2026 figures are built in (2026 bank and debt rates are provisional), and every rate is editable under _Rules & rates_.
- **Actual vs. deemed return:** the year's actual result from Performance, shown next to the deemed return as an indication for the _tegenbewijsregeling_.
- **Export:** CSV of all holdings on the peildatum, and _Print / PDF_ (a print layout without the app chrome).

It's an estimate, not tax advice: check the values against your banks' and brokers' year statements (jaaroverzichten).

### How the numbers are calculated

- **Entering numbers** follows the number format chosen in Settings. With the Dutch format, "5.000" is five thousand and "1,5" is one and a half; "1.234,56" works too. As soon as you type a separator, the field shows how it was read (e.g. "= 5 000"), and a value that could be read two ways is highlighted. Numbers copied from English-language sites, like "0.0015", are still read correctly.
- **Cost basis** is per account, with **average cost** by default or **FIFO** (Settings → Cost basis). Fees on buys are added to cost, and fees on sells are deducted from proceeds. Transfers carry their cost lots along.
- **Network fees paid in a coin** (gas, Bitcoin miner fees) are a realized loss of the cost of the coins spent. They're listed as "network fee" among the realized gains.
- **Realized P&L** = sell proceeds − fees − cost of the units sold. Because cost is in EUR at the transaction's FX rate, currency effects are included. For holdings bought in a foreign currency, the open gain is also split into a **price effect** (valued at the exchange rate you paid) and a **currency effect**.
- **Rewards** (staking) arrive with a cost basis equal to their market value and count as income. **Dividends** count as income net of withholding tax.
- **Cash** is valued at face value (non-EUR at the ECB rate) and is not part of "invested". Manual buys, sells and dividends can optionally settle against an account's cash balance; synced ones always do.
- **Net worth over time** is computed from your transactions: each day's holdings are valued at that day's close, carrying the last close over weekends and holidays. Holdings without any price history yet count at cost, and the chart says so. Period changes (1W, 1M, YTD) are net worth changes and include deposits.
- **Performance per year** = realized gains + income + change in open (unrealized) gains over the year. Deposits and withdrawals aren't results, and the years add up to the all-time result. Fees and withholding tax are already included and shown for reference.
- **Income** = dividends net of withholding tax, staking and other rewards at their EUR value when received, and interest (rewards paid on cash). The Income and Performance pages export CSV.
- **Day change** comes from each provider's 24h change. Where a provider has none (metals), it is derived from the previous stored daily close.

### Price sources (free, no keys)

| Asset         | Source                                                     | Fallback                                                   |
| ------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Stocks / ETFs | Yahoo Finance chart API (quotes in GBp/ZAc are normalised) | Tradegate by ISIN (EUR, converted to the listing currency) |
| Crypto        | CoinGecko `simple/price` (EUR)                             | Bitvavo public ticker, then Yahoo `SYM-EUR`                |
| Metals        | gold-api.com spot (USD/oz → EUR/g)                         | Yahoo COMEX futures (`GC=F`, `SI=F`, …)                    |
| FX            | ECB reference rates via Frankfurter                        | last cached rate                                           |

A fallback is only used when the main source gives no price, and only if its price is between half and double the last known one (a token without a known price is never priced by symbol, which could be a different coin). _Settings → Prices_ shows when it happened. Every refresh stores the latest quote, today's close in `price_history`, and a net-worth snapshot.

**Price history backfill** loads daily EUR closes for every asset from its first transaction until today. It covers Yahoo (stocks, ETFs, `SYM-EUR` crypto pairs), CoinGecko (crypto, last 365 days, as a fallback), Yahoo futures for metals, and ECB rates for foreign cash. It runs 30 seconds after startup, daily, and a few seconds after transactions change or a sync finishes. Each asset is loaded in full once, then topped up incrementally. `POST /api/prices/backfill` forces a full re-check. One failing asset does not block the others; failures appear on the Overview and Settings pages.

## Development

Requirements: Node 22+. Without `DATABASE_URL`, the server uses an embedded PostgreSQL (PGlite) under `server/.data/`, so no Docker is needed.

```bash
npm install
cp .env.example server/.env   # set APP_SECRET; leave DATABASE_URL unset for PGlite
npm run dev:server            # API on :8080 (also serves web/dist if built)
npm run dev:web               # Vite on :5173, proxies /api to :8080
```

| Command                                           | What it does                                                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                        | Server unit tests (ledger maths) and API integration tests (in-memory Postgres, stubbed price APIs)                                                                                       |
| `npm run typecheck`                               | TypeScript, server and web                                                                                                                                                                |
| `npm run lint` / `npm run format`                 | ESLint / Prettier                                                                                                                                                                         |
| `npm run build`                                   | Compile server to `server/dist`, bundle web to `web/dist`                                                                                                                                 |
| `npm run db:generate -w server`                   | Generate a migration after editing `server/src/db/schema.ts`                                                                                                                              |
| `npm run dev:live -w server`                      | A second instance on `http://127.0.0.1:8081` with its own empty database, to try real exchange keys and wallets without mixing them with demo data. Delete `server/.data/live` afterwards |
| `npx tsx scripts/bench.ts [scale]` (in `server/`) | Times the main pages against a large synthetic history (scale 1 ≈ 20,000 transactions)                                                                                                    |

Demo data: after creating a user, run `SESSION=<pd_session cookie> npx tsx server/scripts/sample-data.ts`.

### Stack and why

- **Fastify + TypeScript** (server): fast, schema-friendly, small footprint. One language across server and UI.
- **PostgreSQL + Drizzle ORM**: `NUMERIC` columns for exact money and quantities (decimal.js in code, never floats), typed queries, and generated SQL migrations. PGlite runs the same migrations in tests and local dev.
- **React + Vite + Tailwind + TanStack Query + Recharts** (web): a responsive SPA with light/dark themes, served by the same container.
- **Single app container** with an in-process scheduler. For a one-user home server, a separate worker or queue would only add moving parts.

### Security notes

- Passwords are hashed with argon2id. Sessions are random 256-bit tokens, stored hashed, in `HttpOnly; SameSite=Strict` cookies.
- CSRF: every mutating `/api` request must carry `X-Requested-With: portfolio`, which cross-site pages cannot send without a CORS preflight the server never grants.
- Login, setup and password change are rate-limited per client IP. The app only trusts `X-Forwarded-For` when `TRUST_PROXY` is set, so a faked header can't dodge the limit. Behind a reverse proxy, set `TRUST_PROXY` (e.g. `true`, or the proxy's IP). First-run setup is atomic, so only one account can ever be created. Credentials and cookies are redacted from logs.
- CSV exports escape cells that would otherwise run as spreadsheet formulas (e.g. a token named `=HYPERLINK(…)`).
- Every create, update and delete is written to `audit_log` with before/after snapshots.
- Responses carry a strict Content-Security-Policy (same-origin scripts only, no framing), `nosniff`, `no-referrer` and a restrictive Permissions-Policy. HSTS is added when `COOKIE_SECURE=true`.
- The container runs as an unprivileged user. Backups are written owner-readable only, and backup file names are validated so requests can't reach outside the backup folder.
- Exposing the dashboard to the internet isn't recommended; use a VPN (see [Access away from home](#access-away-from-home-vpn)). If you do expose it, put it behind a reverse proxy with HTTPS and set `COOKIE_SECURE=true`.
- Exchange credentials are encrypted at rest (AES-256-GCM, HKDF from `APP_SECRET`) and never returned or logged. Changing `APP_SECRET` means re-entering keys.

## Troubleshooting

| Symptom                                             | What to check                                                                                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A synced coin got the wrong price (wrong coin)      | After a sync, _New assets added_ shows which price feed each new coin was matched to (e.g. "LUNA → CoinGecko terra-luna-2"). If it's wrong, edit the asset under _Assets_ and set the right CoinGecko id.                             |
| A price shows "stale" or "no price yet"             | _Settings → Prices_ lists failures. Free APIs rate-limit; prices retry on the next refresh. For a wrong ticker, edit the asset (_Assets_) and fix its Yahoo ticker or CoinGecko id.                                                   |
| The history chart says "valued at cost"             | Price history is still loading (it runs in the background after changes), or there is no free history for that asset. `POST /api/prices/backfill` forces a re-check.                                                                  |
| A connection or wallet shows balance mismatches     | History the API doesn't expose (very old trades, staking moves). Fix the history, or use _Adjust_ to record a correcting deposit or withdrawal.                                                                                       |
| "Stored credentials cannot be decrypted"            | `APP_SECRET` changed. Restore the old value, or re-enter the API keys.                                                                                                                                                                |
| The container is unhealthy                          | `docker compose logs app`. The health check (`/api/health`) also fails when the database is unreachable.                                                                                                                              |
| Pages feel slow                                     | Set `LOG_LEVEL=debug` and `docker compose up -d`; every request then logs its `responseTime` in milliseconds (`docker compose logs app \| grep responseTime`). Set it back to `info` afterwards.                                      |
| The `db` container keeps restarting after an update | Its log mentions old databases or incompatible data files: the PostgreSQL major version changed. Go back to the previous image tag, then follow [Upgrading PostgreSQL](#upgrading-postgresql).                                        |
| Locked out                                          | There is one user and no reset by e-mail. Restore a backup, or reset the password from the database: `docker compose exec db psql -U kluishuis -c "delete from users"`, then open the app to run first-time setup again (data stays). |
