# Roadmap

_Nederlands: [ROADMAP.md](../ROADMAP.md)_

Box3balans started as a personal project and is now being made suitable for everyone in the Netherlands who wants to keep track of their investments and box 3 themselves, on their own hardware. Box3balans isn't hosted for you anywhere: you run it yourself.

Have an idea or want to help? See [CONTRIBUTING.en.md](../../CONTRIBUTING.en.md).

## Done

- **Basics:** manual entry, live prices, overview and positions, physical and vaulted precious metal, price history, results, income and dividends, box 3 with export, backups.
- **Connections** with Bitvavo, Kraken, Coinbase and Interactive Brokers, with staking on those exchanges. Bitvavo and Coinbase have been tested with real accounts, Kraken and Interactive Brokers not yet (phase F).
- **Wallets:** Bitcoin (including xpub), Ethereum and L2s, BNB Chain, Solana, Cardano, Dogecoin, Litecoin, XRP and Tron. Bitcoin, Cardano, Dogecoin, Unichain, Ink and Soneium have been tested with real addresses.
- **CSV import** with column layout, preview, duplicate detection and undo. Built-in formats for specific brokers came in phase D, more in phases F and G.
- **Annual statements as PDF** (0.1.18): under _Values per year_ Box3balans reads an annual statement in the browser and offers the amounts next to a reference date; with a template per provider the right ones are ticked right away ([ADR 0009](adr/0009-pdf-lezen-in-de-browser.md)). Goldrepublic's account statement (0.1.27) is recognised too, and read as transactions under _Import CSV_.
- **Crypto prices:** Bitvavo as a price source; price history for coins an exchange no longer trades and for swapped coins (NU → T, FTM → S, MATIC → POL and others), from Yahoo or Binance, but only when it's certain to be the same coin; conversions by Bitvavo as a sale and a purchase. Released in 0.1.4 up to and including 0.1.7, after testing with real accounts.
- **Returns:** time- and money-weighted return with a benchmark, a cost overview and expected dividends.
- **Box 3:** actual return for the rebuttal scheme (tegenbewijsregeling) and a preview of the system from 2028.
- **Online demo** (0.1.26): look around the example household at [box3balans.nl/demo](https://box3balans.nl/demo/) without installing; recorded from the real demo at every release ([ADR 0010](adr/0010-online-demo-zonder-server.md)).
- **Demonstrable privacy** (0.1.30): Box3balans only connects to a fixed list of hosts, enforced in the code and visible under _Settings → Network_, where you switch features off down to fully offline (0.1.32); optionally sealed off with a proxy at network level, and checked in CI on every change. A new installation only accepts its first user with a setup code from the log ([ADR 0011](adr/0011-vaste-lijst-van-bestemmingen.md), [what Box3balans sends](privacy.md)).
- **Management:** encrypted backups, change history with restore, _Needs attention_, second price sources, PostgreSQL 18 with a tested upgrade.

## Phase A: installable for everyone ✅

- Licence (AGPL-3.0), contribution and security guidelines, issue forms.
- Ready-made images for Intel/AMD and ARM via GitHub, with automatic tests.
- Starting without settings: key and database password are created on first start.
- A single-container variant for laptops and for trying it out.
- Installation guides per system, and the README in Dutch.

## Phase B: box 3 for everyone, not just investors ✅

- **Household:** you, a fiscal partner and minor children (their assets count for the parents with custody). An owner per account: you, your partner, joint (with your share) or a child. The split of the base between partners, with per person the assets, the base and the tax.
- **Values per year:** per account only the value on 1 January, money in and out, income and costs. Enough for the deemed-return calculation, the comparison with the actual return and the 2028 preview, without importing every transaction.
- **Savings:** balances on 1 January, interest and money in and out, read from your bank's export (CSV with balance, ABN AMRO's TAB file, CAMT.053, or CSV without balance with one known balance).
- **Other assets and debts:** a second or let home (WOZ value, with the vacant-value ratio when let), money lent to others, capital insurance policies, debts with interest paid, and a tick box for accounts abroad.

## Phase C: Dutch ✅

- The app in Dutch, with the terms from the tax return, including the server's messages and the input error messages. English is available under _Settings → Appearance → Language_.
- A start wizard (_Get started_): household and fiscal partnership → accounts → values on 1 January, or the way to import and connections → your box 3.
- A demo mode (`DEMO=true`): an example household with made-up prices, signed in right away, without storing anything.

## Phase D: filling in the tax return ✅

