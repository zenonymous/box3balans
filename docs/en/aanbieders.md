# Providers: where Dutch households hold their box 3, and how it gets into Box3balans

_Nederlands: [aanbieders.md](../aanbieders.md)_

Researched on 13 October 2026. Most sources are Dutch; their titles are kept as they are.

This is a backlog: per provider what can be fetched, by which route, how much work it is and how urgent. Every card can be used separately as a GitHub issue. What was researched earlier is in [exportformaten.md](exportformaten.md) (ABN AMRO, ING, Meesman, Brand New Day, Peaks, Lightyear, Scalable Capital) and [degiro-koppeling.md](degiro-koppeling.md); that isn't redone here.

## In short

**What matters most for box 3:**

- **What isn't pre-filled is most easily forgotten.** That's mainly crypto, crowdfunding and shares from a foreign employer (RSUs and ESPP at Schwab, Morgan Stanley/E\*TRADE, Fidelity, Computershare; that those aren't pre-filled isn't verified). From 2026 crypto platforms do report transactions, but not balances, and only for the first time in January 2027 ([BLOX](https://support.weareblox.com/hc/nl/articles/44505422300817-Welke-informatie-wordt-gedeeld), [BLOX on DAC8](https://support.weareblox.com/hc/nl/articles/44505479681041-Vanaf-wanneer-geldt-DAC8-voor-mijn-transacties)). Mogelijk doesn't pass on annual statements by itself ([Mogelijk](https://www.mogelijk.nl/faq/jaaroverzichten)), and neither does Collin ([Collin](https://www.collincrowdfund.nl/veelgestelde-vragen/)).
- **Money-market funds aren't savings.** Revolut _Dagelijkse Geldmarktfondsen_ and Wise _Interest_ invest in a fund ([Revolut](https://help.revolut.com/nl-NL/help/app-features/flexible-accounts/difference-between-savings-and-flexible/), [Wise](https://www.wise.com/nl/interest)). In box 3 those are other assets, not bank balances. Whoever enters the whole account as a savings account is in the wrong category.
- **One platform, two categories.** At Geldvoorelkaar and Lendahand, uninvested money in the wallet belongs to the bank balances and the money lent to the other assets ([Geldvoorelkaar](https://www.geldvoorelkaar.nl/veelgestelde-vragen/investeerders/), [Lendahand](https://www.lendahand.com/en-EU/pages/crowdfunding-taxes)). In Box3balans those are two accounts.
- **Many providers only give a PDF with the value on 1 January.** Brand New Day, BLOX, Finst, Peaks, Raisin, the crowdfunding platforms, Mintos, NPEX and the insurers. _Values per year_ already works there by hand. A reader for such PDFs (see [Route: the PDF annual statement](#route-the-pdf-annual-statement)) covers in one go the largest group that now stays out of view.
- **What's not possible.** Logging in with a password (BullionVault, DEGIRO), keys that can also pay or trade (bunq, Freedom24) and aggregators (PSD2, the pre-filled tax return) are ruled out by [ADR 0001](adr/0001-zelf-hosten.md) and [ADR 0005](adr/0005-geen-inlog-koppelingen.md). See [Deliberately not](#deliberately-not).

**Top 10 to build now:**

1. **Brand New Day:** _values per year_ with the financial annual statement now, then a PDF template for the annual statement and the Q4 quarterly statement. Over 360,000 clients, €2.2 billion in free investment accounts.
2. **Revolut and Wise:** teach the bank import a few headings (`Completed Date`, `Running Balance`) and keep money-market funds separate. Small work.
3. **LYNX:** test and document the existing connection with Interactive Brokers (Flex Web Service). LYNX accounts are IBKR accounts.
4. **Charles Schwab Equity Awards:** a recogniser for the export of the award history (JSON or CSV).
5. **Morgan Stanley at Work / E\*TRADE:** a recogniser for _BenefitHistory.xlsx_ and the holdings export.
6. **Finst (with Anycoin Direct):** a recogniser for the Excel export of _Activiteit_. Needs a sample file first.
7. **Crypto.com App:** a recogniser for the app's CSV; the header row is known.
8. **Bitpanda:** a connection with the new public read-only API (crypto, stocks, ETFs, metals).
9. **Crowdfunding (Geldvoorelkaar, Collin, Lendahand, Mogelijk):** _values per year_ with an explanation per platform and the wallet/money-lent split.
10. **eToro:** a recogniser for the _Account Statement_ (tab _Account Activity_).

In addition, as a foundation: **a reader for PDF annual statements** (L). That makes number 1, 9 and a dozen cards with priority 2 small work afterwards. _The basis has been built (October 2026); per provider a template is now needed, see [Route: the PDF annual statement](#route-the-pdf-annual-statement)._

## Routes

| Route                   | What                                                                                                                       | Where in the code                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| (a) connection          | API key or token with read permissions only                                                                                | `server/src/sync/`                             |
| (b) recogniser          | CSV export (or Excel, saved as CSV) that's recognised by itself                                                            | `server/src/import/formats/`                   |
| (c) portfolio statement | positions on one day, as a check and starting position                                                                     | `server/src/import/statement.ts`               |
| (d) values per year     | value on 1 January, money in and out, income, costs; by hand or from a bank export                                         | _Accounts → Values per year_, `import/bank.ts` |
| (e) wallet              | public address on a blockchain                                                                                             | `server/src/wallets/`                          |
| PDF annual statement    | the value on 1 January (and sometimes income and money in and out) from a PDF; fills _values per year_, after confirmation | `server/src/import/yearStatement.ts`           |

**Work:** S = a day or less (explanation, testing, a few headings added); M = a recogniser or connection with tests, a few days; L = a new component.

**Priority:** 1 = build now, 2 = after that, 3 = only on request. Weighted by reach in the Netherlands, how badly the box 3 amount suffers if it's missing (not pre-filled, often forgotten, wrong category), and how feasible it is.

## Backlog

| Prio | Provider                                                                                              | Kind                | Box 3 category                                           | Route                         | Work      | Needed from a user                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------- | ----------------------------- | --------- | ---------------------------------------------------------------------------------------------- |
| 1    | [Brand New Day](#brand-new-day)                                                                       | index, savings      | other assets; bank balances (savings account)            | (d) now; PDF annual statement | S, then M | text (pdftotext) of a financial annual statement and a Q4 quarterly statement, amounts changed |
| 1    | [PDF annual statement (basis)](#route-the-pdf-annual-statement)                                       | component           | all                                                      | new                           | L         | per provider the text layer of one annual statement                                            |
| 1    | [Revolut](#revolut)                                                                                   | bank, fintech       | bank balances (abroad); money-market funds: other assets | (d) extend bank import        | S         | anonymised account statement (CSV) with a savings and a fund row                               |
| 1    | [Wise](#wise)                                                                                         | payment institution | bank balances (abroad); Interest: other assets           | (d) extend bank import        | S         | anonymised statement CSV in EUR and one other currency                                         |
| 1    | [LYNX](#lynx-and-mexem)                                                                               | broker              | other assets; cash: bank balance                         | (a) existing IBKR connection  | S         | someone with a LYNX account trying a Flex token                                                |
| 1    | [Charles Schwab Equity Awards](#charles-schwab-equity-awards)                                         | share plan          | other assets (abroad)                                    | (b)                           | M         | anonymised export (JSON or CSV) with a vest, ESPP purchase, sale and dividend                  |
| 1    | [Morgan Stanley at Work / E\*TRADE](#morgan-stanley-at-work-and-etrade)                               | share plan          | other assets (abroad)                                    | (b) + (c)                     | M         | _BenefitHistory.xlsx_ (Download Expanded) and the holdings export, anonymised                  |
| 1    | [Finst and Anycoin Direct](#finst-and-anycoin-direct)                                                 | crypto              | other assets                                             | (b); now (d)                  | M         | anonymised Excel export of _Activiteit_                                                        |
| 1    | [Crypto.com App](#cryptocom)                                                                          | crypto              | other assets                                             | (b)                           | M         | anonymised CSV with earn and card rows                                                         |
| 1    | [Bitpanda](#bitpanda)                                                                                 | crypto, securities  | other assets                                             | (a)                           | M         | a read key to test against, or saved API responses                                             |
| 1    | [Geldvoorelkaar](#geldvoorelkaar)                                                                     | crowdfunding        | other assets (money lent); wallet: bank balances         | (d), later PDF                | S         | text of an annual statement                                                                    |
| 1    | [eToro](#etoro)                                                                                       | broker              | other assets                                             | (b)                           | M         | _Account Statement_, tab _Account Activity_ as CSV, anonymised                                 |
| 2    | [BLOX](#blox)                                                                                         | crypto              | other assets                                             | (d), later PDF                | S         | text of an annual statement PDF                                                                |
| 2    | [Coinmerce](#coinmerce)                                                                               | crypto              | other assets                                             | (b)                           | M         | anonymised orders CSV                                                                          |
| 2    | [Collin Crowdfund](#collin-crowdfund)                                                                 | crowdfunding        | other assets (money lent)                                | (d), later PDF                | S         | text of an annual statement                                                                    |
| 2    | [Lendahand](#lendahand)                                                                               | crowdfunding        | other assets; wallet: bank balances                      | (d), later PDF                | S         | text of an annual statement                                                                    |
| 2    | [Mogelijk](#mogelijk)                                                                                 | crowdfunding        | other assets (money lent or fund)                        | (d), later PDF                | S         | text of an annual statement                                                                    |
| 2    | [Mintos](#mintos)                                                                                     | P2P                 | other assets                                             | (d), later PDF                | S         | text of a tax report                                                                           |
| 2    | [Fidelity NetBenefits](#fidelity-netbenefits-and-stock-plan-services)                                 | share plan          | other assets (abroad)                                    | (b)                           | M         | anonymised Activity CSV                                                                        |
| 2    | [Computershare and EquatePlus](#computershare-and-equateplus)                                         | share plan          | other assets (abroad)                                    | PDF (c)                       | M         | text of a plan statement or holdings statement                                                 |
| 2    | [Meesman](#meesman)                                                                                   | index               | other assets                                             | (b)                           | M         | the Excel export (already asked for in #6)                                                     |
| 2    | [ING Zelf op de Beurs](#ing-abn-amro-and-the-other-brokers-already-researched)                        | broker              | other assets                                             | (b) + (c)                     | M         | both tabs and the portfolio overview (already asked for in #6)                                 |
| 2    | [Peaks](#peaks)                                                                                       | robo                | other assets                                             | (d), later PDF                | S         | text of an annual statement                                                                    |
| 2    | [Raisin](#raisin)                                                                                     | savings platform    | bank balances (abroad)                                   | (d), later PDF                | S         | text of a financial annual statement                                                           |
| 2    | [Large Dutch banks](#large-dutch-banks-already-supported)                                             | bank                | bank balances                                            | (d) exists; testing           | S         | real exports from ASN, Triodos, Knab and bunq (#6)                                             |
| 2    | [Wealth management by banks and Van Lanschot](#wealth-management-by-the-large-banks-and-van-lanschot) | wealth management   | other assets                                             | (d), later PDF                | S         | text of a tax annual statement                                                                 |
| 2    | [Capital insurance](#capital-insurance)                                                               | insurance           | other assets (non-exempt part)                           | (d)                           | S         | none                                                                                           |
| 2    | [ASN Groenprojectenfonds](#asn-groenprojectenfonds)                                                   | green fund          | green investments                                        | (d)                           | S         | none                                                                                           |
| 2    | [Triodos Groenfonds](#triodos-groenfonds)                                                             | green fund          | green investments up to 2026, then other assets          | (d)                           | S         | none                                                                                           |
| 3    | [N26](#n26)                                                                                           | bank                | bank balances (abroad)                                   | (d) testing                   | S         | anonymised CSV                                                                                 |
| 3    | [bunq](#bunq-stocks-and-api)                                                                          | bank, investing     | bank balances; Stocks: other assets                      | (d)                           | S         | none                                                                                           |
| 3    | [PayPal](#paypal)                                                                                     | payment institution | bank balances (abroad), not verified                     | (d)                           | S         | anonymised activity CSV                                                                        |
| 3    | [Freedom24](#freedom24)                                                                               | broker              | other assets                                             | (b)                           | M         | broker report (XLSX), anonymised                                                               |
| 3    | [XTB](#xtb)                                                                                           | broker              | other assets                                             | (b)                           | M         | anonymised _Cash Operations_ CSV                                                               |
| 3    | [Semmie](#semmie-and-index-capital)                                                                   | robo, management    | other assets                                             | (d)                           | S         | unknown what can be downloaded                                                                 |
| 3    | [NN Beheerd Beleggen](#nn-beheerd-beleggen)                                                           | management          | other assets                                             | (d)                           | S         | none                                                                                           |
| 3    | [Centraal Beheer and a.s.r.](#centraal-beheer-and-asr)                                                | index, management   | other assets                                             | (d)                           | S         | none                                                                                           |
| 3    | [Bitonic](#bitonic)                                                                                   | crypto              | other assets                                             | (e) and (d)                   | S         | whether there's an account export                                                              |
| 3    | [Bybit](#bybit)                                                                                       | crypto              | other assets                                             | (a)                           | M         | a read key to test against                                                                     |
| 3    | [Binance](#binance)                                                                                   | crypto (to 2023)    | other assets                                             | (b) or (a)                    | M         | anonymised _Transaction History_ CSV                                                           |
| 3    | [Bitstamp](#bitstamp)                                                                                 | crypto              | other assets                                             | (a) or (b)                    | M         | a read key or anonymised CSV                                                                   |
| 3    | [Kapitaal Op Maat](#kapitaal-op-maat)                                                                 | crowdfunding        | other assets (money lent)                                | (d)                           | S         | none                                                                                           |
| 3    | [Invesdor (Oneplanetcrowd)](#invesdor-oneplanetcrowd)                                                 | crowdfunding        | other assets                                             | (d)                           | S         | none                                                                                           |
| 3    | [DuurzaamInvesteren](#duurzaaminvesteren)                                                             | crowdfunding        | other assets                                             | (d)                           | S         | none                                                                                           |
| 3    | [NPEX](#npex)                                                                                         | securities platform | other assets                                             | (d), later PDF (c)            | S         | text of a tax annual statement                                                                 |
| 3    | [Go & Grow (Bondora)](#go--grow-bondora)                                                              | P2P                 | other assets                                             | (d), possibly (b)             | S         | anonymised Excel export                                                                        |
| 3    | [Equiniti](#equiniti-eq)                                                                              | share plan          | other assets (abroad)                                    | unknown                       | —         | what EQ Shareview lets you download                                                            |
| 3    | [BullionVault](#bullionvault)                                                                         | precious metal      | other assets                                             | vault in grams, by hand       | S         | none                                                                                           |
| 3    | [Holland Gold](#holland-gold)                                                                         | precious metal      | other assets                                             | vault in grams, by hand       | S         | none                                                                                           |
| 3    | [Bank savings and investment rights for your home](#bank-savings-and-investment-rights-for-your-home) | own home            | box 1, sometimes box 3                                   | (d)                           | S         | none                                                                                           |
| —    | [Anycoin Direct](#finst-and-anycoin-direct)                                                           | crypto (stopped)    | other assets                                             | via Finst                     | —         | —                                                                                              |
| —    | [Goldrepublic](#goldrepublic)                                                                         | precious metal      | other assets                                             | account statement (PDF) read  | —         | —                                                                                              |

## Cards

### Banks and savings

#### Large Dutch banks (already supported)

**What:** ING, Rabobank, ABN AMRO, ASN Bank/SNS/RegioBank, Triodos, Knab and bunq. Bank balances.

**Status:** _Read a bank export_ already reads CSV with a balance column (ING, Rabobank), ABN AMRO's TAB file, CAMT.053, MT940 and CSV without balance ([README](../../README.en.md#values-per-year-and-bank-exports), `server/src/import/bank.ts`). The exports from ASN Bank, Triodos, Knab and bunq haven't been tested with real files yet ([#6](https://github.com/zenonymous/box3balans/issues/6)). bunq offers PDF, CSV and MT940 ([bunq](https://help.bunq.com/articles/what-types-of-bank-statements-can-i-export)).

**PSD2:** ruled out; see [Deliberately not](#deliberately-not).

**Advice:** build nothing new; keep asking for real exports. Work S, prio 2.

**Tested with real files from ING (October 2026):** the CSV export of the current account and of the Oranje Spaarrekening (the latter has its own layout: _Omschrijving_, _Rekening naam_, _Bedrag_, _Valuta_, dates as `2025-01-31`), the annual statement over 2025 and two _Afschriften Betaalrekening_ (September 2024 up to 1 January 2025 and August 2025 up to 1 January 2026).

- **Savings account:** the balances on 1 January 2025 and 2026 and the interest over 2025 from the export are equal to the annual statement to the cent.
- **Current account:** the export and the statements match each other completely (opening balance plus movements is closing balance, the same movements per day), but the annual statement states a balance on 1 January that's 2.5% (2025) and 5.7% (2026) lower and that appears nowhere as a balance in the statements. Not explained by the value date (equal to the booking date) or by one movement around the turn of the year. ING sends the annual statement's figures to the Belastingdienst; the user is asking ING for an explanation.
- **Consequence for Box3balans:** the template reads the annual statement as ING prints it; the bank import gives the balance according to the statements. The README advises checking the balance for a current account.

#### Revolut

**What:** current account and _Dagelijks Sparen_ (daily savings) at Revolut's bank: bank balances, probably abroad (Revolut Bank UAB, Lithuania; not confirmed in the pages read). In addition _Dagelijkse Geldmarktfondsen_ (Flexible Cash Funds) from Revolut Securities Europe UAB: those are investments in money-market funds, so other assets ([difference between the two](https://help.revolut.com/nl-NL/help/app-features/flexible-accounts/difference-between-savings-and-flexible/), [Dagelijks Sparen](https://www.revolut.com/nl-NL/savings/open-a-savings-account/)). Box3balans already reads the stocks statement ([README](../../README.en.md#csv-import)).

**Reach:** no Dutch client numbers found; Revolut only gives worldwide numbers ([Revolut](https://www.revolut.com/nl-NL/savings/open-a-savings-account/)).

**Routes:**

- **API:** no API for personal accounts found.
- **CSV:** according to open-source parsers the account statement has the header `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance` ([revolut-toolkit](https://github.com/lastunicorn/revolut-toolkit), MIT). Second-hand: not seen at Revolut itself.
- **What Box3balans does now:** the bank import doesn't recognise a date column, because `Started Date` and `Completed Date` don't fit the date pattern in `server/src/import/bank.ts`. So the file is refused.

**Advice:** (d), extend the bank import:

- `Completed Date` as the date, `Balance` already exists as a balance column;
- skip rows with a `State` other than `COMPLETED`;
- use `Product` (such as _Current_ and _Savings_) and `Currency` to keep accounts apart, as already done with the account column;
- for money-market fund rows, report that they belong to the other assets.

Work S, prio 1.

**Needed:** an anonymised statement with a savings row and a money-market fund row.

**Open questions:** are money-market funds in the same CSV file or in a statement of their own? What's in `Product`?

**Crypto at Revolut:** a statement of its own (CSV) with the header `Symbol,Type,Quantity,Price,Value,Fees,Date`; prices and values with their currency in them (`€35,761.54`, `89,162.28 SEK`) and dates as `May 5, 2020, 10:10:57 PM` ([Export-To-Ghostfolio, sample](https://github.com/dickwolff/Export-To-Ghostfolio/blob/main/samples/revolut-crypto-export.csv), Apache-2.0). Box3balans has recognised it since October 2026 (buys, sells, sends, receives, staking rewards; staking and unstaking skipped), not yet tested with a real export.

#### Wise

**What:** balances in several currencies at Wise. How the Belastingdienst classifies them (bank balances abroad?) isn't verified. _Interest_ invests the balance in a BlackRock money-market fund via Wise Assets Europe AS: other assets ([Wise Interest NL](https://www.wise.com/nl/interest)).

**Routes:**

- **API:** personal tokens don't give balance statements, except for accounts in the US, Canada, Australia, New Zealand, Singapore and Malaysia ([Wise, personal API tokens](https://docs.wise.com/guides/developer/auth-and-security/personal-api-token.md)). So not usable for the Netherlands.
- **CSV:** according to open-source parsers the statement export has, among others, `TransferWise ID`, `Date`, `Amount`, `Currency`, `Description`, `Payment Reference`, `Running Balance`, `Exchange From`, `Exchange To`, `Exchange Rate` and `Total fees` ([ledger-autosync, wise.py](https://github.com/egh/ledger-autosync/blob/master/examples/plugins/wise.py), GPL-3.0). Second-hand.
- **What Box3balans does now:** `Date` and `Amount` are recognised, `Running Balance` not as a balance. So the import falls back to "CSV without balance".

**Advice:** (d): add `Running Balance` to the balance columns and create a separate account per `Currency`; foreign currencies at the ECB rate of 1 January, as the Belastingdienst asks ([Belastingdienst, box 3 assets 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_)). Interest as a separate account with _values per year_. Work S, prio 1.

**Needed:** an anonymised statement CSV in EUR and one other currency.

**Open question:** are Interest movements in the normal statement?

#### N26

**What:** current account at N26: bank balances, probably abroad (not checked).

**CSV:** according to an open-source parser `Booking Date`, `Value Date`, `Partner Name`, `Partner Iban`, `Type`, `Payment Reference`, `Account Name`, `Amount (EUR)`, `Original Amount`, `Original Currency`, `Exchange Rate`, without balance ([you-need-a-parser, n26.ts](https://github.com/leolabs/you-need-a-parser/blob/master/packages/ynap-parsers/src/de/n26/n26.ts), MIT). Second-hand.

**Advice:** (d). The headings `Booking Date` and `Amount (EUR)` already fit the patterns in `bank.ts`; this probably works as "CSV without balance". Only testing. Work S, prio 3.

#### Raisin

**What:** savings accounts and term deposits at foreign partner banks: bank balances abroad ([Raisin](https://www.raisin.com/nl-nl/sparen/financieel-jaaroverzicht/)).

**Routes:**

- **Annual statement:** a _Financieel Jaaroverzicht_ as a PDF attached to a message in your Raisin account ([Raisin](https://www.raisin.com/nl-nl/sparen/financieel-jaaroverzicht/)). What exactly is in it (balance per account on 1 January, withholding tax) the page doesn't say.
- **Withholding tax:** foreign withholding tax on interest can be set off in box 3, up to the treaty rate; anything withheld above that you reclaim in the country itself ([Raisin, tax](https://www.raisin.com/nl-nl/belasting/)). The tax return asks, per account abroad, for the gross interest and the withholding tax (same page).
- **CSV or API:** not found.

**Advice:** (d), one account per partner bank with the abroad tick box; later a PDF template. Work S, prio 2.

**Status (October 2026):** _values per year_ records, for an account abroad, the withholding tax on the interest, with the country ([#36](https://github.com/zenonymous/box3balans/issues/36)). The actual return counts the interest gross, and _For the tax return_ shows the tax with the account and per country. A PDF template for the _Financieel Jaaroverzicht_ waits for the text of a real statement.

#### bunq (Stocks and API)

**What:** current and savings accounts (bank balances, already supported) and _bunq Stocks_, run by the German partner Ginmon ([bunq, Ginmon](https://help.bunq.com/articles/ginmon-our-bunq-stocks-partner)): other assets.

**Routes:**

- **API:** a personal key can control your account and make payments ([bunq API keys](https://doc.bunq.com/basics/authentication/api-keys)). No read-only permissions, so no connection (ADR 0005).
- **Annual statement:** _Annual Overview_ as a PDF, only in the app ([bunq](https://help.bunq.com/articles/how-do-i-export-my-annual-account-overview), [bunq](https://help.bunq.com/articles/what-types-of-bank-statements-can-i-export)). Whether Stocks is in it isn't verified.

**Advice:** bank balances via the existing bank import; Stocks as an account with _values per year_. Work S, prio 3.

#### PayPal

**What:** balance at PayPal. Who runs the European accounts and how the Belastingdienst classifies the balance hasn't been checked; probably bank balances abroad.

**Routes:** an activity overview as CSV exists according to common knowledge, but the columns and whether there's a balance column weren't found. The BittyTax parser for PayPal only reads crypto purchases at PayPal ([BittyTax, paypal.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/paypal.py), AGPL-3.0).

**Advice:** (d) by hand; only build something with a real file. Work S, prio 3.

### Brokers and investment platforms

#### LYNX (and Mexem)

**What:** securities and cash; LYNX arranges accounts at Interactive Brokers. LYNX writes that Interactive Brokers forms the link between the investment account "via LYNX" and external applications ([LYNX, linking with AI](https://www.lynx.nl/beurs/beurs-koersen/beursinfo/beurs-nieuws-tips/beleggen-ai-chatgpt-claude/), [Interactive Brokers via LYNX](https://www.lynx.nl/online-broker/interactive-brokers-lynx/)).

**Routes:**

- **Flex Queries:** according to a Portfolio Dividend Tracker guide, you create an Activity Flex Query in LYNX under _Performance & Reports → Flex Queries_; a token for the Flex Web Service is under _Account Settings → Reporting_ ([PDT](https://help-en.portfoliodividendtracker.com/article/269-download-your-lynx-actions)). Second-hand; not found on LYNX's own site.
- **Box3balans:** the connection with Interactive Brokers already uses that Flex Web Service ([README](../../README.en.md#connections-with-exchanges-and-brokers)).

**Advice:** (a), the existing connection. Test with a LYNX account and put "also for LYNX" in the connection dialog. Work S, prio 1. According to comparison sites Mexem also works via Interactive Brokers; then the same probably applies there (both not verified).

**Needed:** someone with a LYNX account who creates a Flex token and runs a sync.

**Open question:** does a LYNX account's Flex token work on the same address as at IBKR?

#### eToro

**What:** stocks, ETFs, crypto and CFDs at eToro (Europe) Ltd, Cyprus ([eToro, regulation](https://www.etoro.com/nl/customer-service/regulation-license/)). Other assets.

**Routes:**

- **API:** not researched for private clients.
- **Export:** you create the _Account Statement_ under _Portfolio → History_ for a period and save it as PDF or Excel. It contains the tabs _Closed Positions_ (with ISIN) and _Account Activity_ (deposits, withdrawals, opened and closed positions, costs) ([eToro](https://help.etoro.com/s/article/what-is-the-etoro-account-statement?language=en_GB)).
- **Columns:** Export-To-Ghostfolio's test file has `Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,Balance,Position ID,Asset type,NWA`; you delete all tabs except _Account Activity_ and save as CSV with commas ([Export-To-Ghostfolio, README](https://github.com/dickwolff/Export-To-Ghostfolio#etoro), [sample](https://github.com/dickwolff/Export-To-Ghostfolio/blob/main/samples/etoro-export.csv), Apache-2.0).

**Advice:** (b), a recogniser for _Account Activity_. `Details` contains the symbol (`NKE/USD`), `Position ID` links opening and closing. CFDs aren't ownership of the underlying; skip those rows and report them. Work M, prio 1.

**Needed:** an anonymised _Account Activity_ with buys, sells, dividend and a CFD.

**Open questions:** the types in `Type`; whether `Units` is negative on a sale; where the ISIN is (only in _Closed Positions_?).

**Status (October 2026):** the recogniser has been built ([#24](https://github.com/zenonymous/box3balans/issues/24)), on the public sample, not yet tested with a real export. Amounts are read as dollars (they add up to the account balance, not in the share's currency); SDRT goes with the purchase with the same Position ID; CFDs, cash and unknown types are skipped and named. eToro's exchange suffixes `.NV` and `.ZU` become Yahoo's `.AS` and `.SW`.

#### Freedom24

**What:** broker from Cyprus; according to a newspaper over 300,000 clients in Europe ([Cyprus Mail](https://cyprus-mail.com/2024/09/26/online-broker-freedom24-reaches-300000-customers), second-hand).

**Routes:** an API with a key pair ([Freedom24](https://freedom24.com/tradernet-api/auth-api)); a read-only setting wasn't found, and third-party tools place orders with it ([TradesViz](https://www.tradesviz.com/blog/auto-import-freedom24/)). So no connection. The _Broker report_ is an Excel file under _Reports_ ([Portfolio Performance forum](https://forum.portfolio-performance.info/t/freedom24-import/18110/3), second-hand).

**Advice:** (b) on request. Work M, prio 3.

#### XTB

**What:** Polish broker (XTB S.A.) with Dutch clients via the European passport (only confirmed second-hand: [trade.nl](https://trade.nl/broker/xtb/)).

**Export:** _Account history → Cash operations → Export_, as CSV; header `ID;Type;Time;Symbol;Comment;Amount`, with purchases as `OPEN BUY 34/42.5658 @ 11.7480` in `Comment` ([Export-To-Ghostfolio](https://github.com/dickwolff/Export-To-Ghostfolio#xtb), [sample](https://github.com/dickwolff/Export-To-Ghostfolio/blob/main/samples/xtb-export.csv)).

**Advice:** (b) on request. Work M (the quantity and price are in a text field), prio 3.

**Status (October 2026):** the recogniser has been built ([#46](https://github.com/zenonymous/box3balans/issues/46)), on the public sample, not yet tested with a real export. Buys and sells come from the comment (`OPEN BUY 34/42.5658 @ 11.7480`), so in any language; amounts are read as euros; withholding tax goes with the dividend with the previous ID; cash and CFDs are skipped. XTB's country codes (`.US`, `.UK`, `.PL` …) become Yahoo's exchange suffixes.

#### ING, ABN AMRO and the other brokers already researched

In [exportformaten.md](exportformaten.md):

- **ING Zelf op de Beurs and Eenvoudig Beleggen:** the _Historisch portefeuilleoverzicht_ (CSV) has been read since 0.1.39, tested with a real overview from Eenvoudig Beleggen (October 2026). ING's transaction CSVs (tabs Beleggingen and Geld): columns still unknown, sample needed. (b) + (c), work M, prio 2.
- **ABN AMRO:** no securities export; fund rows in the TAB export of the linked account. Prio 3 until there's a real file.
- **Lightyear, Scalable Capital:** recognised.
- **DEGIRO, Interactive Brokers, Saxo, Trade Republic, Trading 212, BUX, Revolut (stocks), Rabobank Beleggen:** recognised or connected ([README](../../README.en.md#csv-import)).

### Index funds, robo-advisers and wealth management

#### Brand New Day

**What (products and box 3):**

- **Investment account (free assets):** investing in Brand New Day's own equity and bond funds, self-composed or as a model portfolio ([investment account information, question 13](https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf)). Box 3, other assets. Part of it can be in the _Cashallocatie_ (cash allocation) (question 29).
- **Savings account and savings deposit:** free savings ([savings deposit terms](https://new.brandnewday.nl/documenten/productvoorwaarden-spaardeposito-revision-3.pdf)). Bank balances.
- **Not in box 3:** Pensioenrekening savings and investing, annuity payout (box 1); the Hypotheekrekening investing account and the Gouden-handdrukrekening (golden handshake) have their own tax treatment (question 13; [annual statement FAQ](https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/)). The mortgage account is an investment right for the home you live in; see [that card](#bank-savings-and-investment-rights-for-your-home).

**Reach:** over 360,000 clients and €10.6 billion in assets entrusted at the end of 2025. In free investment accounts €2,174 million (2024: €1,680 million), free savings €338 million ([Brand New Day Bank annual report 2025](https://new.brandnewday.nl/documenten/jaarverslag-2025-bnd-bank.pdf), p. 3–6).

**Platform:** Brand New Day develops its software itself (Brand New Day Diensten) and moved to the cloud in 2025 ([annual report 2025](https://new.brandnewday.nl/documenten/jaarverslag-2025-bnd-bank.pdf), _Onderzoek en ontwikkeling_). No source found that Ohpen is behind it. Ohpen actually started as a competitor of Brand New Day ([IEXProfs](https://www.iexprofs.nl/onbekend/54936/onbekend/Ohpen-is-nu-echt-open.aspx), second-hand). See also [Platforms on Ohpen](#platforms-on-ohpen).

**What's in MijnBND** ([investment account information, questions 14 and 28–35](https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf), version 5 December 2024):

- the current portfolio, the return, the costs and the executed orders;
- **quarterly statement** per investment account, after every quarter: composition, **value per fund and in total at the start and end of the quarter**, the amount in the Cashallocatie, return per fund, costs, **deposits and withdrawals per fund and in total**, and the transactions;
- **financial annual statement** in February: for investment accounts in box 3 **the starting and end value** and **the dividend paid out with the dividend tax withheld**;
- everything under _Mijn documenten_ (for example _Kwartaaloverzichten_), including old quarterly, annual and transaction statements. For savings and investment accounts: _Mijn documenten → Overzichten → Jaaroverzichten_ ([annual statement FAQ](https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/)).

Brand New Day says itself: for the tax return you report the value of 1 January ([annual statement FAQ](https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/)).

**Format:** Brand New Day doesn't say. One user only had a PDF _Overzicht beleggingstransacties_ with the columns `#`, `Datum`, `Soort`, `Fonds`, `Aantal`, `Prijs`, `Bedrag` ([Portfolio Performance forum](https://forum.portfolio-performance.info/t/pdf-import-from-brand-new-day/31804), second-hand). **No CSV, Excel or API found** (see also [exportformaten.md](exportformaten.md#4-brand-new-day-investing-free-assets)).

**Funds:** own funds with an ISIN, such as the BND Wereld Indexfonds Unhedged (NL0012706238, price €24.64 on 31 August 2026, dividend €0.27 in June 2026) ([factsheet](https://www.brandnewday.nl/content/app/pdf/documentencentrum/FactsheetsCollectief/BND-Wereld-Indexfonds-C-Unhedged.pdf)). Not listed on an exchange; whether Yahoo has them wasn't checked. Tracking with transactions therefore needs manual prices.

**Open source:** no importer found, not in Portfolio Performance either ([PDF extractors](https://github.com/portfolio-performance/portfolio/tree/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf)).

**Advice:**

1. **Now, (d), work S.** One account with _values per year_ per investment account and one per savings account. In the explanation (README or tooltip): value on 1 January = the starting value from the financial annual statement; income = the dividend; money in and out = the sum of the deposits and withdrawals from the four quarterly statements. That's enough for the deemed-return system and the actual return.
2. **After that, PDF annual statement, work M (after the basis).** A template for the financial annual statement (starting value, end value, dividend, dividend tax) and one for the Q4 quarterly statement (value per fund on 31 December, deposits and withdrawals). The Q4 statement can also become a portfolio statement (c) if it mentions numbers of units.

Prio 1.

**Needed from a user:** the text of a financial annual statement and of a Q4 quarterly statement, made with `pdftotext -layout`, with names and amounts changed (see [what a reader needs](#what-a-reader-needs)).

**Open questions:**

- Is the "beginwaarde" (starting value) the value on 1 January (or on 31 December of the year before; that's the same)?
- Are numbers of units in the quarterly statement, or only amounts?
- Is the dividend paid out to the Cashallocatie or reinvested? That decides whether it's already in the end value.
- Does the Cashallocatie belong to the bank balances? Brand New Day is a bank; Box3balans counts cash at a bank or broker as a bank balance by default ([README](../../README.en.md#box-3)).
- Is there an app with an export, or a public price page with daily prices per fund?

#### Meesman

In [exportformaten.md](exportformaten.md#3-meesman-indexbeleggen): an Excel export under _Opdrachten → Transacties_ with unknown columns, and an annual statement under _Documenten_. (b) once there's a sample; until then (d). Work M, prio 2.

#### Peaks

In [exportformaten.md](exportformaten.md#5-peaks): an annual statement in February with the value on 1 January, and a quarterly report; no export. (d) now, later a PDF template. Work S, prio 2.

#### Semmie and Index Capital

**What:** wealth management and investment accounts (SemmieWealth). According to a comparison site, Semmie took over Index Capital in October 2023, with the BeCapital label ([vermogensbeheer.nl](https://www.vermogensbeheer.nl/nieuws/semmie-neemt-index-capital-over), second-hand). semmie.nl redirects to semmiewealth.nl (seen on 13 October 2026).

**Routes:** no export, annual statement or API found.

**Advice:** (d). Work S, prio 3. **Open question:** what Semmie lets you download in the client portal.

#### NN Beheerd Beleggen

**What:** managed investing at NN Bank, with fixed management costs ([NN, costs](https://www.nn.nl/Particulier/Beleggen/Beheerd-Beleggen/Kosten-Beheerd-Beleggen.htm), [product terms](https://www.nn.nl/Particulier/Beleggen/Productvoorwaarden-Beheerd-Beleggen.htm)). Other assets.

**Routes:** not researched which annual statement NN gives. **Advice:** (d). Work S, prio 3.

#### Centraal Beheer and a.s.r.

- **a.s.r. bank** stopped its investment services in 2020; the savings portfolio went to Achmea Bank (Centraal Beheer) ([a.s.r.](https://www.asr.nl/levensverzekering/sparen-beleggen)). Investors could move to Evi van Lanschot free of charge ([press release a.s.r. and Van Lanschot Kempen](https://www.asrnederland.nl/-/media/files/asrnederland-nl/nieuws-en-pers/2020/20200115-persbericht-asr-en-van-lanschot-kempen-gaan-samenwerkingsovereenkomst-aan.pdf)). What remains at a.s.r. are insurance policies: see [Capital insurance](#capital-insurance).
- **Centraal Beheer Beleggen:** funds from Achmea Investment Management ([review, second-hand](https://www.financieelonafhankelijkblog.nl/centraal-beheer-beleggen-review-en-ervaringen)). No export or annual statement found on its own site.

**Advice:** (d). Work S, prio 3.

#### Wealth management by the large banks and Van Lanschot

- **Rabobank:** the investment portfolio's annual statement mentions the value on 1 January and comes by 1 February at the latest ([Rabobank](https://www.rabobank.nl/particulieren/beleggen/service/waar-staat-het-jaaroverzicht-beleggen); the page gave us a 403, the content comes from a search result: not verified). Box3balans already reads Rabobank Beleggen's transactions.
- **ING and ABN AMRO:** annual statements under _Documenten_ ([exportformaten.md](exportformaten.md)).
- **Van Lanschot Kempen:** makes a _Jaaroverzicht voor tegenbewijsregeling box 3_ per securities account (only from a search result from [vanlanschotkempen.com](https://www.vanlanschotkempen.com/nl-nl/private-banking/inspiratie/beleggen-en-sparen/plannen-box-3-zijn-bekendgemaakt), not verified).
- **Evi van Lanschot** took over Robeco's online platform in 2023, together 150,000 clients and €6 billion ([banken.nl](https://www.banken.nl/nieuws/amp/24333/van-lanschot-kempen-neemt-online-beleggingsplatform-robeco-over), second-hand). On 13 October 2026 evi.nl redirects to a site that has nothing to do with it; whether Evi still exists isn't verified.

**Advice:** (d) now, PDF templates only when users ask for them. Work S, prio 2.

#### Platforms on Ohpen

Ohpen is a banking platform for others ([Ohpen](https://www.ohpen.com/)). Known clients according to news reports: de Volksbank (the investment accounts of ASN, SNS and RegioBank), Aegon, NN, Knab, LeasePlan Bank and TKP ([banken.nl](https://www.banken.nl/nieuws/20613/de-volksbank-kiest-core-banking-platform-ohpen-voor-beleggingsdiensten), [IBS Intelligence](https://ibsintelligence.com/ibsi-news/de-volksbank-renews-core-banking-contract-with-ohpen/), [IPE](https://www.ipe.com/news/tkp-to-outsource-investment-admin-for-dc-plans-to-ohpen/10043380.article); all second-hand). Ohpen offers APIs to its clients, not to end clients ([Ohpen](https://www.ohpen.com/)). A shared export or shared annual statement for all these platforms wasn't found. No separate card; the accounts go via (d).

### Crypto

General: the Belastingdienst lets you use the price on 1 January of the platform you use ([Belastingdienst, crypto assets](https://www.belastingdienst.nl/wps/wcm/connect/nl/werk-en-inkomen/content/cryptovaluta); from a search result, not read myself). The Dutch platforms below have a MiCA licence from the AFM ([BLOX](https://weareblox.com/nl-nl/blox-verkrijgt-micar-licentie), [Bitonic](https://bitonic.nl/nl/news/298/bitonic-ontvangt-micar-vergunning-van-de-autoriteit-financiele-markten)); for Finst and Coinmerce only confirmed second-hand.

#### Finst and Anycoin Direct

**What:** crypto (over 400 coins) and staking at Finst. Finst took over Anycoin Direct's clients in November 2024; together "up to 500,000 investors", with a free switch for Dutch and Belgian clients ([Finst](https://finst.com/nl/blog/articles/finst-and-anycoin-direct-join-forces)). On 13 October 2026 anycoindirect.eu/nl/help redirects to finst.com/nl/help. Other assets.

**Routes:**

- **API:** none; Finst "currently" doesn't support API trading (article from December 2023) ([Finst](https://help.finst.com/nl/article/biedt-finst-api-trading-aan-1l8kyfy/)). A read-only API wasn't found.
- **Export:** on the desktop: _Activiteit_ → choose a period → _Exporteren_, in **Excel format** ([Finst, updated 27 July 2026](https://help.finst.com/nl/article/hoe-kan-ik-mijn-transactiegeschiedenis-downloaden-1n7971t/)). The columns aren't listed anywhere.
- **Annual statement:** under _Account → Jaaroverzicht_, in February or March ([Finst](https://help.finst.com/nl/article/biedt-finst-een-jaarlijks-belastingrapportoverzicht-1xai8v8/)). Content and format aren't stated.
- **Open source:** no importer found (searched on GitHub).
- **Anycoin Direct (stopped):** orders could be exported as Excel under _Bestellingen_ ([Blockpit](https://intercom.help/blockpit/de/articles/12136922-wie-importiere-ich-daten-mittels-anycoin-direct-csv-excel-datei), second-hand); there was no API for tax software ([CoinTracking](https://cointracking.info/imports/anycoin-tax/), second-hand). Whether old Anycoin history can be downloaded at Finst is unknown.

**Advice:** (b), a recogniser for the _Activiteit_ export (saved as CSV, as with Saxo). Until then (d) with the annual statement. Work M, prio 1.

**Needed:** an anonymised export with buys, sells, deposits, withdrawals, staking and costs.

**Open questions:** the columns and type values; whether euro deposits and withdrawals are in it; what the annual statement shows (value on 1 January per coin?); whether ex-Anycoin clients still get their old history.

#### BLOX

**What:** crypto app, with _Verdien_ (rewards) and _Beheer_ (managed account) ([BLOX](https://support.weareblox.com/hc/nl/articles/40655907523089-Hoe-en-waar-wordt-mijn-crypto-bewaard-in-een-Beheerd-Account)). Other assets.

**Routes:**

- **API:** not found (help centre searched for "API" and "export").
- **CSV:** not found. You see transactions per coin in the app ([BLOX](https://support.weareblox.com/hc/nl/articles/15540929642641-Hoe-volg-ik-mijn-Bitcoin-transactie)); the costs of _Beheer_ are in the transaction overview ([BLOX](https://support.weareblox.com/hc/nl/articles/40656130782737-Ontvang-ik-een-factuur-van-de-Beheer-kosten)).
- **Annual statement:** the value of your vault on 1 January; app: profile → _Mijn gegevens_ → _Jaaroverzichten_; web: _Instellingen → Jaaroverzichten_ → _Exporteren als PDF_ ([BLOX, where](https://support.weareblox.com/hc/nl/articles/25982426553617-Waar-kan-ik-mijn-jaaroverzicht-vinden), [BLOX, which year](https://support.weareblox.com/hc/nl/articles/31488885544721-Welk-jaaroverzicht-heb-ik-nodig-voor-mijn-belastingaangifte)).
- **Open source:** nothing found.

**Advice:** (d) now, with the explanation "the annual statement for year X gives the value on 1 January of year X". Later a PDF template. Work S, prio 2.

**Open questions:** does the PDF have the value per coin or only the total? Does BLOX have a transaction export the help centre doesn't mention?

#### Bitonic

**What:** bitcoin only; "the first bitcoin company in the Netherlands" ([Bitonic](https://bitonic.nl/nl/news/298/bitonic-ontvangt-micar-vergunning-van-de-autoriteit-financiele-markten)). For a long time you bought bitcoin and had it sent to your own wallet; now it can also stay on a Bitonic account ([Bitonic FAQ](https://bitonic.nl/nl/faq)). The trading platform BL3P closed on 20 December 2024; the site with the trading history went offline on 4 May 2026 ([Bitonic](https://bitonic.nl/nl/news/301/bl3p-definitief-offline)).

**Routes:**

- **API:** only a public price API ([Bitonic API](https://bitonic.nl/nl/api)). CoinLedger mentions a read-only API ([CoinLedger](https://coinledger.io/de/integrations/bitonic), second-hand, not confirmed).
- **Export:** not found; the FAQ answers load with JavaScript and couldn't be read.
- **Wallets:** bitcoin that went to your own wallet is already followed by Box3balans by address or xpub.

**Advice:** (e) for what's in your own wallet, (d) for the balance on the account. Work S, prio 3. **Open question:** whether the account has an export or annual statement.

#### Coinmerce

**What:** crypto app. Other assets.

**Routes:**

- **API:** not found.
- **CSV:** on the orders page you download a CSV of your latest orders ([Coinmerce](https://support.coinmerce.io/en/articles/178418-how-is-my-crypto-taxed)). Columns unknown. According to Waltio it goes via _Orders_ and the export button, with only completed orders ([Waltio](https://help.waltio.com/en/articles/5837160-coinmerce-file), second-hand).
- **Annual statement:** in the app under _Account → Orders → Annual Overview_ the starting and end value of the year, not downloadable: Coinmerce recommends a screenshot ([Coinmerce, 10 July 2026](https://support.coinmerce.io/en/articles/209223-annual-overview)). The terms mention continuously downloadable statements ([terms](https://support.coinmerce.io/en/articles/179087-general-terms-and-conditions)).

**Advice:** (b) once there's a sample; until then (d) with the starting value from the app. Work M, prio 2.

**Needed:** an anonymised orders CSV with buys, sells, deposits, withdrawals and staking.

#### Bitpanda

**What:** crypto, stocks, ETFs, precious metals and commodities ([Bitpanda Grondstoffen](https://support.bitpanda.com/hc/nl/articles/5771948622364-Bitpanda-Grondstoffen)). Other assets.

**Routes:**

- **API:** the new public API (`https://api.public.bitpanda.com/v1`) has `GET /v1/portfolio` (cash and investment balances together), `GET /v1/portfolio-history` and `GET /v1/operations` (one timeline of trades, transfers and other transactions). You create a key under _Account Settings → API_ with scopes; `Read` is for market data and portfolios, `Trade` separate ([Bitpanda docs](https://docs.public.bitpanda.com/), [migration](https://docs.public.bitpanda.com/migrating-from-the-legacy-api)). The old API (`api.bitpanda.com/v1`) stops on **31 January 2027** ([migration](https://docs.public.bitpanda.com/migrating-from-the-legacy-api)).
- **CSV and PDF:** _History → Export_ ([Bitpanda](https://support.bitpanda.com/hc/en-gb/articles/360000122759-How-can-I-download-the-history-of-my-Bitpanda-account)). Columns according to BittyTax: `Transaction ID, Timestamp, Transaction Type, In/Out, Amount Fiat, Fiat, Amount Asset, Asset, Asset market price, Asset market price currency, Asset class, Product ID, Fee, Fee asset, Spread, Spread Currency, Tax Fiat` ([BittyTax](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/bitpanda.py), AGPL-3.0).
- **Annual statement:** tax reports only for Austrians; others get quarterly statements, can request an annual statement or download the history ([Bitpanda](https://support.bitpanda.com/hc/nl/articles/18668973207580-Belastingrapporten-bekijken-en-begrijpen)).
- **Open source:** rotki connects with the **old** API (`wallets/transactions`, `fiatwallets/transactions`, `trades`) ([rotki, bitpanda.py](https://github.com/rotki/rotki/blob/develop/rotkehlchen/exchanges/bitpanda.py), AGPL-3.0).

**Advice:** (a), a connection with the new API and a `Read` key. Don't build on the old API. Work M, prio 1.

**Status (October 2026):** the connection has been built ([#22](https://github.com/zenonymous/box3balans/issues/22)) on the OpenAPI description, not yet tested with a real key. Permissions: _Balances_, _Transaction_ and _Trade (Read)_ (for the names of assets), no write permissions. Because the documentation doesn't name the values of `operation_type` and `transaction_type`, the translation goes by what's certain: direction (`flow`), amounts and whether there's a `trade`; the type name only serves to recognise rewards. Two equal opposite rows of one coin in an operation are a move within Bitpanda and cancel out. Stocks and ETFs go by ISIN; metals and commodities not yet. Still open: what the types really are, and whether an unstaking appears as a separate incoming row.

**Open questions:** whether `/v1/operations` gives stocks, ETFs and metals with ISIN; the pagination and how far back; whether a `Read` key really can't change anything. Box 3 category of the euro balance (Box3balans counts cash on a crypto exchange as another asset by default).

#### Crypto.com

**What:** the Crypto.com App (crypto, earn, card) and the Exchange. Other assets.

**Routes:**

- **API:** only for the Exchange, not for the app; rotki connects the Exchange ([rotki, cryptocom.py](https://github.com/rotki/rotki/blob/develop/rotkehlchen/exchanges/cryptocom.py)).
- **The app's CSV:** _Accounts → History → Export_, per wallet and period (up to three years per report), download available for 30 days ([Crypto.com](https://help.crypto.com/en/articles/3438579-how-do-i-export-my-transaction-history-app); from a search result). Header:

  ```text
  Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash
  ```

  ([Export-To-Ghostfolio, sample](https://github.com/dickwolff/Export-To-Ghostfolio/blob/main/samples/cryptocom-export.csv), Apache-2.0; also in [BittyTax](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/cryptocom.py) and [rotki](https://github.com/rotki/rotki/blob/develop/rotkehlchen/data_import/importers/cryptocom.py), AGPL-3.0).

- `Transaction Kind` has codes such as `crypto_to_exchange_transfer`, `crypto_wallet_swap_credited` and `crypto_wallet_swap_debited` (same sample). `Native Amount` is the value in your own currency.

**Advice:** (b), a recogniser for the app CSV. Read the type codes from rotki's and BittyTax's test files (copy nothing; they're AGPL, the same licence as Box3balans, but only the list of codes is needed). Work M, prio 1.

**Needed:** an anonymised CSV with earn, card cashback and a swap.

**Status (October 2026):** the recogniser has been built ([#21](https://github.com/zenonymous/box3balans/issues/21)), on the header and type codes from the public sample and the parsers above, not yet tested with a real export. Unknown types are skipped and named with their code in the check.

#### Bybit

**What:** exchange; since 2025 Bybit EU with a MiCA licence from Austria, which MEXC recommends to departing Dutch clients ([Finance Magnates](https://financemagnates.com/cryptocurrency/exchange/mexc-to-offboard-dutch-users-recommends-bybit-as-micar-compliant-alternative/), second-hand).

**Routes:**

- **API:** keys can be _Read-Only_ ([rotki, Bybit](https://rotki.com/integrations/bybit), [docs.rotki.com](https://docs.rotki.com/usage-guides/integrations/exchange-keys)). rotki uses `account/transaction-log`, `account/wallet-balance` and `order/history` from API v5 ([rotki, bybit.py](https://github.com/rotki/rotki/blob/develop/rotkehlchen/exchanges/bybit.py), [Bybit v5](https://bybit-exchange.github.io/docs/v5/guide)). Deposits and withdrawals per 30 days per request (rotki).
- **CSV:** deposits and withdrawals with `Date & Time(UTC), Coin, QTY, Type, Account Balance, Description` ([BittyTax](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/bybit.py)).
- According to CoinLedger, keys without an IP restriction expire after three months ([CoinLedger](https://help.coinledger.io/en/articles/6588913-bybit-api-import-guide), second-hand). That clashes with a sync that runs for years.

**Advice:** (a) on request. Work M, prio 3.

#### Binance

**What:** Binance left the Netherlands in 2023; from 17 July 2023 Dutch users could only withdraw ([Binance](https://www.binance.com/en/support/announcement/notice-on-changes-of-services-in-the-netherlands-b5a647be31cf469b87fc3337fd461ced)). Only relevant for the reference dates 1 January 2023 and earlier, for example for the actual-return statement over 2023 and earlier.

**Routes:**

- **API:** keys with only _Enable Reading_ ([rotki, Binance](https://rotki.com/integrations/binance)); rotki connects ([binance.py](https://github.com/rotki/rotki/blob/develop/rotkehlchen/exchanges/binance.py)). Whether a Dutch account can still create keys after the departure is unknown.
- **CSV:** the _Transaction History_ statement with `UTC_Time, Account, Operation, Coin, Change, Remark` and a long list of `Operation` values ([BittyTax](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/binance.py)).

**Advice:** (b) on request, because it concerns old years. Work M, prio 3.

**Status (October 2026):** the recogniser for _Transaction History_ has been built ([#52](https://github.com/zenonymous/box3balans/issues/52)), on the layout and the list of `Operation` values from BittyTax, not yet tested with a real export. The rows of one second form one trade. Against cash that's a buy or sell; against a dollar stablecoin (USDT, USDC, BUSD, FDUSD, TUSD, USDP, DAI) a sale of the stablecoin and a purchase of the coin at one dollar per stablecoin, because most trading on Binance went that way; between two other coins a sale and a purchase, each at that coin's closing price on that day (the export names no amount in money; without a closing price it comes out at €0, with a notice). Moves within Binance (Earn, staking, savings), futures and margin, small balances to BNB and euros are skipped.

#### Bitstamp

**What:** exchange (Luxembourg). **API:** keys with only the permissions _account balance_ and _user transactions_, confirmed by email ([rotki, Bitstamp](https://rotki.com/integrations/bitstamp)); `POST /api/v2/user_transactions/` and `/api/v2/account_balances/` with v2 signing ([Bitstamp API](https://www.bitstamp.net/api/)). **CSV:** `ID, Account, Type, Subtype, Datetime, Amount, Amount currency, Value, Value currency, Rate, Rate currency, Fee, Fee currency, Order ID` ([BittyTax](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/bitstamp.py)).

**Advice:** (a) or (b) on request. Work M, prio 3.

**Status (October 2026):** the recogniser for both CSV layouts has been built ([#53](https://github.com/zenonymous/box3balans/issues/53)), on the layouts in BittyTax and rotki, not yet tested with a real export. Everything against euros or dollars is booked, cash too, so the cash balance is right; a swap between two coins has no value in money and is skipped and counted.

### Crowdfunding and P2P

General: loans via a platform are receivables, in the tax return _uitgeleend geld_ (money lent, other assets); interest credited less than yearly counts in the value on 1 January ([Belastingdienst, box 3 assets 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_)). None of the platforms below was found to have an API or CSV for investors; they all send an annual statement.

#### Geldvoorelkaar

**What:** loans to SMEs and real estate, and a mortgage fund in preparation ([Geldvoorelkaar](https://www.geldvoorelkaar.nl/veelgestelde-vragen/)). Money lent: other assets. **Money in the Wallet that isn't invested belongs to the bank and savings balances** ([Geldvoorelkaar FAQ](https://www.geldvoorelkaar.nl/veelgestelde-vragen/investeerders/)); the wallet runs via OPP (same page).

**Reach:** €701 million financed since the start, €477.5 million paid out to investors (up to 1 September 2026) ([statistics](https://www.geldvoorelkaar.nl/over-ons/statistiekpagina/)).

**Routes:**

- **Jaaropgaaf** (annual statement) from mid-February: _Mijn gegevens → Downloads_, choose the year; it's sent to your email. In it: **outstanding capital on 1 January and 31 December** (after write-offs and provision), the total invested in the year, the costs, and projects with payment problems. A _specificatieoverzicht_ gives the provisions per project ([FAQ](https://www.geldvoorelkaar.nl/veelgestelde-vragen/investeerders/)).
- **API, CSV:** not found.

**Advice:** (d), two accounts: _Geldvoorelkaar (lent)_ as another asset and _Geldvoorelkaar (wallet)_ as a bank balance. Later a PDF template. Work S, prio 1 (together with the other platforms: one piece of explanation).

**Open question:** is the interest received in the annual statement (needed for the actual return)?

#### Collin Crowdfund

**What:** loans to SMEs. Collin passed €300 million ([Collin](https://www.collincrowdfund.nl/nieuwsbrief-collin-doorkruist-de-grens-van-300-miljoen/)).

**Routes:** a yearly annual statement in _Mijn Collin_; report under "other receivables, such as money lent"; Collin passes nothing on to the Belastingdienst ([Collin FAQ](https://www.collincrowdfund.nl/veelgestelde-vragen/)). What's in it, the FAQ doesn't say.

**Advice:** (d), later PDF. Work S, prio 2.

#### Lendahand

**What:** loans to entrepreneurs and projects worldwide, with a social or sustainable goal ([Lendahand](https://www.lendahand.com/en-EU/pages/crowdfunding-taxes)). Outstanding loans in box 3; the wallet balance is listed separately on the annual statement and belongs to the bank and savings balances ([Lendahand](https://www.lendahand.com/en-EU/pages/crowdfunding-taxes)).

**Routes:** annual statement in the _Financial Dashboard_, at the bottom under _Downloads_ (same page). No API or CSV found.

**Advice:** (d) with two accounts, later PDF. Work S, prio 2.

#### Mogelijk

**What:** real estate financing (direct loans), a fund and bonds ([Mogelijk](https://www.mogelijk.nl/faq/jaaroverzichten)).

**Routes:** annual statements are emailed between 11 and 13 February; investors in direct loans can also download them in the app; fund statements not yet. Mogelijk doesn't pass them on to the Belastingdienst by itself ([Mogelijk](https://www.mogelijk.nl/faq/jaaroverzichten)). Content and format aren't stated.

**Advice:** (d), later PDF. Work S, prio 2.

#### Kapitaal Op Maat

At the end of every financial year a tax overview in your portfolio overview, with the interest received and the total capital invested ([Kapitaal Op Maat](https://www.kapitaalopmaat.nl/Hoe-wordt-crowdfunding-belast)). Whether the value on 1 January is in it isn't clear. (d), work S, prio 3.

#### Invesdor (Oneplanetcrowd)

On 13 October 2026 oneplanetcrowd.com redirects to invesdor.nl. Not researched further. (d), work S, prio 3.

#### DuurzaamInvesteren

Annual statement in _Mijn DuurzaamInvesteren_ under _Documenten_; for projects via the custodian AFS the amounts are pre-filled according to the site; for some projects you have to go to the issuer ([DuurzaamInvesteren](https://www.duurzaaminvesteren.nl/over-duurzaaminvesteren/belastingopgave-2025), [FAQ](https://www.duurzaaminvesteren.nl/veelgestelde-vragen/veelgestelde-vragen-investeerders); the page loads with JavaScript, content from a search result, not verified). Some projects are green investments; not researched. (d), work S, prio 3.

#### NPEX

**What:** bonds and certificates from SMEs. **Tax annual statement** under _Documenten → Persoonlijk_: **the value and position per financial instrument on 1 January and 31 December**, tradable bonds at trading value, some funds at intrinsic value; if it differs from the pre-filled tax return, the annual statement prevails ([NPEX, explanation 2025](https://www.npex.nl/jaarnota2025)).

**Advice:** (d), later a PDF template that can also give positions (c). Work S, prio 3.

#### Mintos

**What:** loans (_Claims_ and _Notes_), bonds, real estate and ETFs ([Mintos, tax report](https://help.mintos.com/hc/en-us/articles/32061202728849-Tax-Report-Insights-Your-Quick-Guide)). Other assets.

**Routes:**

- **Tax report** (English, under _Reports_, for 2025 at the end of March 2026): **opening and closing balance of the account** (annex 1), the ETF portfolio (annex 2), interest, other income, costs, write-offs, deposits and withdrawals ([Mintos](https://help.mintos.com/hc/en-us/articles/32061202728849-Tax-Report-Insights-Your-Quick-Guide), [Mintos](https://help.mintos.com/hc/en-us/articles/43210112798225-When-will-my-2025-tax-report-be-available)).
- **Account statement** under _Transactions_ or _Statement_ ([Mintos](https://help.mintos.com/hc/en-us/articles/33872886368401-How-can-I-access-my-account-statement)); according to forum users downloadable as XLS ([Portfolio Performance forum](https://forum.portfolio-performance.info/t/unterstuetzung-von-p2p-anbietern-wie-mintos/5511), second-hand).
- **API:** Mintos's API is for loan originators, not for investors ([Mintos](https://help.mintos.com/hc/en-us/articles/7220945828113-What-is-an-API)).

**Advice:** (d) with the tax report: the value on 1 January, money in and out, interest as income. Later PDF. Work S, prio 2.

#### Go & Grow (Bondora)

Go & Grow is Bondora's product, with its own help centre. Statements and tax reports per goal or for everything together, as **PDF or Excel**, for a period you choose, under _Statements_ ([Go & Grow](https://help.goandgrow.eu/hc/en-us/articles/34275456362898-How-to-generate-statements-and-tax-reports)). Portfolio Performance reads the PDF statement ([BondoraCapitalPDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/BondoraCapitalPDFExtractor.java), EPL-1.0). (d); a recogniser for the Excel export only with a sample. Work S, prio 3.

### Green investments

**The end date of the exemption differs per source.** RVO: the tax benefit stops on 1 January 2028, after a decision of the House of Representatives in autumn 2025 ([RVO, green projects scheme](https://www.rvo.nl/subsidies-financiering/regeling-groenprojecten)). Triodos: strongly reduced on 1 January 2027, abolished on 1 January 2028 ([Triodos](https://www.triodos-im.com/articles/2026/triodos-groenfonds-becomes-even-more-impactful)). Rijksoverheid: on 1 January 2027 ([Rijksoverheid](https://rijksoverheid.nl/vraag-en-antwoord/duurzame-economie/groen-sparen-in-een-groenfonds), probably outdated). [box3-sources.md](box3-sources.md) and the [README](../../README.en.md#box-3) say 2028. For 2026 the exemption is €26,715, with a fiscal partner €53,430 ([Belastingdienst 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_)). Recognised green funds are listed at [RVO](https://www.rvo.nl/subsidies-financiering/regeling-groenprojecten/groenfondsen).

#### ASN Groenprojectenfonds

A green fund from ASN Impact Investors, free of box 3 within the exemption, with a 0.1% tax credit since 2025; temporarily closed in 2020 and 2024, open again in early 2025 ([ASN, FAQ](https://beleggingsfondsen.asnbank.nl/overig/downloads/faq-asn-impact-investors.html), [ASN, opening February 2025](https://beleggingsfondsen.asnbank.nl/overig/downloads/toelichting-openen-asn-groenprojectenfonds-februari-2025.html); from search results). Bought via ASN Bank's investment account (de Volksbank, on Ohpen; see [Platforms on Ohpen](#platforms-on-ohpen)). Export or annual statement not researched.

**Advice:** (d) with the account as a _green investment_ (already possible). Work S, prio 2. Make sure the app moves it to other assets by itself the year after the end date.

#### Triodos Groenfonds

Gave up its green status on **1 April 2026**; the scheme is strongly reduced on 1 January 2027 and abolished on 1 January 2028 ([Triodos](https://www.triodos-im.com/articles/2026/triodos-groenfonds-becomes-even-more-impactful)). Whoever was a shareholder on 1 January 2026 still gets the benefit over 2026 once more, according to the explanation of the prospectus ([Triodos](https://www.triodos-im.com/binaries/content/assets/shared/fund-assets/tim/tgf/toelichting-wijziging-prospectus-triodos-groenfonds-nv-per-1-april-2026.pdf); content from a search result, the PDF itself couldn't be opened).

**Advice:** (d). Box3balans must be able to classify a green account per year: green up to and including 2026, other assets from 2027. Work S, prio 2. **Status (October 2026):** an account can now get another category from a certain year (_Box 3 → Rules & rates → From a year on_): green up to and including 2026, other assets from 2027. Explained in the README.

### Employer share plans

**Why it matters:** shares you hold at an American plan administrator after a vest or an ESPP purchase are ordinary box 3 assets ("shares … that don't belong to a substantial interest"), abroad, in dollars, to be converted at the ECB rate of 1 January ([Belastingdienst 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_)). They're probably not in the pre-filled tax return (not verified). Unvested shares and unexercised options probably don't belong there (wages on acquisition); no primary source for that was found.

**All recognisers below:** currency USD, follow the cash at the administrator separately, and don't book `fee` for tax withheld at a vest as costs (that's wage tax, box 1).

#### Charles Schwab Equity Awards

**What:** RSUs and ESPP in Schwab's _Equity Award Center_.

**Routes:**

- **API:** not found for equity award accounts.
- **Export:** the award account's full transaction history as **CSV or JSON**; dates always `MM/DD/YYYY` ([cgt-calc, Schwab](https://cgt-calc.uk/brokers/schwab/)). Schwab itself doesn't document it publicly.
- **Columns** (from cgt-calc's parser, MIT, actively maintained): top row `Date, Action, Symbol, Description, Quantity, FeesAndCommissions, DisbursementElection, Amount`; details per transaction including `AwardDate`, `AwardId`, `VestDate`, `VestFairMarketValue`, `PurchaseDate`, `PurchaseFairMarketValue`, `SalePrice`, `SharesSold`, `NetSharesDeposited`, `SharesWithheld`. In the CSV the details are on follow-up rows with empty top columns ([schwab_equity_award_json.py](https://github.com/KapJI/capital-gains-calculator/blob/main/cgt_calc/parsers/schwab_equity_award_json.py)).
- **Types:** `Deposit` (vest or ESPP; description `ESPP`), `Sale`, `Forced Quick Sell`, `Dividend`, `Tax Withholding`, `Wire Transfer`, `Journal`, `Lapse` (the wage component of a vest) and more (same file).
- **Pitfall:** on splits Schwab doesn't consistently rewrite old rows; cgt-calc keeps a list per share for that (same file).
- **Ordinary Schwab account:** Export-To-Ghostfolio already reads the brokerage export (`Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount`) ([sample](https://github.com/dickwolff/Export-To-Ghostfolio/blob/main/samples/schwab-export.csv)).
- **PDF:** Portfolio Performance reads Schwab's account statements ([SchwabPDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/SchwabPDFExtractor.java), EPL-1.0).

**Advice:** (b), a recogniser for the CSV variant (JSON can come later; the import only reads CSV now). `Deposit` → `buy` at `VestFairMarketValue` or `PurchaseFairMarketValue` (cost basis for the actual return), `Sale` → `sell`, `Dividend` → `dividend`, skip and report `Lapse`, `Journal` and `Wire Transfer`. Work M, prio 1.

**Needed:** an anonymised CSV export with an RSU vest, an ESPP purchase, a sale and a dividend.

**Open questions:** the cost basis for ESPP (purchase price or market value?); can an ordinary Schwab account appear in the same export?

**Status (October 2026):** the recogniser has been built ([#18](https://github.com/zenonymous/box3balans/issues/18)) on the layout cgt-calc describes and tests, not yet with a real export. Chosen: a vest and an ESPP purchase become a purchase at market value (for ESPP the one on the purchase day), because the difference with what you paid was taxed as wages in box 1; the ESPP price paid is in the note. _Lapse_ rows (the gross vest) are skipped, because the shares come in as _Deposit_; cash (_Journal_, _Wire Transfer_) too. The export with only prices (`FairMarketValuePrice`) isn't recognised.

#### Morgan Stanley at Work and E\*TRADE

**What:** Morgan Stanley at Work's share plans (formerly _Shareworks_, _StockPlan Connect_ or _E\*TRADE stock plan_) are on etrade.com, under _At Work_ ([Morgan Stanley, guide outside the US](https://www.morganstanley.com/cs/pdf/et_account_management_etrade_com_non_us_english.pdf)). Access Direct accounts become E\*TRADE accounts ([Morgan Stanley](https://www.morganstanley.com/atwork/employees/msad-to-etrade)).

**Routes:**

- **API:** the E\*TRADE API (OAuth) has accounts, balances, transactions and portfolio, but also orders ([E\*TRADE API](https://apisb.etrade.com/docs/api/account/api-account-v1.html)); no read-only permissions found, and whether stock plan accounts are in it isn't stated. Not usable.
- **Exports** (from SeFA's documentation, MIT): _At Work → Holdings → Benefit History_ → _Download_ → _Download Expanded_ gives **BenefitHistory.xlsx** (RSU and ESPP); under _Holdings_ there's also a _holdings by status_ export ([SeFA](https://github.com/atulgpt/SeFA/blob/main/src/sefa/parser/demat/etrade/README.md)). Morgan Stanley's own guide only mentions _Holdings_, _Orders_, confirmations and _Tax Documents_ ([guide](https://www.morganstanley.com/cs/pdf/et_account_management_etrade_com_non_us_english.pdf)).
- **Old Morgan Stanley reports:** `Releases Report.csv` (`Vest Date, Order Number, Plan, Type, Status, Price, Quantity, Net Cash Proceeds, Net Share Proceeds, Tax Payment Method`) and `Withdrawals Report.csv` (`Execution Date, Order Number, Plan, Type, Order Status, Price, Quantity, Net Amount, Net Share Proceeds, Tax Payment Method`); cgt-calc only tested them with Alphabet ([mssb.py](https://github.com/KapJI/capital-gains-calculator/blob/main/cgt_calc/parsers/mssb.py), [cgt-calc](https://cgt-calc.uk/brokers/morgan-stanley/)).
- **PDF:** Portfolio Performance reads E\*TRADE confirmations (_EMPLOYEE STOCK PLAN RELEASE CONFIRMATION_) and Morgan Stanley quarterly statements (_SHARE PURCHASE AND HOLDINGS_, _Release Detail Report_) ([ETradePDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/ETradePDFExtractor.java), [MorganStanleyPDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/MorganStanleyPDFExtractor.java), EPL-1.0).

**Advice:** (b) for BenefitHistory (Excel, saved as CSV) and (c) for the holdings export as a portfolio statement on the day of download. Start with the holdings: they give the position, and an export in early January approximates 1 January. Work M, prio 1.

**Needed:** anonymised BenefitHistory.xlsx and holdings export.

**Open questions:** the columns of both files (not seen publicly); whether the holdings can be chosen for a date; how sales appear in them.

#### Fidelity NetBenefits and Stock Plan Services

**What:** share plans at Fidelity Stock Plan Services.

**Routes:** NetBenefits's _Activity_ CSV with `Transaction date, Transaction type, Investment name, Shares, Amount` ([beancounttools, netbenefits](https://github.com/tarioch/beancounttools/blob/master/src/tariochbctools/importers/netbenefits/importer.py), MIT). Portfolio Performance reads confirmations with _YOU PURCHASED_ or _YOU SOLD_ ([FidelityInternationalPDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/FidelityInternationalPDFExtractor.java), EPL-1.0). No official description from Fidelity was found.

**Advice:** (b). Work M, prio 2. **Needed:** an anonymised Activity CSV. **Open question:** does the CSV contain the vests, or only buys and sells?

#### Computershare and EquatePlus

**What:** Computershare manages share registers and employee plans. EquatePlus's release notes (originally from Equatex) are on Computershare's site ([EquatePlus release notes](https://content-assets.computershare.com/eh96rkuu9740/2R1Z53p8y8ZnwyX1UvX6wZ/dc632ce060e118ffbdc60d10a44d375c/EquatePlus-Release-70-Notes-EQX.pdf)), and Computershare bought the European plan part of Shareworks from Morgan Stanley ([press release via Nasdaq](https://www.nasdaq.com/press-release/computershare-to-buy-european-public-equity-employee-share-plan-business-from)).

**Routes:**

- **EquatePlus:** a _Participant Plan Holdings Statement_ on request, for a period of at most 12 months, with available and restricted shares per plan and the transactions per type ([Computershare](https://images.info.computershare.com/Web/CMPTSHR1/%7B189d4c0d-b6f3-4ba6-bc09-ec194b9ccb6d%7D_Participant_Plan_Holdings_Statement.pdf)). Format not stated; probably PDF. _EquateAPI_ exists, but is for employers (release notes).
- **Investor Center:** transactions under _Activity_ exportable as PDF or "C…" (the text breaks off; probably CSV) ([an issuer's FAQ](https://s202.q4cdn.com/481442212/files/doc_downloads/2026/PKST-Website-FAQ-6-19-26-vFinal.pdf), second-hand).
- **PDF:** Portfolio Performance reads the _Plan Statement_ ([ComputersharePDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/ComputersharePDFExtractor.java), EPL-1.0).

**Advice:** PDF as a portfolio statement (c): the holdings statement up to and including 31 December. Until then (d). Work M, prio 2.

**Needed:** the text of a holdings statement (EquatePlus) or plan statement (Computershare).

#### Equiniti (EQ)

Not researched what EQ Shareview lets you download. Prio 3 until someone asks for it.

### Precious metal

#### Goldrepublic

**Status (October 2026):** the account statement (PDF) is read, in two ways: under _Import CSV_ as transactions (purchases and sales in grams, deposits, withdrawals, storage costs), and under _Values per year_ as an annual statement (total on 1 January and 31 December, money in and out, costs). Built and tested with a real statement over 2025 (`server/src/import/formats/goldrepublic.ts`).

**What Goldrepublic offers:** no API (the app and the website work with user name and password, so no connection, ADR 0005). On the website under _Afschriften_, in the app under _Transacties_, you download an account statement over a chosen period: opening balance (cash, and per metal grams, price per kg and value), every transaction with the details of every order (product and vault, moment of execution, value, costs, handling costs, weight) and the closing balance. In English, with partly Dutch descriptions. In addition, by email a confirmation of every order and every change in the cash deposit, the bar allocation daily, and a bar list to download ([terms](https://www.goldrepublic.com/en-us/terms-and-conditions)).

**Costs** ([rates](https://www.goldrepublic.com/nl-nl/tarieven)): buying and selling 1%, buying via a savings plan 0.5%; storage 0.5% per year for gold and 1% for silver and platinum (plus VAT), charged in euros every month: first from the cash deposit, otherwise via a direct debit, and only if that fails by selling metal. Silver has handling costs (€9 per kg). Metals: gold, silver and platinum, in Amsterdam, Zürich or Frankfurt.

**Valuation:** the statement values at Goldrepublic's price on that day; Box3balans at the spot price. Whoever wants to use Goldrepublic's amount tracks the account with values per year.

#### BullionVault

**API:** XML pages such as `view_balance_xml.do` and `view_orders_xml.do`, but only after logging in with user name and password (`j_username`, `j_password`, session cookie); no key or read-only permission; statements have no XML version ([BullionVault XML API](https://www.bullionvault.com/help/xml_api.html)). So no connection (ADR 0005).

**Advice:** like Goldrepublic: purchases in grams on Gold or Silver. Work S (explanation only), prio 3.

#### Holland Gold

Storage in _Holland Gold Safe_ (the Netherlands, Switzerland, Singapore), fully allocated, visible in the client portal ([Holland Gold](https://www.hollandgold.nl/en/faq/opslag/is-the-precious-metal-i-hold-with-holland-gold-safe-fully-owned-by-me-and-exclusively-allocated/); from a search result). No export or annual statement found. Like Goldrepublic. Work S, prio 3.

### Insurance and own-home products

#### Capital insurance

**What:** capital insurance policies that aren't a capital insurance for the home you live in belong in box 3 with their value on 1 January, except policies that only pay out on death (up to an amount), on disability, illness or accident, and policies from before 15 September 1999 that weren't increased or extended ([Belastingdienst 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_), [Belastingdienst](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/vermogen/wat_zijn_uw_bezittingen_en_schulden/uw_bezittingen/niet_vrijgesteld_deel_kapitaalverzekeringen)). You request the market value from the insurer (same page).

**Routes:** no API or export; a value statement by letter or PDF.

**Advice:** (d), already exists ("capital insurance" as a type). Add an explanation of which exemptions Box3balans doesn't apply ([box3-sources.md](box3-sources.md)). Work S, prio 2.

#### Bank savings and investment rights for your home

A savings account, investment right or capital insurance for the home you live in (banksparen, beleggingsrecht, kapitaalverzekering eigen woning) belongs in box 1 ([Belastingdienst 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_)). If the product doesn't (or no longer) meet the conditions, or you sell the home without buying a new one within three years, the value goes to box 3 ([Belastingdienst, saving for repaying your mortgage](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/woning/uw_hypotheek_of_lening/sparen_voor_de_aflossing_van_uw_hypotheek); from a search result). Example: Brand New Day's Hypotheekrekening-beleggen.

**Advice:** (d), with the account set to _not in box 3_ as long as it belongs in box 1, and switchable per year. Work S, prio 3.

## Route: the PDF annual statement

**Status (October 2026):** the basis has been built ([#14](https://github.com/zenonymous/box3balans/issues/14)). The browser reads the PDF with pdf.js and only sends the text ([ADR 0009](adr/0009-pdf-lezen-in-de-browser.md)); the server finds the values with a template (`TEMPLATES` in `server/src/import/yearStatement.ts`) or, without a template, the amounts next to a reference date or a word such as _beginwaarde_; the user ticks what goes into the table. The first template is ING's annual statement (current, savings and credit card accounts), built and tested with a real statement over 2025; a statement of several accounts is split per account, also without a template. The others are waiting for a text sample from a user (see the [README](../../README.en.md#annual-statement-as-pdf)). Adding a template is then work S.

### What it yields

| Provider                   | Document                           | What's in it                                                                       | Source                                                                                                                                                                                                                                       |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand New Day              | financial annual statement         | starting and end value, dividend, dividend tax                                     | [investment account information](https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf)                                                                                            |
| Brand New Day              | quarterly statement                | value per fund at start and end of quarter, deposits and withdrawals, transactions | same                                                                                                                                                                                                                                         |
| Peaks                      | annual statement                   | value on 1 January                                                                 | [exportformaten.md](exportformaten.md#5-peaks)                                                                                                                                                                                               |
| BLOX                       | annual statement                   | value of the vault on 1 January                                                    | [BLOX](https://support.weareblox.com/hc/nl/articles/31488885544721-Welk-jaaroverzicht-heb-ik-nodig-voor-mijn-belastingaangifte)                                                                                                              |
| Raisin                     | financial annual statement         | not stated                                                                         | [Raisin](https://www.raisin.com/nl-nl/sparen/financieel-jaaroverzicht/)                                                                                                                                                                      |
| Geldvoorelkaar             | annual statement                   | outstanding on 1 January and 31 December, invested, costs                          | [Geldvoorelkaar](https://www.geldvoorelkaar.nl/veelgestelde-vragen/investeerders/)                                                                                                                                                           |
| Lendahand                  | annual statement                   | outstanding loans, wallet balance separately                                       | [Lendahand](https://www.lendahand.com/en-EU/pages/crowdfunding-taxes)                                                                                                                                                                        |
| Mintos                     | tax report                         | opening and closing balance, interest, deposits and withdrawals                    | [Mintos](https://help.mintos.com/hc/en-us/articles/32061202728849-Tax-Report-Insights-Your-Quick-Guide)                                                                                                                                      |
| NPEX                       | tax annual statement               | value and position per instrument on 1 January and 31 December                     | [NPEX](https://www.npex.nl/jaarnota2025)                                                                                                                                                                                                     |
| Kapitaal Op Maat           | tax overview                       | interest received, total invested                                                  | [Kapitaal Op Maat](https://www.kapitaalopmaat.nl/Hoe-wordt-crowdfunding-belast)                                                                                                                                                              |
| ING                        | annual statement                   | per account the balances on 1 January and 31 December, the interest (recognised)   | tested with a real statement                                                                                                                                                                                                                 |
| Rabobank                   | investments annual statement       | value on 1 January (not verified)                                                  | [Rabobank](https://www.rabobank.nl/particulieren/beleggen/service/waar-staat-het-jaaroverzicht-beleggen)                                                                                                                                     |
| Computershare / EquatePlus | plan statement, holdings statement | positions per plan, transactions                                                   | [Computershare](https://images.info.computershare.com/Web/CMPTSHR1/%7B189d4c0d-b6f3-4ba6-bc09-ec194b9ccb6d%7D_Participant_Plan_Holdings_Statement.pdf)                                                                                       |
| Morgan Stanley             | quarterly statement                | purchases and positions (_SHARE PURCHASE AND HOLDINGS_)                            | [Portfolio Performance](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/MorganStanleyPDFExtractor.java)                                                    |
| Insurers                   | value statement                    | value on 1 January                                                                 | [Belastingdienst](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/vermogen/wat_zijn_uw_bezittingen_en_schulden/uw_bezittingen/niet_vrijgesteld_deel_kapitaalverzekeringen) |

Collin, Mogelijk, Finst, DuurzaamInvesteren, ING, ABN AMRO, Meesman and DEGIRO also have an annual statement, but what's in it wasn't found. Coinmerce drops out: only a screen in the app.

**Where it pays off:** at providers without CSV and without API, where the user now types over an amount every year. That's Brand New Day (over 360,000 clients alone, not all with free assets), Peaks, BLOX, the crowdfunding platforms and Mintos; for crowdfunding and crypto without a pre-filled tax return. Typing it over isn't hard; the benefit is in the source in the dossier (which PDF, which page), in a check per year and in picking up income and money in and out, which people now skip.

### What a reader needs

- **Text from the PDF, without network.** pdf.js (`pdfjs-dist`, Apache-2.0) gives text with positions. Only PDFs with a text layer; scans (OCR) not. _Built in the browser instead of on the server; see [ADR 0009](adr/0009-pdf-lezen-in-de-browser.md)._
- **A template per provider and document**, as data: how you recognise it (a fixed text such as "Financieel jaaroverzicht" plus the provider's name) and per field a label with a number pattern (for example "Beginwaarde" → amount to the right of it). Read Dutch numbers (`1.234,56`) with the existing `num(raw, ",")`.
- **A fallback without a template:** look for "1 januari" and amounts nearby, and let the user choose. Never save silently.
- **Always a preview screen**, as with the CSV import: the value found, the line from the PDF it comes from, and _Save_ only after confirmation. The dossier names the PDF and the page as the source.
- **What it fills:** _values per year_ (value on 1 January, and where the document gives it: income, money in and out), or a portfolio statement (c) if the document lists positions with ISIN and quantity (NPEX, EquatePlus, possibly Brand New Day's Q4 statement).
- **Privacy:** don't store the PDF, only the values found and the file name, or as an attachment like photos of precious metal; the owner has to decide on that.
- **Test files:** don't ask users for PDFs. Blacked-out text often stays readable in a PDF. Ask for the output of `pdftotext -layout file.pdf -`, with names, account numbers and amounts changed. The templates work on text, so the tests do too.
- **Licences:** Portfolio Performance has 142 PDF extractors, including Computershare, Morgan Stanley, E\*TRADE, Schwab, Fidelity, Bondora and Raisin Bank ([folder](https://github.com/portfolio-performance/portfolio/tree/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf)). That code is EPL-1.0, which can't be combined with AGPL-3.0: only read how the documents look, take nothing over.

**Work:** the basis (reading text, templates, preview screen, tests) is L; after that S per template, provided there's a text sample.

## Deliberately not

- **PSD2 via an aggregator** (Enable Banking, GoCardless and the like): your bank data then passes a third party; [ADR 0001](adr/0001-zelf-hosten.md) rules that out. A home installation can't have a PSD2 licence of its own. See also [degiro-koppeling.md](degiro-koppeling.md#3-psd2-the-cash-account).
- **The pre-filled tax return as a source:** the Belastingdienst only sends that data to a registered intermediary, via their accounting software ([Belastingdienst](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/aangifte_doen/praktische_informatie/gegevens_vooraf_ingevulde_aangifte_voor_uw_intermediair/)).
- **Logging in with a password:** BullionVault, DEGIRO, and the unofficial Meesman API ([ADR 0005](adr/0005-geen-inlog-koppelingen.md)).
- **Keys that can do more than read:** bunq (can pay), Freedom24 (can trade, no read permission found), E\*TRADE (OAuth with orders).
- **Wise API for Dutch accounts:** gives no balance statements.

## Not verified

- **Brand New Day:** whether the financial annual statement and the quarterly statement are PDFs and what they look like; whether the starting value is the value on 1 January; whether the quarterly statement mentions quantities; whether there's an app export or a public daily price per fund; how the Cashallocatie counts in box 3; that Ohpen isn't behind it (only derived from the annual report).
- **Revolut, Wise, N26:** all header rows come from open-source parsers, not from the providers; whether money-market funds are in the Revolut statement; how the Belastingdienst classifies balances at Wise and PayPal.
- **LYNX and Mexem:** that IBKR's Flex Web Service works with their accounts (only second-hand and derived).
- **eToro:** the type values in `Type` and how CFDs and sales appear in it.
- **Finst:** the columns of the Excel export and the content of the annual statement; whether old Anycoin history can be fetched at Finst.
- **BLOX, Bitonic, Coinmerce:** whether there's a transaction export the help centre doesn't mention; the content of the BLOX PDF; the columns of the Coinmerce CSV; whether Bitonic has an API for account data (only CoinLedger says so).
- **Bitpanda:** whether `/v1/operations` gives securities and metals with ISIN, and that `Read` really only reads.
- **Crypto.com:** the details of the app export (three years per report, 30 days) come from a search result.
- **Bybit:** that keys without an IP restriction expire after three months (only CoinLedger).
- **Binance:** whether Dutch accounts can still create API keys after July 2023.
- **Share plans:** all export formats come from open-source parsers (cgt-calc, SeFA, beancounttools), not from Schwab, Morgan Stanley or Fidelity; whether unvested RSUs and unexercised options fall outside box 3; the format of the EquatePlus statements; Computershare Investor Center's CSV export; Equiniti not researched.
- **Crowdfunding:** the content of the annual statements of Collin, Lendahand and Mogelijk; DuurzaamInvesteren (page loads with JavaScript); Invesdor not researched; the Mintos export as XLS (only forum).
- **Green investments:** the end date of the exemption (2027 or 2028; sources contradict each other); the data about the ASN Groenprojectenfonds come from search results.
- **Wealth management:** the content of the annual statements of Rabobank (403) and Van Lanschot; whether Evi still exists; the news reports about Ohpen clients.
- **Reach:** for most providers no reliable Dutch client numbers found (Revolut, Wise, eToro, BLOX, Bitpanda, Crypto.com, the share plans).
- **Other:** where N26, PayPal and Revolut Bank are established (common knowledge, not checked); that Mexem works via Interactive Brokers; Holland Gold's storage countries (from a search result); the Triodos explanation about the benefit over 2026 (the PDF couldn't be opened).

**Not researched yet:** Equiniti (EQ Shareview), Invesdor (ex-Oneplanetcrowd), Carta and Global Shares (share plans of unlisted and other employers), OKX and KuCoin, savings banks without a known export (NN Bank, NIBC, Santander, Ayvens), other precious-metal dealers with storage (such as The Silver Mountain), and the PayPal export.

## Sources

Box3balans:

- README, bank exports and recognised exports: [README.en.md](../../README.en.md)
- Earlier research: [exportformaten.md](exportformaten.md), [degiro-koppeling.md](degiro-koppeling.md), [box3-sources.md](box3-sources.md)
- Decisions: [ADR 0001](adr/0001-zelf-hosten.md), [ADR 0005](adr/0005-geen-inlog-koppelingen.md)
- Code: `server/src/import/bank.ts` (the bank import's headings), `server/src/import/statement.ts`, `server/src/import/formats/`

Belastingdienst, RVO and Rijksoverheid:

- Bezittingen en schulden box 3, 2026: https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_
- Niet-vrijgesteld deel kapitaalverzekeringen: https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/vermogen/wat_zijn_uw_bezittingen_en_schulden/uw_bezittingen/niet_vrijgesteld_deel_kapitaalverzekeringen
- Sparen voor de aflossing van uw hypotheek: https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/woning/uw_hypotheek_of_lening/sparen_voor_de_aflossing_van_uw_hypotheek
- Cryptobezittingen: https://www.belastingdienst.nl/wps/wcm/connect/nl/werk-en-inkomen/content/cryptovaluta
- Gegevens vooraf ingevulde aangifte voor uw intermediair: https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/aangifte_doen/praktische_informatie/gegevens_vooraf_ingevulde_aangifte_voor_uw_intermediair/
- RVO, green projects scheme and green funds: https://www.rvo.nl/subsidies-financiering/regeling-groenprojecten, https://www.rvo.nl/subsidies-financiering/regeling-groenprojecten/groenfondsen
- Rijksoverheid, green savings: https://rijksoverheid.nl/vraag-en-antwoord/duurzame-economie/groen-sparen-in-een-groenfonds

Brand New Day:

- Belangrijke informatie over uw beleggingsrekening (version 5 December 2024): https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf
- Annual statement FAQ: https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/
- Brand New Day Bank annual report 2025: https://new.brandnewday.nl/documenten/jaarverslag-2025-bnd-bank.pdf
- Savings deposit product terms: https://new.brandnewday.nl/documenten/productvoorwaarden-spaardeposito-revision-3.pdf
- Factsheet BND Wereld Indexfonds Unhedged: https://www.brandnewday.nl/content/app/pdf/documentencentrum/FactsheetsCollectief/BND-Wereld-Indexfonds-C-Unhedged.pdf
- Portfolio Performance forum (second-hand): https://forum.portfolio-performance.info/t/pdf-import-from-brand-new-day/31804
- IEXProfs about Ohpen (second-hand): https://www.iexprofs.nl/onbekend/54936/onbekend/Ohpen-is-nu-echt-open.aspx

Banks and fintechs:

- Revolut: https://help.revolut.com/nl-NL/help/app-features/flexible-accounts/difference-between-savings-and-flexible/, https://www.revolut.com/nl-NL/savings/open-a-savings-account/
- Wise: https://docs.wise.com/guides/developer/auth-and-security/personal-api-token.md, https://www.wise.com/nl/interest
- bunq: https://doc.bunq.com/basics/authentication/api-keys, https://help.bunq.com/articles/what-types-of-bank-statements-can-i-export, https://help.bunq.com/articles/how-do-i-export-my-annual-account-overview, https://help.bunq.com/articles/ginmon-our-bunq-stocks-partner
- Raisin: https://www.raisin.com/nl-nl/sparen/financieel-jaaroverzicht/, https://www.raisin.com/nl-nl/belasting/
- Ohpen: https://www.ohpen.com/; second-hand: https://www.banken.nl/nieuws/20613/de-volksbank-kiest-core-banking-platform-ohpen-voor-beleggingsdiensten, https://ibsintelligence.com/ibsi-news/de-volksbank-renews-core-banking-contract-with-ohpen/, https://www.ipe.com/news/tkp-to-outsource-investment-admin-for-dc-plans-to-ohpen/10043380.article

Brokers and wealth management:

- LYNX: https://www.lynx.nl/online-broker/interactive-brokers-lynx/, https://www.lynx.nl/beurs/beurs-koersen/beursinfo/beurs-nieuws-tips/beleggen-ai-chatgpt-claude/; Portfolio Dividend Tracker (second-hand): https://help-en.portfoliodividendtracker.com/article/269-download-your-lynx-actions
- eToro: https://help.etoro.com/s/article/what-is-the-etoro-account-statement?language=en_GB, https://www.etoro.com/nl/customer-service/regulation-license/
- Freedom24: https://freedom24.com/tradernet-api/auth-api; second-hand: https://www.tradesviz.com/blog/auto-import-freedom24/, https://forum.portfolio-performance.info/t/freedom24-import/18110/3, https://cyprus-mail.com/2024/09/26/online-broker-freedom24-reaches-300000-customers
- XTB (second-hand): https://trade.nl/broker/xtb/
- NN: https://www.nn.nl/Particulier/Beleggen/Beheerd-Beleggen/Kosten-Beheerd-Beleggen.htm, https://www.nn.nl/Particulier/Beleggen/Productvoorwaarden-Beheerd-Beleggen.htm
- a.s.r.: https://www.asr.nl/levensverzekering/sparen-beleggen, https://www.asrnederland.nl/-/media/files/asrnederland-nl/nieuws-en-pers/2020/20200115-persbericht-asr-en-van-lanschot-kempen-gaan-samenwerkingsovereenkomst-aan.pdf
- Rabobank (403; content from a search result): https://www.rabobank.nl/particulieren/beleggen/service/waar-staat-het-jaaroverzicht-beleggen
- Second-hand: https://www.vermogensbeheer.nl/nieuws/semmie-neemt-index-capital-over, https://www.banken.nl/nieuws/amp/24333/van-lanschot-kempen-neemt-online-beleggingsplatform-robeco-over, https://www.financieelonafhankelijkblog.nl/centraal-beheer-beleggen-review-en-ervaringen

Crypto:

- BLOX: https://support.weareblox.com/hc/nl/articles/25982426553617-Waar-kan-ik-mijn-jaaroverzicht-vinden, https://support.weareblox.com/hc/nl/articles/31488885544721-Welk-jaaroverzicht-heb-ik-nodig-voor-mijn-belastingaangifte, https://support.weareblox.com/hc/nl/articles/44505422300817-Welke-informatie-wordt-gedeeld, https://support.weareblox.com/hc/nl/articles/44505479681041-Vanaf-wanneer-geldt-DAC8-voor-mijn-transacties, https://support.weareblox.com/hc/nl/articles/40656130782737-Ontvang-ik-een-factuur-van-de-Beheer-kosten, https://weareblox.com/nl-nl/blox-verkrijgt-micar-licentie (the help centre read via the public Zendesk API)
- Finst: https://help.finst.com/nl/article/hoe-kan-ik-mijn-transactiegeschiedenis-downloaden-1n7971t/, https://help.finst.com/nl/article/biedt-finst-een-jaarlijks-belastingrapportoverzicht-1xai8v8/, https://help.finst.com/nl/article/biedt-finst-api-trading-aan-1l8kyfy/, https://finst.com/nl/blog/articles/finst-and-anycoin-direct-join-forces
- Anycoin Direct (second-hand): https://intercom.help/blockpit/de/articles/12136922-wie-importiere-ich-daten-mittels-anycoin-direct-csv-excel-datei, https://cointracking.info/imports/anycoin-tax/
- Bitonic: https://bitonic.nl/nl/faq, https://bitonic.nl/nl/api, https://bitonic.nl/nl/news/301/bl3p-definitief-offline, https://bitonic.nl/nl/news/298/bitonic-ontvangt-micar-vergunning-van-de-autoriteit-financiele-markten; CoinLedger (second-hand): https://coinledger.io/de/integrations/bitonic
- Coinmerce: https://support.coinmerce.io/en/articles/209223-annual-overview, https://support.coinmerce.io/en/articles/178418-how-is-my-crypto-taxed, https://support.coinmerce.io/en/articles/179087-general-terms-and-conditions; Waltio (second-hand): https://help.waltio.com/en/articles/5837160-coinmerce-file
- Bitpanda: https://docs.public.bitpanda.com/, https://docs.public.bitpanda.com/migrating-from-the-legacy-api, https://support.bitpanda.com/hc/en-gb/articles/360000122759-How-can-I-download-the-history-of-my-Bitpanda-account, https://support.bitpanda.com/hc/nl/articles/18668973207580-Belastingrapporten-bekijken-en-begrijpen, https://support.bitpanda.com/hc/nl/articles/5771948622364-Bitpanda-Grondstoffen
- Crypto.com: https://help.crypto.com/en/articles/3438579-how-do-i-export-my-transaction-history-app
- Bybit: https://bybit-exchange.github.io/docs/v5/guide; second-hand: https://help.coinledger.io/en/articles/6588913-bybit-api-import-guide, https://financemagnates.com/cryptocurrency/exchange/mexc-to-offboard-dutch-users-recommends-bybit-as-micar-compliant-alternative/
- Binance: https://www.binance.com/en/support/announcement/notice-on-changes-of-services-in-the-netherlands-b5a647be31cf469b87fc3337fd461ced
- Bitstamp: https://www.bitstamp.net/api/
- rotki: https://docs.rotki.com/usage-guides/integrations/exchange-keys, https://rotki.com/integrations/bitstamp, https://rotki.com/integrations/bybit, https://rotki.com/integrations/binance

Crowdfunding and P2P:

- Geldvoorelkaar: https://www.geldvoorelkaar.nl/veelgestelde-vragen/investeerders/, https://www.geldvoorelkaar.nl/over-ons/statistiekpagina/
- Collin: https://www.collincrowdfund.nl/veelgestelde-vragen/, https://www.collincrowdfund.nl/nieuwsbrief-collin-doorkruist-de-grens-van-300-miljoen/
- Lendahand: https://www.lendahand.com/en-EU/pages/crowdfunding-taxes
- Mogelijk: https://www.mogelijk.nl/faq/jaaroverzichten
- Kapitaal Op Maat: https://www.kapitaalopmaat.nl/Hoe-wordt-crowdfunding-belast
- DuurzaamInvesteren (content from a search result): https://www.duurzaaminvesteren.nl/over-duurzaaminvesteren/belastingopgave-2025
- NPEX: https://www.npex.nl/jaarnota2025
- Mintos: https://help.mintos.com/hc/en-us/articles/32061202728849-Tax-Report-Insights-Your-Quick-Guide, https://help.mintos.com/hc/en-us/articles/43210112798225-When-will-my-2025-tax-report-be-available, https://help.mintos.com/hc/en-us/articles/33872886368401-How-can-I-access-my-account-statement, https://help.mintos.com/hc/en-us/articles/7220945828113-What-is-an-API; forum (second-hand): https://forum.portfolio-performance.info/t/unterstuetzung-von-p2p-anbietern-wie-mintos/5511
- Go & Grow: https://help.goandgrow.eu/hc/en-us/articles/34275456362898-How-to-generate-statements-and-tax-reports

Green investments:

- Triodos: https://www.triodos-im.com/binaries/content/assets/shared/fund-assets/tim/tgf/toelichting-wijziging-prospectus-triodos-groenfonds-nv-per-1-april-2026.pdf, https://www.triodos-im.com/articles/2026/triodos-groenfonds-becomes-even-more-impactful
- ASN (from search results): https://beleggingsfondsen.asnbank.nl/overig/downloads/faq-asn-impact-investors.html, https://beleggingsfondsen.asnbank.nl/overig/downloads/toelichting-openen-asn-groenprojectenfonds-februari-2025.html

Share plans:

- Morgan Stanley: https://www.morganstanley.com/cs/pdf/et_account_management_etrade_com_non_us_english.pdf, https://www.morganstanley.com/atwork/employees/msad-to-etrade
- E\*TRADE API: https://apisb.etrade.com/docs/api/account/api-account-v1.html
- Computershare: https://images.info.computershare.com/Web/CMPTSHR1/%7B189d4c0d-b6f3-4ba6-bc09-ec194b9ccb6d%7D_Participant_Plan_Holdings_Statement.pdf, https://content-assets.computershare.com/eh96rkuu9740/2R1Z53p8y8ZnwyX1UvX6wZ/dc632ce060e118ffbdc60d10a44d375c/EquatePlus-Release-70-Notes-EQX.pdf, https://www.nasdaq.com/press-release/computershare-to-buy-european-public-equity-employee-share-plan-business-from; an issuer's FAQ (second-hand): https://s202.q4cdn.com/481442212/files/doc_downloads/2026/PKST-Website-FAQ-6-19-26-vFinal.pdf
- cgt-calc: https://cgt-calc.uk/brokers/schwab/, https://cgt-calc.uk/brokers/morgan-stanley/

Precious metal:

- BullionVault: https://www.bullionvault.com/help/xml_api.html
- Holland Gold: https://www.hollandgold.nl/en/faq/opslag/is-the-precious-metal-i-hold-with-holland-gold-safe-fully-owned-by-me-and-exclusively-allocated/

Open-source projects (code and test files read, nothing copied):

- capital-gains-calculator (cgt-calc), **MIT**: https://github.com/KapJI/capital-gains-calculator (`cgt_calc/parsers/schwab_equity_award_json.py`, `mssb.py`)
- SeFA, **MIT**: https://github.com/atulgpt/SeFA/blob/main/src/sefa/parser/demat/etrade/README.md
- beancounttools, **MIT**: https://github.com/tarioch/beancounttools/blob/master/src/tariochbctools/importers/netbenefits/importer.py
- revolut-toolkit, **MIT**: https://github.com/lastunicorn/revolut-toolkit
- you-need-a-parser, **MIT**: https://github.com/leolabs/you-need-a-parser/blob/master/packages/ynap-parsers/src/de/n26/n26.ts
- ledger-autosync, **GPL-3.0**: https://github.com/egh/ledger-autosync/blob/master/examples/plugins/wise.py
- Export-To-Ghostfolio, **Apache-2.0**: https://github.com/dickwolff/Export-To-Ghostfolio (`samples/` and `src/converters/` for Crypto.com, eToro, Schwab, XTB)
- BittyTax, **AGPL-3.0**: https://github.com/BittyTax/BittyTax/tree/master/src/bittytax/conv/parsers (Binance, Bitpanda, Bitstamp, Bybit, Crypto.com, PayPal)
- rotki, **AGPL-3.0**: https://github.com/rotki/rotki/tree/develop/rotkehlchen/exchanges and https://github.com/rotki/rotki/tree/develop/rotkehlchen/data_import/importers
- Portfolio Performance, **EPL-1.0**: https://github.com/portfolio-performance/portfolio/tree/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf

Not found: an importer for Brand New Day, Finst, BLOX, Bitonic, Coinmerce or any of the Dutch crowdfunding platforms, in any open-source project (searched on GitHub, in the lists of rotki, BittyTax, Export-To-Ghostfolio and Portfolio Performance).
