# Roadmap

Box3balans begon als persoonlijk project en wordt nu geschikt gemaakt voor iedereen in Nederland die zijn beleggingen en box 3 zelf wil bijhouden, op eigen hardware. Box3balans wordt niet ergens voor je gehost: je draait het zelf.

Heb je een idee of wil je meehelpen? Zie [CONTRIBUTING.md](../CONTRIBUTING.md).

## Klaar

- **Basis:** handmatige invoer, live koersen, overzicht en posities, fysiek en bewaard edelmetaal, koersgeschiedenis, resultaten, inkomsten en dividenden, box 3 met export, back-ups.
- **Koppelingen** met Bitvavo, Kraken, Coinbase en Interactive Brokers, met staking op die beurzen. Nog niet getest met echte accounts.
- **Wallets:** Bitcoin (ook xpub), Ethereum en L2's, BNB Chain, Solana, Cardano, Dogecoin, Litecoin, XRP en Tron. Bitcoin, Cardano, Dogecoin, Unichain, Ink en Soneium zijn getest met echte adressen.
- **CSV-import** met kolomindeling, voorbeeld, dubbelherkenning en ongedaan maken. Ingebouwde formaten voor specifieke brokers volgen in fase D.
- **Rendement:** tijd- en geldgewogen rendement met een benchmark, een kostenoverzicht en verwachte dividenden.
- **Box 3:** werkelijk rendement voor de tegenbewijsregeling en een vooruitblik op het stelsel vanaf 2028.
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
- **Nog open:** formaten voor ABN AMRO en ING Beleggen, Meesman, Brand New Day, Peaks, Lightyear en Scalable Capital. Daarvoor zijn [geanonimiseerde voorbeeldbestanden](https://github.com/zenonymous/box3balans/issues/new/choose) nodig.

## Fase E: onderhoud en extra veiligheid ✅

- **Tweestapsverificatie** met een authenticator-app (TOTP), met herstelcodes en een opdracht om het uit te zetten als je buitengesloten bent.
- **Melding bij een nieuwe versie**, alleen als je dat aanzet: Box3balans vraagt GitHub dan één keer per dag naar de nieuwste versie.
- **Belastingregels als gegevensbestand** (`server/src/rules/box3.json`) met de datum van de laatste controle en de bron per jaar in de app, een melding als ze meer dan 400 dagen oud zijn, en een vast jaarritme in [belastingregels.md](belastingregels.md): voorstellen rond Prinsjesdag, vaste cijfers in december, definitieve percentages na afloop van het jaar.

## Oorspronkelijke opzet

Het project begon als persoonlijk dashboard voor beleggingen, crypto en edelmetaal, gebouwd in acht mijlpalen. Die zijn allemaal af; de laatste, ingebouwde formaten voor specifieke brokers, kwam in fase D.
