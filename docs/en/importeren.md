# Bringing data in

_Nederlands: [importeren.md](../importeren.md)_

How to get your assets into Box3balans: values per year and bank exports, annual statements as PDF, CSV exports from brokers and exchanges, connections and wallets. A short overview is in the [README](../../README.en.md#using); what we know per provider, in [aanbieders.md](aanbieders.md).

## Values per year and bank exports

For an account with **values per year** (_Accounts → Values per year_) you fill in per year:

- **the value on 1 January**: from your bank's or broker's annual statement, or the balance at the end of 31 December. The value on 31 December is the value on 1 January of the next year, so you don't fill that in separately;
- **money in and out** in that year (deposits and withdrawals);
- **income**: interest or dividend that came in on the account, rent from a let home, interest on money lent; for a debt the **interest paid**;
- **costs** (only for the 2028 preview, where they're deductible).

For a **home** you fill in the WOZ value that applies to that year (the one with valuation date 1 January of the year before). If you let it with rent protection, tick _Let_ and fill in the annual rent: it then counts for part of the WOZ value (the vacant-value ratio, 73% to 100%, depending on the rent as a percentage of the WOZ value). The home you live in doesn't belong in box 3 (that's box 1).

**Providers without a usable export** are tracked like this:

- **Brand New Day:** per investment account a _Broker_ account with values per year (other assets), and per savings account a _Bank account_. The value on 1 January is the starting value from the _financieel jaaroverzicht_ (in February, under _Mijn documenten → Overzichten → Jaaroverzichten_); the income is the dividend paid out from that same statement; money in and out are the deposits and withdrawals from the four quarterly statements. Pension and annuity accounts don't belong in box 3; the mortgage account and the golden-handshake account have their own rules.
- **Crowdfunding** (Geldvoorelkaar, Collin Crowdfund, Lendahand, Mogelijk, Kapitaal Op Maat, Invesdor, DuurzaamInvesteren …): two accounts. The money lent becomes a _Money lent to others_ account (other assets), with the outstanding amount on 1 January from the annual statement and the interest received as income. Money in the wallet that hasn't been lent yet becomes a _Bank account_ with values per year (bank balance).
- **Managed investing** (NN Beheerd Beleggen, Centraal Beheer Beleggen, a bank's wealth management): a _Broker_ account with values per year, with the value on 1 January from the (tax) annual statement; try _Read a year statement (PDF)_ for that.
- **Investing at bunq** (_bunq Stocks_, via Ginmon): a _Broker_ account with values per year. You read the bank accounts in with the bank import; there's no connection with bunq, because a bunq key can also make payments.
- **Capital insurance:** a _Capital insurance_ account with the value on 1 January from the insurer's value statement. Box3balans doesn't apply the exemptions for capital insurance, such as the one for policies from before 15 September 1999 that weren't increased or extended; if your policy falls under that, set the account to _Not in box 3_ under _Box 3 → Rules & rates_. What remained at a.s.r. after 2020 are such policies.
- **Green funds** (ASN Groenprojectenfonds and other funds with a green certificate): set the account to _Green investments_ under _Box 3 → Rules & rates_; the exemption and the tax credit per year are in the rules. If a fund loses its green certificate, like the Triodos Groenfonds on 1 April 2026, set it to _Other assets_ under _From a year on_ from the next year (here 2027). On 1 January 2028 the exemption ends for everyone.
- **Bank savings and investment rights for the home you live in** (banksparen, beleggingsrecht eigen woning) belong in box 1 as long as they meet the conditions: set the account to _Not in box 3_. If they move to box 3, for example because they no longer meet the conditions, set them under _From a year on_ from that year to _Bank balances_ (bank savings) or _Other assets_ (investment right).

What we know per provider and what's still needed to support them better is in [docs/en/aanbieders.md](aanbieders.md).

**Reading a bank export.** For a bank account, _Read a bank export_ takes the balances on 1 January, the interest and the money in and out per year from the transactions you download from your bank. Box3balans reads:

- **CAMT.053**, the standard statement format with balances: the best choice if your bank offers it;
- **MT940**, the older standard format, also with balances;
- **CSV with a header row and a balance column**, such as from ING (_Saldo na mutatie_) and Rabobank (_Saldo na trn_); several accounts in one file are kept apart;
- **ABN AMRO's TAB file**;
- **CSV without balances** (such as from bunq): you then fill in the balance after the last row, and Box3balans calculates the rest backwards;
- **Revolut's and Wise's CSV statement**: every product and every currency becomes its own account, rows that are still pending or were reverted don't count, and amounts in another currency are converted at the ECB rate (the balance on 1 January at that of the last working day before, the rest at that of the day itself).

Which file to choose per bank:

| Bank                                  | Choose when downloading                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| ING                                   | CSV, of the current and the savings account (tested with real exports)                     |
| Rabobank                              | CSV                                                                                        |
| ABN AMRO                              | TAB or CAMT.053                                                                            |
| ASN Bank (also for SNS and RegioBank) | CAMT.053 (their CSV isn't tested)                                                          |
| Triodos                               | CAMT.053 or MT940 (the CSV isn't tested)                                                   |
| Knab                                  | MT940 (the default under _Bij- en afschrijvingen → Boekhoudexport_)                        |
| bunq                                  | CAMT.053 or MT940 if the app offers it; otherwise CSV, with the balance after the last row |
| Revolut                               | Statement as CSV (Excel), for all products or per account                                  |
| Wise                                  | Statement as CSV, per currency                                                             |

CAMT.053 and MT940 are built on the public standards. The exports from ASN Bank, Triodos, Knab, bunq, Revolut and Wise haven't been tested with real files yet; if reading doesn't work, report it (without amounts) in [#6](https://github.com/zenonymous/box3balans/issues/6).

Money in a money-market fund, such as _Flexible Cash Funds_ at Revolut or _Interest_ at Wise, isn't a bank balance but another asset: track that in its own account (for example a broker with values per year). Box3balans warns when a statement mentions such a fund.

Interest is recognised by the description ("rente", "creditrente", "interest"). You first see per year what was found: an estimated balance (because the file starts or ends halfway through a year) and the totals of years the file only partly covers are unticked until you tick them. Nothing is saved until you press _Save_ in the table.

### Annual statement as PDF

For every account with values per year, except a home, _Read a year statement (PDF)_ reads the annual statement (jaaroverzicht or jaaropgaaf) of your bank, broker or platform. The PDF is read in your browser and not stored: only the text goes to your own Box3balans ([ADR 0009](adr/0009-pdf-lezen-in-de-browser.md)). What you tick goes into the table, with the file name and the page as its source; that also appears in the dossier.

**ING's annual statement** is recognised: choose the account from the statement (current, savings or credit card account) and the balances on 1 January and 31 December and the interest are ticked right away. For a debt, such as a credit card, the balance goes in as what you owe. For a current account, check the balance: for one user ING's annual statement differed there from ING's own statements and export (the savings account matched). The bank export gives the balance as it is on your statements.

**Goldrepublic's account statement** over a whole year is recognised too: the total on 1 January and on 31 December, the deposits, the withdrawals and the costs (storage, transaction and handling costs) are ticked right away. If you want the purchases and sales themselves, read the same PDF in under [CSV import](#csv-import).

Box3balans looks for amounts next to a reference date ("1 januari 2025", "31-12-2024") and next to words such as _beginwaarde_, _eindwaarde_, _dividend_, _rente_, _inleg_, _onttrekkingen_ and _kosten_ (starting value, end value, dividend, interest, deposits, withdrawals, costs). An amount on 31 December is the value on 1 January of the next year. Per amount you choose whether it's right and which column it belongs in. A PDF without text (a scan) or with a password can't be read.

**Help recognise a statement.** If Box3balans knows a statement, the right amounts are ticked right away. That needs a sample of the text per provider. If Box3balans doesn't know your statement yet, tick the right amounts and choose _Help others read this statement_ below the table. Box3balans then makes a file with the statement's text:

- the text comes from the first page and from the pages with what you ticked;
- every number is made up (years, 1 January and 31 December stay);
- every word that isn't common in statements, or that's in the ticked lines, is struck out;
- you see exactly what's in it, and can have more words struck out.

Share it with the [_Share a format_](https://github.com/zenonymous/box3balans/issues/new?template=formaat-delen.yml) form (see [Sharing your format](#sharing-your-format)). Which providers matter most is in [docs/en/aanbieders.md](aanbieders.md#route-the-pdf-annual-statement).

You can also make the text yourself. Don't send a PDF, because blacked-out text in a PDF can often still be read. Send the output of this command (from [Poppler](https://poppler.freedesktop.org/), on a Mac with `brew install poppler`), with names, addresses, account numbers and amounts changed, with the [_Annual statement (PDF) from a provider_](https://github.com/zenonymous/box3balans/issues/new?template=jaaroverzicht.yml) form:

```bash
pdftotext -layout jaaroverzicht.pdf -
```

In January, _Needs attention_ reminds you to fill in the values on 1 January of the new year.

## CSV import

_Transactions → Import CSV_ reads exports from almost any broker, exchange or spreadsheet.

**Recognised exports.** Box3balans recognises these files by itself; you then don't have to choose columns:

| Provider             | Which file                                                                                                           | What's read                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEGIRO               | _Rekeningoverzicht_ (Account.csv) or _Transacties_ (Transactions.csv)                                                | Buys and sells with costs and transaction tax; from the account statement also corporate actions, dividend with dividend tax and interest                                                 |
| DEGIRO               | _Portefeuille_ (Portfolio.csv), on a day you choose                                                                  | No transactions but a check: your positions and the cash at DEGIRO on that day, next to what the transactions add up to; the cash counts for box 3                                        |
| ING                  | _Historisch portefeuilleoverzicht_ (CSV), from Eenvoudig Beleggen or Zelf op de Beurs                                | No transactions but a check, as with DEGIRO: your funds and the cash on the investment account on the day in the file. A fund that isn't in Box3balans yet is created by ISIN             |
| Bitvavo              | Transaction history (CSV)                                                                                            | Everything, with deposits and withdrawals in euros                                                                                                                                        |
| Coinbase             | Transaction report (CSV)                                                                                             | Buys, sells, conversions, sends and receives, rewards                                                                                                                                     |
| Kraken               | _Ledgers_ (ledgers.csv)                                                                                              | Everything against euros, with staking; trades between two coins via the API connection                                                                                                   |
| Bitstamp             | Transaction history (CSV), old and new layout                                                                        | Everything against euros, with deposits, withdrawals and staking; swaps between two coins not                                                                                             |
| Binance              | _Transaction History_ (CSV), for the history up to the summer of 2023                                                | Buys and sells, also against stablecoins (at one dollar per coin) and between two coins (at that day's closing prices), rewards, withdrawals; moves within Binance, futures and euros not |
| Crypto.com App       | _Accounts → History → Export_ (CSV of the crypto wallet)                                                             | Buys (also with the card), sells, conversions, rewards (Earn, staking, cashback), deposits and withdrawals; euros not                                                                     |
| Rabobank Beleggen    | Mutaties & nota's (CSV)                                                                                              | Everything, with deposits, costs and interest                                                                                                                                             |
| Trade Republic       | Transaction export with eight columns (also pytr's)                                                                  | Everything, with deposits, withdrawals and interest                                                                                                                                       |
| Trading 212, BUX     | History (CSV)                                                                                                        | Buys, sells with costs, dividend                                                                                                                                                          |
| Saxo                 | Transaction overview (Excel, saved as CSV)                                                                           | Buys, sells with costs, dividend                                                                                                                                                          |
| Lightyear            | _Download report_ (CSV) under Transactions                                                                           | Buys and sells with costs, dividend with tax; cash and currency exchanges not                                                                                                             |
| Scalable Capital     | Transactions → _Export CSV_ (PRIME+ only)                                                                            | Everything, with deposits, withdrawals, interest and costs                                                                                                                                |
| Revolut              | Stocks statement (CSV)                                                                                               | Buys, sells, dividend                                                                                                                                                                     |
| Revolut              | Crypto statement (CSV)                                                                                               | Buys and sells with costs, in any currency; sends, receives and staking rewards                                                                                                           |
| eToro                | _Account statement_ (Excel): only the _Account Activity_ tab, saved as CSV                                           | Buys, sells (with stamp duty) and dividend, in dollars; cash and CFDs not                                                                                                                 |
| Goldrepublic         | The account statement as a **PDF**: on the website _Afschriften_, in the app _Transacties_, with the period you want | Purchases and sales in grams (with transaction and handling costs), deposits, withdrawals and the monthly storage costs                                                                   |
| XTB                  | _Account history → Cash operations_, exported as CSV                                                                 | Buys and sells, dividend with withholding tax, in euros; cash and CFDs not                                                                                                                |
| Schwab Equity Awards | The award account's transaction history as CSV                                                                       | RSUs and ESPP at market value (what was taxed as wages), sells, dividend with withholding tax, in dollars                                                                                 |
| CoinTracking         | The _Trade List_ as CSV                                                                                              | Buys and sells, deposits, withdrawals, income (staking, mining, airdrops) and lost coins, from all your exchanges and wallets                                                             |
| Delta                | The export of all your transactions (CSV)                                                                            | Buys and sells, deposits, withdrawals, rewards and dividend                                                                                                                               |

Where a file has everything in euros (Bitvavo, Bitstamp, Kraken, Rabobank, Trade Republic, Scalable Capital, Goldrepublic), deposits and withdrawals come along too, so the cash balance is right. For the others Box3balans leaves the cash out and only follows your investments; the check screen shows what was left out.

**Switching from another tracker.** If you tracked your investments in CoinTracking or Delta, their export brings in your whole history in one go. Such an export contains all your exchanges and wallets at once: everything goes into the account you choose, and the check screen names the places the rows come from. For box 3 the total counts; if you still want to see what you have per place, export per place and import each file into its own account. A swap between two coins has no value in euros in these exports and is skipped (except for a CoinTracking export with value columns); the check screen says how many. Box3balans leaves cash (deposits and withdrawals in euros) out.

**Goldrepublic:** choose the account statement (PDF) under _Import CSV_ and a vault account. The PDF is read in your browser, just like an annual statement. A purchase or sale goes in at the moment the order was executed, with the costs and the handling costs; the storage costs Goldrepublic charges in euros every month count as storage costs. Box3balans checks that the money and the grams add up from the opening to the closing balance. The preview compares the statement's opening balance with what the account already has at the start of that day: if it matches, there's a tick; if not, it names the differences, usually because the statements for the years before are still missing (downloadable per year; import them from old to new). Built and tested with a real statement over 2025.

**ING Eenvoudig Beleggen or Zelf op de Beurs:** Box3balans reads the _Historisch portefeuilleoverzicht_ (historical portfolio overview) ING makes for any date (Mijn ING, at the bottom of the investment account, as CSV); ING's transaction export not yet. Create an account (broker, provider ING) and read the overview of 31 December under _Import CSV_: the fund is created by ISIN, with Yahoo's daily prices, and with one click you set the account equal to the overview. Do that every January; for box 3 that's enough. For the actual return a correction counts as a deposit on that day, so without the purchases before it. Tested with a real overview (October 2026).

**DEGIRO every January:** export the year's _Rekeningoverzicht_ and the _Portefeuille_ on 31 December, and import them in that order. The portfolio shows whether the transactions add up to what DEGIRO reports; you correct a difference with one click, and the cash at DEGIRO on 31 December counts as a bank balance. DEGIRO's account statement has been tested with a real export; the other formats are built on public sample files (among others from the Export-To-Ghostfolio project) and not yet tested with real exports: if something's not right, choose _Choose the columns myself_ and [report it](https://github.com/zenonymous/box3balans/issues/new/choose), preferably with an anonymised sample.

For other files:

1. **Choose the account and the file.** Semicolons or commas, decimal commas or points, a byte order mark, title rows above the header row and Windows encoding are all recognised.
2. **Check the columns.** Box3balans guesses which column is what from common English and Dutch headings (Date/Datum, Quantity/Aantal, Price/Koers, Currency/Valuta …) and shows a sample value per column. The transaction type comes from a column, is the same for every row, or follows from the sign of the quantity (negative = sell, as in some broker exports). You map every value in a type column ("Koop", "Staking", "Airdrop" …) to a type or skip it. Save the settings under a name: files with the same columns then use them by themselves.
3. **Review everything before you import.** Nothing is saved until you press _Import … transactions_. The preview shows:
   - **New:** will be imported.
   - **Already imported:** the same row from an earlier import of this or an overlapping file.
   - **Possible duplicate:** the same asset, type, day and quantity as a transaction from another source (a connection, manual entry or an import with other settings). Skipped, unless you tick _Import anyway_.
   - **Problem:** a row that can't be read, with the reason (for example a date or number that isn't understood).
   - **Assets:** which asset each symbol or ISIN is booked on. Existing ones are reused; new ones are looked up in Yahoo (by ISIN, preferably a euro listing) or CoinGecko (by symbol) and created on import. Choose another if the match isn't right.

Times without a time zone are read as local time (`TIME_ZONE`). Prices in a foreign currency get that day's ECB rate. Rewards and crypto deposits without a price get that day's closing price. Crypto withdrawals and deposits are linked to transfers to your other accounts, just as with syncs.

**Undo:** _Earlier imports_ shows every import with the _Undo_ button, which removes exactly the transactions the import created. Transactions you delete separately stay gone if you import the same file again.

**Template:** for anything without a usable export, fill in [the template](../../server/src/import/mapping.ts) (_↓ Template_ on the import page). Columns: `date` (YYYY-MM-DD), `time`, `type` (buy, sell, deposit, withdrawal, dividend, reward, fee, split), `symbol`, `isin`, `name`, `asset_type` (stock, etf, crypto, metal, cash), `quantity` (for a split: the ratio, for example 4), `price`, `total`, `currency`, `fee`, `amount` and `tax_withheld` (dividends), `notes`, `id`.

### Sharing your format

Box3balans doesn't know your broker's, bank's or exchange's export yet? Set up the columns as above. Then choose _Help others read this file_ at the bottom of the import page (before importing; afterwards the file is gone). Box3balans then makes a file on your own server with:

- **your column settings;**
- **a few made-up rows in your file's layout:** at most three per type, such as buy, dividend and deposit.
  - Dates, amounts, IDs and texts are made up.
  - Your funds and coins become well-known funds and coins, such as iShares Core MSCI World or Bitcoin.
  - The order of the dates stays the same.
- **what Box3balans reads from it.**

Of your own file only the column names, the words for the type, the currency codes and words such as _goud_ (gold) or _ETF_ remain. They're in a list; untick what mustn't be shared. Anything that looks like a name from your household, an IBAN, an email address, a phone number or a BSN has already been replaced. Then:

1. Download the file (`box3balans-formaat-….json`).
2. Open the [_Share a format_](https://github.com/zenonymous/box3balans/issues/new?template=formaat-delen.yml) form on GitHub, drag the file into it and submit it. You need a GitHub account for that.

Box3balans itself sends nothing. The issue is public: everyone sees the file, and that you're with this provider, under your GitHub name. How it works and why: [ADR 0012](adr/0012-formaten-delen-zonder-gegevens.md).

**Shared formats.** A shared format comes in a next version of Box3balans. Whoever chooses such a file afterwards gets the columns of that format filled in already, with the notice that the format comes from another user: check the columns and the preview before you import. Box3balans's own formats and your own saved settings take precedence.

## Connections with exchanges and brokers

**Connections** imports the history via read-only APIs: **Bitvavo**, **Kraken**, **Coinbase** (a CDP key with ECDSA) and **Interactive Brokers** (Flex Web Service), and **Bitpanda** (the new public API, with a key with only the read permissions _Balances_, _Transaction_ and _Trade (Read)_; not yet tested with a real key). An account via **LYNX** is an account at Interactive Brokers and should work the same way (not yet tested; if you have LYNX, let us know in [#17](https://github.com/zenonymous/box3balans/issues/17) whether it works). The connection dialog names exactly which permissions you give, per provider. Keys are checked with a real read request, stored encrypted (AES-256-GCM, with a key derived from the app key) and never sent back or logged.

**Read-only, checked where possible.** Coinbase reports what a key may do: Box3balans doesn't accept a key that can also trade or move money, and for an existing connection there's a warning at every sync. Bitvavo, Kraken, Bitpanda and Interactive Brokers don't report that, so there it depends on the permissions you choose yourself (the connection says which per provider). That matters: whoever gets hold of your server, and with it the app key, can read your stored keys, and a read-only key can't move anything then.

Every sync:

1. **Imports** buys, sells, deposits, withdrawals, staking rewards, dividends (with tax withheld) and interest as normal transactions (`source: api`). Missing assets are created by themselves: Bitvavo coins with Bitvavo's own price, other coins via CoinGecko (the largest market cap for that symbol; if CoinGecko doesn't answer, Bitvavo's euro market), securities via Yahoo by ISIN, on the exchange IBKR names. A coin that was created earlier without a price source still gets one as soon as it's found, unless you entered a price yourself.
2. **Books the cash:** buys come off and sells go to the account's cash balance in the trading currency, so euro balances on an exchange are right.
3. **Values in euros:** fiat transactions at that day's ECB rate. Staking rewards, crypto deposits and crypto-to-crypto transactions at that day's closing price (see _Price sources_ in the [README](../../README.en.md#price-sources-free-no-keys)). If there was no price for that day yet, such a reward or deposit is first at €0 and gets its value at a next sync, once the price is known; a transaction you adjusted yourself stays as it is. Coinbase supplies the euro value itself, provided your base currency at Coinbase is EUR.
4. **Links transfers:** a crypto withdrawal from one account and a matching deposit on another (within 5 days, at least 95% arrived) become one transfer, so the cost price moves along. If a link isn't right, open one of the two under _Transactions_ and choose **Unlink**; those two are then never linked automatically again.
5. **Compares balances** with what the exchange reports. Differences are shown on the _Connections_ page, with a button to correct them in one go.

Syncing again is safe: nothing is booked twice. You can adjust imported transactions; a new sync never overwrites your changes. Imported transactions you delete stay gone.

**Staking on an exchange.** Staked coins remain yours, so moving them in or out is neither a sale nor a withdrawal:

- **Kraken:** staked, opt-in and auto-earn balances (`DOT.S`, `ETH2.S`, `SOL.F`, `USDC.M` …) count as the coin itself. Moves between the spot and earn wallets are skipped, including the older "earn" rows without costs. Moves Kraken books as two separate rows (for example `ETH2.S` back to ETH) cancel out if they're within two days of each other; a recent row waits one sync for its counterpart. Rewards, airdrops and referral bonuses are income. Conversions on a delisting are transactions. Kraken's credit for trading fees (KFEE) is ignored.
- **Bitvavo:** coins in fixed staking count via the separate staking balance. Locking (fixed staking or lending) isn't a withdrawal; when it comes back, only what's added on top is the reward. A cancelled withdrawal is reversed (except for unrefunded costs), and moves between Bitvavo's own wallets cancel out. If Bitvavo converts a coin (MATIC for POL, LIT for HEI), it books the old coin out and the new one in; that becomes a sale and a purchase at the same value, so your cost basis moves along. If that value isn't known yet, it happens at a next sync.
- **Coinbase:** the old ETH2 wallet (staked ether) counts as ETH, rewards included. Moves between your Coinbase wallets (vaults, other portfolios, unwinding ETH2) cancel out if the key sees both sides; otherwise they're a deposit or withdrawal.

Known limitations: at Bitvavo the connection assumes costs come on top of the amount sent (in the CSV export they're in the amount), and Bitvavo doesn't document what's in the rows for fixed staking and lending; the balance comparison shows it if either is wrong. Coinbase doesn't report trading fees separately. IBKR Flex supplies at most 365 days per request, skips options and futures and doesn't process stock splits (the balance comparison shows them). Bitpanda: metals and commodities aren't read yet, and a swap between two coins (without a value in money) is skipped; the documentation doesn't name the transaction types, so the connection goes by direction and amount.

## Wallets (self-custody, by address)

**Wallets** follows addresses read-only, via free public block explorers. Only BNB Chain needs a (free) API key. Box3balans never asks for your seed phrase or private keys and doesn't store them either.

| Blockchain                                                          | Source                             | Notes                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bitcoin                                                             | mempool.space (or `MEMPOOL_URL`)   | Addresses or **xpub/ypub/zpub**. Extended keys are scanned with a gap limit of 20, for both receiving and change addresses. Legacy, nested SegWit, native SegWit and **Taproot** (choose "Taproot" for a BIP86 xpub)                                |
| Litecoin                                                            | litecoinspace.org                  | Addresses or Ltub/Mtub/xpub keys                                                                                                                                                                                                                    |
| Ethereum, Arbitrum, Optimism, Base, Polygon, Unichain, Ink, Soneium | Blockscout                         | The coin itself, internal transfers and ERC-20 tokens. You can follow the same address on several chains in one go                                                                                                                                  |
| BNB Chain                                                           | Ankr Advanced API (`ANKR_API_KEY`) | BNB and BEP-20 tokens. Needs a free Ankr account (see below). Ankr doesn't report internal transactions: BNB a contract pays out (for example when swapping a token to BNB) is missing from the history and appears as a difference you can correct |
| Solana                                                              | public RPC (or `SOLANA_RPC_URL`)   | SOL and SPL tokens. Large histories come in gradually (about 1,500 transactions per sync) because of the public RPC's limit                                                                                                                         |
| XRP Ledger                                                          | xrplcluster.com                    | XRP payments; issued tokens are skipped                                                                                                                                                                                                             |
| Tron                                                                | TronGrid                           | TRX and TRC-20 tokens (such as USDT)                                                                                                                                                                                                                |
| Cardano                                                             | Koios (free public API)            | ADA, native tokens and **staking rewards** (dated when they become withdrawable; a returned deposit isn't income). Paste the stake address (stake1…) or a receiving address: Box3balans follows the whole wallet via the stake key                  |
| Dogecoin                                                            | BlockCypher (free)                 | Addresses or **dgub/xpub** (BIP44, gap limit 20). The free tier allows 100 requests per hour: a large history or a new xpub can take a few syncs                                                                                                    |

This is how a wallet sync works:

- **All addresses of a wallet on one chain are settled together**, so money between your own addresses (or change) only costs the network fee. Adding or removing an address re-imports that chain.
- **Network fees** become `fee` transactions, and **swaps** (one token out, another in) become a sale plus a purchase with the same euro value.
- **Tokens** are recognised via CoinGecko by contract address, so USDC on Ethereum, Base and Solana is one asset. Tokens CoinGecko doesn't know, or that the explorer marks as spam, are **skipped**: usually that's airdrop spam. Every wallet shows them and has an "include anyway" switch, which adds them with a manual price. Lookups are remembered and limited per sync; at a limit the rest waits for the next sync.
- **Transfers** to and from your exchanges are linked by themselves, so the purchase price moves along. The **balance comparison** compares the result with the balance on the blockchain once the whole history is in.
- Syncs run in the background. Pages show the progress, and you can close dialogs while an import continues.

**Key for BNB Chain.** No explorer offers BNB Chain history for free without an account (BscScan's API has been paid for this chain since Etherscan's switch to V2). Create a free account at [ankr.com](https://www.ankr.com/rpc/advanced-api/), copy your API key from the Advanced API address (`https://rpc.ankr.com/multichain/<key>`), put it in `.env` as `ANKR_API_KEY=` and run `docker compose up -d`. The free plan allows 50 requests per minute and 200 million credits per month; a sync costs about three requests per address. As long as there's no key, BNB Chain shows "needs to be set up".

Not supported yet: Ethereum validator withdrawals; Solana stake accounts and their rewards; frozen TRX; issued tokens on the XRP Ledger; Cardano addresses from the Byron era.
