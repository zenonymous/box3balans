# Roadmap

Kluishuis begon als persoonlijk project en wordt nu geschikt gemaakt voor iedereen in Nederland die zijn beleggingen en box 3 zelf wil bijhouden, op eigen hardware. Kluishuis wordt niet ergens voor je gehost: je draait het zelf.

Heb je een idee of wil je meehelpen? Zie [CONTRIBUTING.md](../CONTRIBUTING.md).

## Klaar

- **Basis:** handmatige invoer, live koersen, overzicht en posities, fysiek en bewaard edelmetaal, koersgeschiedenis, resultaten, inkomsten en dividenden, box 3 met export, back-ups.
- **Koppelingen** met Bitvavo, Kraken, Coinbase en Interactive Brokers, met staking op die beurzen. Nog niet getest met echte accounts.
- **Wallets:** Bitcoin (ook xpub), Ethereum en L2's, BNB Chain, Solana, Cardano, Dogecoin, Litecoin, XRP en Tron. Bitcoin, Cardano, Dogecoin, Unichain, Ink en Soneium zijn getest met echte adressen.
- **CSV-import** met kolomindeling, voorbeeld, dubbelherkenning en ongedaan maken. Ingebouwde formaten voor specifieke brokers volgen in fase D.
- **Rendement:** tijd- en geldgewogen rendement met een benchmark, een kostenoverzicht en verwachte dividenden.
- **Box 3:** werkelijk rendement voor de tegenbewijsregeling en een vooruitblik op het stelsel vanaf 2028.
- **Beheer:** versleutelde back-ups, wijzigingsgeschiedenis met terugzetten, _Needs attention_, tweede koersbronnen, PostgreSQL 18 met een geteste upgrade.

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

## Fase C: Nederlands

- De app in het Nederlands (Engels blijft beschikbaar), met de termen uit de aangifte.
- Een startwizard: huishouden → rekeningen → snelle waarden of import → je box 3.
- Een demomodus met een voorbeeldhuishouden.

## Fase D: de aangifte invullen

- Ingebouwde formaten voor veelgebruikte brokers en banken: DEGIRO, Trade Republic, ABN AMRO, ING, Rabobank, Saxo, Bux, Meesman, Brand New Day, Peaks, Lightyear, Scalable Capital, en CSV-exports van Bitvavo, Kraken en Coinbase. Daarvoor zijn [geanonimiseerde voorbeeldbestanden](https://github.com/OWNER/kluishuis/issues/new/choose) nodig.
- Een overzicht per jaar in de volgorde van de aangifte en de _Opgaaf werkelijk rendement_: per bankrekening, per beleggingsrekening, crypto en schulden, met wat je waar invult.
- Tests met de rekenvoorbeelden van de Belastingdienst.

## Fase E: onderhoud en extra veiligheid

- Inloggen met een tweede factor (TOTP).
- Een melding als er een nieuwe versie is (alleen als je dat aanzet: het vraagt GitHub om informatie).
- Belastingregels als gegevensbestand, met de datum van de laatste controle in de app, en een vaste jaarlijkse update: voorstellen rond Prinsjesdag, definitieve cijfers in december.

## Oorspronkelijke opzet

Het project begon met acht mijlpalen (zie [PROMPT.md](PROMPT.md)). Alleen mijlpaal 3, ingebouwde formaten voor specifieke brokers, is nog open en zit nu in fase D.
