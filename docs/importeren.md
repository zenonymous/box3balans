# Gegevens binnenhalen

Hoe je je bezit in Box3balans krijgt: waarden per jaar en bankexports, jaaroverzichten als pdf, CSV-exports van brokers en beurzen, koppelingen en wallets. Een kort overzicht staat in de [README](../README.md#gebruiken); wat we per aanbieder weten, in [aanbieders.md](aanbieders.md).

## Waarden per jaar en bankexports

Voor een rekening met **waarden per jaar** (_Rekeningen → Waarden per jaar_) vul je per jaar in:

- **de waarde op 1 januari**: van het jaaroverzicht van je bank of broker, of het saldo aan het eind van 31 december. De waarde op 31 december is de waarde op 1 januari van het jaar erna, dus die vul je niet apart in;
- **geld erin en eruit** in dat jaar (stortingen en opnames);
- **inkomsten**: rente of dividend dat op de rekening binnenkwam, huur van een verhuurde woning, rente op uitgeleend geld; bij een schuld de **betaalde rente**;
- **kosten** (alleen voor de vooruitblik op 2028, waar ze aftrekbaar zijn).

Bij een **woning** vul je de WOZ-waarde in die voor dat jaar geldt (die met waardepeildatum 1 januari van het jaar ervoor). Verhuur je hem met huurbescherming, vink dan _Verhuurd_ aan en vul de jaarhuur in: hij telt dan voor een deel van de WOZ-waarde (de leegwaarderatio, 73% tot 100%, afhankelijk van de huur als percentage van de WOZ-waarde). Je eigen woning hoort niet in box 3 (dat is box 1).

**Aanbieders zonder bruikbare export** houd je zo bij:

- **Brand New Day:** per beleggingsrekening een rekening _Broker_ met waarden per jaar (overige bezittingen), en per spaarrekening een _Bankrekening_. De waarde op 1 januari is de beginwaarde uit het _financieel jaaroverzicht_ (in februari, onder _Mijn documenten → Overzichten → Jaaroverzichten_); de inkomsten zijn het uitgekeerde dividend uit datzelfde overzicht; geld erin en eruit is de inleg en de onttrekkingen uit de vier kwartaaloverzichten. Pensioen- en lijfrenterekeningen horen niet in box 3; voor de hypotheekrekening en de gouden-handdrukrekening gelden eigen regels.
- **Crowdfunding** (Geldvoorelkaar, Collin Crowdfund, Lendahand, Mogelijk, Kapitaal Op Maat, Invesdor, DuurzaamInvesteren …): twee rekeningen. Het uitgeleende geld wordt een rekening _Geld uitgeleend aan anderen_ (overige bezittingen), met het uitstaande bedrag op 1 januari uit de jaaropgaaf en de ontvangen rente als inkomsten. Geld in de wallet dat nog niet is uitgeleend wordt een _Bankrekening_ met waarden per jaar (banktegoed).
- **Beheerd beleggen** (NN Beheerd Beleggen, Centraal Beheer Beleggen, vermogensbeheer van een bank): een rekening _Broker_ met waarden per jaar, met de waarde op 1 januari uit het (fiscale) jaaroverzicht; probeer daarvoor _Jaaroverzicht (pdf) inlezen_.
- **Beleggen bij bunq** (_bunq Stocks_, via Ginmon): een rekening _Broker_ met waarden per jaar. De bankrekeningen lees je in met de bankimport; een koppeling met bunq is er niet, omdat een sleutel van bunq ook kan betalen.
- **Kapitaalverzekeringen:** een rekening _Kapitaalverzekering_ met de waarde op 1 januari uit de waardeopgave van de verzekeraar. Box3balans past de vrijstellingen voor kapitaalverzekeringen niet toe, zoals die voor polissen van vóór 15 september 1999 die niet zijn verhoogd of verlengd; valt jouw polis daaronder, zet de rekening dan onder _Box 3 → Regels en tarieven_ op _Niet in box 3_. Wat bij a.s.r. na 2020 overbleef, zijn zulke verzekeringen.
- **Groene fondsen** (ASN Groenprojectenfonds en andere fondsen met een groenverklaring): zet de rekening onder _Box 3 → Regels en tarieven_ op _Groene beleggingen_; de vrijstelling en de heffingskorting per jaar zitten in de regels. Verliest een fonds zijn groenverklaring, zoals het Triodos Groenfonds per 1 april 2026, zet hem dan onder _Vanaf een bepaald jaar_ vanaf het volgende jaar (hier 2027) op _Overige bezittingen_. Per 1 januari 2028 vervalt de vrijstelling voor iedereen.
- **Banksparen en beleggingsrecht eigen woning** horen in box 1 zolang ze aan de voorwaarden voldoen: zet de rekening op _Niet in box 3_. Gaan ze naar box 3, bijvoorbeeld omdat ze niet meer aan de voorwaarden voldoen, zet dan onder _Vanaf een bepaald jaar_ vanaf dat jaar _Banktegoeden_ (banksparen) of _Overige bezittingen_ (beleggingsrecht).

Wat we per aanbieder weten en wat er nog nodig is om ze beter te ondersteunen, staat in [docs/aanbieders.md](aanbieders.md).

**Bankexport inlezen.** Bij een bankrekening haalt _Bankexport inlezen_ de saldi op 1 januari, de rente en het geld erin en eruit per jaar uit de transacties die je bij je bank downloadt. Box3balans leest:

- **CAMT.053**, het standaard afschriftformaat met saldo's: de beste keus als je bank het aanbiedt;
- **MT940**, het oudere standaardformaat, ook met saldo's;
- **CSV met een kopregel en een saldokolom**, zoals van ING (_Saldo na mutatie_) en Rabobank (_Saldo na trn_); meerdere rekeningen in één bestand worden uit elkaar gehouden;
- **het TAB-bestand van ABN AMRO**;
- **CSV zonder saldo's** (zoals van bunq): dan vul je het saldo na de laatste regel in, en rekent Box3balans de rest terug;
- **het CSV-afschrift van Revolut en Wise**: elk product en elke valuta wordt een eigen rekening, regels die nog in behandeling zijn of zijn teruggedraaid tellen niet mee, en bedragen in een andere valuta worden omgerekend tegen de ECB-koers (het saldo op 1 januari tegen die van de laatste werkdag ervoor, de rest tegen die van de dag zelf).

Welk bestand je per bank kiest:

| Bank                                 | Kies bij het downloaden                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| ING                                  | CSV, van de betaal- en de spaarrekening (getest met echte exports)                       |
| Rabobank                             | CSV                                                                                      |
| ABN AMRO                             | TAB of CAMT.053                                                                          |
| ASN Bank (ook voor SNS en RegioBank) | CAMT.053 (hun CSV is niet getest)                                                        |
| Triodos                              | CAMT.053 of MT940 (de CSV is niet getest)                                                |
| Knab                                 | MT940 (de standaard onder _Bij- en afschrijvingen → Boekhoudexport_)                     |
| bunq                                 | CAMT.053 of MT940 als de app het aanbiedt; anders CSV, met het saldo na de laatste regel |
| Revolut                              | Afschrift als CSV (Excel), voor alle producten of per rekening                           |
| Wise                                 | Afschrift als CSV, per valuta                                                            |

CAMT.053 en MT940 zijn gebouwd op de openbare standaarden. De exports van ASN Bank, Triodos, Knab, bunq, Revolut en Wise zijn nog niet getest met echte bestanden; lukt het inlezen niet, meld dat dan (zonder bedragen) in [#6](https://github.com/zenonymous/box3balans/issues/6).

Geld in een geldmarktfonds, zoals _Flexible Cash Funds_ bij Revolut of _Interest_ bij Wise, is geen banktegoed maar een overige bezitting: houd dat bij in een eigen rekening (bijvoorbeeld een broker met waarden per jaar). Box3balans waarschuwt als een afschrift zo'n fonds noemt.

Rente herken je aan de omschrijving ("rente", "creditrente", "interest"). Je ziet eerst per jaar wat er gevonden is: een geschat saldo (omdat het bestand halverwege een jaar begint of eindigt) en de totalen van jaren die het bestand maar deels beslaat, staan uit tot je ze aanvinkt. Er wordt pas iets opgeslagen als je in de tabel op _Opslaan_ drukt.

### Jaaroverzicht als pdf

Bij elke rekening met waarden per jaar, behalve een woning, leest _Jaaroverzicht (pdf) inlezen_ het jaaroverzicht of de jaaropgaaf van je bank, broker of platform. De pdf wordt in je browser gelezen en niet bewaard: alleen de tekst gaat naar je eigen Box3balans ([ADR 0009](adr/0009-pdf-lezen-in-de-browser.md)). Wat je aanvinkt, komt in de tabel, met de bestandsnaam en de pagina als bron; die staat ook in het dossier.

Het **jaaroverzicht van ING** wordt herkend: kies de rekening uit het overzicht (betaal-, spaar- of creditcardrekening) en de saldi op 1 januari en 31 december en de rente staan meteen aangevinkt. Bij een schuld, zoals een creditcard, komt het saldo erin als wat je verschuldigd bent. Controleer bij een betaalrekening het saldo: bij een gebruiker week het jaaroverzicht van ING daar af van de eigen afschriften en de export van ING (de spaarrekening klopte). De bankexport geeft het saldo zoals het op je afschriften staat.

Box3balans zoekt bedragen naast een peildatum ("1 januari 2025", "31-12-2024") en naast woorden als _beginwaarde_, _eindwaarde_, _dividend_, _rente_, _inleg_, _onttrekkingen_ en _kosten_. Een bedrag op 31 december is de waarde op 1 januari van het jaar erna. Per bedrag kies je of het klopt en in welke kolom het hoort. Een pdf zonder tekst (een scan) of met een wachtwoord kan niet gelezen worden.

**Help een overzicht herkennen.** Kent Box3balans een overzicht, dan staan de juiste bedragen meteen aangevinkt. Daarvoor is per aanbieder een voorbeeld van de tekst nodig. Stuur geen pdf, want zwart gemaakte tekst is in een pdf vaak nog te lezen. Stuur de uitvoer van dit commando (uit [Poppler](https://poppler.freedesktop.org/), op een Mac met `brew install poppler`), met namen, adressen, rekeningnummers en bedragen veranderd:

```bash
pdftotext -layout jaaroverzicht.pdf -
```

Plak die in een issue met het formulier [_Jaaroverzicht (pdf) van een aanbieder_](https://github.com/zenonymous/box3balans/issues/new?template=jaaroverzicht.yml). Welke aanbieders het meest opleveren, staat in [docs/aanbieders.md](aanbieders.md#route-het-pdf-jaaroverzicht).

In januari herinnert _Aandacht nodig_ je eraan de waarden op 1 januari van het nieuwe jaar in te vullen.

## CSV-import

_Transacties → CSV importeren_ leest exports van vrijwel elke broker, beurs of spreadsheet.

**Herkende exports.** Deze bestanden herkent Box3balans zelf; je hoeft dan geen kolommen te kiezen:

| Aanbieder            | Welk bestand                                                                           | Wat er wordt ingelezen                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEGIRO               | _Rekeningoverzicht_ (Account.csv) of _Transacties_ (Transactions.csv)                  | Aankopen en verkopen met kosten en transactiebelasting; uit het rekeningoverzicht ook corporate actions, dividend met dividendbelasting en rente    |
| DEGIRO               | _Portefeuille_ (Portfolio.csv), op een dag die je kiest                                | Geen transacties maar een controle: je posities en het geld bij DEGIRO op die dag, naast wat de transacties optellen; het geld telt mee voor box 3  |
| Bitvavo              | Transactiegeschiedenis (CSV)                                                           | Alles, met stortingen en opnames in euro's                                                                                                          |
| Coinbase             | Transactierapport (CSV)                                                                | Aankopen, verkopen, omzettingen, versturen en ontvangen, beloningen                                                                                 |
| Kraken               | _Ledgers_ (ledgers.csv)                                                                | Alles tegen euro's, met staking; transacties tussen twee munten via de API-koppeling                                                                |
| Bitstamp             | Transactiegeschiedenis (CSV), oude en nieuwe indeling                                  | Alles tegen euro's, met stortingen, opnames en staking; ruilen tussen twee munten niet                                                              |
| Binance              | _Transaction History_ (CSV), voor de geschiedenis tot de zomer van 2023                | Aankopen en verkopen, ook tegen stablecoins (tegen een dollar per munt), beloningen, opnames; verplaatsingen binnen Binance, futures en euro's niet |
| Crypto.com App       | _Accounts → History → Export_ (CSV van de cryptowallet)                                | Aankopen (ook met de kaart), verkopen, omzettingen, beloningen (Earn, staking, cashback), stortingen en opnames; euro's niet                        |
| Rabobank Beleggen    | Mutaties & nota's (CSV)                                                                | Alles, met stortingen, kosten en rente                                                                                                              |
| Trade Republic       | Transactie-export met acht kolommen (ook die van pytr)                                 | Alles, met stortingen, opnames en rente                                                                                                             |
| Trading 212, BUX     | Geschiedenis (CSV)                                                                     | Aankopen, verkopen met kosten, dividend                                                                                                             |
| Saxo                 | Transactieoverzicht (Excel, opgeslagen als CSV)                                        | Aankopen, verkopen met kosten, dividend                                                                                                             |
| Lightyear            | _Download report_ (CSV) onder Transacties                                              | Aankopen en verkopen met kosten, dividend met belasting; geld en valutawissels niet                                                                 |
| Scalable Capital     | Transacties → _CSV exporteren_ (alleen PRIME+)                                         | Alles, met stortingen, opnames, rente en kosten                                                                                                     |
| Revolut              | Aandelenoverzicht (CSV)                                                                | Aankopen, verkopen, dividend                                                                                                                        |
| Revolut              | Crypto-overzicht (CSV)                                                                 | Aankopen en verkopen met kosten, in elke valuta; versturen, ontvangen en stakingbeloningen                                                          |
| eToro                | _Account statement_ (Excel): alleen het tabblad _Account Activity_, opgeslagen als CSV | Aankopen, verkopen (met zegelrecht) en dividend, in dollars; geld en CFD's niet                                                                     |
| XTB                  | _Account history → Cash operations_, exporteren als CSV                                | Aankopen en verkopen, dividend met bronbelasting, in euro's; geld en CFD's niet                                                                     |
| Schwab Equity Awards | De transactiegeschiedenis van de award-rekening als CSV                                | RSU's en ESPP tegen de marktwaarde (wat als loon belast is), verkopen, dividend met bronbelasting, in dollars                                       |
| CoinTracking         | De handelslijst (_Trade List_) als CSV                                                 | Aankopen en verkopen, stortingen, opnames, inkomsten (staking, mining, airdrops) en kwijtgeraakte munten, van al je beurzen en wallets              |
| Delta                | De export van al je transacties (CSV)                                                  | Aankopen en verkopen, stortingen, opnames, beloningen en dividend                                                                                   |

Waar een bestand alles in euro's heeft (Bitvavo, Bitstamp, Kraken, Rabobank, Trade Republic, Scalable Capital), komen ook stortingen en opnames mee, zodat het geldsaldo klopt. Bij de andere laat Box3balans het geld weg en volgt het alleen je beleggingen; bij het controleren staat wat er is weggelaten.

**Overstappen van een andere tracker.** Hield je je beleggingen bij in CoinTracking of Delta, dan haal je met hun export je hele geschiedenis in één keer binnen. Zo'n export bevat al je beurzen en wallets tegelijk: alles komt in de rekening die je kiest, en het controlescherm noemt de plekken waar de regels vandaan komen. Voor box 3 telt het totaal; wil je toch per plek zien wat je hebt, exporteer dan per plek en importeer elk bestand in een eigen rekening. Een ruil tussen twee munten heeft in deze exports geen waarde in euro's en wordt overgeslagen (behalve bij een CoinTracking-export met waardekolommen); het controlescherm zegt hoeveel. Geld (stortingen en opnames in euro's) laat Box3balans weg.

**DEGIRO elk jaar in januari:** exporteer het _Rekeningoverzicht_ van het jaar en de _Portefeuille_ op 31 december, en importeer ze in die volgorde. De portefeuille laat zien of de transacties optellen tot wat DEGIRO meldt; een verschil corrigeer je met één klik, en het geld bij DEGIRO op 31 december telt mee als banktegoed. Het rekeningoverzicht van DEGIRO is getest met een echte export; de andere formaten zijn gebouwd op openbare voorbeeldbestanden (onder meer van het project Export-To-Ghostfolio) en nog niet getest met echte exports: klopt er iets niet, kies dan _Zelf de kolommen kiezen_ en [meld het](https://github.com/zenonymous/box3balans/issues/new/choose), het liefst met een geanonimiseerd voorbeeld.

Bij andere bestanden:

1. **Kies de rekening en het bestand.** Puntkomma's of komma's, decimale komma's of punten, een byte order mark, titelregels boven de kopregel en Windows-codering worden allemaal herkend.
2. **Controleer de kolommen.** Box3balans raadt welke kolom wat is aan de hand van gangbare Engelse en Nederlandse kopjes (Datum, Aantal, Koers, Valuta …) en toont per kolom een voorbeeldwaarde. Het soort transactie komt uit een kolom, is voor elke regel hetzelfde, of volgt uit het teken van het aantal (negatief = verkoop, zoals in sommige brokerexports). Elke waarde in een soortkolom ("Koop", "Staking", "Airdrop" …) koppel je aan een soort of sla je over. Bewaar de instellingen onder een naam: bestanden met dezelfde kolommen gebruiken ze dan vanzelf.
3. **Bekijk alles voordat je importeert.** Er wordt niets opgeslagen tot je op _… transacties importeren_ drukt. Het voorbeeld toont:
   - **Nieuw:** wordt geïmporteerd.
   - **Al geïmporteerd:** dezelfde regel uit een eerdere import van dit of een overlappend bestand.
   - **Mogelijk dubbel:** dezelfde belegging, soort, dag en hoeveelheid als een transactie uit een andere bron (een koppeling, handmatige invoer of een import met andere instellingen). Wordt overgeslagen, tenzij je _Toch importeren_ aanvinkt.
   - **Probleem:** een regel die niet te lezen is, met de reden (bijvoorbeeld een datum of getal dat niet wordt begrepen).
   - **Beleggingen:** op welke belegging elk symbool of ISIN wordt geboekt. Bestaande worden hergebruikt; nieuwe worden opgezocht in Yahoo (op ISIN, bij voorkeur een euronotering) of CoinGecko (op symbool) en bij het importeren aangemaakt. Kies een andere als de match niet klopt.

Tijden zonder tijdzone worden gelezen als lokale tijd (`TIME_ZONE`). Prijzen in een vreemde munt krijgen de ECB-koers van die dag. Beloningen en cryptostortingen zonder prijs krijgen de slotkoers van die dag. Crypto-opnames en -stortingen worden gekoppeld aan overboekingen naar je andere rekeningen, net als bij synchronisaties.

**Ongedaan maken:** _Eerdere imports_ toont elke import met de knop _Terugdraaien_, die precies de transacties verwijdert die de import aanmaakte. Transacties die je los verwijdert, blijven weg als je hetzelfde bestand opnieuw importeert.

**Sjabloon:** voor alles zonder bruikbare export vul je [het sjabloon](../server/src/import/mapping.ts) in (_↓ Template_ op de importpagina). Kolommen: `date` (JJJJ-MM-DD), `time`, `type` (buy, sell, deposit, withdrawal, dividend, reward, fee, split), `symbol`, `isin`, `name`, `asset_type` (stock, etf, crypto, metal, cash), `quantity` (bij een split: de verhouding, bijvoorbeeld 4), `price`, `total`, `currency`, `fee`, `amount` en `tax_withheld` (dividenden), `notes`, `id`.

Wil je dat Box3balans het bestand van jouw broker of bank vanzelf herkent? Stuur een geanonimiseerd voorbeeld via [een issue](https://github.com/zenonymous/box3balans/issues/new/choose).

## Koppelingen met beurzen en brokers

**Koppelingen** importeert de geschiedenis via API's met alleen leesrechten: **Bitvavo**, **Kraken**, **Coinbase** (een CDP-sleutel met ECDSA) en **Interactive Brokers** (Flex Web Service), en **Bitpanda** (de nieuwe openbare API, met een sleutel met alleen de leesrechten _Balances_, _Transaction_ en _Trade (Read)_; nog niet getest met een echte sleutel). Een rekening via **LYNX** is een rekening bij Interactive Brokers en zou op dezelfde manier moeten werken (nog niet getest; heb je LYNX, laat dan in [#17](https://github.com/zenonymous/box3balans/issues/17) weten of het lukt). De verbindingsdialoog noemt per aanbieder precies welke rechten je geeft. Sleutels worden gecontroleerd met een echte leesopdracht, versleuteld opgeslagen (AES-256-GCM, met een sleutel afgeleid van de app-sleutel) en nooit teruggestuurd of gelogd.

Elke synchronisatie:

1. **Importeert** aankopen, verkopen, stortingen, opnames, stakingbeloningen, dividenden (met ingehouden belasting) en rente als gewone transacties (`source: api`). Ontbrekende beleggingen worden vanzelf aangemaakt: munten van Bitvavo met de koers van Bitvavo zelf, andere munten via CoinGecko (de grootste marktwaarde bij dat symbool; geeft CoinGecko geen antwoord, dan de euromarkt van Bitvavo), effecten via Yahoo op ISIN, op de beurs die IBKR noemt. Een munt die eerder zonder koersbron werd aangemaakt, krijgt er alsnog een zodra die gevonden wordt, tenzij je zelf een koers hebt ingevuld.
2. **Boekt het geld:** aankopen gaan af van en verkopen gaan naar het geldsaldo van de rekening in de handelsvaluta, zodat euro-saldi op een beurs kloppen.
3. **Waardeert in euro's:** fiattransacties tegen de ECB-koers van die dag. Stakingbeloningen, cryptostortingen en crypto-naar-cryptotransacties tegen de slotkoers van die dag (zie _Koersbronnen_ in de [README](../README.md#koersbronnen-gratis-zonder-sleutels)). Was er voor die dag nog geen koers, dan staat zo'n beloning of storting eerst op € 0 en krijgt ze haar waarde bij een volgende synchronisatie, zodra de koers bekend is; een transactie die je zelf hebt aangepast blijft zoals ze is. Coinbase levert de eurowaarde zelf, mits je basisvaluta bij Coinbase EUR is.
4. **Koppelt overboekingen:** een crypto-opname van de ene rekening en een passende storting op een andere (binnen 5 dagen, minstens 95% aangekomen) worden één overboeking, zodat de kostprijs meegaat. Klopt een koppeling niet, open dan een van beide onder _Transacties_ en kies **Ontkoppelen**; die twee worden daarna nooit meer vanzelf gekoppeld.
5. **Vergelijkt saldi** met wat de beurs meldt. Verschillen staan op de pagina _Koppelingen_, met een knop om ze in één keer recht te zetten.

Opnieuw synchroniseren is veilig: niets wordt dubbel geboekt. Je kunt geïmporteerde transacties aanpassen; een nieuwe synchronisatie overschrijft je wijzigingen nooit. Geïmporteerde transacties die je verwijdert, blijven weg.

**Staking op een beurs.** Gestakete munten blijven van jou, dus erin of eruit gaan is geen verkoop en geen opname:

- **Kraken:** gestakete, opt-in- en auto-earn-saldi (`DOT.S`, `ETH2.S`, `SOL.F`, `USDC.M` …) tellen als de munt zelf. Verplaatsingen tussen de spot- en earn-portemonnee worden overgeslagen, ook de oudere "earn"-regels zonder kosten. Verplaatsingen die Kraken als twee losse regels boekt (bijvoorbeeld `ETH2.S` terug naar ETH) vallen tegen elkaar weg als ze binnen twee dagen van elkaar staan; een recente regel wacht één synchronisatie op zijn tegenhanger. Beloningen, airdrops en uitnodigingsbonussen zijn inkomsten. Omzettingen bij een delisting zijn transacties. Kraken's tegoed voor handelskosten (KFEE) wordt genegeerd.
- **Bitvavo:** munten in vaste staking tellen mee via het aparte stakingsaldo. Vastzetten (vaste staking of uitlenen) is geen opname; komt het terug, dan is alleen wat er bovenop komt de beloning. Een geannuleerde opname wordt teruggedraaid (op niet-terugbetaalde kosten na), en verplaatsingen tussen Bitvavo's eigen portemonnees vallen tegen elkaar weg. Wisselt Bitvavo een munt om (MATIC voor POL, LIT voor HEI), dan boekt het de oude munt eruit en de nieuwe erin; dat wordt een verkoop en een aankoop tegen dezelfde waarde, zodat je aankoopwaarde meegaat. Is die waarde nog niet bekend, dan gebeurt het bij een volgende synchronisatie.
- **Coinbase:** de oude ETH2-portemonnee (gestakete ether) telt als ETH, beloningen inbegrepen. Verplaatsingen tussen je Coinbase-portemonnees (kluizen, andere portfolio's, het opheffen van ETH2) vallen tegen elkaar weg als de sleutel beide kanten ziet; anders zijn het een storting of opname.

Bekende beperkingen: bij Bitvavo gaat de koppeling ervan uit dat kosten bovenop het verzonden bedrag komen (in de CSV-export zitten ze in het bedrag), en Bitvavo documenteert niet wat er in de regels voor vaste staking en uitlenen staat; de saldovergelijking laat het zien als een van beide niet klopt. Coinbase meldt handelskosten niet apart. IBKR Flex levert maximaal 365 dagen per opvraging, slaat opties en futures over en verwerkt geen aandelensplitsingen (de saldovergelijking laat die zien). Bitpanda: metalen en grondstoffen worden nog niet ingelezen, en een ruil tussen twee munten (zonder waarde in geld) wordt overgeslagen; de documentatie noemt de soorten transacties niet, dus de koppeling gaat op richting en bedrag.

## Wallets (eigen beheer, op adres)

**Wallets** volgt adressen alleen-lezen, via gratis openbare blockchainverkenners. Alleen BNB Chain vraagt een (gratis) API-sleutel. Box3balans vraagt nooit om je seed phrase of privésleutels en bewaart die ook niet.

| Blockchain                                                          | Bron                               | Opmerkingen                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bitcoin                                                             | mempool.space                      | Adressen of **xpub/ypub/zpub**. Uitgebreide sleutels worden doorzocht met een gap limit van 20, voor zowel ontvangst- als wisselgeldadressen. Legacy, nested SegWit, native SegWit en **Taproot** (kies "Taproot" bij een BIP86-xpub)                                           |
| Litecoin                                                            | litecoinspace.org                  | Adressen of Ltub/Mtub/xpub-sleutels                                                                                                                                                                                                                                             |
| Ethereum, Arbitrum, Optimism, Base, Polygon, Unichain, Ink, Soneium | Blockscout                         | De munt zelf, interne overboekingen en ERC-20-tokens. Je kunt hetzelfde adres in één keer op meerdere ketens volgen                                                                                                                                                             |
| BNB Chain                                                           | Ankr Advanced API (`ANKR_API_KEY`) | BNB en BEP-20-tokens. Vraagt een gratis Ankr-account (zie hieronder). Ankr meldt geen interne transacties: BNB die een contract uitbetaalt (bijvoorbeeld bij het ruilen van een token naar BNB) ontbreekt in de geschiedenis en verschijnt als verschil dat je kunt rechtzetten |
| Solana                                                              | openbare RPC (of `SOLANA_RPC_URL`) | SOL en SPL-tokens. Grote geschiedenissen komen er geleidelijk in (ongeveer 1.500 transacties per synchronisatie) door de limiet van de openbare RPC                                                                                                                             |
| XRP Ledger                                                          | xrplcluster.com                    | XRP-betalingen; uitgegeven tokens worden overgeslagen                                                                                                                                                                                                                           |
| Tron                                                                | TronGrid                           | TRX en TRC-20-tokens (zoals USDT)                                                                                                                                                                                                                                               |
| Cardano                                                             | Koios (gratis openbare API)        | ADA, native tokens en **stakingbeloningen** (gedateerd wanneer ze opneembaar worden; teruggekregen borg is geen inkomen). Plak het stake-adres (stake1…) of een ontvangstadres: Box3balans volgt de hele wallet via de stake-sleutel                                            |
| Dogecoin                                                            | BlockCypher (gratis)               | Adressen of **dgub/xpub** (BIP44, gap limit 20). De gratis laag staat 100 verzoeken per uur toe: een grote geschiedenis of een nieuwe xpub kan een paar synchronisaties duren                                                                                                   |

Zo werkt een wallet-synchronisatie:

- **Alle adressen van een wallet op één keten worden samen verrekend**, dus geld tussen je eigen adressen (of wisselgeld) kost alleen de netwerkkosten. Een adres toevoegen of verwijderen importeert die keten opnieuw.
- **Netwerkkosten** worden `fee`-transacties, en **ruilen** (het ene token eruit, het andere erin) wordt een verkoop plus een aankoop met dezelfde eurowaarde.
- **Tokens** worden via CoinGecko op contractadres herkend, dus USDC op Ethereum, Base en Solana is één belegging. Tokens die CoinGecko niet kent, of die de verkenner als spam markeert, worden **overgeslagen**: meestal is dat airdrop-spam. Elke wallet toont ze en heeft een schakelaar "toch meenemen", die ze toevoegt met een handmatige koers. Opzoekingen worden onthouden en per synchronisatie begrensd; bij een limiet wacht de rest tot de volgende synchronisatie.
- **Overboekingen** van en naar je beurzen worden vanzelf gekoppeld, zodat de aankoopprijs meegaat. De **saldovergelijking** vergelijkt het resultaat met het saldo op de blockchain zodra de hele geschiedenis binnen is.
- Synchronisaties lopen op de achtergrond. Pagina's tonen de voortgang, en je kunt dialogen sluiten terwijl een import doorloopt.

**Sleutel voor BNB Chain.** Geen enkele verkenner biedt de geschiedenis van BNB Chain gratis aan zonder account (de API van BscScan is voor deze keten betaald sinds Etherscan's overstap naar V2). Maak een gratis account op [ankr.com](https://www.ankr.com/rpc/advanced-api/), kopieer je API-sleutel uit het Advanced API-adres (`https://rpc.ankr.com/multichain/<sleutel>`), zet hem in `.env` als `ANKR_API_KEY=` en voer `docker compose up -d` uit. Het gratis abonnement staat 50 verzoeken per minuut en 200 miljoen credits per maand toe; een synchronisatie kost ongeveer drie verzoeken per adres. Zolang er geen sleutel is, staat BNB Chain op "moet ingesteld worden".

Nog niet ondersteund: opnames van Ethereum-validators; Solana-stake-accounts en hun beloningen; bevroren TRX; uitgegeven tokens op de XRP Ledger; Cardano-adressen uit het Byron-tijdperk.
