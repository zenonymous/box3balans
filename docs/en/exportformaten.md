# Broker export formats Box3balans doesn't read yet

_Nederlands: [exportformaten.md](../exportformaten.md)_

Researched on 13 October 2026. Most sources are Dutch; their titles are kept as they are.

**In short:** of the seven providers from phase G, two can be built now: **Lightyear** and **Scalable Capital**. For both, the column headings are known from several independent sources. **ING** has a CSV export of transactions and of the portfolio, but the columns aren't public anywhere: that needs a sample file. **Meesman** exports to Excel, with unknown columns. **ABN AMRO** has no export of securities transactions. Purchases and payouts only appear as rows on the linked bank account, and that one you can download as a TAB file. **Brand New Day** and **Peaks** only give PDFs or overviews in the app: no work for a CSV recogniser.

**Advice:**

1. Build Lightyear and Scalable Capital first (see [6](#6-lightyear) and [7](#7-scalable-capital)).
2. Ask in [#6](https://github.com/zenonymous/box3balans/issues/6) specifically for an anonymised file from ING (both tabs and the portfolio) and from Meesman.
3. For ABN AMRO: at most recognise fund purchases and payouts in the TAB export of the linked account, which the bank import already reads. That only makes sense with a real file.
4. Brand New Day and Peaks: refer to _Values per year_. Their financial annual statement has the starting and end value, and at Brand New Day also the dividend and dividend tax.

## Overview

| Provider         | Formats                                                                                                | CSV recogniser                                       | Certainty                                               | Position on a date                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| ABN AMRO         | No securities export; credits and debits of the linked account as PDF, txt (TAB), mt940, xls, camt.053 | Partly: fund rows from the description, without ISIN | low                                                     | Vermogensrapportage (format not stated), no CSV found              |
| ING              | CSV of the transaction overview (tabs Beleggingen and Geld); portfolio as PDF or CSV                   | Yes, once there's a sample                           | medium that it exists, no columns known                 | Yes: _Historisch portefeuilleoverzicht_ on a date; columns unknown |
| Meesman          | Excel (_Exporteren als Excel_) under _Opdrachten → Transacties_                                        | Yes, after saving as CSV, once there's a sample      | medium that it exists, no columns known                 | No, only the annual statement                                      |
| Brand New Day    | PDF: transaction overview, quarterly and annual statement                                              | No (PDF only)                                        | medium                                                  | Quarterly statement with value per fund (PDF)                      |
| Peaks            | Annual statement and quarterly report; transactions only in the app                                    | No                                                   | medium                                                  | Annual statement with the value on 1 January                       |
| Lightyear        | CSV report of transactions; statements as PDF                                                          | Yes                                                  | high for columns and arithmetic; Dutch variant not seen | Not in the CSV; the PDF account statement lists the open positions |
| Scalable Capital | CSV of transactions (PRIME+ only); contract notes and monthly statement as PDF                         | Yes                                                  | high for the columns, medium for types and signs        | Financial status on a chosen date, as a document (format unknown)  |

**What a recogniser delivers** (`server/src/import/formats/types.ts`): per row a `TemplateRow` with `type` buy, sell, deposit, withdrawal, dividend, reward, fee or split, plus isin, symbol, name, quantity, price, currency, fee, amount, tax and id. `detect()` gets the header row (which may be up to fifteen rows below title rows). `convert()` returns rows, skipped rows per reason and warnings. With `settleCash: true` the import also books buys and sells against the cash balance (as for Rabobank and Trade Republic); without it, the cash stays out of the picture (as for Trading 212).

## 1. ABN AMRO (Zelf Beleggen Basis and Plus, Begeleid Beleggen)

**Exports:**

- **No export of securities transactions found.** The investing FAQ mentions the contract notes, the Vermogensrapportage (wealth report) and the box 3 overview, but no CSV or Excel of transactions ([investing FAQ](https://www.abnamro.nl/nl/prive/beleggen/service/index/path-detail/Beleggingen-kopen-of-verkopen/Orderstatus.html)). The Mijn Dealingroom manual (Zelf Beleggen Plus, March 2026) only knows a transaction overview for the _schaduwportefeuille_ (shadow portfolio) ([manual](https://assets.abnamro.com/api/public/content/handleiding-mijn-dealingroom.pdf)).
- **Everything goes through the linked account.** According to the FAQ, ABN AMRO links the investment account to a linked account of your choice, such as a _Beleggers Spaarrekening_ (investor savings account) or your personal account. Purchases are debited from it, sales and payouts are credited to it. That account also shows the details of your order ([investing FAQ](https://www.abnamro.nl/nl/prive/beleggen/service/index/path-detail/Beleggingen-kopen-of-verkopen/Orderstatus.html)).
- **That account's credits and debits** can be downloaded as PDF, txt, mt940, xls or camt.053, up to 18 months back; older ones only as a PDF statement ([downloading](https://www.abnamro.nl/nl/prive/betalen/bij-en-afschrijvingen/downloaden.html)).
- **Other statements** (Internet Bankieren → _Zelf regelen → Overzichten en afschriften → Overige overzichten downloaden_):
  - the _Vermogensrapportage_: current value and development ([investing FAQ](https://www.abnamro.nl/nl/prive/beleggen/service/index/path-detail/Beleggingen-kopen-of-verkopen/Orderstatus.html));
  - the _Overzicht Box 3 Beleggen Transacties_ over 2018–2024, for the actual-return statement ([box 3](https://www.abnamro.nl/nl/prive/beleggen/service/overzicht-rendement-box-3.html));
  - the _Financieel Jaaroverzicht_ (financial annual statement).

  The file format isn't mentioned; probably PDF.

- **API:** the _Investment Asset Report API_ gives positions and transactions, but only to independent asset managers and other intermediaries, in a pilot ([developer.abnamro.com](https://developer.abnamro.com/api-products/investment-asset-report/overview)). Not for private clients.

**What investment rows on the linked account look like.** This comes from one source: an anonymised PDF statement _Bij- en afschrijvingen_ of a Beleggers Spaarrekening (Zelf Beleggen Basis, funds), posted on the Portfolio Performance forum on 31 August 2026 and included as a test file in a still-open pull request ([forum](https://forum.portfolio-performance.info/t/pdf-import-von-abn-amro-group/29478), [PR #5988](https://github.com/portfolio-performance/portfolio/pull/5988)). The descriptions are in English, over several lines:

| Type                            | Pattern in the description                                                                      | Sign on the account |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- |
| Fund purchase                   | `DEPOSIT INV. FUND <fund>` `FONDSCODE <6 digits> PER <dd/mm> UNIT <quantity> @ EUR <price>`     | debit               |
| Payout                          | `DIVIDEND <fund>` `FONDSCODE <code> <dd.mm.yyyy> OVER PART <quantity> PAID WITH EUR <per unit>` | credit              |
| Costs                           | `ABNAMRO Investments See your invoice for details`                                              | debit               |
| Interest on the savings account | `ACCOUNT BALANCED CREDIT INTEREST …`                                                            | credit              |
| Deposit from own account        | SEPA transfer                                                                                   | credit              |

A sale didn't occur in this example; that pattern is unknown. How shares and ETFs from Zelf Beleggen look on the linked account is unknown too.

**Columns of the TAB export** (as `server/src/import/bank.ts` already reads it): no header row, tabs as separator, and per row account number, currency, transaction date (YYYYMMDD), balance before, balance after, value date, amount (decimal comma, negative is a debit) and description. Whether the description in the TAB export has the same text as in the PDF isn't verified.

Made-up example in that form:

```text
123456789	EUR	20260302	1000,00	749,00	20260302	-251,00	DEPOSIT INV. FUND VOORBEELD WERELD FONDSCODE 123456 PER 02/03 UNIT 2,0000 @ EUR 125,50
123456789	EUR	20260331	749,00	751,50	20260331	2,50	DIVIDEND VOORBEELD WERELD DIS FONDSCODE 123456 31.03.2026 OVER PART 10,0000 PAID WITH EUR 0,25
123456789	EUR	20260612	751,50	751,45	20260612	-0,05	ABNAMRO Investments See your invoice for details
```

**To Box3balans:**

- `DEPOSIT INV. FUND` → `buy`: quantity and price from `UNIT … @ EUR …`, name from the description, currency EUR.
- `DIVIDEND` → `dividend`: the row's amount. Whether tax was withheld isn't stated.
- `ABNAMRO Investments` → `fee` in EUR.
- **No ISIN, only a fund code.** The user has to choose an asset per fund code; the import's preview screen already does that for symbols.
- **Fits better in the bank import** than in a recogniser of its own. That already reads this file and sees the interest and the deposits; it could offer the investment rows as transactions.

**Certainty: low.** One PDF, an open pull request, no TAB sample and no sales. Wait for a real file.

## 2. ING (Zelf op de Beurs)

ING now calls the product _Zelf op de Beurs_; next to it there are _Eenvoudig Beleggen_, _Vermogensbeheer_ and _Pensioenbeleggen_.

**Exports** (all from ING's investing FAQ, read on 13 October 2026, [FAQ](https://www.ing.nl/particulier/datasource-chatbot/beleggen/veelgestelde-vragen-beleggen)):

- **Transactions:** in Mijn ING and the ING App you open the transaction overview of your Zelf op de Beurs account, choose a period and download the transactions.
- **Portfolio:** with Zelf op de Beurs you can download a portfolio overview as PDF or CSV; PDF only in Mijn ING.
- **Value on a date:** the _Historisch portefeuilleoverzicht_ (historical portfolio overview) feature, only in Mijn ING, at the bottom of the investment account. Whether it also comes as CSV, the FAQ doesn't say.
- **Dividend:** visible in the transaction overview and in the credits and debits, with the dividend tax withheld in the details.
- **Costs:** every quarter afterwards, by default charged to the current account, or on request to the cash part of the investment account. A specification is on the investment statement under _Documenten_.
- **Annual statement** and the _Overzicht voor opgaaf werkelijk rendement_ (2017–2025) under _Documenten → Beleggen_.

According to the manual of Portfolio Dividend Tracker, a closed tracker and therefore second-hand, it goes like this ([PDT](https://help-en.portfoliodividendtracker.com/article/337-import-your-ing-actions), updated 14 September 2026):

- only via the website, not the app;
- _Beleggen_ → the investment account → at the bottom the _Transactieoverzicht_;
- tab _Beleggingen_ (buys, sells, dividend) and tab _Geld_ (deposits, withdrawals, costs), each with _Download CSV_ below the table;
- at most 365 days per file;
- only Dutch-language exports.

**Columns: unknown.** No open-source parser, test file or forum post with the header row found. Portfolio Performance, Export-To-Ghostfolio and Ghostfolio have nothing for ING Netherlands. The beancount package `beancount-ing` is for ING Germany ([PyPI](https://pypi.org/project/beancount-ing/)).

**What the sample file must show:** the header rows of both tabs and of the portfolio overview, the separator, date and number notation, the values in the type column (buy, sell, dividend, dividend tax, costs, deposit, withdrawal, corporate actions), and whether there's an ISIN in it.

**To Box3balans** (for now):

- Tab Beleggingen → `buy`, `sell` and `dividend` with `tax`.
- Tab Geld → `deposit`, `withdrawal` and `fee`. Costs that go from the current account probably aren't in it.
- The portfolio overview on a date can become a `Statement` in `server/src/import/statement.ts` just like DEGIRO's _Portefeuille_, if it has an ISIN and a quantity per row.

## 3. Meesman Indexbeleggen

**Exports:**

- **Transactions:** in MijnMeesman under _Opdrachten → Transacties_, with the _Exporteren als Excel_ button at the bottom of the table. That's in Meesman's own explanation for the actual-return statement (PDF of 10 October 2025, [explanation](https://www.meesman.nl/media/5ktnud20/uitlegdocument-opgeven-werkelijk-rendement-box-3.pdf)).
- **Annual statement:** in MijnMeesman under _Documenten_ ([explanation](https://www.meesman.nl/media/5ktnud20/uitlegdocument-opgeven-werkelijk-rendement-box-3.pdf)).
- **Meesman's own box 3 tips:** add the reinvested (net) dividend to the purchases and deposits, and leave switch transactions out of both purchases and sales. A pension account doesn't count for box 3.

**Columns: unknown.** No sample file or parser found. Whether the file is .xlsx, .xls or actually CSV is unknown too. Box3balans doesn't read Excel; the user saves it as CSV, as with Saxo.

**A clue to the contents.** The unofficial API wrapper `meesman-wrapper` (MIT) describes the transactions behind MijnMeesman ([order.py](https://github.com/clrxbl/meesman-wrapper/blob/main/meesman/models/order.py)):

- fields such as execution date, fund, amount and number of units;
- order types _Deposit_, _Withdrawal_, _PeriodicDeposit_, _PeriodicWithdrawal_, _Switch_, _Rebalance_ and _Refund_;
- underlying types such as _Buy_, _Sell_, _ReInvest_, _SwitchBuy_ and _SwitchSell_.

That's the internal API, not the Excel export; the Dutch labels in the export may differ. Not verified.

**To Box3balans** (for now):

- Deposit → `buy` of the fund; sale or withdrawal → `sell`. Without a separate cash account, so without `deposit`.
- Reinvested dividend → `dividend` plus `buy` of the same amount.
- Switch → `sell` plus `buy`. Box3balans would then count that as money in and out; the recogniser has to prevent that.
- Costs are in the fund prices: no `fee` rows.

## 4. Brand New Day (investing, free assets)

**Exports:**

- **In MijnBND** you see the current portfolio, the return, the costs and the executed orders. After every quarter there's a quarterly statement with per fund the value at the start and end of the quarter, the deposits and withdrawals and the executed transactions. Every year there's a financial annual statement with the starting and end value, the dividend and the dividend tax withheld. You find them under _Mijn documenten_; old quarterly statements, annual statements and transaction overviews stay available too ([investment account information, version 5 December 2024](https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf), [annual statement FAQ](https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/)).
- **Format:** Brand New Day doesn't say. A user on the Portfolio Performance forum only had a PDF _Overzicht beleggingstransacties_ (February and November 2025). Its columns are `#`, `Datum`, `Soort` (Koop, Verkoop), `Fonds`, `Aantal`, `Prijs` and `Bedrag`, with a sale as a negative amount. He found nothing other than that PDF ([forum](https://forum.portfolio-performance.info/t/pdf-import-from-brand-new-day/31804)). Second-hand.
- **No CSV or Excel export found**, not in the FAQ about MijnBND either ([FAQ MijnBND](https://new.brandnewday.nl/veelgestelde-vragen/categorie/mijnbnd/)).

**Doesn't fit** a CSV recogniser. Use _Values per year_ with the financial annual statement, or the template.

## 5. Peaks

**Exports** (all from Peaks's FAQ, [FAQ](https://www.peaks.com/nl/nl/faq-service/)):

- **Annual statement in February** with the value of your investments on 1 January.
- **Quarterly report** with all investment transactions and the costs, "on a durable medium" (probably PDF).
- **Deposits and withdrawals** are shown in the app's _In en uit_ screen.
- **No export of transactions** found, no CSV or Excel either. The investments are ETFs with ISIN, which Peaks names in the FAQ.

**Doesn't fit** a CSV recogniser. Use _Values per year_ with the value on 1 January from the annual statement.

## 6. Lightyear

**Exports:**

- **CSV:** _Transactions → Download report and Account statement_, choose a period, _Export CSV_. That's in a blog by Lightyear itself (Spanish market, 3 February 2026, [Lightyear + Autodeclaro](https://lightyear.com/en-es/blog/lightyear-autodeclaro)). DeclaRenta calls the same file _Transaction report_, in the app under _Profile → Reports_ ([brokers.md](https://github.com/GeiserX/DeclaRenta/blob/main/docs/brokers.md)).
- **PDF statements:** account statement, annual statement, capital gains statement and costs and charges overview. The Dutch help page only mentions _PDF downloaden_ (app) and _PDF Exporteren_ (web) ([help NL](https://lightyear.com/nl-nl/help/trading-and-investments/tax-and-statement)).
- **Positions:** the PDF account statement itemises your open positions; the CSV has no positions ([help NL](https://lightyear.com/nl-nl/help/trading-and-investments/tax-and-statement), [lightyear.ts](https://github.com/GeiserX/DeclaRenta/blob/main/src/parsers/lightyear.ts)).

**Columns.** The same thirteen columns appear in three independent parsers tested on real files ([DeclaRenta](https://github.com/GeiserX/DeclaRenta/blob/main/src/parsers/lightyear.ts), [e-arveldaja-mcp](https://github.com/iseppo/e-arveldaja-mcp/blob/master/src/tools/lightyear-investments.ts), [turtle-backtest](https://github.com/jaaknt/turtle-backtest/blob/main/docs/specs/lightyear-data-import.md)) and in a fourth ([maisvalias-tool](https://github.com/Tomas-Silva-PT/maisvalias-tool/blob/main/src/parsers/brokerparsers/lightyear/lightyear2026-v1.ts)):

```text
Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.
```

- **Separator:** comma. Two variants have been seen: without quotes, and with every cell in quotes plus a space before the header row (`␣"Date","Reference",…`). Box3balans's CSV parser already skips whitespace before a quote.
- **Date:** `DD/MM/YYYY HH:MM:SS`, day first. The time zone is unknown.
- **Numbers:** decimal point, no thousands separators seen; quantities and prices with nine decimals (`8.000000000`). Read with `num(raw, ".")`.
- **Empty cell:** not applicable.
- **Sign and amounts** (from the arithmetic in e-arveldaja-mcp, checked on 107 purchases with costs, and from turtle-backtest's example):
  - `Net Amt.` is always `Gross Amount − Fee`.
  - **Buy:** `Gross Amount` is what comes off the cash (including costs), `Net Amt.` = quantity × price. Both positive.
  - **Sell:** `Gross Amount` = quantity × price, `Net Amt.` is what comes in. Both positive.
  - **Dividend, Distribution:** `Gross Amount` = `Net Amt.` + `Tax Amt.` + `Fee`.
  - **Withdrawal:** negative. **Deposit:** positive.
  - **Conversion:** two rows with the same `Reference`, one per currency: positive for the currency you get, negative for the one you pay. The costs are on one of the two. `FX Rate` is filled in; which way that rate goes isn't verified.

**Types in `Type`:** `Buy`, `Sell`, `Dividend`, `Distribution`, `Interest`, `Reward`, `Conversion`, `Deposit` and `Withdrawal` ([e-arveldaja-mcp](https://github.com/iseppo/e-arveldaja-mcp/blob/master/src/tools/lightyear-investments.ts)). Splits, securities transfers and other corporate actions weren't seen in any of the sources; DeclaRenta warns about unknown types.

**Prefixes in `Reference`:** `OR-` order, `DD-` dividend, `IN-` interest and money-market fund payout, `RW-` reward, `CN-` currency exchange, `DT-` deposit, `WL-` withdrawal.

**Distribution** only occurred in the examples for two money-market funds (ISIN IE000GWTNRJ7 and IE00B44BQ083), with a `Fee` on it. Those funds are bought and sold with `Buy` and `Sell` at price 1; e-arveldaja-mcp calls them Lightyear's cash-parking funds. For box 3 they're ordinary investments.

**Made-up examples:**

```text
Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.
14/01/2026 15:31:07,OR-AB12CD34EF,VBWLD,IE0000000001,Buy,10.000000000,EUR,120.500000000,1206.50,,1.50,1205.00,
20/03/2026 16:02:44,OR-GH56IJ78KL,VBWLD,IE0000000001,Sell,4.000000000,EUR,130.000000000,520.00,,1.00,519.00,
02/04/2026 06:10:12,DD-MN90OP12QR,VBUS,US0000000002,Dividend,,USD,,10.00,,,8.50,1.50
01/05/2026 13:20:00,IN-ST34UV56WX,VBGELD,IE0000000003,Distribution,,EUR,,3.20,,0.10,3.10,0.00
01/05/2026 03:15:00,IN-YZ78AB90CD,,,Interest,,EUR,,0.42,,,0.42,0.00
05/01/2026 09:00:00,DT-EF12GH34IJ,,,Deposit,,EUR,,500.00,,0.00,500.00,
10/02/2026 11:45:30,CN-KL56MN78OP,USD,,Conversion,,USD,,108.00,0.92593,,108.00,
10/02/2026 11:45:30,CN-KL56MN78OP,EUR,,Conversion,,EUR,,-100.35,1.08000,0.35,-100.00,
```

**To Box3balans:**

| `Type`                  | Row                     | Fields                                                                                                                                |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `Buy`                   | `buy`                   | isin, symbol = `Ticker`, quantity = `Quantity`, price = `Price/share`, currency = `CCY`, fee = `Fee`, id = `lightyear:` + `Reference` |
| `Sell`                  | `sell`                  | same                                                                                                                                  |
| `Dividend`              | `dividend`              | amount = `Gross Amount`, tax = `Tax Amt.`, currency = `CCY`                                                                           |
| `Distribution`          | `dividend`              | same; a `Fee` as a separate `fee` row in `CCY`                                                                                        |
| `Interest`, `Reward`    | `reward`                | cash in `CCY`, only useful if the cash is followed                                                                                    |
| `Deposit`, `Withdrawal` | `deposit`, `withdrawal` | same                                                                                                                                  |
| `Conversion`            | skip                    | "Cash movements (deposits, withdrawals, currency exchange)"                                                                           |
| other                   | skip                    | "Other rows (corporate actions, product changes)"                                                                                     |

**Following the cash or not.** Lightyear holds cash in several currencies and exchanges with separate `Conversion` rows. Box3balans has no currency exchange as a type. Booking an exchange as `withdrawal` plus `deposit` counts as money in and out for box 3. Proposal for the first version: do it as for Trading 212. Read buys, sells and dividend; leave out cash, interest, rewards and exchanges; report them in the check.

**Recognising:** `hasColumns(h, "reference", "ticker", "isin", "type", "ccy", "gross amount", "net amt", "tax amt")`. The heading `Price/share` becomes `price share` after `norm()`, so Revolut (`price per share`, `total amount`) doesn't clash.

**Certainty: high** for the columns and the arithmetic. Whether a Dutch account (Dutch app language) gets the same English headings and types isn't verified.

## 7. Scalable Capital

**Exports:**

- **CSV, only with PRIME+ Broker.** _Transactions_ → select all or individual rows → _Export CSV_; the file goes to your downloads folder. With the FREE Broker it's not possible; you can switch to PRIME+ at any time ([help NL](https://help.scalable.capital/nl/accountbeheer-f3197dc7/kan-ik-informatie-over-mijn-portfolio-exporteren-bijvoo-c0ca1b71), updated 4 August 2026; [help EN](https://help.scalable.capital/en/account-management-f3197dc7/can-i-export-information-about-my-portfolio-such-as-a-cs-4f77cde3)). The announcement from December 2024 still mentioned PRIME and PRIME+ ([product news](https://nl.scalable.capital/en/product-news/transactions-export)).
- **Filters in the transaction overview** (English help page): order type _Buy, Sell, Savings plan, Deposit, Withdrawal, Distribution, Portfolio transfer, Fees (excluding order fees), Corporate action, Taxes, Interest_; status _Pending, Executed, Canceled, Expired, Rejected_. The Dutch page translates them (Aankoop, Verkoop, Periodiek beleggen …). In the CSV all examples had the English values.
- **PDF:** a contract note per transaction, usually within 48 hours, and a monthly account statement in your mailbox.
- **Position on a date:** _Profile → Personal Information → Copy of your data → Request financial status_, with a reference date of your choice. The document goes to your mailbox; the format isn't stated. In addition there's a quarterly overview of your holdings on the last day of the previous quarter. Both only cover custody at Scalable itself; for a custody account at Baader Bank you request it from Baader ([help](https://help.scalable.capital/en/account-management-f3197dc7/how-do-i-receive-an-account-statement-or-financial-statu-4d777d0f)).

**Columns.** From the _Scalable Capital_ template Portfolio Performance has shipped since April 2026 ([csv-config.json](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/csv/csv-config.json), [commit 1c1d432](https://github.com/portfolio-performance/portfolio/commit/1c1d432227af697fce0d37e4eed856a6d3c09f41)). The same appears in two user samples, from 2024 and 2025 ([forum](https://forum.portfolio-performance.info/t/csv-import-von-scalable-capital/30113), [Export-To-Ghostfolio #272](https://github.com/dickwolff/Export-To-Ghostfolio/issues/272)):

```text
date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency
```

- **Separator:** semicolon. **Encoding:** UTF-8 (according to the template).
- **Date:** `YYYY-MM-DD`, time separately as `HH:MM:SS`. Cash rows often have 01:00:00 or 02:00:00, probably midnight UTC in local time.
- **Numbers:** decimal comma with a point for thousands (`1.526,72`), sometimes with many decimals (`-74,989475`). Read with `num(raw, ",")`, not with `looseNum`: that reads `1.000` as 1.
- **`reference` and `description`** are in quotes. Orders start with `SCAL`, payouts and taxes with `WWEK`; deposits and withdrawals have a long code.
- **`assetType`:** `Security` for buys and sells, `Cash` for cash rows, payouts and taxes.
- **`status`:** `Executed` in all examples.
- **`type`** according to Portfolio Performance's template: `Buy`, `Savings plan`, `Sell`, `Distribution`, `Deposit`, `Withdrawal`, `Fee`, `Interest`, `Taxes`, `Cash Transfer In` and `Cash Transfer Out`. In the user samples: `Buy`, `Sell`, `Savings plan`, `Distribution`, `Deposit`, `Withdrawal` and `Taxes`. The values for corporate actions and securities transfers are unknown; a user reports they're in the same file ([forum](https://forum.portfolio-performance.info/t/csv-import-von-scalable-capital/30113)).

**Sign and amounts** (from the user samples, so second-hand):

- `amount` is negative when money goes out (buy, savings plan, withdrawal, tax) and positive when it comes in (sell, deposit, payout).
- **Buy and savings plan:** `amount` = −(`shares` × `price`), unrounded.
- **Sell:** `amount` = `shares` × `price`, without the tax in `tax` taken off. A user confirms that ([forum, 21 February 2025](https://forum.portfolio-performance.info/t/csv-import-von-scalable-capital/30113)).
- **Payout:** `amount` seems net. With `amount` + `tax` as gross, the tax comes out at the German rate; that's derived, not confirmed.
- **`fee`** was 0,00 in all examples. Whether `amount` includes the costs is unknown.
- `fee` and `tax` are positive; for cash rows `tax` is sometimes empty.

**Made-up examples:**

```text
date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency
2026-01-05;01:00:00;Executed;"AB12CD34EF56GH78IJ90KL";"Voorbeeldstorting";Cash;Deposit;;;;500,00;0,00;;EUR
2026-01-06;10:15:30;Executed;"SCALaB3cD4eF5gH";"Voorbeeld Wereld ETF (Acc)";Security;Buy;IE0000000001;12;85,40;-1.024,80;0,00;0,00;EUR
2026-02-02;14:02:11;Executed;"SCALiJ6kL7mN8oP";"Voorbeeld Wereld ETF (Acc)";Security;Savings plan;IE0000000001;1,171;85,39;-99,99169;0,00;0,00;EUR
2026-05-20;16:40:05;Executed;"SCALqR9sT0uV1wX";"Voorbeeld Aandeel";Security;Sell;NL0000000002;30;41,10;1.233,00;0,00;0,00;EUR
2026-06-15;02:00:00;Executed;"WWEK 10000001";"Voorbeeld Dividend ETF (Dist)";Cash;Distribution;IE0000000003;;;12,75;0,00;2,25;EUR
2026-07-01;02:00:00;Executed;"CD34EF56GH78IJ90KL12MN";"Voorbeeldopname";Cash;Withdrawal;;;;-200,00;0,00;;EUR
```

**To Box3balans:**

| `type`                            | Row                | Fields                                                                                                                  |
| --------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `Buy`, `Savings plan`             | `buy`              | isin, name = `description`, quantity = `shares`, price = `price`, currency, fee = `fee`, id = `scalable:` + `reference` |
| `Sell`                            | `sell`             | same; if there's something in `tax`, report it (German tax, normally 0 for Dutch residents)                             |
| `Distribution`                    | `dividend`         | amount = `amount` + `tax` (gross), tax = `tax`                                                                          |
| `Deposit`, `Cash Transfer In`     | `deposit`          | EUR, quantity = \|`amount`\|                                                                                            |
| `Withdrawal`, `Cash Transfer Out` | `withdrawal`       | same                                                                                                                    |
| `Interest`                        | `reward`           | EUR                                                                                                                     |
| `Fee`                             | `fee`              | EUR                                                                                                                     |
| `Taxes`                           | skip with a notice | in the examples German tax per ISIN; no type in the template                                                            |
| status other than `Executed`      | skip               | "Orders not executed"                                                                                                   |
| other                             | skip               | "Other rows (corporate actions, product changes)"                                                                       |

- **Settings:** everything is in euros, so `settleCash: true` and `feeCurrency: "EUR"`, as for Trade Republic. Then the cash balance at Scalable is right.
- **Recognising:** `hasColumns(h, "date", "time", "status", "reference", "assettype", "type", "isin", "shares", "price", "amount", "fee", "tax", "currency")`. The second column is `time`, so Trade Republic's recogniser (`datum`/`date`, then `type`) doesn't pick it up.

**Certainty:** high for the header and notation (template plus two independent samples); medium for the types beyond buy and sell, the signs and what `amount` contains. All samples come from German clients. Whether a Dutch account gets the same English values and German number notation isn't verified.

## Not verified

- **ING:** all column headings, the separator, the date and number notation and the type values of both tabs; whether the portfolio overview as CSV also works for a historical date; the 365-day limit (second-hand only, from Portfolio Dividend Tracker).
- **Meesman:** the columns of the Excel export, whether it's really Excel, the Dutch names of the types, and how reinvested dividend and switches appear in it.
- **ABN AMRO:**
  - whether the TAB and xls export of the linked account have the same descriptions as the PDF statement;
  - what a fund sale looks like;
  - how shares and ETFs from Zelf Beleggen appear on the linked account;
  - whether the Beleggers Spaarrekening can be downloaded as TAB;
  - the format and frequency of the Vermogensrapportage.
- **Brand New Day:** whether there's another export besides PDF (only one user's post seen), and the format of the quarterly and annual statements.
- **Peaks:** whether there's an export in the web environment after all, and the format of the annual statement and quarterly report.
- **Lightyear:**
  - the time zone of `Date`;
  - whether a Dutch account gets the same headings and types;
  - the type values for splits, transfers and other corporate actions;
  - the direction of `FX Rate`;
  - where the variant with and the one without quotes comes from (app or web).
- **Scalable Capital:**
  - the values `Fee`, `Interest` and `Cash Transfer In/Out` (only from Portfolio Performance's template) and those for corporate actions and transfers (unknown);
  - whether `amount` includes the order costs;
  - that `amount` is net for a payout (derived from sample amounts);
  - the status values besides `Executed` and the time zone of `time`;
  - whether Dutch clients get the same file;
  - the format of the financial status.

## Sources

ABN AMRO:

- Investing FAQ (linked account, Vermogensrapportage, contract notes): https://www.abnamro.nl/nl/prive/beleggen/service/index/path-detail/Beleggingen-kopen-of-verkopen/Orderstatus.html
- Downloading credits and debits: https://www.abnamro.nl/nl/prive/betalen/bij-en-afschrijvingen/downloaden.html
- Box 3 return overview: https://www.abnamro.nl/nl/prive/beleggen/service/overzicht-rendement-box-3.html
- Mijn Dealingroom manual (March 2026): https://assets.abnamro.com/api/public/content/handleiding-mijn-dealingroom.pdf
- Investment Asset Report API: https://developer.abnamro.com/api-products/investment-asset-report/overview

ING:

- Veelgestelde vragen Beleggen (investing FAQ): https://www.ing.nl/particulier/datasource-chatbot/beleggen/veelgestelde-vragen-beleggen
- Portfolio Dividend Tracker, importing ING (closed software, second-hand): https://help-en.portfoliodividendtracker.com/article/337-import-your-ing-actions

Meesman:

- Uitlegdocument opgeven werkelijk rendement box 3: https://www.meesman.nl/media/5ktnud20/uitlegdocument-opgeven-werkelijk-rendement-box-3.pdf
- FAQ for existing clients: https://www.meesman.nl/veelgestelde-vragen/voor-bestaande-klanten/

Brand New Day:

- Belangrijke informatie over uw beleggingsrekening (version 5 December 2024): https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf
- Annual statement FAQ: https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/
- FAQ MijnBND: https://new.brandnewday.nl/veelgestelde-vragen/categorie/mijnbnd/ and https://new.brandnewday.nl/veelgestelde-vragen/mijnbnd/hoe-kan-ik-zien-hoe-het-met-mijn-rekening-gaat/

Peaks:

- Contact and frequently asked questions: https://www.peaks.com/nl/nl/faq-service/

Lightyear:

- Help, tax and statements (NL): https://lightyear.com/nl-nl/help/trading-and-investments/tax-and-statement
- Blog Lightyear + Autodeclaro (3 February 2026): https://lightyear.com/en-es/blog/lightyear-autodeclaro
- Blog about the first statements (2022): https://lightyear.com/en-eu/blog/lightyear-statements-are-here
- Sharesight about the Lightyear CSV (buys and sells only): https://www.sharesight.com/au/partners/lightyear/

Scalable Capital:

- Help, CSV export (NL): https://help.scalable.capital/nl/accountbeheer-f3197dc7/kan-ik-informatie-over-mijn-portfolio-exporteren-bijvoo-c0ca1b71
- Help, CSV export (EN): https://help.scalable.capital/en/account-management-f3197dc7/can-i-export-information-about-my-portfolio-such-as-a-cs-4f77cde3
- Help, account statement and financial status: https://help.scalable.capital/en/account-management-f3197dc7/how-do-i-receive-an-account-statement-or-financial-statu-4d777d0f
- Product news, transaction export (12 December 2024): https://nl.scalable.capital/en/product-news/transactions-export

Open-source projects (code and test files; nothing copied, all sample rows above are made up):

- Portfolio Performance, **EPL-1.0**: Scalable Capital CSV template in https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/csv/csv-config.json; open PR #5988 with the Dutch ABN AMRO statement: https://github.com/portfolio-performance/portfolio/pull/5988; the existing `ABNAMROGroupPDFExtractor` only reads German MoneYou statements.
- DeclaRenta, **AGPL-3.0**: https://github.com/GeiserX/DeclaRenta (`src/parsers/lightyear.ts`, `tests/fixtures/lightyear-sample.csv`, `docs/brokers.md`)
- e-arveldaja-mcp, **Apache-2.0**: https://github.com/iseppo/e-arveldaja-mcp/blob/master/src/tools/lightyear-investments.ts
- maisvalias-tool, **MIT**: https://github.com/Tomas-Silva-PT/maisvalias-tool/blob/main/src/parsers/brokerparsers/lightyear/lightyear2026-v1.ts
- turtle-backtest, **no licence** (only read): https://github.com/jaaknt/turtle-backtest/blob/main/docs/specs/lightyear-data-import.md
- meesman-wrapper, **MIT** (unofficial API, logs in; only as a clue): https://github.com/clrxbl/meesman-wrapper/blob/main/meesman/models/order.py
- Export-To-Ghostfolio, **Apache-2.0**: no converter for these seven; issue #272 with a user's Scalable sample: https://github.com/dickwolff/Export-To-Ghostfolio/issues/272
- beancount-ing, **MIT**: for ING Germany, not the Netherlands: https://pypi.org/project/beancount-ing/

Forums (user posts, second-hand):

- Portfolio Performance, CSV import Scalable Capital: https://forum.portfolio-performance.info/t/csv-import-von-scalable-capital/30113
- Portfolio Performance, PDF import ABN AMRO Group: https://forum.portfolio-performance.info/t/pdf-import-von-abn-amro-group/29478
- Portfolio Performance, PDF import Brand New Day: https://forum.portfolio-performance.info/t/pdf-import-from-brand-new-day/31804

Not found: an importer or format description for any of these seven providers in Ghostfolio itself, in beancount importers or in Parqet's documentation. According to a search result, Parqet connects Scalable Capital via _Autosync_, so by logging in; that's outside this setup and wasn't checked.
