# Roadmap

Box3balans begon als persoonlijk project en wordt nu geschikt gemaakt voor iedereen in Nederland die zijn beleggingen en box 3 zelf wil bijhouden, op eigen hardware. Box3balans wordt niet ergens voor je gehost: je draait het zelf.

Heb je een idee of wil je meehelpen? Zie [CONTRIBUTING.md](../CONTRIBUTING.md).

## Klaar

- **Basis:** handmatige invoer, live koersen, overzicht en posities, fysiek en bewaard edelmetaal, koersgeschiedenis, resultaten, inkomsten en dividenden, box 3 met export, back-ups.
- **Koppelingen** met Bitvavo, Kraken, Coinbase en Interactive Brokers, met staking op die beurzen. Bitvavo en Coinbase zijn getest met echte accounts, Kraken en Interactive Brokers nog niet (fase F).
- **Wallets:** Bitcoin (ook xpub), Ethereum en L2's, BNB Chain, Solana, Cardano, Dogecoin, Litecoin, XRP en Tron. Bitcoin, Cardano, Dogecoin, Unichain, Ink en Soneium zijn getest met echte adressen.
- **CSV-import** met kolomindeling, voorbeeld, dubbelherkenning en ongedaan maken. Ingebouwde formaten voor specifieke brokers kwamen in fase D, meer in fase F en G.
- **Jaaroverzichten als pdf** (0.1.18): bij _Waarden per jaar_ leest Box3balans een jaaroverzicht in de browser en biedt de bedragen naast een peildatum aan; met een sjabloon per aanbieder staan de juiste meteen aangevinkt ([ADR 0009](adr/0009-pdf-lezen-in-de-browser.md)). Het rekeningoverzicht van Goldrepublic (0.1.27) wordt ook herkend, en bij _CSV importeren_ als transacties gelezen.
- **Koersen voor crypto:** Bitvavo als koersbron; koersgeschiedenis voor munten die een beurs niet meer verhandelt en voor ingeruilde munten (NU → T, FTM → S, MATIC → POL en andere), van Yahoo of Binance, maar alleen als vaststaat dat het dezelfde munt is; omwisselingen door Bitvavo als verkoop en aankoop. Uitgebracht in 0.1.4 tot en met 0.1.7, na het testen met echte accounts.
- **Rendement:** tijd- en geldgewogen rendement met een benchmark, een kostenoverzicht en verwachte dividenden.
- **Box 3:** werkelijk rendement voor de tegenbewijsregeling en een vooruitblik op het stelsel vanaf 2028.
- **Online demo** (0.1.26): op [box3balans.nl/demo](https://box3balans.nl/demo/) rondkijken in het voorbeeldhuishouden, zonder te installeren; opgenomen uit de echte demo bij elke release ([ADR 0010](adr/0010-online-demo-zonder-server.md)).
- **Aantoonbare privacy** (0.1.30): Box3balans maakt alleen verbinding met een vaste lijst van adressen, afgedwongen in de code en zichtbaar onder _Instellingen → Netwerk_; optioneel afgeschermd met een proxy op netwerkniveau. Een nieuwe installatie neemt de eerste gebruiker alleen aan met een setupcode uit het log ([ADR 0011](adr/0011-vaste-lijst-van-bestemmingen.md), [wat Box3balans verstuurt](privacy.md)).
- **Beheer:** versleutelde back-ups, wijzigingsgeschiedenis met terugzetten, _Aandacht nodig_, tweede koersbronnen, PostgreSQL 18 met een geteste upgrade.

## Fase A: installeerbaar voor iedereen ✅

- Licentie (AGPL-3.0), bijdrage- en beveiligingsrichtlijnen, issue-formulieren.
- Kant-en-klare images voor Intel/AMD en ARM via GitHub, met automatische tests.
- Starten zonder instellingen: sleutel en databasewachtwoord worden bij de eerste start aangemaakt.
- Een variant met één container voor laptops en om uit te proberen.
- Installatiehandleidingen per systeem, en de README in het Nederlands.

## Fase B: box 3 voor iedereen, niet alleen beleggers ✅

- **Huishouden:** jij, een fiscale partner en minderjarige kinderen (hun bezit telt voor de ouders met gezag). Per rekening een eigenaar: jij, je partner, samen (met jouw aandeel) of een kind. De verdeling van de grondslag tussen partners, met per persoon het bezit, de grondslag en de belasting.
- **Waarden per jaar:** per rekening alleen de waarde op 1 januari, geld erin en eruit, inkomsten en kosten. Genoeg voor de forfaitaire berekening, de vergelijking met het werkelijk rendement en de vooruitblik op 2028, zonder elke transactie te importeren.
- **Spaargeld:** saldi op 1 januari, rente en geld erin en eruit, ingelezen uit de export van je bank (CSV met saldo, het TAB-bestand van ABN AMRO, CAMT.053, of CSV zonder saldo met één bekend saldo).
- **Overige bezittingen en schulden:** een tweede of verhuurde woning (WOZ-waarde, met de leegwaarderatio bij verhuur), uitgeleend geld, kapitaalverzekeringen, schulden met betaalde rente, en een vinkje voor rekeningen in het buitenland.

## Fase C: Nederlands ✅

- De app in het Nederlands, met de termen uit de aangifte, ook de meldingen van de server en de foutmeldingen bij invoer. Engels kan via _Instellingen → Weergave → Taal_.
- Een startwizard (_Aan de slag_): huishouden en fiscaal partnerschap → rekeningen → waarden op 1 januari, of de weg naar import en koppelingen → je box 3.
- Een demomodus (`DEMO=true`): een voorbeeldhuishouden met verzonnen koersen, meteen ingelogd, zonder iets te bewaren.

## Fase D: de aangifte invullen ✅

- **Herkende exports** van DEGIRO (rekeningoverzicht en transacties), Bitvavo, Coinbase, Kraken (ledgers), Rabobank Beleggen, Trade Republic, Trading 212, BUX, Saxo en Revolut. Gebouwd op openbare voorbeeldbestanden, nog niet getest met echte exports. Banken (ING, Rabobank, ABN AMRO …) lees je in via _Waarden per jaar_ met hun eigen export.
- **Voor de aangifte:** per jaar box 3 in de volgorde van de aangifte, per rekening en eigenaar, met dividendbelasting en het werkelijk rendement (vanaf 2025 in de aangifte zelf, daarvoor met de _Opgaaf werkelijk rendement_).
- **Rekenvoorbeelden van de Belastingdienst** als tests: de vijf forfaitaire voorbeelden voor 2025 komen precies uit (met dezelfde afronding), en drie voorbeelden van het werkelijk rendement.
- **Daarna:** meer aanbieders in fase F en G; wat er per aanbieder nog nodig is, staat in [aanbieders.md](aanbieders.md).

## Fase E: onderhoud en extra veiligheid ✅

- **Tweestapsverificatie** met een authenticator-app (TOTP), met herstelcodes en een opdracht om het uit te zetten als je buitengesloten bent.
- **Melding bij een nieuwe versie**, alleen als je dat aanzet: Box3balans vraagt GitHub dan één keer per dag naar de nieuwste versie.
- **Belastingregels als gegevensbestand** (`server/src/rules/box3.json`) met de datum van de laatste controle en de bron per jaar in de app, een melding als ze meer dan 400 dagen oud zijn, en een vast jaarritme in [belastingregels.md](belastingregels.md): voorstellen rond Prinsjesdag, vaste cijfers in december, definitieve percentages na afloop van het jaar.

## Fase F: klaar voor 1 januari 2027 (nu – december 2026)

De werkzaamheden staan als issues in de mijlpaal [Fase F](https://github.com/zenonymous/box3balans/milestone/1).

- **Box 3-regels voor 2027:** de voorstellen uit het Belastingplan 2027 en de kabinetsbrief van 29 september staan in [box3-sources.md](box3-sources.md); ze staan sinds 0.1.11 als voorlopig jaar in de app, en worden gecontroleerd zodra het Belastingplan in december is aangenomen ([#4](https://github.com/zenonymous/box3balans/issues/4)).
- **Testen met echte gegevens:** de koppelingen met echte sleutels met alleen leesrechten ([#5](https://github.com/zenonymous/box3balans/issues/5)). Bitvavo en Coinbase zijn getest en wat dat opleverde, is opgelost in 0.1.4 tot en met 0.1.7 (zie de [stand van zaken](https://github.com/zenonymous/box3balans/issues/5#issuecomment-6078821954)); Kraken en Interactive Brokers wachten op iemand met een account. Behalve het rekeningoverzicht en de portefeuille van DEGIRO wachten de herkende exports nog op echte, geanonimiseerde bestanden ([#6](https://github.com/zenonymous/box3balans/issues/6)), en de pdf-jaaroverzichten op tekstvoorbeelden ([#14](https://github.com/zenonymous/box3balans/issues/14)). Een verkeerd gelezen bedrag is nu het grootste risico.
- **DEGIRO beter inlezen** ✅: DEGIRO heeft geen API, maar de export _Portefeuille_ kan op elke datum. Ingelezen op 31 december controleert hij de geïmporteerde transacties en telt het geld bij DEGIRO mee voor box 3. Het rekeningoverzicht leest nu ook transactiebelasting, corporate actions en rente, getest met een echte export. Zie het [onderzoek](degiro-koppeling.md).
- **Klaar voor de peildatum** ✅ (0.1.17): op _Box 3_ per jaar wat er voor 1 januari nog nodig is, per rekening (een waarde, een synchronisatie, een import, de portefeuille van DEGIRO), plus beleggingen zonder koers en crypto die van een beurs is gehaald maar nergens is aangekomen. Van half december tot eind mei ook onder _Aandacht nodig_.
- **Meer aanbieders** ✅: ongeveer 55 Nederlandse aanbieders van box 3-bezit [onderzocht](aanbieders.md), elk als issue met het label [aanbieder](https://github.com/zenonymous/box3balans/issues?q=is%3Aissue+label%3Aaanbieder) en een prioriteit. Gebouwd: het rekeningafschrift van Revolut en Wise in de bankimport, met omrekening van andere valuta tegen de ECB-koers (0.1.18), de jaaroverzichten als pdf (0.1.18), de Crypto.com App (0.1.19), eToro (0.1.20), het crypto-overzicht van Revolut en de exports van CoinTracking en Delta, om vanuit een andere tracker over te stappen (0.1.21). Voor LYNX en Interactive Brokers geldt dezelfde koppeling; Brand New Day en crowdfunding houd je bij met _Waarden per jaar_ en hun jaaroverzicht.
- **Vindbaar worden:** screenshots in de README ✅ ([#7](https://github.com/zenonymous/box3balans/issues/7)) en een plek voor vragen in [Discussions](https://github.com/zenonymous/box3balans/discussions) ✅ ([#9](https://github.com/zenonymous/box3balans/issues/9)). Nog open: box3balans.nl als Nederlandstalige landingspagina ([#8](https://github.com/zenonymous/box3balans/issues/8)), en daarna een aankondiging in Nederlandse communities zoals Tweakers, het IEX-forum en r/DutchFIRE ([#10](https://github.com/zenonymous/box3balans/issues/10)), in de eerste helft van januari.

## Fase G: het aangifteseizoen (januari – mei 2027)

- **Definitieve percentages 2026** voor spaargeld en schulden, in een uitgave vóór de aangifte op 1 maart opengaat.
- **Ontbrekende formaten:** [onderzocht](exportformaten.md) in oktober 2026. Lightyear en Scalable Capital worden herkend sinds 0.1.17, gebouwd op openbare beschrijvingen. ING Zelf op de Beurs en Meesman hebben een export, maar de kolommen staan nergens beschreven: daarvoor is een voorbeeldbestand nodig. ABN AMRO heeft geen export van effectentransacties; daar gebruik je _Waarden per jaar_ met het jaaroverzicht. Welke bankexports de import leest, staat sinds 0.1.10 per bank in de README; MT940 kwam erbij voor Knab, dat standaard MT940 geeft. Testen met echte exports van ASN Bank, Triodos, Knab, bunq, Revolut en Wise volgt zodra iemand er een deelt.
- **Sjablonen voor jaaroverzichten:** per aanbieder (Brand New Day, Peaks, BLOX, Geldvoorelkaar, Mintos …) een sjabloon, zodra iemand de tekst van een overzicht deelt via [het formulier](https://github.com/zenonymous/box3balans/issues/new?template=jaaroverzicht.yml).
- **Meer aanbieders:** gebouwd in oktober 2026, op openbare beschrijvingen en nog niet getest met echte gegevens: XTB, Schwab Equity Awards (aandelenplannen van werkgevers), Bitstamp en een koppeling met de nieuwe API van Bitpanda (de oude stopt op 31 januari 2027). Daarna: Morgan Stanley at Work en Finst, zodra iemand een voorbeeld deelt; zie de issues met [prioriteit 1](https://github.com/zenonymous/box3balans/issues?q=is%3Aissue+is%3Aopen+label%3A%22prioriteit+1%22).
- **Een dossier per jaar** ✅ (al in 0.1.9): één afdrukbaar document met het box 3-overzicht, het werkelijk rendement, de waarden op 1 januari en waar elk bedrag vandaan komt. Voor je eigen administratie, en voor als de Belastingdienst vragen stelt.
- **De Wet werkelijk rendement volgen:** de Eerste Kamer behandelt het wetsvoorstel en de novelle naar verwachting vanaf januari. De vooruitblik in de app volgt sinds 0.1.3 de kabinetsbrief van 29 september (heffingsvrij resultaat € 1.000); belasting bij verkoop voor aandelen, obligaties en opties komt erin zodra de tekst van de novelle er is, na het advies van de Raad van State ([#11](https://github.com/zenonymous/box3balans/issues/11)).

## Fase H: het nieuwe stelsel vanaf 2028 (vanaf medio 2027, als de wet er komt)

- **De volledige berekening, niet alleen een vooruitblik:** per bezitting het rendement van het jaar (gerealiseerd en ongerealiseerd), belasting bij verkoop voor onroerend goed en aandelen in startende ondernemingen (met de regels voor wat je al vóór 2028 had), aftrekbare kosten, het heffingsvrije resultaat, verliesverrekening over de jaren heen en de verdeling tussen partners.
- **Beginwaarden op 1 januari 2028:** het ongerealiseerde rendement over 2028 wordt vanaf die waarden gemeten. Een checklist zorgt dat elke bezitting vóór die datum een betrouwbare waarde op 31 december 2027 heeft.
- **De aangifte over 2028** (in 2029) in de volgorde van het nieuwe formulier, zodra de Belastingdienst dat publiceert.
- **Het oude stelsel blijft** voor 2027 en eerder, voor correcties en bezwaar. Komt de wet er niet, dan gaat het jaarritme van de forfaitaire regels gewoon door.

## Doorlopend

- **Eenvoudiger installeren:** Box3balans in de app-catalogi van Unraid, TrueNAS en CasaOS/Umbrel, zodat het zonder terminal kan. Een sjabloon voor Unraid (Community Applications) en een bestand voor CasaOS en ZimaOS (_Custom Install → Import_) staan klaar in [`deploy/`](../deploy); TrueNAS werkt al via _Install via YAML_. Nog te doen: Box3balans aanmelden bij Community Applications, en een app voor Umbrel.
- **Controleerbare images** ✅: ondertekend met cosign, met een lijst van wat erin zit (SBOM) en hoe het is gebouwd (provenance). Zie [SECURITY.md](../SECURITY.md#images-controleren).
- **Pull requests via CI** op `main` zodra anderen meebouwen.
- **Versie 1.0** na het eerste aangifteseizoen met echte gebruikers: formaten getest met echte exports en geen bekende ernstige fouten.

## Bewust niet

- **Box3balans voor anderen hosten.** Dat je gegevens thuis blijven, is juist het punt.
- **Box 1 en box 2**, zoals de eigen woning of een aanmerkelijk belang.
- **Beleggingsadvies**, zoals herbalanceren.
- **Inloggen bij brokers zonder officiële API**, zoals DEGIRO. Dat vraagt je wachtwoord, met volledige handelsrechten, en hun voorwaarden staan het niet toe. Box3balans leest hun exports ([onderzoek](degiro-koppeling.md)).

## Oorspronkelijke opzet

Het project begon als persoonlijk dashboard voor beleggingen, crypto en edelmetaal, gebouwd in acht mijlpalen. Die zijn allemaal af; de laatste, ingebouwde formaten voor specifieke brokers, kwam in fase D.
