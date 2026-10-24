# Updating DEGIRO automatically: what's possible?

_Nederlands: [degiro-koppeling.md](../degiro-koppeling.md)_

Researched on 11 October 2026. DEGIRO's own pages and agreement are in Dutch; their titles are kept as they are.

**In short:** DEGIRO has no official API. There's also no read-only key, and no token like Interactive Brokers' Flex Web Service. The client agreement forbids scripts and APIs within the trading platform, and also sharing your login details with anyone. Every automatic connection that does exist logs in with your user name and password, and those give full trading rights. That applies to the open-source libraries, to SnapTrade and getquin, and according to a search result also to Delta (the page itself couldn't be opened). The unofficial webtrader API has broken at least six times since December 2022. PSD2 doesn't help: it only covers money, and the cash account at flatexDEGIRO is probably not a payment account.

**Advice:** don't build a connection that logs in. Improve the route with exports:

- Read the _Portefeuille_ (portfolio) export on a chosen date (31 December) as the position on the reference date and as a check on the transactions.
- Keep the account statement (Account.csv) as the source for buys, sells and dividend.
- Two files per year, in January, cover what box 3 needs.

A connection through the webtrader API at most as an experiment: password typed in each time, login approved in the DEGIRO app, never stored. See [7](#7-advice-for-box3balans).

## 1. Official API

- **No API for private clients.** The help centre has no article about an API or third-party apps ([help centre](https://www.degiro.nl/helpdesk/)). flatexDEGIRO's investor-relations page mentions no API or connections for clients ([flatexDEGIRO IR](https://www.flatexdegiro.com/investor-relations)). SnapTrade, which does open up DEGIRO, writes itself that DEGIRO has no public API for developers ([SnapTrade](https://snaptrade.com/brokerage-integrations/degiro-api)).
- **What the client agreement says** (_Cliënt Overeenkomst_, footer version 20220830, PDF fetched on 11 October 2026; [PDF](https://www.degiro.nl/data/pdf/Voorwaarden_Beleggingsdiensten.pdf)):
  - **Geautomatiseerde Instrumenten** (automated instruments) are, according to the definitions, among other things automated queries, scripts and an "application programming interface". **Art. 5.6** forbids them within the trading platform. If DEGIRO sees them, it can block the queries, the activities and the account.
  - **Art. 5.5 and 7.5:** no algorithmic trading and no automated orders. Anyone who wants to trade automatically contacts DEGIRO first.
  - **Art. 3.2:** only the client may use the Toegangscode (access code: user name plus password or biometrics).
  - **Art. 7.2.1:** never disclose the Toegangscode to anyone, not even to DEGIRO staff. Any use by third parties counts as unauthorised and isn't allowed. On a reasonable suspicion DEGIRO blocks the account.
  - **Art. 7.2.2:** after seven wrong passwords there's a block only DEGIRO can lift.
- **No power of attorney.** Only the account holder may manage the account ([help centre: power of attorney](https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/kan-ik-een-volmacht-geven-voor-mijn-account)).

**Consequence:** an aggregator that logs in with your password is a third party within the meaning of art. 7.2.1. Box3balans runs at the owner's own place, so that provision is less clear there. A script that fetches data does fall under art. 5.6.

## 2. The unofficial webtrader API

The webtrader and the app talk to `trader.degiro.nl`. Four libraries imitate that:

| Library                                                                       | Language   | Latest release                                                          | Login                            |
| ----------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- | -------------------------------- |
| [Chavithra/degiro-connector](https://github.com/Chavithra/degiro-connector)   | Python     | 3.0.36, 26 May 2026                                                     | password + TOTP or in-app        |
| [OhMajesticLama/degiroasync](https://github.com/OhMajesticLama/degiroasync)   | Python     | 1.1.0, 27 June 2026                                                     | password + TOTP                  |
| [icastillejogomez/degiro-api](https://github.com/icastillejogomez/degiro-api) | TypeScript | 1.0.6, 14 May 2026 (only a User-Agent fix; before that 1.0.4 from 2021) | password + TOTP, or a session ID |
| [lolokraus/DegiroAPI](https://github.com/lolokraus/DegiroAPI) (`degiroapi`)   | Python     | 0.9.5, June 2020                                                        | quiet since 2022                 |

Release dates from [PyPI](https://pypi.org/project/degiro-connector/) and [npm](https://www.npmjs.com/package/degiro-api).

**Logging in** ([action_connect.py](https://github.com/Chavithra/degiro-connector/blob/main/src/degiro_connector/trading/actions/action_connect.py), [connection.py](https://github.com/Chavithra/degiro-connector/blob/main/examples/trading/connection.py)):

- User name and password go in a POST to `/login/secure/login`. With an authenticator app, a TOTP code also goes to `/login/secure/login/totp`. The library can generate that code itself from the TOTP secret.
- Without an authenticator, DEGIRO responds with an `inAppToken`. The client then asks again via `/login/secure/login/in-app` every 5 seconds, until you tap Yes in the app. This was added in September 2025 ([PR #184](https://github.com/Chavithra/degiro-connector/pull/184)).
- None of the libraries supports an SMS code ([#164](https://github.com/Chavithra/degiro-connector/issues/164)).
- After too many failed attempts DEGIRO asks for a captcha, which you have to solve in the browser ([PR #183](https://github.com/Chavithra/degiro-connector/pull/183)).
- **What DEGIRO says:** logging in on a new device needs the password plus a second step: a notification in the app (default), an SMS code or a code from an authenticator app ([help centre: logging in](https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/ik-heb-hulp-nodig-om-te-loggen-op-mijn-account), [two-step verification](https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/toegang-tot-uw-degiro-account/wat-twee-stapsverificatie)).

**Session:**

- The login gives a `sessionId` (JSESSIONID). The account number `intAccount` comes from `/pa/secure/client`. Both go along with every request.
- How long a session lives isn't documented by DEGIRO. degiro-connector assumes 30 minutes without use ([README §3.8](https://github.com/Chavithra/degiro-connector#38-is-there-a-timeout-)). Not verified.

**Endpoints Box3balans would need** ([urls.py](https://github.com/Chavithra/degiro-connector/blob/main/src/degiro_connector/core/constants/urls.py)):

- **Positions now:** `trading/secure/v5/update/{intAccount};jsessionid=…` with `portfolio=0`.
- **Positions on a date:** `portfolio-reports/secure/v3/positionReport/{csv|xls|pdf|html}` with `toDate`. This seems to be the _Portefeuille_ export ([action_get_position_report.py](https://github.com/Chavithra/degiro-connector/blob/main/src/degiro_connector/trading/actions/action_get_position_report.py)).
- **Transactions:** `portfolio-reports/secure/v4/transactions` (JSON, from–to).
- **Cash movements, including dividend:** `portfolio-reports/secure/v6/accountoverview` (JSON). The same as a file: `portfolio-reports/secure/v3/cashAccountReport/{format}`.
- **Product data with ISIN:** `product_search/secure/v5/products/info`, by product ID.

That the CSVs from these endpoints equal Portfolio.csv and Account.csv is obvious but not verified.

**Without a stored password?** None of the libraries knows a long-lived token or a refresh token. The TypeScript library can work with only an existing session ID ([PR #21](https://github.com/icastillejogomez/degiro-api/pull/21), January 2021). Then you copy it from your browser, and it expires with the session. Approval in the app makes a stored TOTP secret unnecessary, but the password is still needed for every login.

**How often it broke:**

- **December 2022:** bot detection blocks Python's default User-Agent ("python_bot"). The fix is a browser User-Agent ([DegiroAPI #61](https://github.com/lolokraus/DegiroAPI/issues/61), [#107](https://github.com/Chavithra/degiro-connector/issues/107)).
- **January 2023:** error code 429 (too many requests) on repeated logins; after waiting 15 minutes it works again for a while ([#110](https://github.com/Chavithra/degiro-connector/issues/110)).
- **Mid-March 2024:** Myra's firewall blocks requests without a User-Agent. The TypeScript library only worked again in May 2026 ([#57](https://github.com/icastillejogomez/degiro-api/issues/57), [v1.0.5](https://github.com/icastillejogomez/degiro-api/commits/master)).
- **June 2024:** the reporting endpoints move from `/reporting/` to `/portfolio-reports/` (502 Bad Gateway). Fixed within a few days ([#147](https://github.com/Chavithra/degiro-connector/issues/147)).
- **August 2024:** a user reports that two-step verification becomes mandatory from September ([DegiroAPI #64](https://github.com/lolokraus/DegiroAPI/issues/64)). That's second-hand: DEGIRO's own pages don't put it that way.
- **December 2024:** a question whether DEGIRO blocks Google Cloud IP addresses. The login returned HTML instead of JSON. Unanswered ([#161](https://github.com/Chavithra/degiro-connector/issues/161)).
- **March 2025:** endpoints move to `/secure` ([PR #168](https://github.com/Chavithra/degiro-connector/pull/168)).
- **August–September 2025:** approval in the app and the captcha need changes. Product search goes from v5 to v1, with intermittent 404s; that issue is still open ([#188](https://github.com/Chavithra/degiro-connector/issues/188)).
- **February–June 2026:** degiroasync 1.0.0 mentions a "DEGIRO API overhaul", including for logging in ([CHANGELOG](https://github.com/OhMajesticLama/degiroasync/blob/main/CHANGELOG.md)).

**Maintenance:**

- **degiro-connector:** the liveliest, but slow. Last commit May 2026, 22 open issues and pull requests.
- **degiroasync:** small (4 stars), but maintained.
- **The TypeScript library:** looking for maintainers since August 2024 ([#59](https://github.com/icastillejogomez/degiro-api/issues/59)).

## 3. PSD2: the cash account

- **The interface exists.** flatexDEGIRO publishes a PSD2 interface (XS2A) with consents, accounts, balances and transactions ([specification](https://s206.q4cdn.com/770226284/files/doc_downloads/2026/05/Characteristic-XS2A-interface-of-the-FTX-Bank.pdf)). According to the document, what you can fetch follows from what you can do in online banking. Dutch clients manage their cash account through DEGIRO's platform (art. 10.3.1 of the agreement). Whether this interface includes the DEGIRO cash accounts of Dutch clients isn't verified.
- **Probably not a payment account.**
  - According to art. 10.3.1 the cash account serves exclusively as a clearing account for securities transactions. Money only goes to and from the linked bank account (art. 8.1).
  - flatexDEGIRO Bank's general FAQ (not specific to DEGIRO) says cash accounts aren't meant as payment accounts ([FAQ](https://flatexdegiro.com/English/bank-se/bank-se-faqs)).
  - The Court of Justice ruled that an account from which money can only leave via another account isn't a payment account ([C-191/17](https://eur-lex.europa.eu/legal-content/NL/TXT/?uri=CELEX:62017CJ0191)).
  - PSD2 only gives account information services access to payment accounts ([PSD2, art. 67](https://eur-lex.europa.eu/eli/dir/2015/2366/oj)).
- **No aggregator found that lists DEGIRO for the Netherlands.**
  - **Enable Banking:** the market pages for the Netherlands and Germany don't mention DEGIRO or flatex ([NL](https://enablebanking.com/docs/markets/nl/), [DE](https://enablebanking.com/docs/markets/de/)). Linking your own accounts in a restricted mode is possible ([Control Panel](https://enablebanking.com/docs/api/control-panel/), [FAQ](https://enablebanking.com/docs/faq/)).
  - **GoCardless Bank Account Data:** its own documentation reports no stop ([docs](https://docs.gocardless.com/bank-account-data/overview)). Actual Budget's documentation says GoCardless hasn't accepted new accounts since July 2025 ([Actual Budget](https://actualbudget.org/docs/advanced/bank-sync/gocardless/)). That's second-hand.
  - **Finanzfluss Copilot:** imports DEGIRO accounts at the German branch (BIC BIWBDE33XXX) automatically, but reports that this isn't possible for clients of the Dutch Branch ([Finanzfluss](https://www.finanzfluss.de/copilot/hilfe/fehlerhafter-datenabgleich-flatex-degiro/)).
- **Even if it worked:** PSD2 only gives the cash balance and cash movements, no securities.

## 4. Aggregators for securities

- **SnapTrade** lists DEGIRO as "Read Only" and directly available ([Broker Access Guide](https://docs.snaptrade.com/docs/broker-access-guide)).
  - You type your DEGIRO login details into SnapTrade's portal. Trading isn't possible ([DEGIRO page](https://snaptrade.com/brokerage-integrations/degiro-api)). How SnapTrade handles DEGIRO's two-step verification isn't verified.
  - You get positions, balances and activities; activities are updated once a day ([Account Data](https://docs.snaptrade.com/docs/account-data)).
  - **Personal** is now free for those linking their own accounts. You get one client ID with a consumer key and link the broker in SnapTrade's dashboard ([Personal vs Commercial](https://docs.snaptrade.com/docs/personal-vs-commercial)). Commercial: _Build_ free up to 5 connections, _Launch_ $100 per month plus $1–2 per user ([pricing](https://snaptrade.com/pricing)).
- **Plaid Investments:** only the United States and Canada ([Plaid](https://plaid.com/docs/investments/)).
- **finAPI:** commercial, in 13 countries including the Netherlands. Securities accounts go through the German FinTS, with web scraping as a fallback; you only get the list of banks on request ([coverage](https://www.finapi.io/en/products/country-coverage/)). The pricing page mentions monthly licences from €60 and a scheme for own use (at most 10 own accounts) whose price isn't clear ([pricing](https://www.finapi.io/en/prices/)). DEGIRO Netherlands: not found.
- **wealthAPI:** commercial, BaFin licence as an account information service. The home page doesn't mention DEGIRO ([wealthAPI](https://wealthapi.eu/en/)).
- **Tink:** has a product for investments, but doesn't mention the Netherlands or DEGIRO ([Tink Investments](https://tink.com/products/investments)).
- **Yodlee and Salt Edge:** no DEGIRO found. Not verified.
- **Powens:** listed by Open Banking Tracker as an aggregator for DEGIRO B.V. ([tracker](https://openbankingtracker.com/powens/degiro-bv)). That's second-hand; not confirmed on Powens's own pages.

**For Box3balans:** only SnapTrade Personal fits technically: a token, read-only, free. But your DEGIRO password then sits with an external party, which art. 7.2.1 explicitly forbids. And your portfolio goes through the cloud, while the ROADMAP says the point is data staying at home.

## 5. How other trackers do it

- **Portfolio Performance:** PDF import of the account statement, the transaction overview and dividend notes ([DegiroPDFExtractor.java](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/DegiroPDFExtractor.java)). No API.
- **Parqet:** PDF import of Transactions.pdf and Account.pdf ([blog, updated 14 December 2023](https://parqet.com/en/blog/degiro)). Autosync doesn't mention DEGIRO ([Autosync, August 2024](https://parqet.com/en/blog/autosync)).
- **getquin:** "automatic connection via Open Banking", for which you enter your login details ([help](https://help.getquin.com/en/articles/9711631-degiro)). Through which partner isn't stated.
- **Snowball Analytics:** CSV import of the Transactions ([help](https://help.snowball-analytics.com/import-degiro/)). An automatic DEGIRO connection isn't verified.
- **Sharesight:** CSV import of the Transactions, and forwarding the transaction confirmation emails ([Sharesight](https://www.sharesight.com/eu/partners/degiro)).
- **Ghostfolio:** no DEGIRO code in the source, only its own CSV/JSON import ([import-activities.service.ts](https://github.com/ghostfolio/ghostfolio/blob/main/apps/client/src/app/services/import-activities.service.ts)). The community project Export-To-Ghostfolio converts DEGIRO's account statement ([README](https://github.com/dickwolff/Export-To-Ghostfolio)).
- **Delta:** the help page gave a 403. According to the search engine snippet, Delta asks for user name, password and the app's 5-digit PIN ([Delta](https://support.delta.app/en/articles/10471165-connecting-degiro-broker)). Second-hand.
- **Kubera:** nothing found.

**Pattern:** the trackers that care about reliability work with files. A "connection" always goes through your login details.

## 6. Exports: what DEGIRO offers and what Box3balans does with them

According to the help centre ([reports](https://www.degiro.nl/helpdesk/belasting/welke-rapportagemogelijkheden-zijn-er-en-waar-kan-ik-de-rapportages-vinden)):

- **Portefeuille (portfolio):** your open positions on a date you choose, at the last closing price. As CSV, XLS or PDF. **A historical date is possible**, so 31 December too.
- **Transacties (transactions):** buys and sells over a period you choose (a month by default). As CSV, Excel or PDF.
- **Rekeningoverzicht (account statement):** all movements, including dividend and dividend tax. Same periods and formats.
- **Jaaropgaven (annual statements):** the tax annual statement and a costs and charges overview, as PDF under _Inbox → Documenten_. DEGIRO aims to have them ready before the tax-return period ([annual statement](https://www.degiro.nl/helpdesk/belasting/waar-kan-ik-de-jaaropgave-vinden)). According to art. 8.4, statements only come electronically, via the platform and/or email. What exactly is in them (such as the value on 1 January) the help centre doesn't say.
- **Cash account:** a PDF every quarter.

**By email** only a confirmation per executed order comes in. You turn it on or off under _Instellingen → Notificaties → Terugmelden orderstatus_ ([help centre](https://www.degiro.nl/helpdesk/orders/ontvang-ik-een-bevestiging-als-mijn-order-uitgevoerd)). The format isn't mentioned. I haven't found an export DEGIRO emails automatically.

A user reported in 2024 that the account statement exported at most three months at a time ([#147](https://github.com/Chavithra/degiro-connector/issues/147)). That's not verified.

**What the importer does now** (`server/src/import/formats/degiro.ts`):

- **Account statement:** buys and sells with costs (on the first execution of an order), and dividend with dividend tax. It skips:
  - deposits, currency exchange and interest;
  - connection fees;
  - "other lines" such as corporate actions and product changes. Splits, ISIN changes and mergers are therefore missing.
  - It counts costs in another currency as euros.
- **Transactions:** only buys and sells.
- **No Portfolio.csv.** So there's no position on the reference date, no check whether the transactions add up to what DEGIRO says, and no starting position if the history is incomplete.
- **It doesn't track the money on the cash account**, while for box 3 that's a bank balance.
- **Not yet tested with real exports** ([#6](https://github.com/zenonymous/box3balans/issues/6)).

Sample files in open-source projects show for Portfolio.csv the columns _Product, Symbool/ISIN, Aantal, Slotkoers, Lokale waarde, (valuta), Waarde in EUR_, with a line "CASH & CASH FUND & FTX CASH (EUR)" ([sample](https://github.com/ArthurHNL/stock-buy-script/blob/main/Portfolio_dummy.csv)). That's second-hand: get a real file before building on it.

## 7. Advice for Box3balans

| Option                        | Rights                           | Terms risk                                    | Fragility | Work                             |
| ----------------------------- | -------------------------------- | --------------------------------------------- | --------- | -------------------------------- |
| 1. Better import of exports   | none                             | none                                          | low       | small to medium                  |
| 2. Webtrader API, on request  | full trading during the session  | art. 5.6 (scripts), block possible            | high      | medium, plus ongoing maintenance |
| 3. SnapTrade Personal         | read-only, password with a third | art. 7.2.1 (third parties), explicitly banned | medium    | medium                           |
| 4. PSD2 or confirmation mails | read-only                        | low                                           | medium    | medium, and yields little        |

**1. Making better use of exports (recommended).**

- **Read Portfolio.csv as the position on a date.** Positions per ISIN on 31 December, compared with the sum of the imported transactions. Differences go to the attention list, with the offer to book a starting position or correction. The CASH line can fill the bank balance at DEGIRO on that date.
- **Corporate actions in the account statement** at least recognised and clearly reported.
- **A January routine in the app:** "export _Portefeuille_ on 31-12 and the _Rekeningoverzicht_ for the year".
- **Trade-off:** no password, no risk with the terms. Tested with fixed files, without network, as now.

**2. Webtrader API, only as an experiment and only on request.**

- **This is how it would work:** you type the password each time, approve the login in the app, and Box3balans fetches `positionReport` (31-12 and today) and `cashAccountReport` as CSV. Those go through the existing parsers. Then log out, store nothing.
- **Objections:**
  - During the session the app has full trading rights, and the password goes through the server.
  - It falls under the ban on scripts (art. 5.6), with a risk of a block.
  - It broke at least six times in four years: firewall, captcha, moved endpoints.
  - It can't be tested against DEGIRO itself.
  - It saves two downloads a year.
- **Never:** storing the password plus TOTP secret for an unattended sync. Then full access sits in the app and two-step verification is bypassed.

**3. SnapTrade Personal (not recommended).** Technically it resembles the IBKR connection: a key, read-only, free. But your DEGIRO password sits with an external party, your data goes through the cloud, and how SnapTrade handles DEGIRO's two-step verification is unknown.

**4. PSD2 or confirmation mails (don't).** PSD2 gives at most the money and doesn't seem to exist here. The mails only cover transactions, in an unknown format.

**Proposal for the ROADMAP**, under _Deliberately not_: "Logging in to brokers without an official API, such as DEGIRO."

## Not verified

- Whether flatexDEGIRO's PSD2 interface includes the DEGIRO cash accounts of Dutch clients, and whether an aggregator offers them.
- How long a DEGIRO session lives, and whether a server counts as a new device on every login.
- Whether `positionReport` and `cashAccountReport` produce exactly Portfolio.csv and Account.csv.
- The contents of the tax annual statement.
- How SnapTrade, getquin and Delta handle two-step verification, and which partner getquin uses.
- DEGIRO support at Yodlee, Salt Edge, Powens and Kubera.
- That GoCardless no longer accepts new accounts (second-hand only).

## Sources

DEGIRO and flatexDEGIRO:

- Cliënt Overeenkomst / Voorwaarden Beleggingsdiensten (art. 3.2, 5.5, 5.6, 7.2, 7.5, 8.1, 8.4, 10.3): https://www.degiro.nl/data/pdf/Voorwaarden_Beleggingsdiensten.pdf
- Help centre: https://www.degiro.nl/helpdesk/
- Reports: https://www.degiro.nl/helpdesk/belasting/welke-rapportagemogelijkheden-zijn-er-en-waar-kan-ik-de-rapportages-vinden
- Annual statement: https://www.degiro.nl/helpdesk/belasting/waar-kan-ik-de-jaaropgave-vinden
- Order confirmation by email: https://www.degiro.nl/helpdesk/orders/ontvang-ik-een-bevestiging-als-mijn-order-uitgevoerd
- Logging in and two-step verification: https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/ik-heb-hulp-nodig-om-te-loggen-op-mijn-account and https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/toegang-tot-uw-degiro-account/wat-twee-stapsverificatie
- Power of attorney: https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/kan-ik-een-volmacht-geven-voor-mijn-account
- flatexDEGIRO investor relations: https://www.flatexdegiro.com/investor-relations
- XS2A specification: https://s206.q4cdn.com/770226284/files/doc_downloads/2026/05/Characteristic-XS2A-interface-of-the-FTX-Bank.pdf
- FAQ flatexDEGIRO Bank: https://flatexdegiro.com/English/bank-se/bank-se-faqs

Libraries (source, issues, releases):

- degiro-connector: https://github.com/Chavithra/degiro-connector (PyPI: https://pypi.org/project/degiro-connector/)
- degiroasync: https://github.com/OhMajesticLama/degiroasync
- degiro-api (TypeScript): https://github.com/icastillejogomez/degiro-api (npm: https://www.npmjs.com/package/degiro-api)
- DegiroAPI / `degiroapi`: https://github.com/lolokraus/DegiroAPI

Law:

- Court of Justice, C-191/17: https://eur-lex.europa.eu/legal-content/NL/TXT/?uri=CELEX:62017CJ0191
- PSD2 (Directive 2015/2366): https://eur-lex.europa.eu/eli/dir/2015/2366/oj

Aggregators:

- SnapTrade: https://snaptrade.com/brokerage-integrations/degiro-api, https://docs.snaptrade.com/docs/broker-access-guide, https://docs.snaptrade.com/docs/account-data, https://docs.snaptrade.com/docs/personal-vs-commercial, https://snaptrade.com/pricing
- Plaid: https://plaid.com/docs/investments/
- finAPI: https://www.finapi.io/en/products/country-coverage/, https://www.finapi.io/en/prices/
- wealthAPI: https://wealthapi.eu/en/
- Tink: https://tink.com/products/investments
- Enable Banking: https://enablebanking.com/docs/markets/nl/, https://enablebanking.com/docs/markets/de/, https://enablebanking.com/docs/api/control-panel/, https://enablebanking.com/docs/faq/
- GoCardless: https://docs.gocardless.com/bank-account-data/overview
- Actual Budget about GoCardless (second-hand): https://actualbudget.org/docs/advanced/bank-sync/gocardless/
- Open Banking Tracker about Powens (second-hand): https://openbankingtracker.com/powens/degiro-bv

Trackers:

- Portfolio Performance: https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/DegiroPDFExtractor.java
- Parqet: https://parqet.com/en/blog/degiro, https://parqet.com/en/blog/autosync
- getquin: https://help.getquin.com/en/articles/9711631-degiro
- Snowball Analytics: https://help.snowball-analytics.com/import-degiro/
- Sharesight: https://www.sharesight.com/eu/partners/degiro
- Ghostfolio: https://github.com/ghostfolio/ghostfolio
- Export-To-Ghostfolio: https://github.com/dickwolff/Export-To-Ghostfolio
- Delta (couldn't be opened, 403): https://support.delta.app/en/articles/10471165-connecting-degiro-broker
- Finanzfluss Copilot: https://www.finanzfluss.de/copilot/hilfe/fehlerhafter-datenabgleich-flatex-degiro/
