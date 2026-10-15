# Aanbieders: waar Nederlandse huishoudens hun box 3 hebben, en hoe het Box3balans in komt

Onderzocht op 13 oktober 2026.

Dit is een backlog: per aanbieder wat er te halen is, langs welke route, hoeveel werk het is en hoe dringend. Elke kaart is los als GitHub-issue te gebruiken. Wat al eerder is uitgezocht, staat in [exportformaten.md](exportformaten.md) (ABN AMRO, ING, Meesman, Brand New Day, Peaks, Lightyear, Scalable Capital) en [degiro-koppeling.md](degiro-koppeling.md); dat wordt hier niet overgedaan.

## Kort

**Wat het meest uitmaakt voor box 3:**

- **Wat niet vooraf is ingevuld, wordt het makkelijkst vergeten.** Dat zijn vooral crypto, crowdfunding en aandelen van een buitenlandse werkgever (RSU's en ESPP bij Schwab, Morgan Stanley/E\*TRADE, Fidelity, Computershare; dat die niet vooraf ingevuld zijn, is niet geverifieerd). Cryptoplatforms melden vanaf 2026 wel transacties, maar geen saldi, en pas in januari 2027 voor het eerst ([BLOX](https://support.weareblox.com/hc/nl/articles/44505422300817-Welke-informatie-wordt-gedeeld), [BLOX over DAC8](https://support.weareblox.com/hc/nl/articles/44505479681041-Vanaf-wanneer-geldt-DAC8-voor-mijn-transacties)). Mogelijk geeft jaaroverzichten niet uit zichzelf door ([Mogelijk](https://www.mogelijk.nl/faq/jaaroverzichten)), Collin ook niet ([Collin](https://www.collincrowdfund.nl/veelgestelde-vragen/)).
- **Geldmarktfondsen zijn geen spaargeld.** Revolut _Dagelijkse Geldmarktfondsen_ en Wise _Interest_ beleggen in een fonds ([Revolut](https://help.revolut.com/nl-NL/help/app-features/flexible-accounts/difference-between-savings-and-flexible/), [Wise](https://www.wise.com/nl/interest)). In box 3 zijn dat overige bezittingen, niet banktegoeden. Wie de hele rekening als spaarrekening invoert, zit in de verkeerde categorie.
- **Eén platform, twee categorieën.** Bij Geldvoorelkaar en Lendahand hoort niet-geïnvesteerd geld in de wallet bij de banktegoeden en het uitgeleende geld bij de overige bezittingen ([Geldvoorelkaar](https://www.geldvoorelkaar.nl/veelgestelde-vragen/investeerders/), [Lendahand](https://www.lendahand.com/en-EU/pages/crowdfunding-taxes)). Dat zijn in Box3balans twee rekeningen.
- **Veel aanbieders geven alleen een pdf met de waarde op 1 januari.** Brand New Day, BLOX, Finst, Peaks, Raisin, de crowdfundingplatforms, Mintos, NPEX en de verzekeraars. _Waarden per jaar_ werkt daar nu al met de hand. Een lezer voor zulke pdf's (zie [Route: het pdf-jaaroverzicht](#route-het-pdf-jaaroverzicht)) dekt in één keer de grootste groep die nu buiten beeld blijft.
- **Wat niet kan.** Inloggen met een wachtwoord (BullionVault, DEGIRO), sleutels die ook kunnen betalen of handelen (bunq, Freedom24) en aggregators (PSD2, de vooraf ingevulde aangifte) vallen af door [ADR 0001](adr/0001-zelf-hosten.md) en [ADR 0005](adr/0005-geen-inlog-koppelingen.md). Zie [Bewust niet](#bewust-niet).

**Top 10 om nu te bouwen:**

1. **Brand New Day:** _waarden per jaar_ met het financieel jaaroverzicht nu, daarna een pdf-sjabloon voor het jaaroverzicht en het kwartaaloverzicht van Q4. Ruim 360.000 klanten, € 2,2 miljard in vrije beleggingsrekeningen.
2. **Revolut en Wise:** de bankimport een paar kopjes leren (`Completed Date`, `Running Balance`) en geldmarktfondsen apart houden. Klein werk.
3. **LYNX:** de bestaande koppeling met Interactive Brokers (Flex Web Service) testen en documenteren. LYNX-rekeningen zijn IBKR-rekeningen.
4. **Charles Schwab Equity Awards:** een herkenner voor de export van de award-geschiedenis (JSON of CSV).
5. **Morgan Stanley at Work / E\*TRADE:** een herkenner voor _BenefitHistory.xlsx_ en de holdings-export.
6. **Finst (met Anycoin Direct):** een herkenner voor de Excel-export van _Activiteit_. Vraagt eerst een voorbeeldbestand.
7. **Crypto.com App:** een herkenner voor de CSV van de app; de kopregel is bekend.
8. **Bitpanda:** een koppeling met de nieuwe openbare API met alleen leesrechten (crypto, aandelen, ETF's, metalen).
9. **Crowdfunding (Geldvoorelkaar, Collin, Lendahand, Mogelijk):** _waarden per jaar_ met een uitleg per platform en de splitsing wallet/uitgeleend geld.
10. **eToro:** een herkenner voor het _Account Statement_ (tabblad _Account Activity_).

Daarnaast, als fundament: **een lezer voor pdf-jaaroverzichten** (L). Die maakt nummer 1, 9 en een tiental kaarten met prioriteit 2 daarna klein werk. _De basis is gebouwd (oktober 2026); per aanbieder is nu een sjabloon nodig, zie [Route: het pdf-jaaroverzicht](#route-het-pdf-jaaroverzicht)._

## Routes

| Route                      | Wat                                                                                                                   | Waar in de code                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| (a) koppeling              | API-sleutel of token met alleen leesrechten                                                                           | `server/src/sync/`                                |
| (b) herkenner              | CSV-export (of Excel, opgeslagen als CSV) die vanzelf wordt herkend                                                   | `server/src/import/formats/`                      |
| (c) portefeuille-overzicht | posities op één dag, als controle en beginstand                                                                       | `server/src/import/statement.ts`                  |
| (d) waarden per jaar       | waarde op 1 januari, geld erin en eruit, inkomsten, kosten; met de hand of uit een bankexport                         | _Rekeningen → Waarden per jaar_, `import/bank.ts` |
| (e) wallet                 | publiek adres op een blockchain                                                                                       | `server/src/wallets/`                             |
| pdf-jaaroverzicht          | de waarde op 1 januari (en soms inkomsten en geld erin en eruit) uit een pdf; vult _waarden per jaar_, na bevestiging | `server/src/import/yearStatement.ts`              |

**Werk:** S = een dag of minder (uitleg, testen, een paar kopjes erbij); M = een herkenner of koppeling met tests, een paar dagen; L = een nieuw onderdeel.

**Prioriteit:** 1 = nu bouwen, 2 = daarna, 3 = alleen op verzoek. Gewogen naar bereik in Nederland, hoe erg het box 3-bedrag eronder lijdt als het ontbreekt (niet vooraf ingevuld, vaak vergeten, verkeerde categorie), en hoe haalbaar het is.

## Backlog

| Prio | Aanbieder                                                                                          | Soort             | Box 3-categorie                                                  | Route                         | Werk     | Nodig van een gebruiker                                                                            |
| ---- | -------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------- | ----------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| 1    | [Brand New Day](#brand-new-day)                                                                    | index, sparen     | overige bezittingen; banktegoeden (spaarrekening)                | (d) nu; pdf-jaaroverzicht     | S, dan M | tekst (pdftotext) van een financieel jaaroverzicht en een Q4-kwartaaloverzicht, bedragen veranderd |
| 1    | [Pdf-jaaroverzicht (basis)](#route-het-pdf-jaaroverzicht)                                          | onderdeel         | alle                                                             | nieuw                         | L        | per aanbieder de tekstlaag van één jaaroverzicht                                                   |
| 1    | [Revolut](#revolut)                                                                                | bank, fintech     | banktegoeden (buitenland); geldmarktfondsen: overige bezittingen | (d) bankimport uitbreiden     | S        | geanonimiseerd rekeningafschrift (CSV) met een spaar- en een fondsregel                            |
| 1    | [Wise](#wise)                                                                                      | betaalinstelling  | banktegoeden (buitenland); Interest: overige bezittingen         | (d) bankimport uitbreiden     | S        | geanonimiseerde statement-CSV in EUR en één andere valuta                                          |
| 1    | [LYNX](#lynx-en-mexem)                                                                             | broker            | overige bezittingen; geld: banktegoed                            | (a) bestaande IBKR-koppeling  | S        | iemand met een LYNX-rekening die een Flex-token probeert                                           |
| 1    | [Charles Schwab Equity Awards](#charles-schwab-equity-awards)                                      | aandelenplan      | overige bezittingen (buitenland)                                 | (b)                           | M        | geanonimiseerde export (JSON of CSV) met een vest, ESPP-aankoop, verkoop en dividend               |
| 1    | [Morgan Stanley at Work / E\*TRADE](#morgan-stanley-at-work-en-etrade)                             | aandelenplan      | overige bezittingen (buitenland)                                 | (b) + (c)                     | M        | _BenefitHistory.xlsx_ (Download Expanded) en de holdings-export, geanonimiseerd                    |
| 1    | [Finst en Anycoin Direct](#finst-en-anycoin-direct)                                                | crypto            | overige bezittingen                                              | (b); nu (d)                   | M        | geanonimiseerde Excel-export van _Activiteit_                                                      |
| 1    | [Crypto.com App](#cryptocom)                                                                       | crypto            | overige bezittingen                                              | (b)                           | M        | geanonimiseerde CSV met earn- en kaartregels                                                       |
| 1    | [Bitpanda](#bitpanda)                                                                              | crypto, effecten  | overige bezittingen                                              | (a)                           | M        | een leessleutel om tegen te testen, of opgeslagen antwoorden van de API                            |
| 1    | [Geldvoorelkaar](#geldvoorelkaar)                                                                  | crowdfunding      | overige bezittingen (uitgeleend geld); wallet: banktegoeden      | (d), later pdf                | S        | tekst van een jaaropgaaf                                                                           |
| 1    | [eToro](#etoro)                                                                                    | broker            | overige bezittingen                                              | (b)                           | M        | _Account Statement_, tabblad _Account Activity_ als CSV, geanonimiseerd                            |
| 2    | [BLOX](#blox)                                                                                      | crypto            | overige bezittingen                                              | (d), later pdf                | S        | tekst van een jaaroverzicht-pdf                                                                    |
| 2    | [Coinmerce](#coinmerce)                                                                            | crypto            | overige bezittingen                                              | (b)                           | M        | geanonimiseerde orders-CSV                                                                         |
| 2    | [Collin Crowdfund](#collin-crowdfund)                                                              | crowdfunding      | overige bezittingen (uitgeleend geld)                            | (d), later pdf                | S        | tekst van een jaaropgave                                                                           |
| 2    | [Lendahand](#lendahand)                                                                            | crowdfunding      | overige bezittingen; wallet: banktegoeden                        | (d), later pdf                | S        | tekst van een jaaroverzicht                                                                        |
| 2    | [Mogelijk](#mogelijk)                                                                              | crowdfunding      | overige bezittingen (uitgeleend geld of fonds)                   | (d), later pdf                | S        | tekst van een jaaroverzicht                                                                        |
| 2    | [Mintos](#mintos)                                                                                  | P2P               | overige bezittingen                                              | (d), later pdf                | S        | tekst van een tax report                                                                           |
| 2    | [Fidelity NetBenefits](#fidelity-netbenefits-en-stock-plan-services)                               | aandelenplan      | overige bezittingen (buitenland)                                 | (b)                           | M        | geanonimiseerde Activity-CSV                                                                       |
| 2    | [Computershare en EquatePlus](#computershare-en-equateplus)                                        | aandelenplan      | overige bezittingen (buitenland)                                 | pdf (c)                       | M        | tekst van een plan statement of holdings statement                                                 |
| 2    | [Meesman](#meesman)                                                                                | index             | overige bezittingen                                              | (b)                           | M        | de Excel-export (al gevraagd in #6)                                                                |
| 2    | [ING Zelf op de Beurs](#ing-abn-amro-en-de-andere-al-onderzochte-brokers)                          | broker            | overige bezittingen                                              | (b) + (c)                     | M        | beide tabbladen en het portefeuilleoverzicht (al gevraagd in #6)                                   |
| 2    | [Peaks](#peaks)                                                                                    | robo              | overige bezittingen                                              | (d), later pdf                | S        | tekst van een jaaroverzicht                                                                        |
| 2    | [Raisin](#raisin)                                                                                  | spaarplatform     | banktegoeden (buitenland)                                        | (d), later pdf                | S        | tekst van een financieel jaaroverzicht                                                             |
| 2    | [Grote Nederlandse banken](#grote-nederlandse-banken-al-ondersteund)                               | bank              | banktegoeden                                                     | (d) bestaat; testen           | S        | echte exports van ASN, Triodos, Knab en bunq (#6)                                                  |
| 2    | [Vermogensbeheer van banken en Van Lanschot](#vermogensbeheer-van-de-grote-banken-en-van-lanschot) | vermogensbeheer   | overige bezittingen                                              | (d), later pdf                | S        | tekst van een fiscaal jaaroverzicht                                                                |
| 2    | [Kapitaalverzekeringen](#kapitaalverzekeringen)                                                    | verzekering       | overige bezittingen (niet-vrijgesteld deel)                      | (d)                           | S        | geen                                                                                               |
| 2    | [ASN Groenprojectenfonds](#asn-groenprojectenfonds)                                                | groenfonds        | groene beleggingen                                               | (d)                           | S        | geen                                                                                               |
| 2    | [Triodos Groenfonds](#triodos-groenfonds)                                                          | groenfonds        | groene beleggingen t/m 2026, daarna overige bezittingen          | (d)                           | S        | geen                                                                                               |
| 3    | [N26](#n26)                                                                                        | bank              | banktegoeden (buitenland)                                        | (d) testen                    | S        | geanonimiseerde CSV                                                                                |
| 3    | [bunq](#bunq-stocks-en-api)                                                                        | bank, beleggen    | banktegoeden; Stocks: overige bezittingen                        | (d)                           | S        | geen                                                                                               |
| 3    | [PayPal](#paypal)                                                                                  | betaalinstelling  | banktegoeden (buitenland), niet geverifieerd                     | (d)                           | S        | geanonimiseerde activiteiten-CSV                                                                   |
| 3    | [Freedom24](#freedom24)                                                                            | broker            | overige bezittingen                                              | (b)                           | M        | broker report (XLSX), geanonimiseerd                                                               |
| 3    | [XTB](#xtb)                                                                                        | broker            | overige bezittingen                                              | (b)                           | M        | geanonimiseerde _Cash Operations_-CSV                                                              |
| 3    | [Semmie](#semmie-en-index-capital)                                                                 | robo, beheer      | overige bezittingen                                              | (d)                           | S        | onbekend wat er te downloaden is                                                                   |
| 3    | [NN Beheerd Beleggen](#nn-beheerd-beleggen)                                                        | beheer            | overige bezittingen                                              | (d)                           | S        | geen                                                                                               |
| 3    | [Centraal Beheer en a.s.r.](#centraal-beheer-en-asr)                                               | index, beheer     | overige bezittingen                                              | (d)                           | S        | geen                                                                                               |
| 3    | [Bitonic](#bitonic)                                                                                | crypto            | overige bezittingen                                              | (e) en (d)                    | S        | of er een export van het account is                                                                |
| 3    | [Bybit](#bybit)                                                                                    | crypto            | overige bezittingen                                              | (a)                           | M        | een leessleutel om tegen te testen                                                                 |
| 3    | [Binance](#binance)                                                                                | crypto (tot 2023) | overige bezittingen                                              | (b) of (a)                    | M        | geanonimiseerde _Transaction History_-CSV                                                          |
| 3    | [Bitstamp](#bitstamp)                                                                              | crypto            | overige bezittingen                                              | (a) of (b)                    | M        | een leessleutel of geanonimiseerde CSV                                                             |
| 3    | [Kapitaal Op Maat](#kapitaal-op-maat)                                                              | crowdfunding      | overige bezittingen (uitgeleend geld)                            | (d)                           | S        | geen                                                                                               |
| 3    | [Invesdor (Oneplanetcrowd)](#invesdor-oneplanetcrowd)                                              | crowdfunding      | overige bezittingen                                              | (d)                           | S        | geen                                                                                               |
| 3    | [DuurzaamInvesteren](#duurzaaminvesteren)                                                          | crowdfunding      | overige bezittingen                                              | (d)                           | S        | geen                                                                                               |
| 3    | [NPEX](#npex)                                                                                      | effectenplatform  | overige bezittingen                                              | (d), later pdf (c)            | S        | tekst van een fiscaal jaaroverzicht                                                                |
| 3    | [Go & Grow (Bondora)](#go--grow-bondora)                                                           | P2P               | overige bezittingen                                              | (d), eventueel (b)            | S        | geanonimiseerde Excel-export                                                                       |
| 3    | [Equiniti](#equiniti-eq)                                                                           | aandelenplan      | overige bezittingen (buitenland)                                 | onbekend                      | —        | wat EQ Shareview laat downloaden                                                                   |
| 3    | [BullionVault](#bullionvault)                                                                      | edelmetaal        | overige bezittingen                                              | kluis in grammen, met de hand | S        | geen                                                                                               |
| 3    | [Holland Gold](#holland-gold)                                                                      | edelmetaal        | overige bezittingen                                              | kluis in grammen, met de hand | S        | geen                                                                                               |
| 3    | [Banksparen en beleggingsrecht eigen woning](#banksparen-en-beleggingsrecht-eigen-woning)          | eigen woning      | box 1, soms box 3                                                | (d)                           | S        | geen                                                                                               |
| —    | [Anycoin Direct](#finst-en-anycoin-direct)                                                         | crypto (gestopt)  | overige bezittingen                                              | via Finst                     | —        | —                                                                                                  |
| —    | [Goldrepublic](#goldrepublic)                                                                      | edelmetaal        | overige bezittingen                                              | bestaat al (kluis in grammen) | —        | —                                                                                                  |

## Kaarten

### Banken en sparen

#### Grote Nederlandse banken (al ondersteund)

**Wat:** ING, Rabobank, ABN AMRO, ASN Bank/SNS/RegioBank, Triodos, Knab en bunq. Banktegoeden.

**Stand:** _Bankexport inlezen_ leest al CSV met saldokolom (ING, Rabobank), het TAB-bestand van ABN AMRO, CAMT.053, MT940 en CSV zonder saldo ([README](../README.md#waarden-per-jaar-en-bankexports), `server/src/import/bank.ts`). De exports van ASN Bank, Triodos, Knab en bunq zijn nog niet getest met echte bestanden ([#6](https://github.com/zenonymous/box3balans/issues/6)). bunq biedt PDF, CSV en MT940 ([bunq](https://help.bunq.com/articles/what-types-of-bank-statements-can-i-export)).

**PSD2:** valt af; zie [Bewust niet](#bewust-niet).

**Advies:** niets nieuws bouwen; blijven vragen om echte exports. Werk S, prio 2.

#### Revolut

**Wat:** betaalrekening en _Dagelijks Sparen_ bij de bank van Revolut: banktegoeden, vermoedelijk in het buitenland (Revolut Bank UAB, Litouwen; niet in de gelezen pagina's bevestigd). Daarnaast _Dagelijkse Geldmarktfondsen_ (Flexible Cash Funds) van Revolut Securities Europe UAB: dat zijn beleggingen in geldmarktfondsen, dus overige bezittingen ([verschil tussen beide](https://help.revolut.com/nl-NL/help/app-features/flexible-accounts/difference-between-savings-and-flexible/), [Dagelijks Sparen](https://www.revolut.com/nl-NL/savings/open-a-savings-account/)). Het aandelenoverzicht leest Box3balans al ([README](../README.md#csv-import)).

**Bereik:** geen Nederlands klantenaantal gevonden; Revolut noemt alleen wereldwijde aantallen ([Revolut](https://www.revolut.com/nl-NL/savings/open-a-savings-account/)).

**Routes:**

- **API:** geen API voor particuliere rekeningen gevonden.
- **CSV:** het rekeningafschrift heeft volgens open-sourceparsers de kop `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance` ([revolut-toolkit](https://github.com/lastunicorn/revolut-toolkit), MIT). Tweedehands: niet bij Revolut zelf gezien.
- **Wat Box3balans nu doet:** de bankimport herkent geen datumkolom, want `Started Date` en `Completed Date` passen niet in het patroon voor datums in `server/src/import/bank.ts`. Het bestand wordt dus geweigerd.

**Advies:** (d), de bankimport uitbreiden:

- `Completed Date` als datum, `Balance` bestaat al als saldokolom;
- regels met `State` anders dan `COMPLETED` overslaan;
- `Product` (zoals _Current_ en _Savings_) en `Currency` gebruiken om rekeningen uit elkaar te houden, zoals nu al met de rekeningkolom;
- bij geldmarktfondsregels melden dat die bij de overige bezittingen horen.

Werk S, prio 1.

**Nodig:** een geanonimiseerd afschrift met een spaarregel en een geldmarktfondsregel.

**Open vragen:** staan geldmarktfondsen in hetzelfde CSV-bestand of in een eigen overzicht? Wat staat er in `Product`?

#### Wise

**Wat:** saldi in meerdere valuta bij Wise. Hoe de Belastingdienst die indeelt (banktegoeden in het buitenland?), is niet geverifieerd. _Interest_ belegt het saldo in een geldmarktfonds van BlackRock via Wise Assets Europe AS: overige bezittingen ([Wise Interest NL](https://www.wise.com/nl/interest)).

**Routes:**

- **API:** persoonlijke tokens geven geen saldo-afschriften, behalve voor rekeningen in de VS, Canada, Australië, Nieuw-Zeeland, Singapore en Maleisië ([Wise, personal API tokens](https://docs.wise.com/guides/developer/auth-and-security/personal-api-token.md)). Voor Nederland dus niet bruikbaar.
- **CSV:** de statement-export heeft volgens open-sourceparsers onder meer `TransferWise ID`, `Date`, `Amount`, `Currency`, `Description`, `Payment Reference`, `Running Balance`, `Exchange From`, `Exchange To`, `Exchange Rate` en `Total fees` ([ledger-autosync, wise.py](https://github.com/egh/ledger-autosync/blob/master/examples/plugins/wise.py), GPL-3.0). Tweedehands.
- **Wat Box3balans nu doet:** `Date` en `Amount` worden herkend, `Running Balance` niet als saldo. De import valt dus terug op "CSV zonder saldo".

**Advies:** (d): `Running Balance` toevoegen aan de saldokolommen en per `Currency` een aparte rekening maken; vreemde valuta tegen de ECB-koers van 1 januari, zoals de Belastingdienst vraagt ([Belastingdienst, bezittingen box 3 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_)). Interest als aparte rekening met _waarden per jaar_. Werk S, prio 1.

**Nodig:** een geanonimiseerde statement-CSV in EUR en één andere valuta.

**Open vraag:** staan Interest-mutaties in het gewone statement?

#### N26

**Wat:** betaalrekening bij N26: banktegoeden, vermoedelijk in het buitenland (niet nagelezen).

**CSV:** volgens een open-sourceparser `Booking Date`, `Value Date`, `Partner Name`, `Partner Iban`, `Type`, `Payment Reference`, `Account Name`, `Amount (EUR)`, `Original Amount`, `Original Currency`, `Exchange Rate`, zonder saldo ([you-need-a-parser, n26.ts](https://github.com/leolabs/you-need-a-parser/blob/master/packages/ynap-parsers/src/de/n26/n26.ts), MIT). Tweedehands.

**Advies:** (d). De kopjes `Booking Date` en `Amount (EUR)` passen al in de patronen van `bank.ts`; dit werkt waarschijnlijk als "CSV zonder saldo". Alleen testen. Werk S, prio 3.

#### Raisin

**Wat:** spaarrekeningen en deposito's bij buitenlandse partnerbanken: banktegoeden in het buitenland ([Raisin](https://www.raisin.com/nl-nl/sparen/financieel-jaaroverzicht/)).

**Routes:**

- **Jaaroverzicht:** een _Financieel Jaaroverzicht_ als pdf in de bijlage van een bericht in je Raisin-account ([Raisin](https://www.raisin.com/nl-nl/sparen/financieel-jaaroverzicht/)). Wat er precies in staat (saldo per rekening op 1 januari, bronbelasting), zegt de pagina niet.
- **Bronbelasting:** buitenlandse bronbelasting op rente is te verrekenen in box 3 ([Raisin, belasting](https://www.raisin.com/nl-nl/belasting/)). Box3balans kent ingehouden belasting al bij dividend; bij rente op een rekening met _waarden per jaar_ niet.
- **CSV of API:** niet gevonden.

**Advies:** (d), per partnerbank één rekening met het vinkje buitenland; later een pdf-sjabloon. Werk S, prio 2.

**Open vraag:** moet _waarden per jaar_ ingehouden bronbelasting op rente kunnen vastleggen?

#### bunq (Stocks en API)

**Wat:** betaal- en spaarrekeningen (banktegoeden, al ondersteund) en _bunq Stocks_, uitgevoerd door de Duitse partner Ginmon ([bunq, Ginmon](https://help.bunq.com/articles/ginmon-our-bunq-stocks-partner)): overige bezittingen.

**Routes:**

- **API:** een persoonlijke sleutel kan je rekening besturen en betalingen doen ([bunq API keys](https://doc.bunq.com/basics/authentication/api-keys)). Geen leesrechten-only, dus geen koppeling (ADR 0005).
- **Jaaroverzicht:** _Annual Overview_ als pdf, alleen in de app ([bunq](https://help.bunq.com/articles/how-do-i-export-my-annual-account-overview), [bunq](https://help.bunq.com/articles/what-types-of-bank-statements-can-i-export)). Of Stocks erin staat, is niet geverifieerd.

**Advies:** banksaldi via de bestaande bankimport; Stocks als rekening met _waarden per jaar_. Werk S, prio 3.

#### PayPal

**Wat:** saldo bij PayPal. Wie de Europese rekeningen voert en hoe de Belastingdienst het saldo indeelt, is niet nagelezen; vermoedelijk banktegoeden in het buitenland.

**Routes:** een activiteitenoverzicht als CSV bestaat volgens algemene bekendheid, maar de kolommen en of er een saldokolom in staat, zijn niet gevonden. De BittyTax-parser voor PayPal leest alleen crypto-aankopen bij PayPal ([BittyTax, paypal.py](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/paypal.py), AGPL-3.0).

**Advies:** (d) met de hand; pas iets bouwen met een echt bestand. Werk S, prio 3.

### Brokers en beleggingsplatforms

#### LYNX (en Mexem)

**Wat:** effecten en geld; LYNX bemiddelt rekeningen bij Interactive Brokers. LYNX schrijft dat Interactive Brokers de koppeling vormt tussen de beleggingsrekening "via LYNX" en externe toepassingen ([LYNX, koppelen met AI](https://www.lynx.nl/beurs/beurs-koersen/beursinfo/beurs-nieuws-tips/beleggen-ai-chatgpt-claude/), [Interactive Brokers via LYNX](https://www.lynx.nl/online-broker/interactive-brokers-lynx/)).

**Routes:**

- **Flex Queries:** volgens een handleiding van Portfolio Dividend Tracker maak je in LYNX onder _Performance & Reports → Flex Queries_ een Activity Flex Query; een token voor de Flex Web Service staat onder _Account Settings → Reporting_ ([PDT](https://help-en.portfoliodividendtracker.com/article/269-download-your-lynx-actions)). Tweedehands; niet op de site van LYNX zelf gevonden.
- **Box3balans:** de koppeling met Interactive Brokers gebruikt die Flex Web Service al ([README](../README.md#koppelingen-met-beurzen-en-brokers)).

**Advies:** (a), de bestaande koppeling. Testen met een LYNX-rekening en in de verbindingsdialoog "ook voor LYNX" zetten. Werk S, prio 1. Mexem werkt volgens vergelijkingssites ook via Interactive Brokers; dan geldt daar vermoedelijk hetzelfde (beide niet geverifieerd).

**Nodig:** iemand met een LYNX-rekening die een Flex-token aanmaakt en een synchronisatie draait.

**Open vraag:** werkt het Flex-token van een LYNX-rekening op hetzelfde adres als bij IBKR?

#### eToro

**Wat:** aandelen, ETF's, crypto en CFD's bij eToro (Europe) Ltd, Cyprus ([eToro, regulering](https://www.etoro.com/nl/customer-service/regulation-license/)). Overige bezittingen.

**Routes:**

- **API:** niet onderzocht voor particulieren.
- **Export:** het _Account Statement_ maak je onder _Portfolio → History_ voor een periode en sla je op als pdf of Excel. De tabbladen _Closed Positions_ (met ISIN) en _Account Activity_ (stortingen, opnames, geopende en gesloten posities, kosten) staan erin ([eToro](https://help.etoro.com/s/article/what-is-the-etoro-account-statement?language=en_GB)).
- **Kolommen:** het testbestand van Export-To-Ghostfolio heeft `Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,Balance,Position ID,Asset type,NWA`; je verwijdert alle tabbladen behalve _Account Activity_ en slaat op als CSV met komma ([Export-To-Ghostfolio, README](https://github.com/dickwolff/Export-To-Ghostfolio#etoro), [voorbeeld](https://github.com/dickwolff/Export-To-Ghostfolio/blob/main/samples/etoro-export.csv), Apache-2.0).

**Advies:** (b), een herkenner voor _Account Activity_. `Details` bevat het symbool (`NKE/USD`), `Position ID` koppelt openen en sluiten. CFD's zijn geen bezit van het onderliggende; die regels overslaan en melden. Werk M, prio 1.

**Nodig:** een geanonimiseerde _Account Activity_ met aankopen, verkopen, dividend en een CFD.

**Open vragen:** de soorten in `Type`; of `Units` bij een verkoop negatief is; waar de ISIN staat (alleen in _Closed Positions_?).

**Stand (oktober 2026):** de herkenner is gebouwd ([#24](https://github.com/zenonymous/box3balans/issues/24)), op het openbare voorbeeld, nog niet getest met een echte export. Bedragen worden gelezen als dollars (ze tellen op tot het saldo van de rekening, niet in de valuta van het aandeel); SDRT gaat bij de aankoop met dezelfde Position ID; CFD's, geld en onbekende soorten worden overgeslagen en genoemd. eToro's beurssuffixen `.NV` en `.ZU` worden Yahoo's `.AS` en `.SW`.

#### Freedom24

**Wat:** broker uit Cyprus; volgens een krant ruim 300.000 klanten in Europa ([Cyprus Mail](https://cyprus-mail.com/2024/09/26/online-broker-freedom24-reaches-300000-customers), tweedehands).

**Routes:** een API met een sleutelpaar ([Freedom24](https://freedom24.com/tradernet-api/auth-api)); een instelling voor alleen lezen is niet gevonden, en tools van derden plaatsen er orders mee ([TradesViz](https://www.tradesviz.com/blog/auto-import-freedom24/)). Dus geen koppeling. Het _Broker report_ is een Excel-bestand onder _Reports_ ([forum Portfolio Performance](https://forum.portfolio-performance.info/t/freedom24-import/18110/3), tweedehands).

**Advies:** (b) op verzoek. Werk M, prio 3.

#### XTB

**Wat:** Poolse broker (XTB S.A.) met Nederlandse klanten via het Europees paspoort (alleen tweedehands bevestigd: [trade.nl](https://trade.nl/broker/xtb/)).

**Export:** _Account history → Cash operations → Export_, als CSV; kop `ID;Type;Time;Symbol;Comment;Amount`, met aankopen als `OPEN BUY 34/42.5658 @ 11.7480` in `Comment` ([Export-To-Ghostfolio](https://github.com/dickwolff/Export-To-Ghostfolio#xtb), [voorbeeld](https://github.com/dickwolff/Export-To-Ghostfolio/blob/main/samples/xtb-export.csv)).

**Advies:** (b) op verzoek. Werk M (het aantal en de koers zitten in een tekstveld), prio 3.

#### ING, ABN AMRO en de andere al onderzochte brokers

Staan in [exportformaten.md](exportformaten.md):

- **ING Zelf op de Beurs:** CSV van transacties en portefeuille, kolommen onbekend; voorbeeld nodig. (b) + (c), werk M, prio 2.
- **ABN AMRO:** geen effectenexport; fondsregels in de TAB-export van de tegenrekening. Prio 3 tot er een echt bestand is.
- **Lightyear, Scalable Capital:** herkend.
- **DEGIRO, Interactive Brokers, Saxo, Trade Republic, Trading 212, BUX, Revolut (aandelen), Rabobank Beleggen:** herkend of gekoppeld ([README](../README.md#csv-import)).

### Indexfondsen, robo-advisers en vermogensbeheer

#### Brand New Day

**Wat (producten en box 3):**

- **Beleggingsrekening (vrij vermogen):** beleggen in eigen aandelen- en obligatiefondsen van Brand New Day, zelf samengesteld of als modelportefeuille ([informatie beleggingsrekening, vraag 13](https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf)). Box 3, overige bezittingen. Een deel kan in de _Cashallocatie_ staan (vraag 29).
- **Spaarrekening en spaardeposito:** vrij sparen ([voorwaarden spaardeposito](https://new.brandnewday.nl/documenten/productvoorwaarden-spaardeposito-revision-3.pdf)). Banktegoeden.
- **Niet in box 3:** Pensioenrekening-sparen en -beleggen, Lijfrente-uitkering (box 1); Hypotheekrekening-beleggen en Gouden-handdrukrekening hebben een eigen fiscale behandeling (vraag 13; [FAQ jaaroverzicht](https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/)). De hypotheekrekening is een beleggingsrecht eigen woning; zie [die kaart](#banksparen-en-beleggingsrecht-eigen-woning).

**Bereik:** ruim 360.000 klanten en € 10,6 miljard toevertrouwd vermogen eind 2025. In vrije beleggingsrekeningen € 2.174 miljoen (2024: € 1.680 miljoen), vrij spaargeld € 338 miljoen ([jaarverslag 2025 Brand New Day Bank](https://new.brandnewday.nl/documenten/jaarverslag-2025-bnd-bank.pdf), p. 3–6).

**Platform:** Brand New Day ontwikkelt zijn software zelf (Brand New Day Diensten) en verhuisde in 2025 naar de cloud ([jaarverslag 2025](https://new.brandnewday.nl/documenten/jaarverslag-2025-bnd-bank.pdf), _Onderzoek en ontwikkeling_). Geen bron gevonden dat Ohpen erachter zit. Ohpen begon juist als concurrent van Brand New Day ([IEXProfs](https://www.iexprofs.nl/onbekend/54936/onbekend/Ohpen-is-nu-echt-open.aspx), tweedehands). Zie ook [Platforms op Ohpen](#platforms-op-ohpen).

**Wat in MijnBND staat** ([informatie beleggingsrekening, vragen 14 en 28–35](https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf), versie 5 december 2024):

- de actuele portefeuille, het rendement, de kosten en de uitgevoerde orders;
- **kwartaaloverzicht** per beleggingsrekening, na elk kwartaal: samenstelling, **waarde per fonds en totaal aan begin en eind van het kwartaal**, het bedrag in de Cashallocatie, rendement per fonds, kosten, **inleg en onttrekkingen per fonds en totaal**, en de transacties;
- **financieel jaaroverzicht** in februari: voor beleggingsrekeningen in box 3 **de begin- en eindwaarde** en **het uitgekeerde dividend met de ingehouden dividendbelasting**;
- alles onder _Mijn documenten_ (bijvoorbeeld _Kwartaaloverzichten_), ook oude kwartaal-, jaar- en transactieoverzichten. Voor spaar- en beleggingsrekeningen: _Mijn documenten → Overzichten → Jaaroverzichten_ ([FAQ jaaroverzicht](https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/)).

Brand New Day zegt zelf: voor de aangifte geef je de waarde van 1 januari op ([FAQ jaaroverzicht](https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/)).

**Formaat:** Brand New Day noemt het niet. Eén gebruiker had alleen een pdf _Overzicht beleggingstransacties_ met de kolommen `#`, `Datum`, `Soort`, `Fonds`, `Aantal`, `Prijs`, `Bedrag` ([forum Portfolio Performance](https://forum.portfolio-performance.info/t/pdf-import-from-brand-new-day/31804), tweedehands). **Geen CSV, Excel of API gevonden** (zie ook [exportformaten.md](exportformaten.md#4-brand-new-day-beleggen-vrij-vermogen)).

**Fondsen:** eigen fondsen met een ISIN, zoals het BND Wereld Indexfonds Unhedged (NL0012706238, koers € 24,64 op 31 augustus 2026, dividend € 0,27 in juni 2026) ([factsheet](https://www.brandnewday.nl/content/app/pdf/documentencentrum/FactsheetsCollectief/BND-Wereld-Indexfonds-C-Unhedged.pdf)). Niet beursgenoteerd; of Yahoo ze heeft, is niet gecontroleerd. Bijhouden met transacties vraagt dus handmatige koersen.

**Open-source:** geen importer gevonden, ook niet in Portfolio Performance ([pdf-extractors](https://github.com/portfolio-performance/portfolio/tree/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf)).

**Advies:**

1. **Nu, (d), werk S.** Eén rekening _waarden per jaar_ per beleggingsrekening en één per spaarrekening. In de uitleg (README of tooltip): waarde op 1 januari = de beginwaarde uit het financieel jaaroverzicht; inkomsten = het dividend; geld erin en eruit = de som van de inleg en onttrekkingen uit de vier kwartaaloverzichten. Dat is genoeg voor het forfaitaire stelsel én het werkelijk rendement.
2. **Daarna, pdf-jaaroverzicht, werk M (na de basis).** Een sjabloon voor het financieel jaaroverzicht (beginwaarde, eindwaarde, dividend, dividendbelasting) en een voor het Q4-kwartaaloverzicht (waarde per fonds op 31 december, inleg en onttrekkingen). Het Q4-overzicht kan ook een portefeuille-overzicht (c) worden als het aantallen participaties noemt.

Prio 1.

**Nodig van een gebruiker:** de tekst van een financieel jaaroverzicht en van een Q4-kwartaaloverzicht, gemaakt met `pdftotext -layout`, met namen en bedragen veranderd (zie [wat de lezer nodig heeft](#wat-een-lezer-nodig-heeft)).

**Open vragen:**

- Is de "beginwaarde" de waarde op 1 januari (of op 31 december van het jaar ervoor; dat is hetzelfde)?
- Staan er aantallen participaties in het kwartaaloverzicht, of alleen bedragen?
- Is het dividend uitgekeerd op de Cashallocatie of herbelegd? Dat bepaalt of het al in de eindwaarde zit.
- Hoort de Cashallocatie bij de banktegoeden? Brand New Day is een bank; Box3balans rekent geld bij een bank of broker standaard als banktegoed ([README](../README.md#box-3)).
- Is er een app met een export, of een openbare koerspagina met dagkoersen per fonds?

#### Meesman

Staat in [exportformaten.md](exportformaten.md#3-meesman-indexbeleggen): een Excel-export onder _Opdrachten → Transacties_ met onbekende kolommen, en een jaaroverzicht onder _Documenten_. (b) zodra er een voorbeeld is; tot die tijd (d). Werk M, prio 2.

#### Peaks

Staat in [exportformaten.md](exportformaten.md#5-peaks): een jaaroverzicht in februari met de waarde op 1 januari, en een kwartaalrapport; geen export. (d) nu, later een pdf-sjabloon. Werk S, prio 2.

#### Semmie en Index Capital

**Wat:** vermogensbeheer en beleggingsrekeningen (SemmieWealth). Volgens een vergelijkingssite nam Semmie in oktober 2023 Index Capital over, met het label BeCapital ([vermogensbeheer.nl](https://www.vermogensbeheer.nl/nieuws/semmie-neemt-index-capital-over), tweedehands). semmie.nl verwijst naar semmiewealth.nl (gezien op 13 oktober 2026).

**Routes:** geen export, jaaroverzicht of API gevonden.

**Advies:** (d). Werk S, prio 3. **Open vraag:** wat Semmie in het klantportaal laat downloaden.

#### NN Beheerd Beleggen

**Wat:** beheerd beleggen bij NN Bank, met vaste beheerkosten ([NN, kosten](https://www.nn.nl/Particulier/Beleggen/Beheerd-Beleggen/Kosten-Beheerd-Beleggen.htm), [productvoorwaarden](https://www.nn.nl/Particulier/Beleggen/Productvoorwaarden-Beheerd-Beleggen.htm)). Overige bezittingen.

**Routes:** niet onderzocht welk jaaroverzicht NN geeft. **Advies:** (d). Werk S, prio 3.

#### Centraal Beheer en a.s.r.

- **a.s.r. bank** stopte in 2020 met beleggingsdiensten; de spaarportefeuille ging naar Achmea Bank (Centraal Beheer) ([a.s.r.](https://www.asr.nl/levensverzekering/sparen-beleggen)). Beleggers konden kosteloos naar Evi van Lanschot ([persbericht a.s.r. en Van Lanschot Kempen](https://www.asrnederland.nl/-/media/files/asrnederland-nl/nieuws-en-pers/2020/20200115-persbericht-asr-en-van-lanschot-kempen-gaan-samenwerkingsovereenkomst-aan.pdf)). Wat bij a.s.r. overblijft, zijn verzekeringen: zie [Kapitaalverzekeringen](#kapitaalverzekeringen).
- **Centraal Beheer Beleggen:** fondsen van Achmea Investment Management ([review, tweedehands](https://www.financieelonafhankelijkblog.nl/centraal-beheer-beleggen-review-en-ervaringen)). Geen export of jaaroverzicht op de eigen site gevonden.

**Advies:** (d). Werk S, prio 3.

#### Vermogensbeheer van de grote banken en Van Lanschot

- **Rabobank:** het jaaroverzicht van de beleggingsportefeuille noemt de waarde op 1 januari en komt uiterlijk 1 februari ([Rabobank](https://www.rabobank.nl/particulieren/beleggen/service/waar-staat-het-jaaroverzicht-beleggen); de pagina gaf ons een 403, de inhoud komt uit een zoekresultaat: niet geverifieerd). De transacties van Rabobank Beleggen leest Box3balans al.
- **ING en ABN AMRO:** jaaroverzichten onder _Documenten_ ([exportformaten.md](exportformaten.md)).
- **Van Lanschot Kempen:** maakt per effectenrekening een _Jaaroverzicht voor tegenbewijsregeling box 3_ (alleen uit een zoekresultaat van [vanlanschotkempen.com](https://www.vanlanschotkempen.com/nl-nl/private-banking/inspiratie/beleggen-en-sparen/plannen-box-3-zijn-bekendgemaakt), niet geverifieerd).
- **Evi van Lanschot** nam in 2023 het online platform van Robeco over, samen 150.000 klanten en € 6 miljard ([banken.nl](https://www.banken.nl/nieuws/amp/24333/van-lanschot-kempen-neemt-online-beleggingsplatform-robeco-over), tweedehands). evi.nl verwijst op 13 oktober 2026 naar een site die er niets mee te maken heeft; of Evi nog bestaat, is niet geverifieerd.

**Advies:** (d) nu, pdf-sjablonen pas als gebruikers erom vragen. Werk S, prio 2.

#### Platforms op Ohpen

Ohpen is een bankplatform voor anderen ([Ohpen](https://www.ohpen.com/)). Bekende klanten volgens nieuwsberichten: de Volksbank (de beleggingsrekeningen van ASN, SNS en RegioBank), Aegon, NN, Knab, LeasePlan Bank en TKP ([banken.nl](https://www.banken.nl/nieuws/20613/de-volksbank-kiest-core-banking-platform-ohpen-voor-beleggingsdiensten), [IBS Intelligence](https://ibsintelligence.com/ibsi-news/de-volksbank-renews-core-banking-contract-with-ohpen/), [IPE](https://www.ipe.com/news/tkp-to-outsource-investment-admin-for-dc-plans-to-ohpen/10043380.article); alle tweedehands). Ohpen biedt API's aan zijn klanten, niet aan eindklanten ([Ohpen](https://www.ohpen.com/)). Een gedeelde export of een gedeeld jaaroverzicht voor al deze platforms is niet gevonden. Geen aparte kaart; de rekeningen gaan via (d).

### Crypto

Algemeen: de Belastingdienst laat je de koers op 1 januari van het platform dat je gebruikt hanteren ([Belastingdienst, cryptobezittingen](https://www.belastingdienst.nl/wps/wcm/connect/nl/werk-en-inkomen/content/cryptovaluta); uit een zoekresultaat, niet zelf gelezen). De Nederlandse platforms hieronder hebben een MiCA-vergunning van de AFM ([BLOX](https://weareblox.com/nl-nl/blox-verkrijgt-micar-licentie), [Bitonic](https://bitonic.nl/nl/news/298/bitonic-ontvangt-micar-vergunning-van-de-autoriteit-financiele-markten)); voor Finst en Coinmerce alleen tweedehands bevestigd.

#### Finst en Anycoin Direct

**Wat:** crypto (ruim 400 munten) en staking bij Finst. Finst nam in november 2024 de klanten van Anycoin Direct over; samen "tot 500.000 beleggers", met een gratis overstap voor Nederlandse en Belgische klanten ([Finst](https://finst.com/nl/blog/articles/finst-and-anycoin-direct-join-forces)). anycoindirect.eu/nl/help verwijst op 13 oktober 2026 door naar finst.com/nl/help. Overige bezittingen.

**Routes:**

- **API:** geen; Finst ondersteunt "momenteel" geen API-trading (artikel van december 2023) ([Finst](https://help.finst.com/nl/article/biedt-finst-api-trading-aan-1l8kyfy/)). Een API om alleen te lezen is niet gevonden.
- **Export:** op de desktop: _Activiteit_ → periode kiezen → _Exporteren_, in **Excel-formaat** ([Finst, bijgewerkt 27 juli 2026](https://help.finst.com/nl/article/hoe-kan-ik-mijn-transactiegeschiedenis-downloaden-1n7971t/)). De kolommen staan nergens.
- **Jaaroverzicht:** onder _Account → Jaaroverzicht_, in februari of maart ([Finst](https://help.finst.com/nl/article/biedt-finst-een-jaarlijks-belastingrapportoverzicht-1xai8v8/)). Inhoud en formaat staan er niet bij.
- **Open-source:** geen importer gevonden (gezocht op GitHub).
- **Anycoin Direct (gestopt):** de bestellingen waren als Excel te exporteren onder _Bestellingen_ ([Blockpit](https://intercom.help/blockpit/de/articles/12136922-wie-importiere-ich-daten-mittels-anycoin-direct-csv-excel-datei), tweedehands); er was geen API voor belastingsoftware ([CoinTracking](https://cointracking.info/imports/anycoin-tax/), tweedehands). Of oude Anycoin-geschiedenis bij Finst te downloaden is, is onbekend.

**Advies:** (b), een herkenner voor de export van _Activiteit_ (opgeslagen als CSV, zoals bij Saxo). Tot die tijd (d) met het jaaroverzicht. Werk M, prio 1.

**Nodig:** een geanonimiseerde export met aankopen, verkopen, stortingen, opnames, staking en kosten.

**Open vragen:** de kolommen en soortwaarden; of eurostortingen en -opnames erin staan; wat het jaaroverzicht toont (waarde op 1 januari per munt?); of ex-Anycoin-klanten hun oude geschiedenis nog krijgen.

#### BLOX

**Wat:** crypto-app, met _Verdien_ (beloningen) en _Beheer_ (beheerd account) ([BLOX](https://support.weareblox.com/hc/nl/articles/40655907523089-Hoe-en-waar-wordt-mijn-crypto-bewaard-in-een-Beheerd-Account)). Overige bezittingen.

**Routes:**

- **API:** niet gevonden (help center doorzocht op "API" en "export").
- **CSV:** niet gevonden. Transacties zie je per munt in de app ([BLOX](https://support.weareblox.com/hc/nl/articles/15540929642641-Hoe-volg-ik-mijn-Bitcoin-transactie)); de kosten van _Beheer_ staan in het transactieoverzicht ([BLOX](https://support.weareblox.com/hc/nl/articles/40656130782737-Ontvang-ik-een-factuur-van-de-Beheer-kosten)).
- **Jaaroverzicht:** de waarde van je kluis op 1 januari; app: profiel → _Mijn gegevens_ → _Jaaroverzichten_; web: _Instellingen → Jaaroverzichten_ → _Exporteren als PDF_ ([BLOX, waar](https://support.weareblox.com/hc/nl/articles/25982426553617-Waar-kan-ik-mijn-jaaroverzicht-vinden), [BLOX, welk jaar](https://support.weareblox.com/hc/nl/articles/31488885544721-Welk-jaaroverzicht-heb-ik-nodig-voor-mijn-belastingaangifte)).
- **Open-source:** niets gevonden.

**Advies:** (d) nu, met de uitleg "het jaaroverzicht van jaar X geeft de waarde op 1 januari van jaar X". Later een pdf-sjabloon. Werk S, prio 2.

**Open vragen:** staat in de pdf de waarde per munt of alleen het totaal? Heeft BLOX een transactie-export die het help center niet noemt?

#### Bitonic

**Wat:** alleen bitcoin; "het eerste bitcoinbedrijf van Nederland" ([Bitonic](https://bitonic.nl/nl/news/298/bitonic-ontvangt-micar-vergunning-van-de-autoriteit-financiele-markten)). Lange tijd kocht je bitcoin en liet je die naar je eigen wallet sturen; nu kan het ook op een Bitonic-account ([Bitonic FAQ](https://bitonic.nl/nl/faq)). Het handelsplatform BL3P sloot op 20 december 2024; de site met de handelsgeschiedenis ging op 4 mei 2026 offline ([Bitonic](https://bitonic.nl/nl/news/301/bl3p-definitief-offline)).

**Routes:**

- **API:** alleen een openbare koers-API ([Bitonic API](https://bitonic.nl/nl/api)). CoinLedger noemt een API met alleen leesrechten ([CoinLedger](https://coinledger.io/de/integrations/bitonic), tweedehands, niet bevestigd).
- **Export:** niet gevonden; de antwoorden in de FAQ laden met JavaScript en waren niet te lezen.
- **Wallets:** bitcoin die naar je eigen wallet ging, volgt Box3balans al op adres of xpub.

**Advies:** (e) voor wat in je eigen wallet staat, (d) voor het saldo op het account. Werk S, prio 3. **Open vraag:** of het account een export of jaaroverzicht heeft.

#### Coinmerce

**Wat:** crypto-app. Overige bezittingen.

**Routes:**

- **API:** niet gevonden.
- **CSV:** op de pagina met orders download je een CSV van je laatste orders ([Coinmerce](https://support.coinmerce.io/en/articles/178418-how-is-my-crypto-taxed)). Kolommen onbekend. Volgens Waltio gaat het via _Orders_ en de exportknop, met alleen afgeronde orders ([Waltio](https://help.waltio.com/en/articles/5837160-coinmerce-file), tweedehands).
- **Jaaroverzicht:** in de app onder _Account → Orders → Annual Overview_ de begin- en eindwaarde van het jaar, niet te downloaden: Coinmerce raadt een screenshot aan ([Coinmerce, 10 juli 2026](https://support.coinmerce.io/en/articles/209223-annual-overview)). De voorwaarden noemen doorlopend downloadbare overzichten ([voorwaarden](https://support.coinmerce.io/en/articles/179087-general-terms-and-conditions)).

**Advies:** (b) zodra er een voorbeeld is; tot die tijd (d) met de beginwaarde uit de app. Werk M, prio 2.

**Nodig:** een geanonimiseerde orders-CSV met kopen, verkopen, stortingen, opnames en staking.

#### Bitpanda

**Wat:** crypto, aandelen, ETF's, edelmetaal en grondstoffen ([Bitpanda Grondstoffen](https://support.bitpanda.com/hc/nl/articles/5771948622364-Bitpanda-Grondstoffen)). Overige bezittingen.

**Routes:**

- **API:** de nieuwe openbare API (`https://api.public.bitpanda.com/v1`) heeft `GET /v1/portfolio` (geld- en beleggingssaldi samen), `GET /v1/portfolio-history` en `GET /v1/operations` (één tijdlijn van trades, overboekingen en andere transacties). Een sleutel maak je onder _Account Settings → API_ met scopes; `Read` is voor marktgegevens en portefeuilles, `Trade` apart ([Bitpanda docs](https://docs.public.bitpanda.com/), [migratie](https://docs.public.bitpanda.com/migrating-from-the-legacy-api)). De oude API (`api.bitpanda.com/v1`) stopt op **31 januari 2027** ([migratie](https://docs.public.bitpanda.com/migrating-from-the-legacy-api)).
- **CSV en pdf:** _History → Export_ ([Bitpanda](https://support.bitpanda.com/hc/en-gb/articles/360000122759-How-can-I-download-the-history-of-my-Bitpanda-account)). Kolommen volgens BittyTax: `Transaction ID, Timestamp, Transaction Type, In/Out, Amount Fiat, Fiat, Amount Asset, Asset, Asset market price, Asset market price currency, Asset class, Product ID, Fee, Fee asset, Spread, Spread Currency, Tax Fiat` ([BittyTax](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/bitpanda.py), AGPL-3.0).
- **Jaaroverzicht:** belastingrapporten alleen voor Oostenrijkers; anderen krijgen kwartaaloverzichten, kunnen een jaaroverzicht aanvragen of de geschiedenis downloaden ([Bitpanda](https://support.bitpanda.com/hc/nl/articles/18668973207580-Belastingrapporten-bekijken-en-begrijpen)).
- **Open-source:** rotki koppelt met de **oude** API (`wallets/transactions`, `fiatwallets/transactions`, `trades`) ([rotki, bitpanda.py](https://github.com/rotki/rotki/blob/develop/rotkehlchen/exchanges/bitpanda.py), AGPL-3.0).

**Advies:** (a), een koppeling met de nieuwe API en een `Read`-sleutel. Niet op de oude API bouwen. Werk M, prio 1.

**Open vragen:** of `/v1/operations` aandelen, ETF's en metalen met ISIN geeft; de paginering en hoe ver terug; of een `Read`-sleutel echt niets kan wijzigen. Box 3-categorie van het eurosaldo (Box3balans rekent geld op een cryptobeurs standaard als overige bezitting).

#### Crypto.com

**Wat:** de Crypto.com App (crypto, earn, kaart) en de Exchange. Overige bezittingen.

**Routes:**

- **API:** alleen voor de Exchange, niet voor de app; rotki koppelt de Exchange ([rotki, cryptocom.py](https://github.com/rotki/rotki/blob/develop/rotkehlchen/exchanges/cryptocom.py)).
- **CSV van de app:** _Accounts → History → Export_, per wallet en periode (tot drie jaar per rapport), download 30 dagen beschikbaar ([Crypto.com](https://help.crypto.com/en/articles/3438579-how-do-i-export-my-transaction-history-app); uit een zoekresultaat). Kop:

  ```text
  Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash
  ```

  ([Export-To-Ghostfolio, voorbeeld](https://github.com/dickwolff/Export-To-Ghostfolio/blob/main/samples/cryptocom-export.csv), Apache-2.0; ook in [BittyTax](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/cryptocom.py) en [rotki](https://github.com/rotki/rotki/blob/develop/rotkehlchen/data_import/importers/cryptocom.py), AGPL-3.0).

- `Transaction Kind` heeft codes zoals `crypto_to_exchange_transfer`, `crypto_wallet_swap_credited` en `crypto_wallet_swap_debited` (zelfde voorbeeld). `Native Amount` is de waarde in je eigen valuta.

**Advies:** (b), een herkenner voor de app-CSV. Lees de soortcodes uit de testbestanden van rotki en BittyTax (niets kopiëren; die zijn AGPL, dezelfde licentie als Box3balans, maar alleen de lijst met codes is nodig). Werk M, prio 1.

**Nodig:** een geanonimiseerde CSV met earn, kaartcashback en een swap.

**Stand (oktober 2026):** de herkenner is gebouwd ([#21](https://github.com/zenonymous/box3balans/issues/21)), op de kop en de soortcodes uit het openbare voorbeeld en de parsers hierboven, nog niet getest met een echte export. Onbekende soorten worden overgeslagen en bij het controleren met hun code genoemd.

#### Bybit

**Wat:** beurs; sinds 2025 Bybit EU met een MiCA-vergunning uit Oostenrijk, die MEXC aan vertrekkende Nederlandse klanten aanraadt ([Finance Magnates](https://financemagnates.com/cryptocurrency/exchange/mexc-to-offboard-dutch-users-recommends-bybit-as-micar-compliant-alternative/), tweedehands).

**Routes:**

- **API:** sleutels kunnen _Read-Only_ zijn ([rotki, Bybit](https://rotki.com/integrations/bybit), [docs.rotki.com](https://docs.rotki.com/usage-guides/integrations/exchange-keys)). rotki gebruikt `account/transaction-log`, `account/wallet-balance` en `order/history` van API v5 ([rotki, bybit.py](https://github.com/rotki/rotki/blob/develop/rotkehlchen/exchanges/bybit.py), [Bybit v5](https://bybit-exchange.github.io/docs/v5/guide)). Stortingen en opnames per 30 dagen per verzoek (rotki).
- **CSV:** stortingen en opnames met `Date & Time(UTC), Coin, QTY, Type, Account Balance, Description` ([BittyTax](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/bybit.py)).
- Sleutels zonder IP-beperking verlopen volgens CoinLedger na drie maanden ([CoinLedger](https://help.coinledger.io/en/articles/6588913-bybit-api-import-guide), tweedehands). Dat botst met een synchronisatie die jaren loopt.

**Advies:** (a) op verzoek. Werk M, prio 3.

#### Binance

**Wat:** Binance vertrok in 2023 uit Nederland; vanaf 17 juli 2023 konden Nederlanders alleen nog opnemen ([Binance](https://www.binance.com/en/support/announcement/notice-on-changes-of-services-in-the-netherlands-b5a647be31cf469b87fc3337fd461ced)). Alleen van belang voor de peildata 1 januari 2023 en eerder, bijvoorbeeld voor de opgaaf werkelijk rendement over 2023 en eerder.

**Routes:**

- **API:** sleutels met alleen _Enable Reading_ ([rotki, Binance](https://rotki.com/integrations/binance)); rotki koppelt ([binance.py](https://github.com/rotki/rotki/blob/develop/rotkehlchen/exchanges/binance.py)). Of een Nederlands account na het vertrek nog sleutels kan maken, is onbekend.
- **CSV:** het _Transaction History_-overzicht met `UTC_Time, Account, Operation, Coin, Change, Remark` en een lange lijst `Operation`-waarden ([BittyTax](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/binance.py)).

**Advies:** (b) op verzoek, omdat het om oude jaren gaat. Werk M, prio 3.

#### Bitstamp

**Wat:** beurs (Luxemburg). **API:** sleutels met alleen de rechten _account balance_ en _user transactions_, bevestigd per e-mail ([rotki, Bitstamp](https://rotki.com/integrations/bitstamp)); `POST /api/v2/user_transactions/` en `/api/v2/account_balances/` met v2-ondertekening ([Bitstamp API](https://www.bitstamp.net/api/)). **CSV:** `ID, Account, Type, Subtype, Datetime, Amount, Amount currency, Value, Value currency, Rate, Rate currency, Fee, Fee currency, Order ID` ([BittyTax](https://github.com/BittyTax/BittyTax/blob/master/src/bittytax/conv/parsers/bitstamp.py)).

**Advies:** (a) of (b) op verzoek. Werk M, prio 3.

### Crowdfunding en P2P

Algemeen: leningen via een platform zijn vorderingen, in de aangifte _uitgeleend geld_ (overige bezittingen); rente die minder dan jaarlijks wordt bijgeschreven, telt mee in de waarde op 1 januari ([Belastingdienst, bezittingen box 3 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_)). Geen van de platforms hieronder heeft een API of CSV voor beleggers gevonden; ze sturen allemaal een jaaroverzicht.

#### Geldvoorelkaar

**Wat:** leningen aan het mkb en vastgoed, en een hypotheekfonds in voorbereiding ([Geldvoorelkaar](https://www.geldvoorelkaar.nl/veelgestelde-vragen/)). Uitgeleend geld: overige bezittingen. **Geld in de Wallet dat niet geïnvesteerd is, hoort bij de bank- en spaartegoeden** ([Geldvoorelkaar FAQ](https://www.geldvoorelkaar.nl/veelgestelde-vragen/investeerders/)); de wallet loopt via OPP (zelfde pagina).

**Bereik:** sinds de start € 701 miljoen gefinancierd, € 477,5 miljoen aan investeerders uitbetaald (tot 1 september 2026) ([statistiek](https://www.geldvoorelkaar.nl/over-ons/statistiekpagina/)).

**Routes:**

- **Jaaropgaaf** vanaf medio februari: _Mijn gegevens → Downloads_, kies het jaar; hij wordt naar je e-mail gestuurd. Erin: **uitstaand vermogen op 1 januari en 31 december** (na afboekingen en voorziening), het totaal geïnvesteerd in het jaar, de kosten, en projecten met betaalproblemen. Een _specificatieoverzicht_ geeft de voorzieningen per project ([FAQ](https://www.geldvoorelkaar.nl/veelgestelde-vragen/investeerders/)).
- **API, CSV:** niet gevonden.

**Advies:** (d), twee rekeningen: _Geldvoorelkaar (uitgeleend)_ als overige bezitting en _Geldvoorelkaar (wallet)_ als banktegoed. Later een pdf-sjabloon. Werk S, prio 1 (samen met de andere platforms: één stuk uitleg).

**Open vraag:** staat de ontvangen rente in de jaaropgaaf (nodig voor het werkelijk rendement)?

#### Collin Crowdfund

**Wat:** leningen aan het mkb. Collin passeerde de € 300 miljoen ([Collin](https://www.collincrowdfund.nl/nieuwsbrief-collin-doorkruist-de-grens-van-300-miljoen/)).

**Routes:** jaarlijks een jaaropgave in _Mijn Collin_; opgeven onder "overige vorderingen, zoals uitgeleend geld"; Collin geeft niets door aan de Belastingdienst ([Collin FAQ](https://www.collincrowdfund.nl/veelgestelde-vragen/)). Wat erin staat, zegt de FAQ niet.

**Advies:** (d), later pdf. Werk S, prio 2.

#### Lendahand

**Wat:** leningen aan ondernemers en projecten wereldwijd, met een sociaal of duurzaam doel ([Lendahand](https://www.lendahand.com/en-EU/pages/crowdfunding-taxes)). Uitstaande leningen in box 3; het walletsaldo staat apart op het jaaroverzicht en hoort bij de bank- en spaartegoeden ([Lendahand](https://www.lendahand.com/en-EU/pages/crowdfunding-taxes)).

**Routes:** jaaroverzicht in het _Financial Dashboard_, onderaan onder _Downloads_ (zelfde pagina). Geen API of CSV gevonden.

**Advies:** (d) met twee rekeningen, later pdf. Werk S, prio 2.

#### Mogelijk

**Wat:** vastgoedfinancieringen (directe leningen), een fonds en obligaties ([Mogelijk](https://www.mogelijk.nl/faq/jaaroverzichten)).

**Routes:** jaaroverzichten gaan tussen 11 en 13 februari per mail; investeerders in directe leningen kunnen ze ook in de app downloaden; fondsoverzichten nog niet. Mogelijk geeft ze niet uit zichzelf door aan de Belastingdienst ([Mogelijk](https://www.mogelijk.nl/faq/jaaroverzichten)). Inhoud en formaat staan er niet bij.

**Advies:** (d), later pdf. Werk S, prio 2.

#### Kapitaal Op Maat

Aan het eind van elk boekjaar een fiscaal overzicht in je portfolio-overzicht, met de ontvangen rente en het totaal geïnvesteerd vermogen ([Kapitaal Op Maat](https://www.kapitaalopmaat.nl/Hoe-wordt-crowdfunding-belast)). Of de waarde op 1 januari erin staat, is niet duidelijk. (d), werk S, prio 3.

#### Invesdor (Oneplanetcrowd)

oneplanetcrowd.com verwijst op 13 oktober 2026 door naar invesdor.nl. Niet verder onderzocht. (d), werk S, prio 3.

#### DuurzaamInvesteren

Jaaropgave in _Mijn DuurzaamInvesteren_ onder _Documenten_; voor projecten via bewaarder AFS staan de bedragen volgens de site al vooraf ingevuld; voor enkele projecten moet je bij de uitgevende instelling zijn ([DuurzaamInvesteren](https://www.duurzaaminvesteren.nl/over-duurzaaminvesteren/belastingopgave-2025), [FAQ](https://www.duurzaaminvesteren.nl/veelgestelde-vragen/veelgestelde-vragen-investeerders); de pagina laadt met JavaScript, inhoud uit een zoekresultaat, niet geverifieerd). Sommige projecten zijn groene beleggingen; niet onderzocht. (d), werk S, prio 3.

#### NPEX

**Wat:** obligaties en certificaten van mkb-bedrijven. **Fiscaal jaaroverzicht** onder _Documenten → Persoonlijk_: **de waarde en positie per financieel instrument op 1 januari en 31 december**, verhandelbare obligaties tegen handelswaarde, sommige fondsen tegen intrinsieke waarde; bij afwijking van de vooraf ingevulde aangifte is het jaaroverzicht leidend ([NPEX, toelichting 2025](https://www.npex.nl/jaarnota2025)).

**Advies:** (d), later een pdf-sjabloon dat ook posities (c) kan geven. Werk S, prio 3.

#### Mintos

**Wat:** leningen (_Claims_ en _Notes_), obligaties, vastgoed en ETF's ([Mintos, tax report](https://help.mintos.com/hc/en-us/articles/32061202728849-Tax-Report-Insights-Your-Quick-Guide)). Overige bezittingen.

**Routes:**

- **Tax report** (Engels, onder _Reports_, over 2025 eind maart 2026): **begin- en eindsaldo van de rekening** (bijlage 1), de ETF-portefeuille (bijlage 2), rente, overige inkomsten, kosten, afschrijvingen, stortingen en opnames ([Mintos](https://help.mintos.com/hc/en-us/articles/32061202728849-Tax-Report-Insights-Your-Quick-Guide), [Mintos](https://help.mintos.com/hc/en-us/articles/43210112798225-When-will-my-2025-tax-report-be-available)).
- **Rekeningoverzicht** onder _Transactions_ of _Statement_ ([Mintos](https://help.mintos.com/hc/en-us/articles/33872886368401-How-can-I-access-my-account-statement)); volgens forumgebruikers als XLS te downloaden ([forum Portfolio Performance](https://forum.portfolio-performance.info/t/unterstuetzung-von-p2p-anbietern-wie-mintos/5511), tweedehands).
- **API:** de API van Mintos is voor kredietverstrekkers, niet voor beleggers ([Mintos](https://help.mintos.com/hc/en-us/articles/7220945828113-What-is-an-API)).

**Advies:** (d) met het tax report: de waarde op 1 januari, geld erin en eruit, rente als inkomsten. Later pdf. Werk S, prio 2.

#### Go & Grow (Bondora)

Go & Grow is het product van Bondora, met een eigen help center. Overzichten en belastingrapporten per doel of voor alles samen, als **pdf of Excel**, voor een zelf gekozen periode, onder _Statements_ ([Go & Grow](https://help.goandgrow.eu/hc/en-us/articles/34275456362898-How-to-generate-statements-and-tax-reports)). Portfolio Performance leest het pdf-overzicht ([BondoraCapitalPDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/BondoraCapitalPDFExtractor.java), EPL-1.0). (d); een herkenner voor de Excel-export alleen met een voorbeeld. Werk S, prio 3.

### Groene beleggingen

**De einddatum van de vrijstelling verschilt per bron.** RVO: het fiscale voordeel stopt per 1 januari 2028, na een besluit van de Tweede Kamer in het najaar van 2025 ([RVO, regeling groenprojecten](https://www.rvo.nl/subsidies-financiering/regeling-groenprojecten)). Triodos: per 1 januari 2027 sterk versoberd, per 1 januari 2028 afgeschaft ([Triodos](https://www.triodos-im.com/articles/2026/triodos-groenfonds-becomes-even-more-impactful)). Rijksoverheid: per 1 januari 2027 ([Rijksoverheid](https://rijksoverheid.nl/vraag-en-antwoord/duurzame-economie/groen-sparen-in-een-groenfonds), vermoedelijk verouderd). [box3-sources.md](box3-sources.md) zegt 2028, de README zegt "De vrijstelling vervalt in 2027" ([README](../README.md#box-3)). Voor 2026 is de vrijstelling € 26.715, met fiscale partner € 53.430 ([Belastingdienst 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_)). Erkende groenfondsen staan bij [RVO](https://www.rvo.nl/subsidies-financiering/regeling-groenprojecten/groenfondsen).

#### ASN Groenprojectenfonds

Een groen fonds van ASN Impact Investors, binnen de vrijstelling vrij van box 3, met heffingskorting 0,1% sinds 2025; in 2020 en 2024 tijdelijk gesloten, begin 2025 weer open ([ASN, FAQ](https://beleggingsfondsen.asnbank.nl/overig/downloads/faq-asn-impact-investors.html), [ASN, opening februari 2025](https://beleggingsfondsen.asnbank.nl/overig/downloads/toelichting-openen-asn-groenprojectenfonds-februari-2025.html); uit zoekresultaten). Gekocht via de beleggingsrekening van ASN Bank (de Volksbank, op Ohpen; zie [Platforms op Ohpen](#platforms-op-ohpen)). Export of jaaroverzicht niet onderzocht.

**Advies:** (d) met de rekening als _groene belegging_ (kan al). Werk S, prio 2. Zorgen dat de app het jaar na de einddatum zelf naar overige bezittingen schuift.

#### Triodos Groenfonds

Liet zijn groenstatus per **1 april 2026** los; de regeling wordt per 1 januari 2027 sterk versoberd en per 1 januari 2028 afgeschaft ([Triodos](https://www.triodos-im.com/articles/2026/triodos-groenfonds-becomes-even-more-impactful)). Wie op 1 januari 2026 aandeelhouder was, heeft volgens de toelichting op het prospectus nog één keer het voordeel over 2026 ([Triodos](https://www.triodos-im.com/binaries/content/assets/shared/fund-assets/tim/tgf/toelichting-wijziging-prospectus-triodos-groenfonds-nv-per-1-april-2026.pdf); inhoud uit een zoekresultaat, de pdf zelf was niet te openen).

**Advies:** (d). Box3balans moet een groene rekening per jaar kunnen indelen: groen tot en met 2026, overige bezittingen vanaf 2027. Werk S, prio 2. **Open vraag:** kan de app nu een categorie per jaar aan, of alleen per rekening?

### Aandelenplannen van werkgevers

**Waarom belangrijk:** aandelen die je na een vest of een ESPP-aankoop bij een Amerikaanse plan-administrateur hebt, zijn gewone box 3-bezittingen ("aandelen … die niet bij een aanmerkelijk belang horen"), in het buitenland, in dollars, om te rekenen tegen de ECB-koers van 1 januari ([Belastingdienst 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_)). Vermoedelijk staan ze niet in de vooraf ingevulde aangifte (niet geverifieerd). Niet-gevest aandelen en niet-uitgeoefende opties horen er vermoedelijk niet bij (loon bij verkrijging); daar is geen primaire bron voor gevonden.

**Alle herkenners hieronder:** valuta USD, het geld bij de administrateur apart volgen, en `fee` voor ingehouden belasting bij een vest niet als kosten boeken (dat is loonheffing, box 1).

#### Charles Schwab Equity Awards

**Wat:** RSU's en ESPP in de _Equity Award Center_ van Schwab.

**Routes:**

- **API:** niet gevonden voor equity-awardrekeningen.
- **Export:** de volledige transactiegeschiedenis van de award-rekening als **CSV of JSON**; datums altijd `MM/DD/YYYY` ([cgt-calc, Schwab](https://cgt-calc.uk/brokers/schwab/)). Schwab zelf documenteert het niet openbaar.
- **Kolommen** (uit de parser van cgt-calc, MIT, actief onderhouden): bovenregel `Date, Action, Symbol, Description, Quantity, FeesAndCommissions, DisbursementElection, Amount`; details per transactie onder meer `AwardDate`, `AwardId`, `VestDate`, `VestFairMarketValue`, `PurchaseDate`, `PurchaseFairMarketValue`, `SalePrice`, `SharesSold`, `NetSharesDeposited`, `SharesWithheld`. In de CSV staan de details op vervolgregels met lege bovenkolommen ([schwab_equity_award_json.py](https://github.com/KapJI/capital-gains-calculator/blob/main/cgt_calc/parsers/schwab_equity_award_json.py)).
- **Soorten:** `Deposit` (vest of ESPP; beschrijving `ESPP`), `Sale`, `Forced Quick Sell`, `Dividend`, `Tax Withholding`, `Wire Transfer`, `Journal`, `Lapse` (de looncomponent van een vest) en meer (zelfde bestand).
- **Valkuil:** bij splitsingen herschrijft Schwab oude regels niet consequent; cgt-calc houdt daarvoor een lijst per aandeel bij (zelfde bestand).
- **Gewone Schwab-rekening:** de brokerage-export (`Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount`) leest Export-To-Ghostfolio al ([voorbeeld](https://github.com/dickwolff/Export-To-Ghostfolio/blob/main/samples/schwab-export.csv)).
- **Pdf:** Portfolio Performance leest de rekeningafschriften van Schwab ([SchwabPDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/SchwabPDFExtractor.java), EPL-1.0).

**Advies:** (b), een herkenner voor de CSV-variant (JSON kan later; de import leest nu alleen CSV). `Deposit` → `buy` tegen `VestFairMarketValue` of `PurchaseFairMarketValue` (aankoopwaarde voor het werkelijk rendement), `Sale` → `sell`, `Dividend` → `dividend`, `Lapse`, `Journal` en `Wire Transfer` overslaan en melden. Werk M, prio 1.

**Nodig:** een geanonimiseerde CSV-export met een RSU-vest, een ESPP-aankoop, een verkoop en een dividend.

**Open vragen:** de aankoopwaarde bij ESPP (aankoopprijs of marktwaarde?); kan een gewone Schwab-rekening ernaast in dezelfde export staan?

#### Morgan Stanley at Work en E\*TRADE

**Wat:** de aandelenplannen van Morgan Stanley at Work (vroeger _Shareworks_, _StockPlan Connect_ of _E\*TRADE stock plan_) staan op etrade.com, onder _At Work_ ([Morgan Stanley, handleiding buiten de VS](https://www.morganstanley.com/cs/pdf/et_account_management_etrade_com_non_us_english.pdf)). Access Direct-rekeningen worden E\*TRADE-rekeningen ([Morgan Stanley](https://www.morganstanley.com/atwork/employees/msad-to-etrade)).

**Routes:**

- **API:** de E\*TRADE-API (OAuth) heeft rekeningen, saldi, transacties en portefeuille, maar ook orders ([E\*TRADE API](https://apisb.etrade.com/docs/api/account/api-account-v1.html)); geen leesrechten-only gevonden, en of stock plan-rekeningen erin zitten, staat er niet. Niet bruikbaar.
- **Exports** (uit de documentatie van SeFA, MIT): _At Work → Holdings → Benefit History_ → _Download_ → _Download Expanded_ geeft **BenefitHistory.xlsx** (RSU en ESPP); onder _Holdings_ staat ook een export _holdings by status_ ([SeFA](https://github.com/atulgpt/SeFA/blob/main/src/sefa/parser/demat/etrade/README.md)). De handleiding van Morgan Stanley zelf noemt alleen _Holdings_, _Orders_, bevestigingen en _Tax Documents_ ([handleiding](https://www.morganstanley.com/cs/pdf/et_account_management_etrade_com_non_us_english.pdf)).
- **Oude Morgan Stanley-rapporten:** `Releases Report.csv` (`Vest Date, Order Number, Plan, Type, Status, Price, Quantity, Net Cash Proceeds, Net Share Proceeds, Tax Payment Method`) en `Withdrawals Report.csv` (`Execution Date, Order Number, Plan, Type, Order Status, Price, Quantity, Net Amount, Net Share Proceeds, Tax Payment Method`); cgt-calc heeft ze alleen getest met Alphabet ([mssb.py](https://github.com/KapJI/capital-gains-calculator/blob/main/cgt_calc/parsers/mssb.py), [cgt-calc](https://cgt-calc.uk/brokers/morgan-stanley/)).
- **Pdf:** Portfolio Performance leest bevestigingen van E\*TRADE (_EMPLOYEE STOCK PLAN RELEASE CONFIRMATION_) en kwartaaloverzichten van Morgan Stanley (_SHARE PURCHASE AND HOLDINGS_, _Release Detail Report_) ([ETradePDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/ETradePDFExtractor.java), [MorganStanleyPDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/MorganStanleyPDFExtractor.java), EPL-1.0).

**Advies:** (b) voor BenefitHistory (Excel, opgeslagen als CSV) en (c) voor de holdings-export als portefeuille-overzicht op de dag van downloaden. Begin met de holdings: die geven de stand, en een export in begin januari benadert 1 januari. Werk M, prio 1.

**Nodig:** geanonimiseerde BenefitHistory.xlsx en holdings-export.

**Open vragen:** de kolommen van beide bestanden (niet openbaar gezien); of de holdings op een datum te kiezen zijn; hoe verkopen erin staan.

#### Fidelity NetBenefits en Stock Plan Services

**Wat:** aandelenplannen bij Fidelity Stock Plan Services.

**Routes:** de _Activity_-CSV van NetBenefits met `Transaction date, Transaction type, Investment name, Shares, Amount` ([beancounttools, netbenefits](https://github.com/tarioch/beancounttools/blob/master/src/tariochbctools/importers/netbenefits/importer.py), MIT). Portfolio Performance leest bevestigingen met _YOU PURCHASED_ of _YOU SOLD_ ([FidelityInternationalPDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/FidelityInternationalPDFExtractor.java), EPL-1.0). Een officiële beschrijving van Fidelity is niet gevonden.

**Advies:** (b). Werk M, prio 2. **Nodig:** een geanonimiseerde Activity-CSV. **Open vraag:** bevat de CSV de vests, of alleen aan- en verkopen?

#### Computershare en EquatePlus

**Wat:** Computershare beheert aandelenregisters en werknemersplannen. De release notes van EquatePlus (oorspronkelijk van Equatex) staan op de site van Computershare ([EquatePlus release notes](https://content-assets.computershare.com/eh96rkuu9740/2R1Z53p8y8ZnwyX1UvX6wZ/dc632ce060e118ffbdc60d10a44d375c/EquatePlus-Release-70-Notes-EQX.pdf)), en Computershare kocht het Europese plangedeelte van Shareworks van Morgan Stanley ([persbericht via Nasdaq](https://www.nasdaq.com/press-release/computershare-to-buy-european-public-equity-employee-share-plan-business-from)).

**Routes:**

- **EquatePlus:** een _Participant Plan Holdings Statement_ op aanvraag, voor een periode van hoogstens 12 maanden, met beschikbare en geblokkeerde stukken per plan en de transacties per soort ([Computershare](https://images.info.computershare.com/Web/CMPTSHR1/%7B189d4c0d-b6f3-4ba6-bc09-ec194b9ccb6d%7D_Participant_Plan_Holdings_Statement.pdf)). Formaat niet vermeld; vermoedelijk pdf. _EquateAPI_ bestaat, maar is voor werkgevers (release notes).
- **Investor Center:** transacties onder _Activity_ te exporteren als pdf of "C…" (de tekst breekt af; vermoedelijk CSV) ([FAQ van een uitgevende instelling](https://s202.q4cdn.com/481442212/files/doc_downloads/2026/PKST-Website-FAQ-6-19-26-vFinal.pdf), tweedehands).
- **Pdf:** Portfolio Performance leest het _Plan Statement_ ([ComputersharePDFExtractor](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/ComputersharePDFExtractor.java), EPL-1.0).

**Advies:** pdf als portefeuille-overzicht (c): het holdings statement tot en met 31 december. Tot die tijd (d). Werk M, prio 2.

**Nodig:** de tekst van een holdings statement (EquatePlus) of plan statement (Computershare).

#### Equiniti (EQ)

Niet onderzocht wat EQ Shareview laat downloaden. Prio 3 tot iemand erom vraagt.

### Edelmetaal

#### Goldrepublic

Al ondersteund als edelmetaal in een kluis, in grammen ([README](../README.md#gebruiken)).

#### BullionVault

**API:** XML-pagina's zoals `view_balance_xml.do` en `view_orders_xml.do`, maar alleen na inloggen met gebruikersnaam en wachtwoord (`j_username`, `j_password`, sessiecookie); geen sleutel of alleen-lezenrecht; afschriften hebben geen XML-versie ([BullionVault XML API](https://www.bullionvault.com/help/xml_api.html)). Dus geen koppeling (ADR 0005).

**Advies:** zoals Goldrepublic: aankopen in grammen op Goud of Zilver. Werk S (alleen uitleg), prio 3.

#### Holland Gold

Opslag in _Holland Gold Safe_ (Nederland, Zwitserland, Singapore), volledig gealloceerd, inzichtelijk in het klantportaal ([Holland Gold](https://www.hollandgold.nl/en/faq/opslag/is-the-precious-metal-i-hold-with-holland-gold-safe-fully-owned-by-me-and-exclusively-allocated/); uit een zoekresultaat). Geen export of jaaroverzicht gevonden. Zoals Goldrepublic. Werk S, prio 3.

### Verzekeringen en eigenwoningproducten

#### Kapitaalverzekeringen

**Wat:** kapitaalverzekeringen die geen kapitaalverzekering eigen woning zijn, horen in box 3 met hun waarde op 1 januari, behalve verzekeringen die alleen bij overlijden uitkeren (tot een bedrag), bij invaliditeit, ziekte of ongeval, en polissen van vóór 15 september 1999 die niet zijn verhoogd of verlengd ([Belastingdienst 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_), [Belastingdienst](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/vermogen/wat_zijn_uw_bezittingen_en_schulden/uw_bezittingen/niet_vrijgesteld_deel_kapitaalverzekeringen)). De waarde in het economisch verkeer vraag je op bij de verzekeraar (zelfde pagina).

**Routes:** geen API of export; een waardeopgave per brief of pdf.

**Advies:** (d), bestaat al ("kapitaalverzekering" als soort). Uitleg toevoegen welke vrijstellingen Box3balans niet toepast ([box3-sources.md](box3-sources.md)). Werk S, prio 2.

#### Banksparen en beleggingsrecht eigen woning

Een spaarrekening, beleggingsrecht of kapitaalverzekering eigen woning hoort in box 1 ([Belastingdienst 2026](https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_)). Voldoet het product niet (meer) aan de voorwaarden, of verkoop je de woning zonder binnen drie jaar een nieuwe te kopen, dan gaat de waarde naar box 3 ([Belastingdienst, sparen voor de aflossing](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/woning/uw_hypotheek_of_lening/sparen_voor_de_aflossing_van_uw_hypotheek); uit een zoekresultaat). Voorbeeld: de Hypotheekrekening-beleggen van Brand New Day.

**Advies:** (d), met de rekening op _niet in box 3_ zolang hij in box 1 hoort, en per jaar om te zetten. Werk S, prio 3.

## Route: het pdf-jaaroverzicht

**Stand (oktober 2026):** de basis is gebouwd ([#14](https://github.com/zenonymous/box3balans/issues/14)). De browser leest de pdf met pdf.js en stuurt alleen de tekst ([ADR 0009](adr/0009-pdf-lezen-in-de-browser.md)); de server zoekt de waarden met een sjabloon (`TEMPLATES` in `server/src/import/yearStatement.ts`) of, zonder sjabloon, de bedragen naast een peildatum of een woord als _beginwaarde_; de gebruiker vinkt aan wat in de tabel komt. Er zijn nog geen sjablonen: elk wacht op een tekstvoorbeeld van een gebruiker (zie [README](../README.md#jaaroverzicht-als-pdf)). Een sjabloon toevoegen is daarna werk S.

### Wat het oplevert

| Aanbieder                  | Document                           | Wat erin staat                                                               | Bron                                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand New Day              | financieel jaaroverzicht           | begin- en eindwaarde, dividend, dividendbelasting                            | [informatie beleggingsrekening](https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf)                                                                                             |
| Brand New Day              | kwartaaloverzicht                  | waarde per fonds begin en eind kwartaal, inleg en onttrekkingen, transacties | idem                                                                                                                                                                                                                                         |
| Peaks                      | jaaroverzicht                      | waarde op 1 januari                                                          | [exportformaten.md](exportformaten.md#5-peaks)                                                                                                                                                                                               |
| BLOX                       | jaaroverzicht                      | waarde van de kluis op 1 januari                                             | [BLOX](https://support.weareblox.com/hc/nl/articles/31488885544721-Welk-jaaroverzicht-heb-ik-nodig-voor-mijn-belastingaangifte)                                                                                                              |
| Raisin                     | financieel jaaroverzicht           | niet vermeld                                                                 | [Raisin](https://www.raisin.com/nl-nl/sparen/financieel-jaaroverzicht/)                                                                                                                                                                      |
| Geldvoorelkaar             | jaaropgaaf                         | uitstaand op 1 januari en 31 december, geïnvesteerd, kosten                  | [Geldvoorelkaar](https://www.geldvoorelkaar.nl/veelgestelde-vragen/investeerders/)                                                                                                                                                           |
| Lendahand                  | jaaroverzicht                      | uitstaande leningen, walletsaldo apart                                       | [Lendahand](https://www.lendahand.com/en-EU/pages/crowdfunding-taxes)                                                                                                                                                                        |
| Mintos                     | tax report                         | begin- en eindsaldo, rente, stortingen en opnames                            | [Mintos](https://help.mintos.com/hc/en-us/articles/32061202728849-Tax-Report-Insights-Your-Quick-Guide)                                                                                                                                      |
| NPEX                       | fiscaal jaaroverzicht              | waarde en positie per instrument op 1 januari en 31 december                 | [NPEX](https://www.npex.nl/jaarnota2025)                                                                                                                                                                                                     |
| Kapitaal Op Maat           | fiscaal overzicht                  | ontvangen rente, totaal geïnvesteerd                                         | [Kapitaal Op Maat](https://www.kapitaalopmaat.nl/Hoe-wordt-crowdfunding-belast)                                                                                                                                                              |
| Rabobank                   | jaaroverzicht beleggingen          | waarde op 1 januari (niet geverifieerd)                                      | [Rabobank](https://www.rabobank.nl/particulieren/beleggen/service/waar-staat-het-jaaroverzicht-beleggen)                                                                                                                                     |
| Computershare / EquatePlus | plan statement, holdings statement | posities per plan, transacties                                               | [Computershare](https://images.info.computershare.com/Web/CMPTSHR1/%7B189d4c0d-b6f3-4ba6-bc09-ec194b9ccb6d%7D_Participant_Plan_Holdings_Statement.pdf)                                                                                       |
| Morgan Stanley             | kwartaaloverzicht                  | aankopen en posities (_SHARE PURCHASE AND HOLDINGS_)                         | [Portfolio Performance](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/MorganStanleyPDFExtractor.java)                                                    |
| Verzekeraars               | waardeopgave                       | waarde op 1 januari                                                          | [Belastingdienst](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/vermogen/wat_zijn_uw_bezittingen_en_schulden/uw_bezittingen/niet_vrijgesteld_deel_kapitaalverzekeringen) |

Collin, Mogelijk, Finst, DuurzaamInvesteren, ING, ABN AMRO, Meesman en DEGIRO hebben ook een jaaroverzicht, maar wat erin staat, is niet gevonden. Coinmerce valt af: alleen een scherm in de app.

**Waar het loont:** bij aanbieders zonder CSV en zonder API, waar de gebruiker nu elk jaar een bedrag overtikt. Dat zijn Brand New Day (alleen al ruim 360.000 klanten, niet allemaal met vrij vermogen), Peaks, BLOX, de crowdfundingplatforms en Mintos; bij crowdfunding en crypto zonder vooraf ingevulde aangifte. Overtikken is niet moeilijk; het voordeel zit in de bron in het dossier (welke pdf, welke pagina), in een controle per jaar en in het ophalen van inkomsten en geld erin en eruit, die mensen nu overslaan.

### Wat een lezer nodig heeft

- **Tekst uit de pdf, zonder netwerk.** pdf.js (`pdfjs-dist`, Apache-2.0) geeft tekst met posities. Alleen pdf's met een tekstlaag; scans (OCR) niet. _Gebouwd in de browser in plaats van op de server; zie [ADR 0009](adr/0009-pdf-lezen-in-de-browser.md)._
- **Een sjabloon per aanbieder en document**, als gegevens: hoe je het herkent (een vaste tekst zoals "Financieel jaaroverzicht" plus de naam van de aanbieder) en per veld een label met een getalpatroon (bijvoorbeeld "Beginwaarde" → bedrag rechts ervan). Nederlandse getallen (`1.234,56`) lezen met de bestaande `num(raw, ",")`.
- **Een terugval zonder sjabloon:** zoek "1 januari" en bedragen in de buurt, en laat de gebruiker kiezen. Nooit stil opslaan.
- **Altijd een voorbeeldscherm**, zoals bij de CSV-import: gevonden waarde, de regel uit de pdf waar die vandaan komt, en _Opslaan_ pas na bevestiging. Het dossier noemt de pdf en de pagina als bron.
- **Wat het vult:** _waarden per jaar_ (waarde op 1 januari, en waar het document dat geeft: inkomsten, geld erin en eruit), of een portefeuille-overzicht (c) als het document posities met ISIN en aantal noemt (NPEX, EquatePlus, eventueel het Q4-overzicht van Brand New Day).
- **Privacy:** de pdf niet bewaren, alleen de gevonden waarden en de bestandsnaam, of als bijlage zoals foto's bij edelmetaal; daarover moet de eigenaar beslissen.
- **Testbestanden:** vraag gebruikers niet om pdf's. Zwart gemaakte tekst blijft in een pdf vaak leesbaar. Vraag de uitvoer van `pdftotext -layout bestand.pdf -`, met namen, rekeningnummers en bedragen veranderd. De sjablonen werken op tekst, dus de tests ook.
- **Licenties:** Portfolio Performance heeft 142 pdf-extractors, waaronder Computershare, Morgan Stanley, E\*TRADE, Schwab, Fidelity, Bondora en Raisin Bank ([map](https://github.com/portfolio-performance/portfolio/tree/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf)). Die code is EPL-1.0, niet te combineren met AGPL-3.0: alleen lezen hoe de documenten eruitzien, niets overnemen.

**Werk:** de basis (tekst lezen, sjablonen, voorbeeldscherm, tests) is L; daarna per sjabloon S, mits er een tekstvoorbeeld is.

## Bewust niet

- **PSD2 via een aggregator** (Enable Banking, GoCardless en dergelijke): je bankgegevens gaan dan langs een derde; dat sluit [ADR 0001](adr/0001-zelf-hosten.md) uit. Zelf een PSD2-vergunning hebben kan een thuisinstallatie niet. Zie ook [degiro-koppeling.md](degiro-koppeling.md#3-psd2-de-geldrekening).
- **De vooraf ingevulde aangifte als bron:** de Belastingdienst stuurt die gegevens alleen naar een geregistreerde intermediair, via diens boekhoudsoftware ([Belastingdienst](https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/aangifte_doen/praktische_informatie/gegevens_vooraf_ingevulde_aangifte_voor_uw_intermediair/)).
- **Inloggen met een wachtwoord:** BullionVault, DEGIRO, en de onofficiële Meesman-API ([ADR 0005](adr/0005-geen-inlog-koppelingen.md)).
- **Sleutels die meer kunnen dan lezen:** bunq (kan betalen), Freedom24 (kan handelen, geen leesrecht gevonden), E\*TRADE (OAuth met orders).
- **Wise-API voor Nederlandse rekeningen:** geeft geen saldo-afschriften.

## Niet geverifieerd

- **Brand New Day:** of het financieel jaaroverzicht en het kwartaaloverzicht pdf's zijn en hoe ze eruitzien; of de beginwaarde de waarde op 1 januari is; of het kwartaaloverzicht aantallen noemt; of er een app-export of een openbare dagkoers per fonds is; hoe de Cashallocatie in box 3 telt; dat Ohpen er niet achter zit (alleen afgeleid uit het jaarverslag).
- **Revolut, Wise, N26:** alle kopregels komen uit open-sourceparsers, niet van de aanbieders; of geldmarktfondsen in het Revolut-afschrift staan; hoe de Belastingdienst saldi bij Wise en PayPal indeelt.
- **LYNX en Mexem:** dat de Flex Web Service van IBKR werkt met hun rekeningen (alleen tweedehands en afgeleid).
- **eToro:** de soortwaarden in `Type` en hoe CFD's en verkopen erin staan.
- **Finst:** de kolommen van de Excel-export en de inhoud van het jaaroverzicht; of oude Anycoin-geschiedenis bij Finst te halen is.
- **BLOX, Bitonic, Coinmerce:** of er een transactie-export bestaat die het help center niet noemt; de inhoud van de BLOX-pdf; de kolommen van de Coinmerce-CSV; of Bitonic een API voor accountgegevens heeft (alleen CoinLedger zegt dat).
- **Bitpanda:** of `/v1/operations` effecten en metalen met ISIN geeft, en dat `Read` echt alleen leest.
- **Crypto.com:** de details van de app-export (drie jaar per rapport, 30 dagen) komen uit een zoekresultaat.
- **Bybit:** dat sleutels zonder IP-beperking na drie maanden verlopen (alleen CoinLedger).
- **Binance:** of Nederlandse accounts na juli 2023 nog API-sleutels kunnen maken.
- **Aandelenplannen:** alle exportformaten komen uit open-sourceparsers (cgt-calc, SeFA, beancounttools), niet van Schwab, Morgan Stanley of Fidelity; of niet-gevest RSU's en niet-uitgeoefende opties buiten box 3 vallen; het formaat van de EquatePlus-statements; de CSV-export van Computershare Investor Center; Equiniti niet onderzocht.
- **Crowdfunding:** de inhoud van de jaaroverzichten van Collin, Lendahand en Mogelijk; DuurzaamInvesteren (pagina laadt met JavaScript); Invesdor niet onderzocht; de Mintos-export als XLS (alleen forum).
- **Groene beleggingen:** de einddatum van de vrijstelling (2027 of 2028; bronnen spreken elkaar tegen); de gegevens over het ASN Groenprojectenfonds komen uit zoekresultaten.
- **Vermogensbeheer:** de inhoud van de jaaroverzichten van Rabobank (403) en Van Lanschot; of Evi nog bestaat; de nieuwsberichten over Ohpen-klanten.
- **Bereik:** voor de meeste aanbieders geen betrouwbaar Nederlands klantenaantal gevonden (Revolut, Wise, eToro, BLOX, Bitpanda, Crypto.com, de aandelenplannen).
- **Overig:** waar N26, PayPal en Revolut Bank gevestigd zijn (algemeen bekend, niet nagelezen); dat Mexem via Interactive Brokers werkt; de opslaglanden van Holland Gold (uit een zoekresultaat); de Triodos-toelichting over het voordeel over 2026 (de pdf was niet te openen).

**Nog niet onderzocht:** Equiniti (EQ Shareview), Invesdor (ex-Oneplanetcrowd), Carta en Global Shares (aandelenplannen van niet-beursgenoteerde en andere werkgevers), OKX en KuCoin, spaarbanken zonder bekende export (NN Bank, NIBC, Santander, Ayvens), andere edelmetaalhandelaren met opslag (zoals The Silver Mountain), en de PayPal-export.

## Bronnen

Box3balans:

- README, bankexports en herkende exports: [README.md](../README.md)
- Eerder onderzoek: [exportformaten.md](exportformaten.md), [degiro-koppeling.md](degiro-koppeling.md), [box3-sources.md](box3-sources.md)
- Beslissingen: [ADR 0001](adr/0001-zelf-hosten.md), [ADR 0005](adr/0005-geen-inlog-koppelingen.md)
- Code: `server/src/import/bank.ts` (kopjes van de bankimport), `server/src/import/statement.ts`, `server/src/import/formats/`

Belastingdienst, RVO en Rijksoverheid:

- Bezittingen en schulden box 3, 2026: https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_
- Niet-vrijgesteld deel kapitaalverzekeringen: https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/vermogen_en_aanmerkelijk_belang/vermogen/wat_zijn_uw_bezittingen_en_schulden/uw_bezittingen/niet_vrijgesteld_deel_kapitaalverzekeringen
- Sparen voor de aflossing van uw hypotheek: https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/woning/uw_hypotheek_of_lening/sparen_voor_de_aflossing_van_uw_hypotheek
- Cryptobezittingen: https://www.belastingdienst.nl/wps/wcm/connect/nl/werk-en-inkomen/content/cryptovaluta
- Gegevens vooraf ingevulde aangifte voor uw intermediair: https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/belastingdienst/prive/aangifte_doen/praktische_informatie/gegevens_vooraf_ingevulde_aangifte_voor_uw_intermediair/
- RVO, regeling groenprojecten en groenfondsen: https://www.rvo.nl/subsidies-financiering/regeling-groenprojecten, https://www.rvo.nl/subsidies-financiering/regeling-groenprojecten/groenfondsen
- Rijksoverheid, groen sparen: https://rijksoverheid.nl/vraag-en-antwoord/duurzame-economie/groen-sparen-in-een-groenfonds

Brand New Day:

- Belangrijke informatie over uw beleggingsrekening (versie 5 december 2024): https://www.brandnewday.nl/content/app/pdf/documentencentrum/Bank/Belangrijke-informatie-beleggingsrekening.pdf
- FAQ jaaroverzicht: https://new.brandnewday.nl/veelgestelde-vragen-over-het-jaaroverzicht/
- Jaarverslag 2025 Brand New Day Bank: https://new.brandnewday.nl/documenten/jaarverslag-2025-bnd-bank.pdf
- Productvoorwaarden spaardeposito: https://new.brandnewday.nl/documenten/productvoorwaarden-spaardeposito-revision-3.pdf
- Factsheet BND Wereld Indexfonds Unhedged: https://www.brandnewday.nl/content/app/pdf/documentencentrum/FactsheetsCollectief/BND-Wereld-Indexfonds-C-Unhedged.pdf
- Forum Portfolio Performance (tweedehands): https://forum.portfolio-performance.info/t/pdf-import-from-brand-new-day/31804
- IEXProfs over Ohpen (tweedehands): https://www.iexprofs.nl/onbekend/54936/onbekend/Ohpen-is-nu-echt-open.aspx

Banken en fintechs:

- Revolut: https://help.revolut.com/nl-NL/help/app-features/flexible-accounts/difference-between-savings-and-flexible/, https://www.revolut.com/nl-NL/savings/open-a-savings-account/
- Wise: https://docs.wise.com/guides/developer/auth-and-security/personal-api-token.md, https://www.wise.com/nl/interest
- bunq: https://doc.bunq.com/basics/authentication/api-keys, https://help.bunq.com/articles/what-types-of-bank-statements-can-i-export, https://help.bunq.com/articles/how-do-i-export-my-annual-account-overview, https://help.bunq.com/articles/ginmon-our-bunq-stocks-partner
- Raisin: https://www.raisin.com/nl-nl/sparen/financieel-jaaroverzicht/, https://www.raisin.com/nl-nl/belasting/
- Ohpen: https://www.ohpen.com/; tweedehands: https://www.banken.nl/nieuws/20613/de-volksbank-kiest-core-banking-platform-ohpen-voor-beleggingsdiensten, https://ibsintelligence.com/ibsi-news/de-volksbank-renews-core-banking-contract-with-ohpen/, https://www.ipe.com/news/tkp-to-outsource-investment-admin-for-dc-plans-to-ohpen/10043380.article

Brokers en vermogensbeheer:

- LYNX: https://www.lynx.nl/online-broker/interactive-brokers-lynx/, https://www.lynx.nl/beurs/beurs-koersen/beursinfo/beurs-nieuws-tips/beleggen-ai-chatgpt-claude/; Portfolio Dividend Tracker (tweedehands): https://help-en.portfoliodividendtracker.com/article/269-download-your-lynx-actions
- eToro: https://help.etoro.com/s/article/what-is-the-etoro-account-statement?language=en_GB, https://www.etoro.com/nl/customer-service/regulation-license/
- Freedom24: https://freedom24.com/tradernet-api/auth-api; tweedehands: https://www.tradesviz.com/blog/auto-import-freedom24/, https://forum.portfolio-performance.info/t/freedom24-import/18110/3, https://cyprus-mail.com/2024/09/26/online-broker-freedom24-reaches-300000-customers
- XTB (tweedehands): https://trade.nl/broker/xtb/
- NN: https://www.nn.nl/Particulier/Beleggen/Beheerd-Beleggen/Kosten-Beheerd-Beleggen.htm, https://www.nn.nl/Particulier/Beleggen/Productvoorwaarden-Beheerd-Beleggen.htm
- a.s.r.: https://www.asr.nl/levensverzekering/sparen-beleggen, https://www.asrnederland.nl/-/media/files/asrnederland-nl/nieuws-en-pers/2020/20200115-persbericht-asr-en-van-lanschot-kempen-gaan-samenwerkingsovereenkomst-aan.pdf
- Rabobank (403; inhoud uit zoekresultaat): https://www.rabobank.nl/particulieren/beleggen/service/waar-staat-het-jaaroverzicht-beleggen
- Tweedehands: https://www.vermogensbeheer.nl/nieuws/semmie-neemt-index-capital-over, https://www.banken.nl/nieuws/amp/24333/van-lanschot-kempen-neemt-online-beleggingsplatform-robeco-over, https://www.financieelonafhankelijkblog.nl/centraal-beheer-beleggen-review-en-ervaringen

Crypto:

- BLOX: https://support.weareblox.com/hc/nl/articles/25982426553617-Waar-kan-ik-mijn-jaaroverzicht-vinden, https://support.weareblox.com/hc/nl/articles/31488885544721-Welk-jaaroverzicht-heb-ik-nodig-voor-mijn-belastingaangifte, https://support.weareblox.com/hc/nl/articles/44505422300817-Welke-informatie-wordt-gedeeld, https://support.weareblox.com/hc/nl/articles/44505479681041-Vanaf-wanneer-geldt-DAC8-voor-mijn-transacties, https://support.weareblox.com/hc/nl/articles/40656130782737-Ontvang-ik-een-factuur-van-de-Beheer-kosten, https://weareblox.com/nl-nl/blox-verkrijgt-micar-licentie (het help center gelezen via de openbare Zendesk-API)
- Finst: https://help.finst.com/nl/article/hoe-kan-ik-mijn-transactiegeschiedenis-downloaden-1n7971t/, https://help.finst.com/nl/article/biedt-finst-een-jaarlijks-belastingrapportoverzicht-1xai8v8/, https://help.finst.com/nl/article/biedt-finst-api-trading-aan-1l8kyfy/, https://finst.com/nl/blog/articles/finst-and-anycoin-direct-join-forces
- Anycoin Direct (tweedehands): https://intercom.help/blockpit/de/articles/12136922-wie-importiere-ich-daten-mittels-anycoin-direct-csv-excel-datei, https://cointracking.info/imports/anycoin-tax/
- Bitonic: https://bitonic.nl/nl/faq, https://bitonic.nl/nl/api, https://bitonic.nl/nl/news/301/bl3p-definitief-offline, https://bitonic.nl/nl/news/298/bitonic-ontvangt-micar-vergunning-van-de-autoriteit-financiele-markten; CoinLedger (tweedehands): https://coinledger.io/de/integrations/bitonic
- Coinmerce: https://support.coinmerce.io/en/articles/209223-annual-overview, https://support.coinmerce.io/en/articles/178418-how-is-my-crypto-taxed, https://support.coinmerce.io/en/articles/179087-general-terms-and-conditions; Waltio (tweedehands): https://help.waltio.com/en/articles/5837160-coinmerce-file
- Bitpanda: https://docs.public.bitpanda.com/, https://docs.public.bitpanda.com/migrating-from-the-legacy-api, https://support.bitpanda.com/hc/en-gb/articles/360000122759-How-can-I-download-the-history-of-my-Bitpanda-account, https://support.bitpanda.com/hc/nl/articles/18668973207580-Belastingrapporten-bekijken-en-begrijpen, https://support.bitpanda.com/hc/nl/articles/5771948622364-Bitpanda-Grondstoffen
- Crypto.com: https://help.crypto.com/en/articles/3438579-how-do-i-export-my-transaction-history-app
- Bybit: https://bybit-exchange.github.io/docs/v5/guide; tweedehands: https://help.coinledger.io/en/articles/6588913-bybit-api-import-guide, https://financemagnates.com/cryptocurrency/exchange/mexc-to-offboard-dutch-users-recommends-bybit-as-micar-compliant-alternative/
- Binance: https://www.binance.com/en/support/announcement/notice-on-changes-of-services-in-the-netherlands-b5a647be31cf469b87fc3337fd461ced
- Bitstamp: https://www.bitstamp.net/api/
- rotki: https://docs.rotki.com/usage-guides/integrations/exchange-keys, https://rotki.com/integrations/bitstamp, https://rotki.com/integrations/bybit, https://rotki.com/integrations/binance

Crowdfunding en P2P:

- Geldvoorelkaar: https://www.geldvoorelkaar.nl/veelgestelde-vragen/investeerders/, https://www.geldvoorelkaar.nl/over-ons/statistiekpagina/
- Collin: https://www.collincrowdfund.nl/veelgestelde-vragen/, https://www.collincrowdfund.nl/nieuwsbrief-collin-doorkruist-de-grens-van-300-miljoen/
- Lendahand: https://www.lendahand.com/en-EU/pages/crowdfunding-taxes
- Mogelijk: https://www.mogelijk.nl/faq/jaaroverzichten
- Kapitaal Op Maat: https://www.kapitaalopmaat.nl/Hoe-wordt-crowdfunding-belast
- DuurzaamInvesteren (inhoud uit zoekresultaat): https://www.duurzaaminvesteren.nl/over-duurzaaminvesteren/belastingopgave-2025
- NPEX: https://www.npex.nl/jaarnota2025
- Mintos: https://help.mintos.com/hc/en-us/articles/32061202728849-Tax-Report-Insights-Your-Quick-Guide, https://help.mintos.com/hc/en-us/articles/43210112798225-When-will-my-2025-tax-report-be-available, https://help.mintos.com/hc/en-us/articles/33872886368401-How-can-I-access-my-account-statement, https://help.mintos.com/hc/en-us/articles/7220945828113-What-is-an-API; forum (tweedehands): https://forum.portfolio-performance.info/t/unterstuetzung-von-p2p-anbietern-wie-mintos/5511
- Go & Grow: https://help.goandgrow.eu/hc/en-us/articles/34275456362898-How-to-generate-statements-and-tax-reports

Groene beleggingen:

- Triodos: https://www.triodos-im.com/binaries/content/assets/shared/fund-assets/tim/tgf/toelichting-wijziging-prospectus-triodos-groenfonds-nv-per-1-april-2026.pdf, https://www.triodos-im.com/articles/2026/triodos-groenfonds-becomes-even-more-impactful
- ASN (uit zoekresultaten): https://beleggingsfondsen.asnbank.nl/overig/downloads/faq-asn-impact-investors.html, https://beleggingsfondsen.asnbank.nl/overig/downloads/toelichting-openen-asn-groenprojectenfonds-februari-2025.html

Aandelenplannen:

- Morgan Stanley: https://www.morganstanley.com/cs/pdf/et_account_management_etrade_com_non_us_english.pdf, https://www.morganstanley.com/atwork/employees/msad-to-etrade
- E\*TRADE API: https://apisb.etrade.com/docs/api/account/api-account-v1.html
- Computershare: https://images.info.computershare.com/Web/CMPTSHR1/%7B189d4c0d-b6f3-4ba6-bc09-ec194b9ccb6d%7D_Participant_Plan_Holdings_Statement.pdf, https://content-assets.computershare.com/eh96rkuu9740/2R1Z53p8y8ZnwyX1UvX6wZ/dc632ce060e118ffbdc60d10a44d375c/EquatePlus-Release-70-Notes-EQX.pdf, https://www.nasdaq.com/press-release/computershare-to-buy-european-public-equity-employee-share-plan-business-from; FAQ uitgevende instelling (tweedehands): https://s202.q4cdn.com/481442212/files/doc_downloads/2026/PKST-Website-FAQ-6-19-26-vFinal.pdf
- cgt-calc: https://cgt-calc.uk/brokers/schwab/, https://cgt-calc.uk/brokers/morgan-stanley/

Edelmetaal:

- BullionVault: https://www.bullionvault.com/help/xml_api.html
- Holland Gold: https://www.hollandgold.nl/en/faq/opslag/is-the-precious-metal-i-hold-with-holland-gold-safe-fully-owned-by-me-and-exclusively-allocated/

Open-sourceprojecten (code en testbestanden gelezen, niets gekopieerd):

- capital-gains-calculator (cgt-calc), **MIT**: https://github.com/KapJI/capital-gains-calculator (`cgt_calc/parsers/schwab_equity_award_json.py`, `mssb.py`)
- SeFA, **MIT**: https://github.com/atulgpt/SeFA/blob/main/src/sefa/parser/demat/etrade/README.md
- beancounttools, **MIT**: https://github.com/tarioch/beancounttools/blob/master/src/tariochbctools/importers/netbenefits/importer.py
- revolut-toolkit, **MIT**: https://github.com/lastunicorn/revolut-toolkit
- you-need-a-parser, **MIT**: https://github.com/leolabs/you-need-a-parser/blob/master/packages/ynap-parsers/src/de/n26/n26.ts
- ledger-autosync, **GPL-3.0**: https://github.com/egh/ledger-autosync/blob/master/examples/plugins/wise.py
- Export-To-Ghostfolio, **Apache-2.0**: https://github.com/dickwolff/Export-To-Ghostfolio (`samples/` en `src/converters/` voor Crypto.com, eToro, Schwab, XTB)
- BittyTax, **AGPL-3.0**: https://github.com/BittyTax/BittyTax/tree/master/src/bittytax/conv/parsers (Binance, Bitpanda, Bitstamp, Bybit, Crypto.com, PayPal)
- rotki, **AGPL-3.0**: https://github.com/rotki/rotki/tree/develop/rotkehlchen/exchanges en https://github.com/rotki/rotki/tree/develop/rotkehlchen/data_import/importers
- Portfolio Performance, **EPL-1.0**: https://github.com/portfolio-performance/portfolio/tree/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf

Niet gevonden: een importer voor Brand New Day, Finst, BLOX, Bitonic, Coinmerce of een van de Nederlandse crowdfundingplatforms, in welk open-sourceproject dan ook (gezocht op GitHub, in de lijsten van rotki, BittyTax, Export-To-Ghostfolio en Portfolio Performance).