- **Recognised exports** from DEGIRO (account statement and transactions), Bitvavo, Coinbase, Kraken (ledgers), Rabobank Beleggen, Trade Republic, Trading 212, BUX, Saxo and Revolut. Built on public sample files, not yet tested with real exports. Banks (ING, Rabobank, ABN AMRO …) are read in under _Values per year_ with their own export.
- **For the tax return:** per year box 3 in the order of the tax return, per account and owner, with dividend tax and the actual return (from 2025 in the tax return itself, before that with the _Opgaaf werkelijk rendement_).
- **The Belastingdienst's worked examples** as tests: the five deemed-return examples for 2025 come out exactly (with the same rounding), and three examples of the actual return.
- **After that:** more providers in phases F and G; what's still needed per provider is in [aanbieders.md](aanbieders.md).

## Phase E: maintenance and extra security ✅

- **Two-step verification** with an authenticator app (TOTP), with recovery codes and a command to turn it off if you're locked out.
- **A notice when there's a new version**, only if you turn it on: Box3balans then asks GitHub once a day for the newest version.
- **Tax rules as a data file** (`server/src/rules/box3.json`) with the date of the last check and the source per year in the app, a notice when they're more than 400 days old, and a fixed yearly rhythm in [belastingregels.md](belastingregels.md): proposals around Prinsjesdag, fixed figures in December, final percentages after the year has ended.

## Phase F: ready for 1 January 2027 (now – December 2026)

