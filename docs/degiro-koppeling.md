# DEGIRO automatisch bijwerken: wat kan er?

Onderzocht op 11 oktober 2026.

**Kort:** DEGIRO heeft geen officiële API. Er is ook geen sleutel met alleen leesrechten, en geen token zoals de Flex Web Service van Interactive Brokers. De klantovereenkomst verbiedt scripts en API's binnen het handelsplatform, en ook het delen van je inloggegevens met wie dan ook. Elke automatische koppeling die wel bestaat, logt in met je gebruikersnaam en wachtwoord, en die geven volledige handelsrechten. Dat geldt voor de open-sourcebibliotheken, voor SnapTrade, getquin en Delta. De onofficiële webtrader-API brak sinds december 2022 minstens zes keer. PSD2 helpt niet: dat gaat alleen over geld, en de geldrekening bij flatexDEGIRO is vermoedelijk geen betaalrekening.

**Advies:** bouw geen koppeling die inlogt. Maak de route met exports beter:

- Lees de export _Portefeuille_ op een gekozen datum (31 december) in als stand op de peildatum en als controle op de transacties.
- Houd het rekeningoverzicht (Account.csv) als bron voor aankopen, verkopen en dividend.
- Twee bestanden per jaar, in januari, dekken wat box 3 nodig heeft.

