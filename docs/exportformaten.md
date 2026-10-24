# Exportformaten van brokers die Box3balans nog niet leest

_English: [en/exportformaten.md](en/exportformaten.md)_

Onderzocht op 13 oktober 2026.

**Kort:** van de zeven aanbieders uit fase G zijn er twee nu te bouwen: **Lightyear** en **Scalable Capital**. Van beide zijn de kolomkoppen bekend uit meerdere onafhankelijke bronnen. **ING** heeft een CSV-export van transacties en van de portefeuille, maar de kolommen staan nergens openbaar: daarvoor is een voorbeeldbestand nodig. **Meesman** exporteert naar Excel, met onbekende kolommen. **ABN AMRO** heeft geen export van effectentransacties. Aankopen en uitkeringen staan alleen als regels op de gekoppelde tegenrekening, en die kun je wel als TAB-bestand downloaden. **Brand New Day** en **Peaks** geven alleen pdf's of overzichten in de app: geen werk voor een CSV-herkenner.

**Advies:**

1. Bouw eerst Lightyear en Scalable Capital (zie [6](#6-lightyear) en [7](#7-scalable-capital)).
2. Vraag in [#6](https://github.com/zenonymous/box3balans/issues/6) gericht om een geanonimiseerd bestand van ING (beide tabbladen en de portefeuille) en van Meesman.
3. Voor ABN AMRO: herken hooguit fondsaankopen en uitkeringen in de TAB-export van de tegenrekening, die de bankimport al leest. Dat is pas zinvol met een echt bestand.
4. Brand New Day en Peaks: verwijs naar _Waarden per jaar_. Hun financieel jaaroverzicht heeft de begin- en eindwaarde, en bij Brand New Day ook het dividend en de dividendbelasting.

## Overzicht

| Aanbieder        | Formaten                                                                                                   | CSV-herkenner                                       | Zekerheid                                                         | Stand op een datum                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| ABN AMRO         | Geen effecten-export; bij- en afschrijvingen van de tegenrekening als pdf, txt (TAB), mt940, xls, camt.053 | Deels: fondsregels uit de omschrijving, zonder ISIN | laag                                                              | Vermogensrapportage (formaat niet vermeld), geen CSV gevonden          |
| ING              | CSV van het transactieoverzicht (tabbladen Beleggingen en Geld); portefeuille als pdf of CSV               | Ja, zodra er een voorbeeld is                       | middel dat het bestaat, geen kolommen bekend                      | Ja: _Historisch portefeuilleoverzicht_ op een datum; kolommen onbekend |
| Meesman          | Excel (_Exporteren als Excel_) onder _Opdrachten → Transacties_                                            | Ja, na opslaan als CSV, zodra er een voorbeeld is   | middel dat het bestaat, geen kolommen bekend                      | Nee, alleen het jaaroverzicht                                          |
| Brand New Day    | Pdf: transactieoverzicht, kwartaal- en jaaroverzicht                                                       | Nee (alleen pdf)                                    | middel                                                            | Kwartaaloverzicht met waarde per fonds (pdf)                           |
| Peaks            | Jaaroverzicht en kwartaalrapport; transacties alleen in de app                                             | Nee                                                 | middel                                                            | Jaaroverzicht met de waarde op 1 januari                               |
| Lightyear        | CSV-rapport van transacties; overzichten als pdf                                                           | Ja                                                  | hoog voor kolommen en rekenkunde; Nederlandse variant niet gezien | Niet in de CSV; het pdf-rekeningoverzicht noemt de open posities       |
| Scalable Capital | CSV van transacties (alleen PRIME+); nota's en maandoverzicht als pdf                                      | Ja                                                  | hoog voor de kolommen, middel voor soorten en tekens              | Vermogensstatus op een gekozen datum, als document (formaat onbekend)  |

**Wat een herkenner levert** (`server/src/import/formats/types.ts`): per regel een `TemplateRow` met `type` buy, sell, deposit, withdrawal, dividend, reward, fee of split, plus isin, symbol, name, quantity, price, currency, fee, amount, tax en id. `detect()` krijgt de kopregel (die tot vijftien regels onder titelregels mag staan). `convert()` geeft rijen, overgeslagen regels per reden en waarschuwingen. Met `settleCash: true` boekt de import aan- en verkopen ook tegen het geldsaldo (zoals bij Rabobank en Trade Republic); zonder blijft het geld buiten beeld (zoals bij Trading 212).

## 1. ABN AMRO (Zelf Beleggen Basis en Plus, Begeleid Beleggen)

**Exports:**

- **Geen export van effectentransacties gevonden.** De beleggen-FAQ noemt de nota's, de vermogensrapportage en het box 3-overzicht, maar geen CSV of Excel van transacties ([FAQ beleggen](https://www.abnamro.nl/nl/prive/beleggen/service/index/path-detail/Beleggingen-kopen-of-verkopen/Orderstatus.html)). De handleiding van Mijn Dealingroom (Zelf Beleggen Plus, maart 2026) kent alleen een transactieoverzicht voor de _schaduwportefeuille_ ([handleiding](https://assets.abnamro.com/api/public/content/handleiding-mijn-dealingroom.pdf)).
- **Alles loopt via de tegenrekening.** Volgens de FAQ koppelt ABN AMRO de beleggingsrekening aan een tegenrekening naar keuze, zoals een _Beleggers Spaarrekening_ of je privérekening. Aankopen worden daarvan afgeschreven, verkopen en uitkeringen komen erop binnen. Op die rekening zie je ook de details van je order ([FAQ beleggen](https://www.abnamro.nl/nl/prive/beleggen/service/index/path-detail/Beleggingen-kopen-of-verkopen/Orderstatus.html)).
- **De bij- en afschrijvingen van die rekening** download je als pdf, txt, mt940, xls of camt.053, tot 18 maanden terug; oudere alleen als pdf-afschrift ([downloaden](https://www.abnamro.nl/nl/prive/betalen/bij-en-afschrijvingen/downloaden.html)).
- **Overige overzichten** (Internet Bankieren → _Zelf regelen → Overzichten en afschriften → Overige overzichten downloaden_):
  - de _Vermogensrapportage_: actuele waarde en ontwikkeling ([FAQ beleggen](https://www.abnamro.nl/nl/prive/beleggen/service/index/path-detail/Beleggingen-kopen-of-verkopen/Orderstatus.html));
  - het _Overzicht Box 3 Beleggen Transacties_ over 2018–2024, voor de opgaaf werkelijk rendement ([box 3](https://www.abnamro.nl/nl/prive/beleggen/service/overzicht-rendement-box-3.html));
  - het _Financieel Jaaroverzicht_.

  Het bestandsformaat staat er niet bij; vermoedelijk pdf.

- **API:** de _Investment Asset Report API_ geeft posities en transacties, maar alleen aan onafhankelijke vermogensbeheerders en andere tussenpartijen, in een pilot ([developer.abnamro.com](https://developer.abnamro.com/api-products/investment-asset-report/overview)). Niet voor particulieren.

**Hoe beleggingsregels op de tegenrekening eruitzien.** Dit komt uit één bron: een geanonimiseerd pdf-afschrift _Bij- en afschrijvingen_ van een Beleggers Spaarrekening (Zelf Beleggen Basis, fondsen), gepost op het forum van Portfolio Performance op 31 augustus 2026 en opgenomen als testbestand in een nog open pull request ([forum](https://forum.portfolio-performance.info/t/pdf-import-von-abn-amro-group/29478), [PR #5988](https://github.com/portfolio-performance/portfolio/pull/5988)). De omschrijvingen zijn Engels, over meerdere regels:

| Soort                       | Patroon in de omschrijving                                                                     | Teken op de rekening |
| --------------------------- | ---------------------------------------------------------------------------------------------- | -------------------- |
| Aankoop fonds               | `DEPOSIT INV. FUND <fonds>` `FONDSCODE <6 cijfers> PER <dd/mm> UNIT <aantal> @ EUR <koers>`    | af                   |
| Uitkering                   | `DIVIDEND <fonds>` `FONDSCODE <code> <dd.mm.jjjj> OVER PART <aantal> PAID WITH EUR <per stuk>` | bij                  |
| Kosten                      | `ABNAMRO Investments See your invoice for details`                                             | af                   |
| Rente op de spaarrekening   | `ACCOUNT BALANCED CREDIT INTEREST …`                                                           | bij                  |
| Storting van eigen rekening | SEPA-overboeking                                                                               | bij                  |

Een verkoop kwam in dit voorbeeld niet voor; dat patroon is onbekend. Hoe aandelen en ETF's van Zelf Beleggen er op de tegenrekening uitzien, is ook onbekend.

**Kolommen van de TAB-export** (zo leest `server/src/import/bank.ts` hem al): geen kopregel, tabs als scheiding, en per regel rekeningnummer, valuta, transactiedatum (JJJJMMDD), saldo vóór, saldo na, rentedatum, bedrag (decimale komma, negatief is af) en omschrijving. Of de omschrijving in de TAB-export dezelfde tekst heeft als in de pdf, is niet geverifieerd.

Verzonnen voorbeeld in die vorm:

```text
123456789	EUR	20260302	1000,00	749,00	20260302	-251,00	DEPOSIT INV. FUND VOORBEELD WERELD FONDSCODE 123456 PER 02/03 UNIT 2,0000 @ EUR 125,50
123456789	EUR	20260331	749,00	751,50	20260331	2,50	DIVIDEND VOORBEELD WERELD DIS FONDSCODE 123456 31.03.2026 OVER PART 10,0000 PAID WITH EUR 0,25
123456789	EUR	20260612	751,50	751,45	20260612	-0,05	ABNAMRO Investments See your invoice for details
```

**Naar Box3balans:**

- `DEPOSIT INV. FUND` → `buy`: aantal en koers uit `UNIT … @ EUR …`, naam uit de omschrijving, valuta EUR.
- `DIVIDEND` → `dividend`: het bedrag van de regel. Of er belasting is ingehouden, staat er niet bij.
- `ABNAMRO Investments` → `fee` in EUR.
- **Geen ISIN, alleen een fondscode.** De gebruiker moet per fondscode een belegging kiezen; het voorbeeldscherm van de import doet dat al voor symbolen.
- **Past eerder in de bankimport** dan in een eigen herkenner. Die leest dit bestand al en ziet de rente en de stortingen; hij zou de beleggingsregels kunnen aanbieden als transacties.

**Zekerheid: laag.** Eén pdf, een open pull request, geen TAB-voorbeeld en geen verkopen. Wacht op een echt bestand.

## 2. ING (Zelf op de Beurs)

ING noemt het product nu _Zelf op de Beurs_; daarnaast zijn er _Eenvoudig Beleggen_, _Vermogensbeheer_ en _Pensioenbeleggen_.

**Exports** (alles uit de beleggen-FAQ van ING, gelezen op 13 oktober 2026, [FAQ](https://www.ing.nl/particulier/datasource-chatbot/beleggen/veelgestelde-vragen-beleggen)):

- **Transacties:** in Mijn ING en de ING App open je het transactieoverzicht van je Zelf op de Beurs-rekening, kies je een periode en download je de transacties.
- **Portefeuille:** bij Zelf op de Beurs kun je een portefeuilleoverzicht downloaden als pdf of CSV; pdf alleen in Mijn ING.
- **Waarde op een datum:** de functie _Historisch portefeuilleoverzicht_, alleen in Mijn ING, onderaan de beleggingsrekening. Of die ook als CSV komt, zegt de FAQ niet.
- **Dividend:** te zien in het transactieoverzicht en bij de bij- en afschrijvingen, met in de details de ingehouden dividendbelasting.
- **Kosten:** elk kwartaal achteraf, standaard ten laste van de betaalrekening, of op verzoek van het gelddeel van de beleggingsrekening. Een specificatie staat op het beleggingsafschrift onder _Documenten_.
- **Jaaroverzicht** en het _Overzicht voor opgaaf werkelijk rendement_ (2017–2025) onder _Documenten → Beleggen_.

Volgens de handleiding van Portfolio Dividend Tracker, een gesloten tracker en dus tweedehands, gaat het zo ([PDT](https://help-en.portfoliodividendtracker.com/article/337-import-your-ing-actions), bijgewerkt 14 september 2026):

- alleen via de website, niet de app;
- _Beleggen_ → de beleggingsrekening → onderaan het _Transactieoverzicht_;
- tabblad _Beleggingen_ (aankopen, verkopen, dividend) en tabblad _Geld_ (stortingen, opnames, kosten), elk met _Download CSV_ onder de tabel;
- hoogstens 365 dagen per bestand;
- alleen Nederlandstalige exports.

**Kolommen: onbekend.** Geen open-sourceparser, testbestand of forumbericht met de kopregel gevonden. Portfolio Performance, Export-To-Ghostfolio en Ghostfolio hebben niets voor ING Nederland. Het beancount-pakket `beancount-ing` is voor ING Duitsland ([PyPI](https://pypi.org/project/beancount-ing/)).

**Wat het voorbeeldbestand moet laten zien:** de kopregels van beide tabbladen en van het portefeuilleoverzicht, het scheidingsteken, datum- en getalnotatie, de waarden in de soortkolom (aankoop, verkoop, dividend, dividendbelasting, kosten, storting, opname, corporate actions), en of er een ISIN in staat.

**Naar Box3balans** (voorlopig):

- Tabblad Beleggingen → `buy`, `sell` en `dividend` met `tax`.
- Tabblad Geld → `deposit`, `withdrawal` en `fee`. Kosten die van de betaalrekening gaan, staan er vermoedelijk niet in.
- Het portefeuilleoverzicht op een datum kan net als DEGIRO's _Portefeuille_ een `Statement` worden in `server/src/import/statement.ts`, als het per regel een ISIN en een aantal heeft.

## 3. Meesman Indexbeleggen

**Exports:**

- **Transacties:** in MijnMeesman onder _Opdrachten → Transacties_, met onderaan de tabel de knop _Exporteren als Excel_. Dat staat in Meesmans eigen uitleg bij de opgaaf werkelijk rendement (pdf van 10 oktober 2025, [uitleg](https://www.meesman.nl/media/5ktnud20/uitlegdocument-opgeven-werkelijk-rendement-box-3.pdf)).
- **Jaaroverzicht:** in MijnMeesman onder _Documenten_ ([uitleg](https://www.meesman.nl/media/5ktnud20/uitlegdocument-opgeven-werkelijk-rendement-box-3.pdf)).
- **Box 3-tips van Meesman zelf:** tel het herbelegde (netto) dividend bij de aankopen en stortingen, en laat switchtransacties weg bij zowel aankopen als verkopen. Een Pensioenrekening telt niet mee voor box 3.

**Kolommen: onbekend.** Geen voorbeeldbestand of parser gevonden. Of het bestand .xlsx, .xls of eigenlijk CSV is, is ook onbekend. Box3balans leest geen Excel; de gebruiker slaat het op als CSV, zoals bij Saxo.

**Aanwijzing voor de inhoud.** De onofficiële API-wrapper `meesman-wrapper` (MIT) beschrijft de transacties achter MijnMeesman ([order.py](https://github.com/clrxbl/meesman-wrapper/blob/main/meesman/models/order.py)):

- velden zoals uitvoerdatum, fonds, bedrag en aantal participaties;
- opdrachtsoorten _Deposit_, _Withdrawal_, _PeriodicDeposit_, _PeriodicWithdrawal_, _Switch_, _Rebalance_ en _Refund_;
- onderliggende soorten zoals _Buy_, _Sell_, _ReInvest_, _SwitchBuy_ en _SwitchSell_.

Dat is de interne API, niet de Excel-export; de Nederlandse labels in de export kunnen anders zijn. Niet geverifieerd.

**Naar Box3balans** (voorlopig):

- Inleg → `buy` van het fonds; verkoop of opname → `sell`. Zonder aparte geldrekening, dus zonder `deposit`.
- Herbelegd dividend → `dividend` plus `buy` van hetzelfde bedrag.
- Switch → `sell` plus `buy`. Box3balans telt dat dan als geld erin en eruit; dat moet de herkenner voorkomen.
- Kosten zitten in de koers van de fondsen: geen `fee`-regels.

## 4. Brand New Day (beleggen, vrij vermogen)

**Exports:**

- **In MijnBND** zie je de actuele portefeuille, het rendement, de kosten en de uitgevoerde orders. Na elk kwartaal komt er een kwartaaloverzicht met per fonds de waarde aan het begin en eind van het kwartaal, de inleg en onttrekkingen en de uitgevoerde transacties. Elk jaar komt er een financieel jaaroverzicht met de begin- en eindwaarde, het dividend en de ingehouden dividendbelasting. Je vindt ze onder _Mijn documenten_; ook oude kwartaaloverzichten, jaaroverzichten en transactieoverzichten blijven beschikbaar ([informatie beleggingsrekening, versie 5 december 2024](https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf), [FAQ jaaroverzicht](https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/)).
- **Formaat:** Brand New Day noemt het niet. Een gebruiker op het forum van Portfolio Performance had alleen een pdf _Overzicht beleggingstransacties_ (februari en november 2025). De kolommen daarin zijn `#`, `Datum`, `Soort` (Koop, Verkoop), `Fonds`, `Aantal`, `Prijs` en `Bedrag`, met een verkoop als negatief bedrag. Hij vond niets anders dan die pdf ([forum](https://forum.portfolio-performance.info/t/pdf-import-from-brand-new-day/31804)). Tweedehands.
- **Geen CSV- of Excel-export gevonden**, ook niet in de FAQ over MijnBND ([FAQ MijnBND](https://new.brandnewday.nl/veelgestelde-vragen/categorie/mijnbnd/)).

**Past niet** bij een CSV-herkenner. Gebruik _Waarden per jaar_ met het financieel jaaroverzicht, of het sjabloon.

## 5. Peaks

**Exports** (alles uit de FAQ van Peaks, [FAQ](https://www.peaks.com/nl/nl/faq-service/)):

- **Jaaroverzicht in februari** met de waarde van je beleggingen op 1 januari.
- **Kwartaalrapport** met alle beleggingstransacties en de kosten, "op een duurzame drager" (vermoedelijk pdf).
- **Stortingen en opnames** zie je in het scherm _In en uit_ van de app.
- **Geen export van transacties** gevonden, ook geen CSV of Excel. De beleggingen zijn ETF's met ISIN, die Peaks in de FAQ noemt.

**Past niet** bij een CSV-herkenner. Gebruik _Waarden per jaar_ met de waarde op 1 januari uit het jaaroverzicht.

## 6. Lightyear

**Exports:**

- **CSV:** _Transactions → Download report and Account statement_, een periode kiezen, _Export CSV_. Dat staat in een blog van Lightyear zelf (Spaanse markt, 3 februari 2026, [Lightyear + Autodeclaro](https://lightyear.com/en-es/blog/lightyear-autodeclaro)). DeclaRenta noemt hetzelfde bestand _Transaction report_, in de app onder _Profiel → Rapporten_ ([brokers.md](https://github.com/GeiserX/DeclaRenta/blob/main/docs/brokers.md)).
- **Pdf-overzichten:** rekeningoverzicht, jaaropgaaf, vermogenswinstrekening en kosten- en lastenoverzicht. De Nederlandse helppagina noemt alleen _PDF downloaden_ (app) en _PDF Exporteren_ (web) ([help NL](https://lightyear.com/nl-nl/help/trading-and-investments/tax-and-statement)).
- **Posities:** het pdf-rekeningoverzicht splitst je open posities uit; de CSV heeft geen posities ([help NL](https://lightyear.com/nl-nl/help/trading-and-investments/tax-and-statement), [lightyear.ts](https://github.com/GeiserX/DeclaRenta/blob/main/src/parsers/lightyear.ts)).

**Kolommen.** Dezelfde dertien kolommen staan in drie onafhankelijke parsers die op echte bestanden zijn getest ([DeclaRenta](https://github.com/GeiserX/DeclaRenta/blob/main/src/parsers/lightyear.ts), [e-arveldaja-mcp](https://github.com/iseppo/e-arveldaja-mcp/blob/master/src/tools/lightyear-investments.ts), [turtle-backtest](https://github.com/jaaknt/turtle-backtest/blob/main/docs/specs/lightyear-data-import.md)) en in een vierde ([maisvalias-tool](https://github.com/Tomas-Silva-PT/maisvalias-tool/blob/main/src/parsers/brokerparsers/lightyear/lightyear2026-v1.ts)):

```text
Date,Reference,Ticker,ISIN,Type,Quantity,CCY,Price/share,Gross Amount,FX Rate,Fee,Net Amt.,Tax Amt.
```

- **Scheidingsteken:** komma. Er zijn twee varianten gezien: zonder aanhalingstekens, en met elke cel tussen aanhalingstekens plus een spatie vóór de kopregel (`␣"Date","Reference",…`). De CSV-parser van Box3balans slaat witruimte vóór een aanhalingsteken al over.
- **Datum:** `DD/MM/YYYY HH:MM:SS`, dag eerst. De tijdzone is onbekend.
- **Getallen:** decimale punt, geen duizendtallen gezien; aantallen en prijzen met negen decimalen (`8.000000000`). Lees met `num(raw, ".")`.
- **Lege cel:** niet van toepassing.
- **Teken en bedragen** (uit de rekenkunde in e-arveldaja-mcp, gecontroleerd op 107 aankopen met kosten, en uit het voorbeeld van turtle-backtest):
  - `Net Amt.` is altijd `Gross Amount − Fee`.
  - **Buy:** `Gross Amount` is wat van het geld afgaat (inclusief kosten), `Net Amt.` = aantal × koers. Beide positief.
  - **Sell:** `Gross Amount` = aantal × koers, `Net Amt.` is wat binnenkomt. Beide positief.
  - **Dividend, Distribution:** `Gross Amount` = `Net Amt.` + `Tax Amt.` + `Fee`.
  - **Withdrawal:** negatief. **Deposit:** positief.
  - **Conversion:** twee regels met dezelfde `Reference`, één per valuta: positief voor de valuta die je krijgt, negatief voor die je betaalt. De kosten staan op één van beide. `FX Rate` is ingevuld; welke kant op die koers gaat, is niet geverifieerd.

**Soorten in `Type`:** `Buy`, `Sell`, `Dividend`, `Distribution`, `Interest`, `Reward`, `Conversion`, `Deposit` en `Withdrawal` ([e-arveldaja-mcp](https://github.com/iseppo/e-arveldaja-mcp/blob/master/src/tools/lightyear-investments.ts)). Splitsingen, overboekingen van effecten en andere corporate actions zijn in geen van de bronnen gezien; DeclaRenta waarschuwt voor onbekende soorten.

**Voorvoegsels in `Reference`:** `OR-` order, `DD-` dividend, `IN-` rente en uitkering van een geldmarktfonds, `RW-` beloning, `CN-` valutawissel, `DT-` storting, `WL-` opname.

**Distribution** kwam in de voorbeelden alleen voor bij twee geldmarktfondsen (ISIN IE000GWTNRJ7 en IE00B44BQ083), met een `Fee` erop. Die fondsen worden met `Buy` en `Sell` tegen koers 1 gekocht en verkocht; e-arveldaja-mcp noemt ze de geldparkeerfondsen van Lightyear. Voor box 3 zijn het gewone beleggingen.

**Verzonnen voorbeelden:**

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

**Naar Box3balans:**

| `Type`                  | Rij                     | Velden                                                                                                                                |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `Buy`                   | `buy`                   | isin, symbol = `Ticker`, quantity = `Quantity`, price = `Price/share`, currency = `CCY`, fee = `Fee`, id = `lightyear:` + `Reference` |
| `Sell`                  | `sell`                  | idem                                                                                                                                  |
| `Dividend`              | `dividend`              | amount = `Gross Amount`, tax = `Tax Amt.`, currency = `CCY`                                                                           |
| `Distribution`          | `dividend`              | idem; een `Fee` als aparte `fee`-regel in `CCY`                                                                                       |
| `Interest`, `Reward`    | `reward`                | geld in `CCY`, alleen zinvol als het geld wordt gevolgd                                                                               |
| `Deposit`, `Withdrawal` | `deposit`, `withdrawal` | idem                                                                                                                                  |
| `Conversion`            | overslaan               | "Geldbewegingen (stortingen, opnames, valutawissel)"                                                                                  |
| anders                  | overslaan               | "Overige regels (corporate actions, productwijzigingen)"                                                                              |

**Geld wel of niet volgen.** Lightyear houdt geld in meerdere valuta's en wisselt met aparte `Conversion`-regels. Box3balans kent geen valutawissel als soort. Een wissel als `withdrawal` plus `deposit` boeken, telt voor box 3 als geld erin en eruit. Voorstel voor de eerste versie: doe het zoals bij Trading 212. Lees aankopen, verkopen en dividend; laat geld, rente, beloningen en wissels weg; meld ze bij het controleren.

**Herkennen:** `hasColumns(h, "reference", "ticker", "isin", "type", "ccy", "gross amount", "net amt", "tax amt")`. De kop `Price/share` wordt na `norm()` `price share`, dus Revolut (`price per share`, `total amount`) botst niet.

**Zekerheid: hoog** voor de kolommen en de rekenkunde. Of een Nederlandse rekening (Nederlandse app-taal) dezelfde Engelse koppen en soorten krijgt, is niet geverifieerd.

## 7. Scalable Capital

**Exports:**

- **CSV, alleen met PRIME+ Broker.** _Transacties_ → alle of losse regels selecteren → _CSV exporteren_; het bestand komt in je downloadmap. Bij de FREE Broker kan het niet; je kunt op elk moment wisselen naar PRIME+ ([help NL](https://help.scalable.capital/nl/accountbeheer-f3197dc7/kan-ik-informatie-over-mijn-portfolio-exporteren-bijvoo-c0ca1b71), bijgewerkt 4 augustus 2026; [help EN](https://help.scalable.capital/en/account-management-f3197dc7/can-i-export-information-about-my-portfolio-such-as-a-cs-4f77cde3)). De aankondiging van december 2024 noemde nog PRIME en PRIME+ ([productnieuws](https://nl.scalable.capital/en/product-news/transactions-export)).
- **Filters in het transactieoverzicht** (Engelse helppagina): ordertype _Buy, Sell, Savings plan, Deposit, Withdrawal, Distribution, Portfolio transfer, Fees (excluding order fees), Corporate action, Taxes, Interest_; status _Pending, Executed, Canceled, Expired, Rejected_. De Nederlandse pagina vertaalt ze (Aankoop, Verkoop, Periodiek beleggen …). In de CSV stonden in alle voorbeelden de Engelse waarden.
- **Pdf:** een effectennota per transactie, meestal binnen 48 uur, en elke maand een rekeningoverzicht in je mailbox.
- **Stand op een datum:** _Profile → Personal Information → Copy of your data → Request financial status_, met een peildatum naar keuze. Het document komt in je mailbox; het formaat staat er niet bij. Daarnaast komt er elk kwartaal een overzicht van je bezit op de laatste dag van het vorige kwartaal. Beide gaan alleen over de bewaring bij Scalable zelf; voor een depot bij Baader Bank vraag je het bij Baader aan ([help](https://help.scalable.capital/en/account-management-f3197dc7/how-do-i-receive-an-account-statement-or-financial-statu-4d777d0f)).

**Kolommen.** Uit het sjabloon _Scalable Capital_ dat Portfolio Performance sinds april 2026 meelevert ([csv-config.json](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/csv/csv-config.json), [commit 1c1d432](https://github.com/portfolio-performance/portfolio/commit/1c1d432227af697fce0d37e4eed856a6d3c09f41)). Hetzelfde staat in twee voorbeelden van gebruikers, uit 2024 en 2025 ([forum](https://forum.portfolio-performance.info/t/csv-import-von-scalable-capital/30113), [Export-To-Ghostfolio #272](https://github.com/dickwolff/Export-To-Ghostfolio/issues/272)):

```text
date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency
```

- **Scheidingsteken:** puntkomma. **Codering:** UTF-8 (volgens het sjabloon).
- **Datum:** `YYYY-MM-DD`, tijd los als `HH:MM:SS`. Geldregels hebben vaak 01:00:00 of 02:00:00, vermoedelijk middernacht UTC in lokale tijd.
- **Getallen:** decimale komma met punt voor duizendtallen (`1.526,72`), soms met veel decimalen (`-74,989475`). Lees met `num(raw, ",")`, niet met `looseNum`: die leest `1.000` als 1.
- **`reference` en `description`** staan tussen aanhalingstekens. Orders beginnen met `SCAL`, uitkeringen en belastingen met `WWEK`; stortingen en opnames hebben een lange code.
- **`assetType`:** `Security` bij aan- en verkopen, `Cash` bij geldregels, uitkeringen en belastingen.
- **`status`:** in alle voorbeelden `Executed`.
- **`type`** volgens het sjabloon van Portfolio Performance: `Buy`, `Savings plan`, `Sell`, `Distribution`, `Deposit`, `Withdrawal`, `Fee`, `Interest`, `Taxes`, `Cash Transfer In` en `Cash Transfer Out`. In de voorbeelden van gebruikers: `Buy`, `Sell`, `Savings plan`, `Distribution`, `Deposit`, `Withdrawal` en `Taxes`. De waarden voor corporate actions en overboekingen van effecten zijn onbekend; een gebruiker meldt dat ze in hetzelfde bestand staan ([forum](https://forum.portfolio-performance.info/t/csv-import-von-scalable-capital/30113)).

**Teken en bedragen** (uit de voorbeelden van gebruikers, dus tweedehands):

- `amount` is negatief als er geld afgaat (aankoop, spaarplan, opname, belasting) en positief als het binnenkomt (verkoop, storting, uitkering).
- **Aankoop en spaarplan:** `amount` = −(`shares` × `price`), onafgerond.
- **Verkoop:** `amount` = `shares` × `price`, zonder de belasting in `tax` eraf. Een gebruiker bevestigt dat ([forum, 21 februari 2025](https://forum.portfolio-performance.info/t/csv-import-von-scalable-capital/30113)).
- **Uitkering:** `amount` lijkt netto. Met `amount` + `tax` als bruto komt de belasting uit op het Duitse tarief; dat is afgeleid, niet bevestigd.
- **`fee`** was in alle voorbeelden 0,00. Of `amount` de kosten bevat, is onbekend.
- `fee` en `tax` zijn positief; bij geldregels is `tax` soms leeg.

**Verzonnen voorbeelden:**

```text
date;time;status;reference;description;assetType;type;isin;shares;price;amount;fee;tax;currency
2026-01-05;01:00:00;Executed;"AB12CD34EF56GH78IJ90KL";"Voorbeeldstorting";Cash;Deposit;;;;500,00;0,00;;EUR
2026-01-06;10:15:30;Executed;"SCALaB3cD4eF5gH";"Voorbeeld Wereld ETF (Acc)";Security;Buy;IE0000000001;12;85,40;-1.024,80;0,00;0,00;EUR
2026-02-02;14:02:11;Executed;"SCALiJ6kL7mN8oP";"Voorbeeld Wereld ETF (Acc)";Security;Savings plan;IE0000000001;1,171;85,39;-99,99169;0,00;0,00;EUR
2026-05-20;16:40:05;Executed;"SCALqR9sT0uV1wX";"Voorbeeld Aandeel";Security;Sell;NL0000000002;30;41,10;1.233,00;0,00;0,00;EUR
2026-06-15;02:00:00;Executed;"WWEK 10000001";"Voorbeeld Dividend ETF (Dist)";Cash;Distribution;IE0000000003;;;12,75;0,00;2,25;EUR
2026-07-01;02:00:00;Executed;"CD34EF56GH78IJ90KL12MN";"Voorbeeldopname";Cash;Withdrawal;;;;-200,00;0,00;;EUR
```

**Naar Box3balans:**

| `type`                            | Rij                   | Velden                                                                                                                  |
| --------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Buy`, `Savings plan`             | `buy`                 | isin, name = `description`, quantity = `shares`, price = `price`, currency, fee = `fee`, id = `scalable:` + `reference` |
| `Sell`                            | `sell`                | idem; staat er iets in `tax`, meld dat (Duitse belasting, voor Nederlanders normaal 0)                                  |
| `Distribution`                    | `dividend`            | amount = `amount` + `tax` (bruto), tax = `tax`                                                                          |
| `Deposit`, `Cash Transfer In`     | `deposit`             | EUR, quantity = \|`amount`\|                                                                                            |
| `Withdrawal`, `Cash Transfer Out` | `withdrawal`          | idem                                                                                                                    |
| `Interest`                        | `reward`              | EUR                                                                                                                     |
| `Fee`                             | `fee`                 | EUR                                                                                                                     |
| `Taxes`                           | overslaan met melding | in de voorbeelden Duitse belasting per ISIN; geen soort in het sjabloon                                                 |
| status anders dan `Executed`      | overslaan             | "Niet uitgevoerde orders"                                                                                               |
| anders                            | overslaan             | "Overige regels (corporate actions, productwijzigingen)"                                                                |

- **Instellingen:** alles is in euro's, dus `settleCash: true` en `feeCurrency: "EUR"`, zoals bij Trade Republic. Dan klopt het geldsaldo bij Scalable.
- **Herkennen:** `hasColumns(h, "date", "time", "status", "reference", "assettype", "type", "isin", "shares", "price", "amount", "fee", "tax", "currency")`. De tweede kolom is `time`, dus de herkenner van Trade Republic (`datum`/`date`, dan `type`) pakt hem niet.

**Zekerheid:** hoog voor de kop en de notatie (sjabloon plus twee onafhankelijke voorbeelden); middel voor de soorten buiten aan- en verkoop, de tekens en wat `amount` bevat. Alle voorbeelden komen van Duitse klanten. Of een Nederlandse rekening dezelfde Engelse waarden en Duitse getalnotatie krijgt, is niet geverifieerd.

## Niet geverifieerd

- **ING:** alle kolomkoppen, het scheidingsteken, de datum- en getalnotatie en de soortwaarden van beide tabbladen; of het portefeuilleoverzicht als CSV ook op een historische datum kan; de grens van 365 dagen (alleen tweedehands, van Portfolio Dividend Tracker).
- **Meesman:** de kolommen van de Excel-export, of het echt Excel is, de Nederlandse namen van de soorten, en hoe herbelegd dividend en switches erin staan.
- **ABN AMRO:**
  - of de TAB- en xls-export van de tegenrekening dezelfde omschrijvingen heeft als het pdf-afschrift;
  - hoe een verkoop van een fonds eruitziet;
  - hoe aandelen en ETF's van Zelf Beleggen op de tegenrekening staan;
  - of de Beleggers Spaarrekening als TAB te downloaden is;
  - het formaat en de frequentie van de Vermogensrapportage.
- **Brand New Day:** of er naast pdf een andere export bestaat (alleen het bericht van één gebruiker gezien), en het formaat van de kwartaal- en jaaroverzichten.
- **Peaks:** of er in de webomgeving toch een export is, en het formaat van jaaroverzicht en kwartaalrapport.
- **Lightyear:**
  - de tijdzone van `Date`;
  - of een Nederlandse rekening dezelfde koppen en soorten krijgt;
  - de soortwaarden voor splitsingen, overboekingen en andere corporate actions;
  - de richting van `FX Rate`;
  - waar de variant met en die zonder aanhalingstekens vandaan komt (app of web).
- **Scalable Capital:**
  - de waarden `Fee`, `Interest` en `Cash Transfer In/Out` (alleen uit het sjabloon van Portfolio Performance) en die voor corporate actions en overboekingen (onbekend);
  - of `amount` de orderkosten bevat;
  - dat `amount` bij een uitkering netto is (afgeleid uit voorbeeldbedragen);
  - de statuswaarden naast `Executed` en de tijdzone van `time`;
  - of Nederlandse klanten hetzelfde bestand krijgen;
  - het formaat van de vermogensstatus.

## Bronnen

ABN AMRO:

- FAQ beleggen (tegenrekening, vermogensrapportage, nota's): https://www.abnamro.nl/nl/prive/beleggen/service/index/path-detail/Beleggingen-kopen-of-verkopen/Orderstatus.html
- Bij- en afschrijvingen downloaden: https://www.abnamro.nl/nl/prive/betalen/bij-en-afschrijvingen/downloaden.html
- Overzicht rendement box 3: https://www.abnamro.nl/nl/prive/beleggen/service/overzicht-rendement-box-3.html
- Handleiding Mijn Dealingroom (maart 2026): https://assets.abnamro.com/api/public/content/handleiding-mijn-dealingroom.pdf
- Investment Asset Report API: https://developer.abnamro.com/api-products/investment-asset-report/overview

ING:

- Veelgestelde vragen Beleggen: https://www.ing.nl/particulier/datasource-chatbot/beleggen/veelgestelde-vragen-beleggen
- Portfolio Dividend Tracker, ING importeren (gesloten software, tweedehands): https://help-en.portfoliodividendtracker.com/article/337-import-your-ing-actions

Meesman:

- Uitlegdocument opgeven werkelijk rendement box 3: https://www.meesman.nl/media/5ktnud20/uitlegdocument-opgeven-werkelijk-rendement-box-3.pdf
- FAQ voor bestaande klanten: https://www.meesman.nl/veelgestelde-vragen/voor-bestaande-klanten/

Brand New Day:

- Belangrijke informatie over uw beleggingsrekening (versie 5 december 2024): https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf
- FAQ jaaroverzicht: https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/
- FAQ MijnBND: https://new.brandnewday.nl/veelgestelde-vragen/categorie/mijnbnd/ en https://new.brandnewday.nl/veelgestelde-vragen/mijnbnd/hoe-kan-ik-zien-hoe-het-met-mijn-rekening-gaat/

Peaks:

- Contact en veelgestelde vragen: https://www.peaks.com/nl/nl/faq-service/

Lightyear:

- Help, belasting en overzichten (NL): https://lightyear.com/nl-nl/help/trading-and-investments/tax-and-statement
- Blog Lightyear + Autodeclaro (3 februari 2026): https://lightyear.com/en-es/blog/lightyear-autodeclaro
- Blog over de eerste overzichten (2022): https://lightyear.com/en-eu/blog/lightyear-statements-are-here
- Sharesight over Lightyear-CSV (alleen aan- en verkopen): https://www.sharesight.com/au/partners/lightyear/

Scalable Capital:

- Help, CSV-export (NL): https://help.scalable.capital/nl/accountbeheer-f3197dc7/kan-ik-informatie-over-mijn-portfolio-exporteren-bijvoo-c0ca1b71
- Help, CSV-export (EN): https://help.scalable.capital/en/account-management-f3197dc7/can-i-export-information-about-my-portfolio-such-as-a-cs-4f77cde3
- Help, rekeningoverzicht en vermogensstatus: https://help.scalable.capital/en/account-management-f3197dc7/how-do-i-receive-an-account-statement-or-financial-statu-4d777d0f
- Productnieuws, transactie-export (12 december 2024): https://nl.scalable.capital/en/product-news/transactions-export

Open-sourceprojecten (code en testbestanden; niets gekopieerd, alle voorbeeldregels hierboven zijn verzonnen):

- Portfolio Performance, **EPL-1.0**: CSV-sjabloon Scalable Capital in https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/csv/csv-config.json; open PR #5988 met het Nederlandse ABN AMRO-afschrift: https://github.com/portfolio-performance/portfolio/pull/5988; de bestaande `ABNAMROGroupPDFExtractor` leest alleen Duitse MoneYou-afschriften.
- DeclaRenta, **AGPL-3.0**: https://github.com/GeiserX/DeclaRenta (`src/parsers/lightyear.ts`, `tests/fixtures/lightyear-sample.csv`, `docs/brokers.md`)
- e-arveldaja-mcp, **Apache-2.0**: https://github.com/iseppo/e-arveldaja-mcp/blob/master/src/tools/lightyear-investments.ts
- maisvalias-tool, **MIT**: https://github.com/Tomas-Silva-PT/maisvalias-tool/blob/main/src/parsers/brokerparsers/lightyear/lightyear2026-v1.ts
- turtle-backtest, **geen licentie** (alleen gelezen): https://github.com/jaaknt/turtle-backtest/blob/main/docs/specs/lightyear-data-import.md
- meesman-wrapper, **MIT** (onofficiële API, logt in; alleen als aanwijzing): https://github.com/clrxbl/meesman-wrapper/blob/main/meesman/models/order.py
- Export-To-Ghostfolio, **Apache-2.0**: geen converter voor deze zeven; issue #272 met een Scalable-voorbeeld van een gebruiker: https://github.com/dickwolff/Export-To-Ghostfolio/issues/272
- beancount-ing, **MIT**: voor ING Duitsland, niet Nederland: https://pypi.org/project/beancount-ing/

Forums (berichten van gebruikers, tweedehands):

- Portfolio Performance, CSV-import Scalable Capital: https://forum.portfolio-performance.info/t/csv-import-von-scalable-capital/30113
- Portfolio Performance, pdf-import ABN AMRO Group: https://forum.portfolio-performance.info/t/pdf-import-von-abn-amro-group/29478
- Portfolio Performance, pdf-import Brand New Day: https://forum.portfolio-performance.info/t/pdf-import-from-brand-new-day/31804

Niet gevonden: een importer of formaatbeschrijving voor een van deze zeven aanbieders in Ghostfolio zelf, in beancount-importers of in de documentatie van Parqet. Parqet koppelt Scalable Capital volgens een zoekresultaat via _Autosync_, dus met inloggen; dat valt buiten deze opzet en is niet nagelezen.