The work is tracked as issues in the [Phase F](https://github.com/zenonymous/box3balans/milestone/1) milestone.

- **Box 3 rules for 2027:** the proposals from the Belastingplan 2027 and the cabinet letter of 29 September are in [box3-sources.md](box3-sources.md); they've been in the app as a provisional year since 0.1.11, and will be checked once the Belastingplan is adopted in December ([#4](https://github.com/zenonymous/box3balans/issues/4)).
- **Testing with real data:** the connections with real read-only keys ([#5](https://github.com/zenonymous/box3balans/issues/5)). Bitvavo and Coinbase have been tested and what that turned up was fixed in 0.1.4 up to and including 0.1.7 (see the [status](https://github.com/zenonymous/box3balans/issues/5#issuecomment-6078821954)); Kraken and Interactive Brokers are waiting for someone with an account. Apart from DEGIRO's account statement and portfolio, the recognised exports are still waiting for real, anonymised files ([#6](https://github.com/zenonymous/box3balans/issues/6)), and the PDF annual statements for text samples ([#14](https://github.com/zenonymous/box3balans/issues/14)). A misread amount is now the biggest risk.
- **Reading DEGIRO better** ✅: DEGIRO has no API, but the _Portefeuille_ export works for any date. Read in on 31 December, it checks the imported transactions and counts the cash at DEGIRO for box 3. The account statement now also reads transaction tax, corporate actions and interest, tested with a real export. See the [research](degiro-koppeling.md).
- **Ready for the reference date** ✅ (0.1.17): on _Box 3_, per year, what's still needed for 1 January, per account (a value, a sync, an import, DEGIRO's portfolio), plus assets without a price and crypto that left an exchange but arrived nowhere. From mid-December to the end of May also under _Needs attention_.
- **More providers** ✅: about 55 Dutch providers of box 3 assets [researched](aanbieders.md), each as an issue with the label [aanbieder](https://github.com/zenonymous/box3balans/issues?q=is%3Aissue+label%3Aaanbieder) and a priority. Built: Revolut's and Wise's account statements in the bank import, with conversion of other currencies at the ECB rate (0.1.18), the annual statements as PDF (0.1.18), the Crypto.com App (0.1.19), eToro (0.1.20), Revolut's crypto overview and the exports of CoinTracking and Delta, to switch from another tracker (0.1.21). For LYNX the same connection as Interactive Brokers applies; Brand New Day and crowdfunding are tracked with _Values per year_ and their annual statement.
- **Becoming findable:** screenshots in the README ✅ ([#7](https://github.com/zenonymous/box3balans/issues/7)) and a place for questions in [Discussions](https://github.com/zenonymous/box3balans/discussions) ✅ ([#9](https://github.com/zenonymous/box3balans/issues/9)). Still open: box3balans.nl as a Dutch landing page ([#8](https://github.com/zenonymous/box3balans/issues/8)), and then an announcement in Dutch communities such as Tweakers, the IEX forum and r/DutchFIRE ([#10](https://github.com/zenonymous/box3balans/issues/10)), in the first half of January.

## Phase G: the tax-return season (January – May 2027)

- **Final 2026 percentages** for savings and debts, in a release before the tax return opens on 1 March.
- **Missing formats:** [researched](exportformaten.md) in October 2026. Lightyear and Scalable Capital have been recognised since 0.1.17, built on public descriptions. ING Zelf op de Beurs and Meesman have an export, but the columns aren't described anywhere: that needs a sample file. ABN AMRO has no export of securities transactions; there you use _Values per year_ with the annual statement. Which bank exports the import reads has been listed per bank in the README since 0.1.10; MT940 was added for Knab, which gives MT940 by default. Testing with real exports from ASN Bank, Triodos, Knab, bunq, Revolut and Wise follows as soon as someone shares one.
- **Sharing formats without data** ✅ (0.1.34): if Box3balans doesn't know a CSV or annual statement yet, _Help others read this file_ makes a file with made-up data in the same layout, which the user shares themselves via the [_Share a format_](https://github.com/zenonymous/box3balans/issues/new?template=formaat-delen.yml) form ([ADR 0012](adr/0012-formaten-delen-zonder-gegevens.md)). A shared CSV format is data and comes into the app without new code. Later, once contributions arrive: templates for annual statements as data too, made from the ticked lines, and a workflow that turns an approved issue into a pull request.
- **Templates for annual statements:** a template per provider (Brand New Day, Peaks, BLOX, Geldvoorelkaar, Mintos …), as soon as someone shares the text of a statement via [the form](https://github.com/zenonymous/box3balans/issues/new?template=formaat-delen.yml).
- **More providers:** built in October 2026, on public descriptions and not yet tested with real data: XTB, Schwab Equity Awards (employer share plans), Bitstamp and a connection with Bitpanda's new API (the old one stops on 31 January 2027). After that: Morgan Stanley at Work and Finst, as soon as someone shares a sample; see the issues with [priority 1](https://github.com/zenonymous/box3balans/issues?q=is%3Aissue+is%3Aopen+label%3A%22prioriteit+1%22).
- **A dossier per year** ✅ (already in 0.1.9): one printable document with the box 3 overview, the actual return, the values on 1 January and where every amount comes from. For your own records, and for when the Belastingdienst asks questions.
- **Following the Wet werkelijk rendement:** the Senate is expected to deal with the bill and the amendment (novelle) from January. The preview in the app has followed the cabinet letter of 29 September (tax-free result €1,000) since 0.1.3; tax on sale for shares, bonds and options will be added once the text of the amendment is out, after the Council of State's advice ([#11](https://github.com/zenonymous/box3balans/issues/11)).

## Phase H: the new system from 2028 (from mid-2027, if the law passes)

- **The full calculation, not just a preview:** per asset the return of the year (realised and unrealised), tax on sale for real estate and shares in start-ups (with the rules for what you already had before 2028), deductible costs, the tax-free result, offsetting losses across years and the split between partners.
- **Starting values on 1 January 2028:** the unrealised return over 2028 is measured from those values. A checklist makes sure every asset has a reliable value on 31 December 2027 before that date.
- **The 2028 tax return** (in 2029) in the order of the new form, once the Belastingdienst publishes it.
- **The old system stays** for 2027 and earlier, for corrections and objections. If the law doesn't pass, the yearly rhythm of the deemed-return rules simply continues.

## Ongoing

- **Easier installation:** Box3balans in the app catalogues of Unraid, TrueNAS and CasaOS/Umbrel, so it works without a terminal. A template for Unraid (Community Applications) and a file for CasaOS and ZimaOS (_Custom Install → Import_) are ready in [`deploy/`](../../deploy); TrueNAS already works via _Install via YAML_. Still to do: submitting Box3balans to Community Applications, and an app for Umbrel.
- **Verifiable images** ✅: signed with cosign, with a list of what's in them (SBOM) and how they were built (provenance). See [SECURITY.md](../../SECURITY.md#verifying-images).
- **Pull requests via CI** on `main` once others build along.
- **Version 1.0** after the first tax-return season with real users: formats tested with real exports and no known serious bugs.

## Deliberately not

- **Hosting Box3balans for others.** Your data staying at home is exactly the point.
- **Box 1 and box 2**, such as the home you live in or a substantial interest in a company.
- **Investment advice**, such as rebalancing.
- **Logging in to brokers without an official API**, such as DEGIRO. That requires your password, with full trading rights, and their terms don't allow it. Box3balans reads their exports ([research](degiro-koppeling.md)).

## Original setup

The project started as a personal dashboard for investments, crypto and precious metal, built in eight milestones. They're all done; the last one, built-in formats for specific brokers, came in phase D.