Een koppeling via de webtrader-API hooguit als experiment: wachtwoord per keer ingetikt, inlog goedgekeurd in de DEGIRO-app, nooit opgeslagen. Zie [7](#7-advies-voor-box3balans).

## 1. Officiële API

- **Geen API voor particulieren.** Het helpcentrum heeft geen artikel over een API of apps van derden ([helpcentrum](https://www.degiro.nl/helpdesk/)). De investor-relationspagina van flatexDEGIRO noemt geen API of koppelingen voor klanten ([flatexDEGIRO IR](https://www.flatexdegiro.com/investor-relations)). SnapTrade, dat DEGIRO wel ontsluit, schrijft zelf dat DEGIRO geen openbare API voor ontwikkelaars heeft ([SnapTrade](https://snaptrade.com/brokerage-integrations/degiro-api)).
- **Wat de klantovereenkomst zegt** (_Cliënt Overeenkomst_, voettekst versie 20220830, PDF opgehaald op 11 oktober 2026; [PDF](https://www.degiro.nl/data/pdf/Voorwaarden_Beleggingsdiensten.pdf)):
  - **Geautomatiseerde Instrumenten** zijn volgens de definities onder meer geautomatiseerde zoekopdrachten, scripts en een "toepassingsprogramma-interface". **Art. 5.6** verbiedt die binnen het handelsplatform. Ziet DEGIRO ze, dan kan het de zoekopdrachten, de activiteiten en het account blokkeren.
  - **Art. 5.5 en 7.5:** geen algorithmic trading en geen geautomatiseerde orders. Wie automatisch wil handelen, neemt eerst contact op met DEGIRO.
  - **Art. 3.2:** alleen de cliënt mag de Toegangscode gebruiken (gebruikersnaam plus wachtwoord of biometrie).
  - **Art. 7.2.1:** maak de Toegangscode nooit aan iemand bekend, ook niet aan medewerkers van DEGIRO. Elk gebruik door derden geldt als onbevoegd en is niet toegestaan. Bij een redelijk vermoeden blokkeert DEGIRO het account.
  - **Art. 7.2.2:** na zeven foute wachtwoorden volgt een blokkade die alleen DEGIRO kan opheffen.
- **Geen volmacht.** Alleen de rekeninghouder mag de rekening beheren ([helpcentrum: volmacht](https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/kan-ik-een-volmacht-geven-voor-mijn-account)).

**Gevolg:** een aggregator die met jouw wachtwoord inlogt, is een derde in de zin van art. 7.2.1. Box3balans draait bij de eigenaar zelf, dus die bepaling is daar minder duidelijk. Een script dat gegevens ophaalt, valt wel onder art. 5.6.

## 2. De onofficiële webtrader-API

De webtrader en de app praten met `trader.degiro.nl`. Vier bibliotheken bootsen dat na:

| Bibliotheek                                                                   | Taal       | Laatste release                                                         | Inloggen                            |
| ----------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- | ----------------------------------- |
| [Chavithra/degiro-connector](https://github.com/Chavithra/degiro-connector)   | Python     | 3.0.36, 26 mei 2026                                                     | wachtwoord + TOTP of in-app         |
| [OhMajesticLama/degiroasync](https://github.com/OhMajesticLama/degiroasync)   | Python     | 1.1.0, 27 juni 2026                                                     | wachtwoord + TOTP                   |
| [icastillejogomez/degiro-api](https://github.com/icastillejogomez/degiro-api) | TypeScript | 1.0.6, 14 mei 2026 (alleen een User-Agent-fix; daarvoor 1.0.4 uit 2021) | wachtwoord + TOTP, of een sessie-id |
| [lolokraus/DegiroAPI](https://github.com/lolokraus/DegiroAPI) (`degiroapi`)   | Python     | 0.9.5, juni 2020                                                        | stil sinds 2022                     |

Releasedata uit [PyPI](https://pypi.org/project/degiro-connector/) en [npm](https://www.npmjs.com/package/degiro-api).

**Inloggen** ([action_connect.py](https://github.com/Chavithra/degiro-connector/blob/main/src/degiro_connector/trading/actions/action_connect.py), [connection.py](https://github.com/Chavithra/degiro-connector/blob/main/examples/trading/connection.py)):

- Gebruikersnaam en wachtwoord gaan in een POST naar `/login/secure/login`. Met een authenticator-app gaat er ook een TOTP-code mee naar `/login/secure/login/totp`. De bibliotheek kan die code zelf maken uit het TOTP-geheim.
- Zonder authenticator antwoordt DEGIRO met een `inAppToken`. De client vraagt dan elke 5 seconden opnieuw via `/login/secure/login/in-app`, tot je in de app op Ja tikt. Dit kwam erin in september 2025 ([PR #184](https://github.com/Chavithra/degiro-connector/pull/184)).
- Een SMS-code ondersteunt geen van de bibliotheken ([#164](https://github.com/Chavithra/degiro-connector/issues/164)).
- Na te veel mislukte pogingen vraagt DEGIRO een captcha, die je in de browser moet oplossen ([PR #183](https://github.com/Chavithra/degiro-connector/pull/183)).
- **Wat DEGIRO zegt:** inloggen op een nieuw apparaat vraagt wachtwoord plus een tweede stap: een melding in de app (standaard), een SMS-code of een code uit een authenticator-app ([helpcentrum: inloggen](https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/ik-heb-hulp-nodig-om-te-loggen-op-mijn-account), [twee-stapsverificatie](https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/toegang-tot-uw-degiro-account/wat-twee-stapsverificatie)).

**Sessie:**

- De login geeft een `sessionId` (JSESSIONID). Het rekeningnummer `intAccount` komt uit `/pa/secure/client`. Beide gaan bij elke aanvraag mee.
- Hoe lang een sessie leeft, documenteert DEGIRO niet. degiro-connector gaat uit van 30 minuten zonder gebruik ([README §3.8](https://github.com/Chavithra/degiro-connector#38-is-there-a-timeout-)). Niet geverifieerd.

**Endpoints die Box3balans nodig zou hebben** ([urls.py](https://github.com/Chavithra/degiro-connector/blob/main/src/degiro_connector/core/constants/urls.py)):

- **Posities nu:** `trading/secure/v5/update/{intAccount};jsessionid=…` met `portfolio=0`.
- **Posities op een datum:** `portfolio-reports/secure/v3/positionReport/{csv|xls|pdf|html}` met `toDate`. Dit lijkt de export _Portefeuille_ te zijn ([action_get_position_report.py](https://github.com/Chavithra/degiro-connector/blob/main/src/degiro_connector/trading/actions/action_get_position_report.py)).
- **Transacties:** `portfolio-reports/secure/v4/transactions` (JSON, van–tot).
- **Geldbewegingen, inclusief dividend:** `portfolio-reports/secure/v6/accountoverview` (JSON). Hetzelfde als bestand: `portfolio-reports/secure/v3/cashAccountReport/{format}`.
- **Productgegevens met ISIN:** `product_search/secure/v5/products/info`, op product-id.

Dat de CSV's van deze endpoints gelijk zijn aan Portfolio.csv en Account.csv, ligt voor de hand maar is niet geverifieerd.

**Zonder opgeslagen wachtwoord?** Geen van de bibliotheken kent een token dat lang geldig blijft, of een refresh-token. De TypeScript-bibliotheek kan werken met alleen een bestaand sessie-id ([PR #21](https://github.com/icastillejogomez/degiro-api/pull/21), januari 2021). Dan kopieer je dat uit je browser, en het vervalt met de sessie. De goedkeuring in de app maakt een opgeslagen TOTP-geheim overbodig, maar het wachtwoord blijft bij elke login nodig.

**Hoe vaak het brak:**

- **December 2022:** botdetectie weert de standaard User-Agent van Python ("python_bot"). De oplossing is een browser-User-Agent ([DegiroAPI #61](https://github.com/lolokraus/DegiroAPI/issues/61), [#107](https://github.com/Chavithra/degiro-connector/issues/107)).
- **Januari 2023:** foutcode 429 (te veel aanvragen) bij herhaald inloggen; na 15 minuten wachten lukt het weer even ([#110](https://github.com/Chavithra/degiro-connector/issues/110)).
- **Half maart 2024:** de firewall van Myra blokkeert aanvragen zonder User-Agent. De TypeScript-bibliotheek werkte pas in mei 2026 weer ([#57](https://github.com/icastillejogomez/degiro-api/issues/57), [v1.0.5](https://github.com/icastillejogomez/degiro-api/commits/master)).
- **Juni 2024:** de rapportage-endpoints verhuizen van `/reporting/` naar `/portfolio-reports/` (502 Bad Gateway). Binnen enkele dagen gerepareerd ([#147](https://github.com/Chavithra/degiro-connector/issues/147)).
- **Augustus 2024:** een gebruiker meldt dat tweestapsverificatie vanaf september verplicht wordt ([DegiroAPI #64](https://github.com/lolokraus/DegiroAPI/issues/64)). Dat is tweedehands: DEGIRO's eigen pagina's zeggen het niet zo.
- **December 2024:** een vraag of DEGIRO IP-adressen van Google Cloud weert. De login gaf HTML in plaats van JSON. Onbeantwoord ([#161](https://github.com/Chavithra/degiro-connector/issues/161)).
- **Maart 2025:** endpoints verhuizen naar `/secure` ([PR #168](https://github.com/Chavithra/degiro-connector/pull/168)).
- **Augustus–september 2025:** de goedkeuring in de app en de captcha vragen aanpassingen. Productzoeken gaat van v5 naar v1, met wisselende 404's; die issue staat nog open ([#188](https://github.com/Chavithra/degiro-connector/issues/188)).
- **Februari–juni 2026:** degiroasync 1.0.0 noemt een "DEGIRO API overhaul", ook voor het inloggen ([CHANGELOG](https://github.com/OhMajesticLama/degiroasync/blob/main/CHANGELOG.md)).

**Onderhoud:**

- **degiro-connector:** de levendigste, maar traag. Laatste commit mei 2026, 22 open issues en pull requests.
- **degiroasync:** klein (4 sterren), maar bijgehouden.
- **De TypeScript-bibliotheek:** zoekt sinds augustus 2024 onderhouders ([#59](https://github.com/icastillejogomez/degiro-api/issues/59)).

## 3. PSD2: de geldrekening

- **De interface bestaat.** flatexDEGIRO publiceert een PSD2-interface (XS2A) met consents, rekeningen, saldi en transacties ([specificatie](https://s206.q4cdn.com/770226284/files/doc_downloads/2026/05/Characteristic-XS2A-interface-of-the-FTX-Bank.pdf)). Wat je kunt ophalen, volgt volgens het document uit wat je in het internetbankieren kunt. Nederlandse klanten beheren hun geldrekening via het platform van DEGIRO (art. 10.3.1 van de overeenkomst). Of deze interface DEGIRO-geldrekeningen van Nederlandse klanten bevat, is niet geverifieerd.
- **Vermoedelijk geen betaalrekening.**
  - De geldrekening dient volgens art. 10.3.1 uitsluitend als clearingrekening voor effectentransacties. Geld gaat alleen naar en van de tegenrekening (art. 8.1).
  - De algemene FAQ van flatexDEGIRO Bank (niet specifiek voor DEGIRO) zegt dat geldrekeningen niet bedoeld zijn als betaalrekening ([FAQ](https://flatexdegiro.com/English/bank-se/bank-se-faqs)).
  - Het Hof van Justitie oordeelde dat een rekening waarvan geld alleen via een andere rekening weg kan, geen betaalrekening is ([C-191/17](https://eur-lex.europa.eu/legal-content/NL/TXT/?uri=CELEX:62017CJ0191)).
  - PSD2 geeft rekeninginformatiediensten alleen toegang tot betaalrekeningen ([PSD2, art. 67](https://eur-lex.europa.eu/eli/dir/2015/2366/oj)).
- **Geen aggregator gevonden die DEGIRO voor Nederland noemt.**
  - **Enable Banking:** de marktpagina's voor Nederland en Duitsland noemen DEGIRO en flatex niet ([NL](https://enablebanking.com/docs/markets/nl/), [DE](https://enablebanking.com/docs/markets/de/)). Eigen rekeningen koppelen in een beperkte modus kan wel ([Control Panel](https://enablebanking.com/docs/api/control-panel/), [FAQ](https://enablebanking.com/docs/faq/)).
  - **GoCardless Bank Account Data:** de eigen documentatie meldt geen stop ([docs](https://docs.gocardless.com/bank-account-data/overview)). De documentatie van Actual Budget zegt dat GoCardless sinds juli 2025 geen nieuwe accounts meer aanneemt ([Actual Budget](https://actualbudget.org/docs/advanced/bank-sync/gocardless/)). Dat is tweedehands.
  - **Finanzfluss Copilot:** importeert DEGIRO-rekeningen bij de Duitse vestiging (BIC BIWBDE33XXX) automatisch, maar meldt dat dat voor klanten van de Dutch Branch niet kan ([Finanzfluss](https://www.finanzfluss.de/copilot/hilfe/fehlerhafter-datenabgleich-flatex-degiro/)).
- **Ook als het zou werken:** PSD2 geeft alleen het geldsaldo en de geldbewegingen, geen effecten.

## 4. Aggregators voor effecten

- **SnapTrade** noemt DEGIRO "Read Only" en direct beschikbaar ([Broker Access Guide](https://docs.snaptrade.com/docs/broker-access-guide)).
  - Je tikt je DEGIRO-inloggegevens in het portaal van SnapTrade. Handelen kan niet ([DEGIRO-pagina](https://snaptrade.com/brokerage-integrations/degiro-api)). Hoe SnapTrade de tweestapsverificatie van DEGIRO afhandelt, is niet geverifieerd.
  - Je krijgt posities, saldi en activiteiten; activiteiten worden één keer per dag bijgewerkt ([Account Data](https://docs.snaptrade.com/docs/account-data)).
  - **Personal** is nu gratis voor wie zijn eigen rekeningen koppelt. Je krijgt één client-ID met consumer key en koppelt de broker in het dashboard van SnapTrade ([Personal vs Commercial](https://docs.snaptrade.com/docs/personal-vs-commercial)). Zakelijk: _Build_ gratis tot 5 koppelingen, _Launch_ $100 per maand plus $1–2 per gebruiker ([prijzen](https://snaptrade.com/pricing)).
- **Plaid Investments:** alleen de Verenigde Staten en Canada ([Plaid](https://plaid.com/docs/investments/)).
- **finAPI:** zakelijk, in 13 landen waaronder Nederland. Effectenrekeningen lopen via het Duitse FinTS, met web scraping als terugval; de lijst met banken krijg je alleen op aanvraag ([dekking](https://www.finapi.io/en/products/country-coverage/)). De prijspagina noemt maandlicenties vanaf € 60 en een regeling voor eigen gebruik (maximaal 10 eigen rekeningen) waarvan de prijs niet eenduidig is ([prijzen](https://www.finapi.io/en/prices/)). DEGIRO Nederland: niet gevonden.
- **wealthAPI:** zakelijk, BaFin-vergunning als rekeninginformatiedienst. De homepage noemt DEGIRO niet ([wealthAPI](https://wealthapi.eu/en/)).
- **Tink:** heeft een product voor beleggingen, maar noemt Nederland en DEGIRO niet ([Tink Investments](https://tink.com/products/investments)).
- **Yodlee en Salt Edge:** geen DEGIRO gevonden. Niet geverifieerd.
- **Powens:** staat bij Open Banking Tracker als aggregator voor DEGIRO B.V. ([tracker](https://openbankingtracker.com/powens/degiro-bv)). Dat is tweedehands; op de eigen pagina's van Powens niet bevestigd.

**Voor Box3balans:** alleen SnapTrade Personal past technisch: een token, alleen lezen, gratis. Maar je DEGIRO-wachtwoord ligt dan bij een externe partij, wat art. 7.2.1 uitdrukkelijk verbiedt. En je portefeuille gaat door de cloud, terwijl de ROADMAP zegt dat het juist om gegevens thuis gaat.

## 5. Hoe andere trackers het doen

- **Portfolio Performance:** PDF-import van het rekeningoverzicht, het transactieoverzicht en dividendnota's ([DegiroPDFExtractor.java](https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/DegiroPDFExtractor.java)). Geen API.
- **Parqet:** PDF-import van Transactions.pdf en Account.pdf ([blog, bijgewerkt 14 december 2023](https://parqet.com/en/blog/degiro)). Autosync noemt DEGIRO niet ([Autosync, augustus 2024](https://parqet.com/en/blog/autosync)).
- **getquin:** "automatische koppeling via Open Banking", waarvoor je je inloggegevens invoert ([help](https://help.getquin.com/en/articles/9711631-degiro)). Via welke partner is niet vermeld.
- **Snowball Analytics:** CSV-import van de Transacties ([help](https://help.snowball-analytics.com/import-degiro/)). Een automatische DEGIRO-koppeling is niet geverifieerd.
- **Sharesight:** CSV-import van de Transacties, en het doorsturen van de bevestigingsmails van transacties ([Sharesight](https://www.sharesight.com/eu/partners/degiro)).
- **Ghostfolio:** geen DEGIRO-code in de broncode, alleen een eigen CSV/JSON-import ([import-activities.service.ts](https://github.com/ghostfolio/ghostfolio/blob/main/apps/client/src/app/services/import-activities.service.ts)). Het communityproject Export-To-Ghostfolio zet het rekeningoverzicht van DEGIRO om ([README](https://github.com/dickwolff/Export-To-Ghostfolio)).
- **Delta:** de helppagina gaf een 403. Volgens het fragment in de zoekmachine vraagt Delta gebruikersnaam, wachtwoord en de 5-cijferige pincode van de app ([Delta](https://support.delta.app/en/articles/10471165-connecting-degiro-broker)). Tweedehands.
- **Kubera:** niets gevonden.

**Patroon:** de trackers die op betrouwbaarheid letten, werken met bestanden. Een "koppeling" loopt altijd via je inloggegevens.

## 6. Exports: wat DEGIRO biedt en wat Box3balans ermee doet

Volgens het helpcentrum ([rapportages](https://www.degiro.nl/helpdesk/belasting/welke-rapportagemogelijkheden-zijn-er-en-waar-kan-ik-de-rapportages-vinden)):

- **Portefeuille:** je open posities op een datum die je kiest, tegen de laatste slotkoers. Als CSV, XLS of PDF. **Een historische datum kan**, dus ook 31 december.
- **Transacties:** aankopen en verkopen over een periode die je kiest (standaard een maand). Als CSV, Excel of PDF.
- **Rekeningoverzicht:** alle bewegingen, ook dividend en dividendbelasting. Zelfde periodes en formaten.
- **Jaaropgaven:** de fiscale jaaropgave en een kosten- en lastenoverzicht, als PDF onder _Inbox → Documenten_. DEGIRO streeft ernaar ze vóór de aangifteperiode klaar te hebben ([jaaropgave](https://www.degiro.nl/helpdesk/belasting/waar-kan-ik-de-jaaropgave-vinden)). Volgens art. 8.4 komen overzichten alleen elektronisch, via het platform en/of e-mail. Wat er precies in staat (zoals de waarde op 1 januari), zegt het helpcentrum niet.
- **Geldrekening:** elk kwartaal een PDF.

**Per e-mail** komt alleen een bevestiging per uitgevoerde order. Die zet je aan of uit onder _Instellingen → Notificaties → Terugmelden orderstatus_ ([helpcentrum](https://www.degiro.nl/helpdesk/orders/ontvang-ik-een-bevestiging-als-mijn-order-uitgevoerd)). Het formaat staat er niet bij. Een export die DEGIRO automatisch mailt, heb ik niet gevonden.

Een gebruiker meldde in 2024 dat het rekeningoverzicht hoogstens drie maanden tegelijk exporteerde ([#147](https://github.com/Chavithra/degiro-connector/issues/147)). Dat is niet geverifieerd.

**Wat de importer nu doet** (`server/src/import/formats/degiro.ts`):

- **Rekeningoverzicht:** aankopen en verkopen met kosten (op de eerste uitvoering van een order), en dividend met dividendbelasting. Hij slaat over:
  - stortingen, valutawissel en rente;
  - aansluitingskosten;
  - "overige regels" zoals corporate actions en productwijzigingen. Splitsingen, ISIN-wijzigingen en fusies ontbreken daardoor.
  - Kosten in een andere valuta telt hij als euro.
- **Transacties:** alleen aankopen en verkopen.
- **Geen Portfolio.csv.** Er is dus geen stand op de peildatum, geen controle of de transacties optellen tot wat DEGIRO zegt, en geen beginstand als de historie niet compleet is.
- **Het geld op de geldrekening volgt hij niet**, terwijl dat voor box 3 een banktegoed is.
- **Nog niet getest met echte exports** ([#6](https://github.com/zenonymous/box3balans/issues/6)).

Voorbeeldbestanden in open-sourceprojecten tonen voor Portfolio.csv de kolommen _Product, Symbool/ISIN, Aantal, Slotkoers, Lokale waarde, (valuta), Waarde in EUR_, met een regel "CASH & CASH FUND & FTX CASH (EUR)" ([voorbeeld](https://github.com/ArthurHNL/stock-buy-script/blob/main/Portfolio_dummy.csv)). Dat is tweedehands: haal een echt bestand op voordat je erop bouwt.

## 7. Advies voor Box3balans

| Optie                        | Rechten                             | Risico voorwaarden                          | Kwetsbaarheid | Werk                            |
| ---------------------------- | ----------------------------------- | ------------------------------------------- | ------------- | ------------------------------- |
| 1. Betere import van exports | geen                                | geen                                        | laag          | klein tot middel                |
| 2. Webtrader-API, op verzoek | volledig handelen tijdens de sessie | art. 5.6 (scripts), blokkade mogelijk       | hoog          | middel, plus blijvend onderhoud |
| 3. SnapTrade Personal        | alleen lezen, wachtwoord bij derde  | art. 7.2.1 (derden), uitdrukkelijk verboden | middel        | middel                          |
| 4. PSD2 of bevestigingsmails | alleen lezen                        | laag                                        | middel        | middel, en levert weinig op     |

**1. Exports beter gebruiken (aanbevolen).**

- **Portfolio.csv inlezen als stand op een datum.** Posities per ISIN op 31 december, vergeleken met de som van de geïmporteerde transacties. Verschillen komen in de aandachtslijst, met het aanbod om een beginstand of correctie te boeken. De CASH-regel kan het banktegoed bij DEGIRO op die datum vullen.
- **Corporate actions in het rekeningoverzicht** minstens herkennen en duidelijk melden.
- **Een januari-routine in de app:** "exporteer _Portefeuille_ op 31-12 en het _Rekeningoverzicht_ van het jaar".
- **Afweging:** geen wachtwoord, geen risico met de voorwaarden. Testen met vaste bestanden, zonder netwerk, zoals nu.

**2. Webtrader-API, alleen als experiment en alleen op verzoek.**

- **Zo zou het werken:** je tikt het wachtwoord per keer in, keurt de inlog goed in de app, en Box3balans haalt `positionReport` (31-12 en vandaag) en `cashAccountReport` als CSV op. Die gaan door de bestaande parsers. Daarna uitloggen, niets bewaren.
- **Bezwaren:**
  - Tijdens de sessie heeft de app volledige handelsrechten, en het wachtwoord gaat door de server.
  - Het valt onder het verbod op scripts (art. 5.6), met risico op een blokkade.
  - Het brak minstens zes keer in vier jaar: firewall, captcha, verhuisde endpoints.
  - Het is niet te testen tegen DEGIRO zelf.
  - Het scheelt twee downloads per jaar.
- **Nooit:** wachtwoord plus TOTP-geheim opslaan voor een onbewaakte sync. Dan ligt volledige toegang in de app en is de tweestapsverificatie omzeild.

**3. SnapTrade Personal (niet aanbevolen).** Technisch lijkt het op de IBKR-koppeling: een sleutel, alleen lezen, gratis. Maar je DEGIRO-wachtwoord ligt bij een externe partij, je gegevens gaan door de cloud, en hoe SnapTrade de tweestapsverificatie van DEGIRO afhandelt, is onbekend.

**4. PSD2 of bevestigingsmails (niet doen).** PSD2 geeft hooguit het geld en lijkt hier niet te bestaan. De mails dekken alleen transacties, in een onbekend formaat.

**Voorstel voor de ROADMAP**, onder _Bewust niet_: "Inloggen bij brokers zonder officiële API, zoals DEGIRO."

## Niet geverifieerd

- Of de PSD2-interface van flatexDEGIRO DEGIRO-geldrekeningen van Nederlandse klanten bevat, en of een aggregator ze aanbiedt.
- Hoe lang een DEGIRO-sessie leeft, en of een server bij elke login als nieuw apparaat geldt.
- Of `positionReport` en `cashAccountReport` precies Portfolio.csv en Account.csv opleveren.
- De inhoud van de fiscale jaaropgave.
- Hoe SnapTrade, getquin en Delta de tweestapsverificatie afhandelen, en welke partner getquin gebruikt.
- DEGIRO-ondersteuning bij Yodlee, Salt Edge, Powens en Kubera.
- Dat GoCardless geen nieuwe accounts meer aanneemt (alleen tweedehands).

## Bronnen

DEGIRO en flatexDEGIRO:

- Cliënt Overeenkomst / Voorwaarden Beleggingsdiensten (art. 3.2, 5.5, 5.6, 7.2, 7.5, 8.1, 8.4, 10.3): https://www.degiro.nl/data/pdf/Voorwaarden_Beleggingsdiensten.pdf
- Helpcentrum: https://www.degiro.nl/helpdesk/
- Rapportages: https://www.degiro.nl/helpdesk/belasting/welke-rapportagemogelijkheden-zijn-er-en-waar-kan-ik-de-rapportages-vinden
- Jaaropgave: https://www.degiro.nl/helpdesk/belasting/waar-kan-ik-de-jaaropgave-vinden
- Orderbevestiging per e-mail: https://www.degiro.nl/helpdesk/orders/ontvang-ik-een-bevestiging-als-mijn-order-uitgevoerd
- Inloggen en tweestapsverificatie: https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/ik-heb-hulp-nodig-om-te-loggen-op-mijn-account en https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/toegang-tot-uw-degiro-account/wat-twee-stapsverificatie
- Volmacht: https://www.degiro.nl/helpdesk/account-en-persoonlijke-gegevens/kan-ik-een-volmacht-geven-voor-mijn-account
- flatexDEGIRO investor relations: https://www.flatexdegiro.com/investor-relations
- XS2A-specificatie: https://s206.q4cdn.com/770226284/files/doc_downloads/2026/05/Characteristic-XS2A-interface-of-the-FTX-Bank.pdf
- FAQ flatexDEGIRO Bank: https://flatexdegiro.com/English/bank-se/bank-se-faqs

Bibliotheken (broncode, issues, releases):

- degiro-connector: https://github.com/Chavithra/degiro-connector (PyPI: https://pypi.org/project/degiro-connector/)
- degiroasync: https://github.com/OhMajesticLama/degiroasync
- degiro-api (TypeScript): https://github.com/icastillejogomez/degiro-api (npm: https://www.npmjs.com/package/degiro-api)
- DegiroAPI / `degiroapi`: https://github.com/lolokraus/DegiroAPI

Recht:

- Hof van Justitie, C-191/17: https://eur-lex.europa.eu/legal-content/NL/TXT/?uri=CELEX:62017CJ0191
- PSD2 (Richtlijn 2015/2366): https://eur-lex.europa.eu/eli/dir/2015/2366/oj

Aggregators:

- SnapTrade: https://snaptrade.com/brokerage-integrations/degiro-api, https://docs.snaptrade.com/docs/broker-access-guide, https://docs.snaptrade.com/docs/account-data, https://docs.snaptrade.com/docs/personal-vs-commercial, https://snaptrade.com/pricing
- Plaid: https://plaid.com/docs/investments/
- finAPI: https://www.finapi.io/en/products/country-coverage/, https://www.finapi.io/en/prices/
- wealthAPI: https://wealthapi.eu/en/
- Tink: https://tink.com/products/investments
- Enable Banking: https://enablebanking.com/docs/markets/nl/, https://enablebanking.com/docs/markets/de/, https://enablebanking.com/docs/api/control-panel/, https://enablebanking.com/docs/faq/
- GoCardless: https://docs.gocardless.com/bank-account-data/overview
- Actual Budget over GoCardless (tweedehands): https://actualbudget.org/docs/advanced/bank-sync/gocardless/
- Open Banking Tracker over Powens (tweedehands): https://openbankingtracker.com/powens/degiro-bv

Trackers:

- Portfolio Performance: https://github.com/portfolio-performance/portfolio/blob/master/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/pdf/DegiroPDFExtractor.java
- Parqet: https://parqet.com/en/blog/degiro, https://parqet.com/en/blog/autosync
- getquin: https://help.getquin.com/en/articles/9711631-degiro
- Snowball Analytics: https://help.snowball-analytics.com/import-degiro/
- Sharesight: https://www.sharesight.com/eu/partners/degiro
- Ghostfolio: https://github.com/ghostfolio/ghostfolio
- Export-To-Ghostfolio: https://github.com/dickwolff/Export-To-Ghostfolio
- Delta (niet te openen, 403): https://support.delta.app/en/articles/10471165-connecting-degiro-broker
- Finanzfluss Copilot: https://www.finanzfluss.de/copilot/hilfe/fehlerhafter-datenabgleich-flatex-degiro/
