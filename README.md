# Kluishuis

_Je kluis woont thuis._

Kluishuis houdt je beleggingen bij: **aandelen en ETF's, crypto, en goud en zilver** (thuis of in een kluis), alles in **euro's**, met een schatting van je **box 3**. Je draait het zelf, op je NAS, een thuisserver of je laptop. Je gegevens blijven dus bij jou: Kluishuis stuurt niets naar de makers en verzamelt geen gebruiksgegevens. Het haalt alleen openbare koersen op.

> **Geen belastingadvies.** Kluishuis maakt schattingen. Controleer de bedragen met de jaaroverzichten van je bank en broker voordat je ze in je aangifte gebruikt. Gebruik op eigen risico; er is geen garantie (zie de [licentie](LICENSE)).

**Status:** in ontwikkeling en bruikbaar. De app zelf is nog Engelstalig; een Nederlandse versie staat op de [roadmap](docs/ROADMAP.md).

## Wat het kan

- **Overzicht:** vermogen door de tijd, de verdeling over beleggingssoorten, posities en rekeningen, en per positie de kostprijs en het gerealiseerde en ongerealiseerde resultaat.
- **Transacties** met de hand, via een **CSV-import** van vrijwel elke broker of beurs, via **koppelingen** met Bitvavo, Kraken, Coinbase en Interactive Brokers, en voor **wallets** op adres: Bitcoin, Ethereum en L2's, BNB Chain, Solana, Cardano, Dogecoin, Litecoin, XRP en Tron.
- **Edelmetaal:** munten en baren met gewicht, zuiverheid, foto's en een printbare inventaris (bijvoorbeeld voor je inboedelverzekering).
- **Rendement:** tijd- en geldgewogen rendement tegen een benchmark, een kostenoverzicht en verwachte dividenden.
- **Box 3:** het forfaitaire stelsel per jaar, je **werkelijk rendement** voor de tegenbewijsregeling, en een vooruitblik op het stelsel vanaf 2028.
- **Veilig bewaard:** versleutelde back-ups in een map die je NAS elders kan kopiëren, een volledige wijzigingsgeschiedenis, en een lijst met wat aandacht nodig heeft.

## Installeren

Je hebt een computer nodig met Docker en Docker Compose v2 (`docker compose version` werkt). Dat kan een NAS zijn (Synology, QNAP, Unraid, TrueNAS), een Raspberry Pi 4 of 5, een thuisserver of een laptop met Docker Desktop. Intel/AMD (x86-64) en ARM64 worden allebei ondersteund. Stap-voor-stapuitleg per systeem staat in [docs/installatie.md](docs/installatie.md).

1. Maak een map en zet [`docker-compose.yml`](docker-compose.yml) erin:

   ```bash
   mkdir kluishuis && cd kluishuis
   curl -fsSLO https://raw.githubusercontent.com/OWNER/kluishuis/main/docker-compose.yml
   ```

2. Start Kluishuis:

   ```bash
   docker compose up -d
   ```

   De eerste keer worden de images gedownload. Na ongeveer een halve minuut toont `docker compose ps` beide containers als `healthy`.

3. Open `http://<je-server>:8080` en maak je gebruiker aan, met een wachtwoord van minstens 12 tekens.

4. **Aanbevolen:** maak naast `docker-compose.yml` een bestand `.env` (voorbeeld: [`.env.example`](.env.example)) met minstens:

   ```bash
   BACKUP_PASSPHRASE='vier willekeurige woorden hier'   # versleutelt de back-ups
   PUID=1000                                            # jouw gebruikers-id (commando: id)
   PGID=1000                                            # jouw groeps-id
   ```

   Voer daarna `docker compose up -d` opnieuw uit. Bewaar de wachtwoordzin in je wachtwoordmanager: zonder kun je een versleutelde back-up niet terugzetten.

Een `.env` is niet verplicht. Bij de eerste start maakt Kluishuis zelf een sleutel voor het versleutelen van API-sleutels en een databasewachtwoord aan, in het volume `app-data`.

**Controleren:** `docker compose logs app --tail 50`. De eerste regels tonen `Kluishuis starting` met de versie. Na een herstart van je NAS kan één keer `Database not reachable yet…, waiting for it` voorbijkomen: de app wacht dan tot de database klaar is.

### In één container

Om het uit te proberen, of op een laptop met Docker Desktop, kan Kluishuis ook in één container draaien, met de database ingebouwd (PGlite):

```bash
curl -fsSLO https://raw.githubusercontent.com/OWNER/kluishuis/main/docker-compose.lite.yml
docker compose -f docker-compose.lite.yml up -d
```

Voor een NAS of server is de standaardopstelling met een eigen PostgreSQL de stevigere keuze. Overstappen gaat met een back-up en terugzetten. Maak in deze variant back-ups vanuit de app (_Settings → Backups & export_): de back-up via de opdrachtregel kan niet zolang de app de database open heeft.

### Zelf bouwen

Wil je eigen wijzigingen draaien, bouw het image dan vanuit de broncode:

```bash
git clone https://github.com/OWNER/kluishuis.git && cd kluishuis
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Werk je op een andere computer dan je server, dan kopieert `scripts/deploy.sh gebruiker@nas` de laatste commit via SSH naar `~/kluishuis` op de server en bouwt het daar. Geef een tweede argument voor een andere map. Moet `docker` daar met `sudo` (zoals op Synology): `DOCKER="sudo docker" scripts/deploy.sh gebruiker@nas`. Alleen gecommitte bestanden gaan mee, nooit `.env`, gegevens of back-ups.

### Bijwerken

```bash
docker compose pull
docker compose up -d
```

Je instellingen, database en back-ups blijven zoals ze zijn; databasemigraties draaien vanzelf bij het opstarten. Wil je eerst een back-up: `docker compose exec app node dist/cli.js backup`. Wil je op een vaste versie blijven, zet dan bijvoorbeeld `KLUISHUIS_VERSION=1.2.0` in `.env`. Wat er per versie verandert, staat bij de [releases](https://github.com/OWNER/kluishuis/releases).

### PostgreSQL upgraden

Kleine updates (18.x) komen mee met `docker compose pull`. Een nieuwe hoofdversie (bijvoorbeeld 18 → 19) kan de oude databestanden niet lezen; je verhuist de gegevens dan met een back-up. Dit is uitgeprobeerd met PostgreSQL 17 → 18: alle pagina's toonden daarna dezelfde gegevens.

1. Maak een back-up: `docker compose exec app node dist/cli.js backup`.
2. `docker compose down`.
3. Zet in `docker-compose.yml` het image van `db` op de nieuwe versie (bijvoorbeeld `postgres:19-alpine`) **en** hernoem het volume (`db-data` → `db-data-19`, op beide plekken). Het oude volume blijft zo onaangeroerd als terugvaloptie.
4. `docker compose up -d`. De app start met een lege database en maakt de tabellen aan.
5. Zet terug: `docker compose exec app node dist/cli.js restore /backups/<de back-up uit stap 1>`, dan `docker compose restart app`, en log opnieuw in.
6. Klopt alles, verwijder dan het oude volume: `docker volume rm kluishuis_db-data`.

### Toegang buitenshuis (VPN)

Zet Kluishuis niet open naar het internet: stuur poort 8080 niet door in je router. Wil je erbij vanaf je telefoon of laptop buiten de deur, gebruik dan een VPN:

- **WireGuard of Tailscale, gewoon:** open `http://<vpn-adres-van-je-server>:8080`. De VPN versleutelt het verkeer al. Laat `COOKIE_SECURE=false`.
- **Tailscale met HTTPS** (een echt `https://`-adres): zet MagicDNS en HTTPS-certificaten aan in de Tailscale-beheeromgeving en voer op de server uit (zo nodig met `sudo`):

  ```bash
  tailscale serve --bg 8080
  ```

  Kluishuis staat dan op `https://<servernaam>.<tailnet>.ts.net`. Zet `COOKIE_SECURE=true` in `.env` en voer `docker compose up -d` uit. Gebruik vanaf dan alleen het https-adres: via het gewone `http://`-adres blijf je niet ingelogd. Laat `TRUST_PROXY=false`. Alle verzoeken delen dan één limiet voor inlogpogingen; voor één gebruiker is dat prima.

  Wil je dat het https-adres de enige ingang is, publiceer de poort dan alleen op de server zelf: verander in `docker-compose.yml` de regel onder `ports` in `"127.0.0.1:${HTTP_PORT:-8080}:8080"`.

## Back-ups en terugzetten

Een back-up is een gzip-bestand met **alle** gegevens behalve inlogsessies: rekeningen, transacties, edelmetaal met foto's, koersen, instellingen, koppelingen en wallets. Ze komen in de map **`backups` naast `docker-compose.yml`**:

- **Automatisch**, elke `BACKUP_INTERVAL_HOURS` (standaard 24). De nieuwste `BACKUP_KEEP` (standaard 14) automatische back-ups blijven bewaard.
- **Handmatig**, via _Settings → Backups & export → Back up now_, of `docker compose exec app node dist/cli.js backup`. Handmatige back-ups worden nooit automatisch verwijderd.
- **Vóór elke terugzetting**, als vangnet (`…-prerestore…`).

**Versleutel ze.** Met `BACKUP_PASSPHRASE` in `.env` (minstens 12 tekens) worden nieuwe back-ups versleuteld (`….json.gz.enc`, AES-256-GCM met een sleutel afgeleid via scrypt). Een verkeerde wachtwoordzin of een beschadigd bestand wordt herkend; er wordt nooit half teruggezet. **Zonder de wachtwoordzin kun je een versleutelde back-up niet terugzetten.** Zonder wachtwoordzin zijn back-ups gewone gzip-bestanden, met je wachtwoord-hash en al je financiële gegevens leesbaar erin; _Needs attention_ herinnert je daaraan.

**Kopieën elders.** Laat de back-uptool van je NAS (Hyper Backup, rclone, een cloudsync …) de map `backups` meenemen. De bestanden zijn van `PUID`/`PGID` uit `.env`: zet die op je eigen gebruiker (het commando `id` op de NAS toont ze), zodat jij en je back-uptool erbij kunnen. Of gebruik _Download_ naast een back-up in Settings.

**De sleutel voor API-sleutels.** API-sleutels van beurzen staan versleuteld in de database, met een sleutel die Kluishuis bij de eerste start aanmaakt in het volume `app-data`. Die sleutel zit niet in de back-ups. Verhuis je naar een andere server, bewaar hem dan in je wachtwoordmanager en zet hem daar als `APP_SECRET` in `.env`:

```bash
docker compose exec app cat /data/app-secret
```

Zonder die sleutel lukt het terugzetten ook, maar moet je de API-sleutels opnieuw invoeren.

**Terugzetten** vervangt alle huidige gegevens door die uit de back-up, in één databasetransactie: alles wordt teruggezet of er verandert niets. Back-ups van oudere versies gaan prima; back-ups van een nieuwere versie worden geweigerd. Daarna is iedereen uitgelogd; log in met de gebruiker uit de back-up.

- Vanuit de app: _Settings → Backups & export → Restore…_ naast een back-up, en typ `RESTORE`. Is de back-up met een eerdere wachtwoordzin gemaakt, vul die dan daar in.
- Vanuit een bestand, bijvoorbeeld op een nieuwe server: zet het in de map `backups` en voer uit:

  ```bash
  docker compose exec app node dist/cli.js restore /backups/kluishuis-20261002-030000-auto.json.gz.enc
  docker compose restart app
  ```

  Dit gebruikt `BACKUP_PASSPHRASE` uit `.env`; voor een andere: `docker compose exec -e BACKUP_PASSPHRASE='…' app node dist/cli.js restore …`.

- Een versleutelde back-up buiten de app lezen: `docker compose exec app node dist/cli.js decrypt /backups/<bestand>.enc` zet het gewone `.json.gz` ernaast.
- `docker compose exec app node dist/cli.js list` toont de back-ups met grootte en datum.

**Extra vangnet (optioneel).** Een ruwe databasedump; terugzetten daarvan vraagt dezelfde PostgreSQL-versie:

```bash
docker compose exec db pg_dump -U kluishuis kluishuis | gzip > kluishuis-db.sql.gz
```

**Exports.** _Settings → Backups & export_ downloadt ook **alle transacties** en de **huidige posities** als CSV. Performance, Income en Box 3 hebben elk hun eigen CSV-export.

### Instellingen (`.env`)

Alles is optioneel. Zet alleen wat je wilt veranderen in `.env` naast `docker-compose.yml` en voer daarna `docker compose up -d` uit.

| Variabele               | Standaard          | Waarvoor                                                                                   |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `HTTP_PORT`             | `8080`             | Poort op de server                                                                         |
| `KLUISHUIS_VERSION`     | `latest`           | Welke versie je draait, bijvoorbeeld `1.2.0`                                               |
| `BACKUP_PASSPHRASE`     | —                  | Versleutelt back-ups (minstens 12 tekens). Nodig om terug te zetten: bewaar hem goed       |
| `PUID` / `PGID`         | `1000`             | Eigenaar van de back-upbestanden: jouw gebruikers- en groeps-id                            |
| `BACKUP_INTERVAL_HOURS` | `24`               | Uren tussen automatische back-ups; `0` = uit                                               |
| `BACKUP_KEEP`           | `14`               | Aantal automatische back-ups dat bewaard blijft                                            |
| `COOKIE_SECURE`         | `false`            | Op `true` als je Kluishuis via HTTPS opent                                                 |
| `TRUST_PROXY`           | `false`            | Alleen achter een reverse proxy: `true`, het aantal proxy's, of hun IP-adres(sen)          |
| `SESSION_DAYS`          | `30`               | Hoe lang je ingelogd blijft                                                                |
| `TIME_ZONE`             | `Europe/Amsterdam` | Kalender voor "welke dag of welk jaar" (box 3-peildatum, jaarresultaten)                   |
| `PRICE_REFRESH_MINUTES` | `15`               | Minuten tussen koersupdates                                                                |
| `SYNC_INTERVAL_HOURS`   | `6`                | Uren tussen synchronisaties van koppelingen en wallets; `0` = alleen met de hand           |
| `SOLANA_RPC_URL`        | openbare RPC       | Eigen Solana-RPC (bijvoorbeeld een gratis Helius-sleutel) voor snellere eerste imports     |
| `ANKR_API_KEY`          | —                  | Gratis Ankr Advanced API-sleutel; nodig voor BNB Chain-wallets                             |
| `LOG_LEVEL`             | `info`             | `debug` logt ook elk verzoek                                                               |
| `APP_SECRET`            | aangemaakt         | Eigen sleutel (minstens 32 tekens) voor API-sleutels, in plaats van de aangemaakte         |
| `POSTGRES_PASSWORD`     | aangemaakt         | Eigen databasewachtwoord, alleen bij de allereerste start; daarna staat het in de database |

## Gebruiken

1. **Overview en Holdings:** je vermogen door de tijd, de verandering van vandaag, de verdeling per beleggingssoort, per positie of per rekening, en elke positie per rekening met kostprijs en open en gerealiseerd resultaat.
2. **Needs attention:** bovenaan de zijbalk verschijnt een rode of oranje link als iets aandacht nodig heeft: een mislukte synchronisatie, saldi die niet kloppen met een beurs of wallet, koersen die niet bijgewerkt konden worden, een negatief saldo, stortingen zonder waarde, opnames die niet aan een storting gekoppeld zijn, of back-ups die mislukt zijn, te lang geleden zijn of niet versleuteld zijn. Elk punt linkt naar waar je het oplost; een waarschuwing kun je wegklikken tot er iets aan verandert.
3. **History** (_Settings → History_): elke wijziging aan transacties, beleggingen, rekeningen, edelmetaal, imports, koppelingen en wallets, veld voor veld, of jij of een synchronisatie of import het deed. Verwijderde transacties en edelmetaalstukken zet je daar terug.
4. **Accounts:** maak er één per plek waar je iets aanhoudt: brokers (DEGIRO), beurzen (Bitvavo), wallets (Ledger), kluizen (Goldrepublic), thuis (de kluis).
5. **Assets:** zoek in Yahoo Finance op naam, ticker of ISIN, of in CoinGecko op munt. Kies de notering die je echt verhandelt (bijvoorbeeld `IWDA.AS` in plaats van `IWDA.L`). Goud, zilver, platina, palladium en euro's staan er al.
6. **Transactions:** aankoop, verkoop, storting, opname, dividend (bruto plus ingehouden belasting), stakingbeloning, kosten betaald in de belegging zelf, split, en **overboekingen** tussen rekeningen, die de kostprijs meenemen. Transacties in een vreemde munt krijgen automatisch de ECB-koers van die dag; die kun je aanpassen.
7. **Metals:** voeg munten en baren toe met gewicht en zuiverheid, of kies een voorbeeld (Krugerrand, Maple Leaf, Gouden Tientje, standaardbaren …). Stukken worden gewaardeerd tegen de spotprijs van het fijngewicht. Vul je de spotwaarde bij aankoop in, dan zie je de betaalde opslag. Metaal in een kluis (Goldrepublic) boek je als aankopen in **grammen** op Gold of Silver. Elk stuk kan tot 8 **foto's** hebben (verkleind in de browser, zonder locatiegegevens). _Inventory_ print een lijst per bewaarplek, of slaat die op als pdf, met foto's, gewichten, aankoopgegevens en waarde.

### CSV-import

_Transactions → Import CSV_ leest exports van vrijwel elke broker, beurs of spreadsheet:

1. **Kies de rekening en het bestand.** Puntkomma's of komma's, decimale komma's of punten, een byte order mark, titelregels boven de kopregel en Windows-codering worden allemaal herkend.
2. **Controleer de kolommen.** Kluishuis raadt welke kolom wat is aan de hand van gangbare Engelse en Nederlandse kopjes (Datum, Aantal, Koers, Valuta …) en toont per kolom een voorbeeldwaarde. Het soort transactie komt uit een kolom, is voor elke regel hetzelfde, of volgt uit het teken van het aantal (negatief = verkoop, zoals in sommige brokerexports). Elke waarde in een soortkolom ("Koop", "Staking", "Airdrop" …) koppel je aan een soort of sla je over. Bewaar de instellingen onder een naam: bestanden met dezelfde kolommen gebruiken ze dan vanzelf.
3. **Bekijk alles voordat je importeert.** Er wordt niets opgeslagen tot je op _Import_ drukt. Het voorbeeld toont:
   - **New:** wordt geïmporteerd.
   - **Already imported:** dezelfde regel uit een eerdere import van dit of een overlappend bestand.
   - **Possible duplicate:** dezelfde belegging, soort, dag en hoeveelheid als een transactie uit een andere bron (een koppeling, handmatige invoer of een import met andere instellingen). Wordt overgeslagen, tenzij je _Import anyway_ aanvinkt.
   - **Problem:** een regel die niet te lezen is, met de reden (bijvoorbeeld een datum of getal dat niet wordt begrepen).
   - **Assets:** op welke belegging elk symbool of ISIN wordt geboekt. Bestaande worden hergebruikt; nieuwe worden opgezocht in Yahoo (op ISIN, bij voorkeur een euronotering) of CoinGecko (op symbool) en bij het importeren aangemaakt. Kies een andere als de match niet klopt.

Tijden zonder tijdzone worden gelezen als lokale tijd (`TIME_ZONE`). Prijzen in een vreemde munt krijgen de ECB-koers van die dag. Beloningen en cryptostortingen zonder prijs krijgen de slotkoers van die dag. Crypto-opnames en -stortingen worden gekoppeld aan overboekingen naar je andere rekeningen, net als bij synchronisaties.

**Ongedaan maken:** _Earlier imports_ toont elke import met een _Undo_ die precies de transacties verwijdert die hij aanmaakte. Transacties die je los verwijdert, blijven weg als je hetzelfde bestand opnieuw importeert.

**Sjabloon:** voor alles zonder bruikbare export vul je [het sjabloon](server/src/import/mapping.ts) in (_↓ Template_ op de importpagina). Kolommen: `date` (JJJJ-MM-DD), `time`, `type` (buy, sell, deposit, withdrawal, dividend, reward, fee, split), `symbol`, `isin`, `name`, `asset_type` (stock, etf, crypto, metal, cash), `quantity` (bij een split: de verhouding, bijvoorbeeld 4), `price`, `total`, `currency`, `fee`, `amount` en `tax_withheld` (dividenden), `notes`, `id`.

Wil je dat Kluishuis het bestand van jouw broker of bank vanzelf herkent? Stuur een geanonimiseerd voorbeeld via [een issue](https://github.com/OWNER/kluishuis/issues/new/choose).

### Koppelingen met beurzen en brokers

**Connections** importeert de geschiedenis via API's met alleen leesrechten: **Bitvavo**, **Kraken**, **Coinbase** (een CDP-sleutel met ECDSA) en **Interactive Brokers** (Flex Web Service). De verbindingsdialoog noemt per aanbieder precies welke rechten je geeft. Sleutels worden gecontroleerd met een echte leesopdracht, versleuteld opgeslagen (AES-256-GCM, met een sleutel afgeleid van de app-sleutel) en nooit teruggestuurd of gelogd.

Elke synchronisatie:

1. **Importeert** aankopen, verkopen, stortingen, opnames, stakingbeloningen, dividenden (met ingehouden belasting) en rente als gewone transacties (`source: api`). Ontbrekende beleggingen worden vanzelf aangemaakt: munten via CoinGecko (de grootste marktwaarde bij dat symbool), effecten via Yahoo op ISIN, op de beurs die IBKR noemt.
2. **Boekt het geld:** aankopen gaan af van en verkopen gaan naar het geldsaldo van de rekening in de handelsvaluta, zodat euro-saldi op een beurs kloppen.
3. **Waardeert in euro's:** fiattransacties tegen de ECB-koers van die dag. Stakingbeloningen, cryptostortingen en crypto-naar-cryptotransacties tegen de slotkoers van die dag (Yahoo `SYM-EUR`, met CoinGecko als terugval). Coinbase levert de eurowaarde zelf, mits je basisvaluta bij Coinbase EUR is.
4. **Koppelt overboekingen:** een crypto-opname van de ene rekening en een passende storting op een andere (binnen 5 dagen, minstens 95% aangekomen) worden één overboeking, zodat de kostprijs meegaat. Klopt een koppeling niet, open dan een van beide onder _Transactions_ en kies **Unlink**; die twee worden daarna nooit meer vanzelf gekoppeld.
5. **Vergelijkt saldi** met wat de beurs meldt. Verschillen staan op de pagina Connections, met een knop om ze in één keer recht te zetten.

Opnieuw synchroniseren is veilig: niets wordt dubbel geboekt. Je kunt geïmporteerde transacties aanpassen; een nieuwe synchronisatie overschrijft je wijzigingen nooit. Geïmporteerde transacties die je verwijdert, blijven weg.

**Staking op een beurs.** Gestakete munten blijven van jou, dus erin of eruit gaan is geen verkoop en geen opname:

- **Kraken:** gestakete, opt-in- en auto-earn-saldi (`DOT.S`, `ETH2.S`, `SOL.F`, `USDC.M` …) tellen als de munt zelf. Verplaatsingen tussen de spot- en earn-portemonnee worden overgeslagen, ook de oudere "earn"-regels zonder kosten. Verplaatsingen die Kraken als twee losse regels boekt (bijvoorbeeld `ETH2.S` terug naar ETH) vallen tegen elkaar weg als ze binnen twee dagen van elkaar staan; een recente regel wacht één synchronisatie op zijn tegenhanger. Beloningen, airdrops en uitnodigingsbonussen zijn inkomsten. Omzettingen bij een delisting zijn transacties. Kraken's tegoed voor handelskosten (KFEE) wordt genegeerd.
- **Bitvavo:** munten in vaste staking tellen mee via het aparte stakingsaldo. Vastzetten (vaste staking of uitlenen) is geen opname; komt het terug, dan is alleen wat er bovenop komt de beloning. Een geannuleerde opname wordt teruggedraaid (op niet-terugbetaalde kosten na), en verplaatsingen tussen Bitvavo's eigen portemonnees vallen tegen elkaar weg.
- **Coinbase:** de oude ETH2-portemonnee (gestakete ether) telt als ETH, beloningen inbegrepen. Verplaatsingen tussen je Coinbase-portemonnees (kluizen, andere portfolio's, het opheffen van ETH2) vallen tegen elkaar weg als de sleutel beide kanten ziet; anders zijn het een storting of opname.

Bekende beperkingen: bij Bitvavo gaat Kluishuis ervan uit dat kosten bovenop het verzonden bedrag komen, en Bitvavo documenteert niet wat er in de regels voor vaste staking en uitlenen staat; de saldovergelijking laat het zien als een van beide niet klopt. Coinbase meldt handelskosten niet apart. IBKR Flex levert maximaal 365 dagen per opvraging, slaat opties en futures over en verwerkt geen aandelensplitsingen (de saldovergelijking laat die zien).

### Wallets (eigen beheer, op adres)

**Wallets** volgt adressen alleen-lezen, via gratis openbare blockchainverkenners. Alleen BNB Chain vraagt een (gratis) API-sleutel. Kluishuis vraagt nooit om je seed phrase of privésleutels en bewaart die ook niet.

| Blockchain                                                          | Bron                               | Opmerkingen                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bitcoin                                                             | mempool.space                      | Adressen of **xpub/ypub/zpub**. Uitgebreide sleutels worden doorzocht met een gap limit van 20, voor zowel ontvangst- als wisselgeldadressen. Legacy, nested SegWit, native SegWit en **Taproot** (kies "Taproot" bij een BIP86-xpub)                                           |
| Litecoin                                                            | litecoinspace.org                  | Adressen of Ltub/Mtub/xpub-sleutels                                                                                                                                                                                                                                             |
| Ethereum, Arbitrum, Optimism, Base, Polygon, Unichain, Ink, Soneium | Blockscout                         | De munt zelf, interne overboekingen en ERC-20-tokens. Je kunt hetzelfde adres in één keer op meerdere ketens volgen                                                                                                                                                             |
| BNB Chain                                                           | Ankr Advanced API (`ANKR_API_KEY`) | BNB en BEP-20-tokens. Vraagt een gratis Ankr-account (zie hieronder). Ankr meldt geen interne transacties: BNB die een contract uitbetaalt (bijvoorbeeld bij het ruilen van een token naar BNB) ontbreekt in de geschiedenis en verschijnt als verschil dat je kunt rechtzetten |
| Solana                                                              | openbare RPC (of `SOLANA_RPC_URL`) | SOL en SPL-tokens. Grote geschiedenissen komen er geleidelijk in (ongeveer 1.500 transacties per synchronisatie) door de limiet van de openbare RPC                                                                                                                             |
| XRP Ledger                                                          | xrplcluster.com                    | XRP-betalingen; uitgegeven tokens worden overgeslagen                                                                                                                                                                                                                           |
| Tron                                                                | TronGrid                           | TRX en TRC-20-tokens (zoals USDT)                                                                                                                                                                                                                                               |
| Cardano                                                             | Koios (gratis openbare API)        | ADA, native tokens en **stakingbeloningen** (gedateerd wanneer ze opneembaar worden; teruggekregen borg is geen inkomen). Plak het stake-adres (stake1…) of een ontvangstadres: Kluishuis volgt de hele wallet via de stake-sleutel                                             |
| Dogecoin                                                            | BlockCypher (gratis)               | Adressen of **dgub/xpub** (BIP44, gap limit 20). De gratis laag staat 100 verzoeken per uur toe: een grote geschiedenis of een nieuwe xpub kan een paar synchronisaties duren                                                                                                   |

Zo werkt een wallet-synchronisatie:

- **Alle adressen van een wallet op één keten worden samen verrekend**, dus geld tussen je eigen adressen (of wisselgeld) kost alleen de netwerkkosten. Een adres toevoegen of verwijderen importeert die keten opnieuw.
- **Netwerkkosten** worden `fee`-transacties, en **ruilen** (het ene token eruit, het andere erin) wordt een verkoop plus een aankoop met dezelfde eurowaarde.
- **Tokens** worden via CoinGecko op contractadres herkend, dus USDC op Ethereum, Base en Solana is één belegging. Tokens die CoinGecko niet kent, of die de verkenner als spam markeert, worden **overgeslagen**: meestal is dat airdrop-spam. Elke wallet toont ze en heeft een schakelaar "toch meenemen", die ze toevoegt met een handmatige koers. Opzoekingen worden onthouden en per synchronisatie begrensd; bij een limiet wacht de rest tot de volgende synchronisatie.
- **Overboekingen** van en naar je beurzen worden vanzelf gekoppeld, zodat de aankoopprijs meegaat. De **saldovergelijking** vergelijkt het resultaat met het saldo op de blockchain zodra de hele geschiedenis binnen is.
- Synchronisaties lopen op de achtergrond. Pagina's tonen de voortgang, en je kunt dialogen sluiten terwijl een import doorloopt.

**Sleutel voor BNB Chain.** Geen enkele verkenner biedt de geschiedenis van BNB Chain gratis aan zonder account (de API van BscScan is voor deze keten betaald sinds Etherscan's overstap naar V2). Maak een gratis account op [ankr.com](https://www.ankr.com/rpc/advanced-api/), kopieer je API-sleutel uit het Advanced API-adres (`https://rpc.ankr.com/multichain/<sleutel>`), zet hem in `.env` als `ANKR_API_KEY=` en voer `docker compose up -d` uit. Het gratis abonnement staat 50 verzoeken per minuut en 200 miljoen credits per maand toe; een synchronisatie kost ongeveer drie verzoeken per adres. Zolang er geen sleutel is, staat BNB Chain op "needs setup".

Nog niet ondersteund: opnames van Ethereum-validators; Solana-stake-accounts en hun beloningen; bevroren TRX; uitgegeven tokens op de XRP Ledger; Cardano-adressen uit het Byron-tijdperk.

### Box 3

De pagina **Box 3** schat je box 3 volgens de forfaitaire spaarvariant (belastingjaren vanaf 2023), voor elk jaar sinds je eerste transactie.

- **Peildatum 1 januari:** je bezit aan het eind van 31 december, gewaardeerd tegen de slotkoers van die dag of de laatste daarvoor. Wallets, kluizen en fysiek metaal tellen mee.
- **Categorieën:** elke positie telt als _banktegoed_, _overige bezitting_, _groene belegging_ of _niet in box 3_. Standaard is geld bij een bank of broker een banktegoed, geld op een cryptobeurs of in een wallet een overige bezitting, en zijn beleggingen, crypto en metalen overige bezittingen. Hele rekeningen kun je anders indelen, bijvoorbeeld een fonds met een groenverklaring als groene belegging of een pensioenrekening als niet in box 3. Groene beleggingen zijn alleen vrijgesteld tot de jaargrens (2023 € 65.072; 2024 € 71.251; 2025 € 26.312; 2026 € 26.715 per persoon, het dubbele met een fiscale partner); wat erboven zit, telt als overige bezitting, en de kleine heffingskorting voor groene beleggingen (0,7% tot en met 2024, daarna 0,1%) gaat eraf. De vrijstelling vervalt in 2027. Overige bezittingen worden ook gesplitst in beleggingen, crypto en metalen, zoals de aangifte erom vraagt.
- **Jouw situatie per jaar:** fiscale partner (verdubbelt het heffingsvrij vermogen en de schuldendrempel), schulden, en banktegoeden of andere bezittingen die de app niet bijhoudt.
- **Berekening:** volgt de stappen van de Belastingdienst (forfaitair rendement → rendementsgrondslag → grondslag sparen en beleggen → aandeel → voordeel → belasting). De officiële cijfers voor 2023–2026 zitten erin (de percentages voor banktegoeden en schulden van 2026 zijn voorlopig), en elk tarief is aan te passen onder _Rules & rates_.
- **Werkelijk rendement (tegenbewijsregeling):** per jaar het werkelijke rendement zoals de _Opgaaf werkelijk rendement_ erom vraagt, per categorie: waarde op 1 januari, geld erin en eruit, waarde op 31 december, waardeverandering en inkomsten. Dividenden tellen bruto, kosten mogen er niet af, betaalde rente op schulden wel, en er is geen heffingsvrij deel. Het wordt vergeleken met de belasting volgens het forfaitaire stelsel, met de vraag of de opgaaf je geld bespaart, en ongeveer hoeveel. Vul per jaar onder _Your situation_ de betaalde rente op schulden en het rendement op bezittingen die de app niet bijhoudt in.
- **Vanaf 2028 (vooruitblik):** het geplande stelsel op basis van werkelijk rendement (wetsvoorstel 36.748, **nog geen wet**) toegepast op je afgelopen jaren: resultaat na kosten, het heffingsvrije resultaat, verliezen die naar voren (en met de novelle naar achteren) worden verrekend, en de belasting vergeleken met het huidige stelsel. Tarief, heffingsvrij resultaat, verliesdrempel en verliesverrekening naar achteren zijn aan te passen, met instellingen voor het wetsvoorstel zoals de Tweede Kamer het aannam en voor de aangekondigde novelle.
- **Bronnen:** de gebruikte regels, met links, staan in [`docs/box3-sources.md`](docs/box3-sources.md). De tarieven voor 2027 zitten er nog niet in: op 5 oktober 2026 waren ze nog niet definitief.
- **Export:** CSV van alle posities op de peildatum, en _Print / PDF_ (een printweergave zonder de rest van de app).

Het blijft een schatting: controleer de waarden met de jaaroverzichten van je banken en brokers.

### Hoe de getallen berekend worden

- **Getallen invoeren** volgt de notatie die je in Settings kiest. Met de Nederlandse notatie is "5.000" vijfduizend en "1,5" anderhalf; "1.234,56" werkt ook. Zodra je een scheidingsteken typt, laat het veld zien hoe het gelezen is (bijvoorbeeld "= 5 000"), en een waarde die op twee manieren te lezen is, wordt gemarkeerd. Getallen uit Engelstalige sites, zoals "0.0015", worden ook goed gelezen.
- **Kostprijs** is per rekening, standaard met **gemiddelde kostprijs**, of **FIFO** (_Settings → Cost basis_). Kosten bij een aankoop tellen bij de kostprijs op, kosten bij een verkoop gaan van de opbrengst af. Overboekingen nemen hun kostprijs mee.
- **Netwerkkosten betaald in een munt** (gas, Bitcoin-transactiekosten) zijn een gerealiseerd verlies ter grootte van de kostprijs van de uitgegeven munten. Ze staan als "network fee" bij de gerealiseerde resultaten.
- **Gerealiseerd resultaat** = verkoopopbrengst − kosten − kostprijs van de verkochte stukken. Omdat de kostprijs in euro's is tegen de koers van de transactie, zit het valuta-effect erin. Bij posities gekocht in een vreemde munt wordt het open resultaat ook gesplitst in een **koerseffect** (gewaardeerd tegen de wisselkoers die je betaalde) en een **valuta-effect**.
- **Beloningen** (staking) komen binnen met een kostprijs gelijk aan hun marktwaarde en tellen als inkomsten. **Dividenden** tellen als inkomsten na ingehouden belasting.
- **Geld** wordt gewaardeerd tegen de nominale waarde (vreemde valuta tegen de ECB-koers) en telt niet als "belegd". Handmatige aankopen, verkopen en dividenden kunnen naar keuze het geldsaldo van een rekening aanpassen; gesynchroniseerde doen dat altijd.
- **Vermogen door de tijd** wordt uit je transacties berekend: elke dag worden je posities gewaardeerd tegen de slotkoers van die dag, met de laatste slotkoers over weekenden en feestdagen. Posities zonder koersgeschiedenis tellen tegen kostprijs, en de grafiek vermeldt dat. Veranderingen per periode (1W, 1M, YTD) zijn veranderingen van je vermogen, stortingen inbegrepen.
- **Resultaat per jaar** = gerealiseerd resultaat + inkomsten + verandering in open (ongerealiseerd) resultaat over het jaar. Stortingen en opnames zijn geen resultaat, en de jaren tellen op tot het totale resultaat. Kosten en ingehouden belasting zitten er al in en worden ter informatie getoond.
- **Inkomsten** = dividenden na ingehouden belasting, staking- en andere beloningen tegen hun eurowaarde bij ontvangst, en rente (beloningen op geld). De pagina's Income en Performance exporteren CSV.
- **Geld erin en eruit.** Voor rendementen komt geld je portefeuille in of uit met stortingen en opnames, beleggingen die erin of eruit gaan (tegen de marktwaarde van die dag), aan- en verkopen die niet via een bijgehouden geldsaldo lopen, dividenden die naar een bankrekening buiten Kluishuis gaan, en gekocht of verkocht fysiek metaal. Beloningen, kosten en overboekingen tussen je rekeningen blijven erbinnen: dat zijn resultaten.
- **Tijdgewogen rendement** (_Performance → Returns %_) schakelt de rendementen van elke dag aan elkaar, met stortingen vanaf het begin van hun dag en opnames aan het eind: hoe de beleggingen het deden, ongeacht wanneer jij geld erin of eruit haalde, zoals fondsen het melden. **Geldgewogen rendement** (XIRR) is je eigen rendement inclusief die timing: per jaar over dat jaar, over de hele periode als jaarrendement. Per positie en per rekening is het een jaarrendement als je die een jaar of langer hebt, anders het rendement over de looptijd.
- **Benchmark:** hetzelfde geld erin en eruit, maar belegd in MSCI World (IWDA), FTSE All-World (VWCE), S&P 500 (CSPX), goud of bitcoin. Deze fondsen herbeleggen dividend, dus hun koersrendement is hun hele rendement. De koersen van de benchmark worden bewaard als verborgen belegging.
- **Kosten** (_Performance → Costs_): transactie- en accountkosten, netwerk- en kluiskosten betaald in een belegging (tegen wat die stukken kostten), ingehouden dividendbelasting, opslag boven de spotprijs bij fysiek metaal, en de lopende kosten van fondsen, geschat als dagwaarde van het fonds × de TER ÷ 365. Vul de TER van een fonds (uit de factsheet) in onder _Assets_. Lopende kosten gaan van de koers van het fonds af en zitten dus al in je resultaten; het overzicht maakt ze alleen zichtbaar.
- **Verwachte dividenden** (_Income_): per positie het dividend per aandeel van de afgelopen 12 maanden (Yahoo), een jaar vooruitgeschoven, voor wat je nu hebt, tegen de wisselkoers van vandaag. De belasting wordt geschat met het percentage dat op die positie werkelijk is ingehouden, anders het gangbare percentage voor het land (NL en VS 15%, Ierse en Luxemburgse fondsen 0%).
- **Ingehouden belasting per land** (_Income_): per jaar en land (uit de ISIN), met wat het betekent voor je aangifte. Nederlandse dividendbelasting wordt helemaal verrekend, buitenlandse tot het verdragstarief; Amerikaanse belasting boven 15% betekent meestal dat je broker geen W-8BEN-formulier van je heeft.
- **Dagverandering** komt uit de 24-uursverandering van elke bron. Waar een bron die niet heeft (metalen), wordt ze afgeleid van de vorige opgeslagen slotkoers.

### Koersbronnen (gratis, zonder sleutels)

| Belegging        | Bron                                                           | Terugval                                                           |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Aandelen / ETF's | Yahoo Finance chart-API (koersen in GBp/ZAc worden omgerekend) | Tradegate op ISIN (EUR, omgerekend naar de valuta van de notering) |
| Crypto           | CoinGecko `simple/price` (EUR)                                 | Bitvavo's openbare ticker, daarna Yahoo `SYM-EUR`                  |
| Metalen          | gold-api.com spot (USD/oz → EUR/g)                             | Yahoo COMEX-futures (`GC=F`, `SI=F`, …)                            |
| Valuta           | ECB-referentiekoersen via Frankfurter                          | laatst bekende koers                                               |

Een terugvalbron wordt alleen gebruikt als de hoofdbron geen koers geeft, en alleen als die koers tussen de helft en het dubbele van de laatst bekende ligt (een token zonder bekende koers krijgt nooit een koers op symbool, want dat kan een andere munt zijn). _Settings → Prices_ toont wanneer dat gebeurde. Elke update bewaart de laatste koers, de slotkoers van vandaag in `price_history`, en een momentopname van je vermogen.

**Koersgeschiedenis** laadt dagelijkse slotkoersen in euro's voor elke belegging, van de eerste transactie tot vandaag: Yahoo (aandelen, ETF's, crypto-paren `SYM-EUR`), CoinGecko (crypto, de laatste 365 dagen, als terugval), Yahoo-futures voor metalen en ECB-koersen voor vreemde valuta. Het `SYM-EUR`-paar van Yahoo wordt voor een munt alleen gebruikt als de huidige koers tussen de helft en het dubbele van de eigen koers van die munt ligt, omdat een andere munt hetzelfde symbool kan hebben; anders komt de geschiedenis van CoinGecko. Het laden gebeurt 30 seconden na het opstarten, dagelijks, en een paar seconden nadat transacties veranderen of een synchronisatie klaar is. Elke belegging wordt één keer volledig geladen en daarna aangevuld. `POST /api/prices/backfill` dwingt een volledige controle af. Eén mislukte belegging houdt de rest niet tegen; mislukkingen staan op de pagina's Overview en Settings.

## Ontwikkelen

Bijdragen zijn welkom: lees [CONTRIBUTING.md](CONTRIBUTING.md). Je hebt Node 22 of nieuwer nodig. Zonder `DATABASE_URL` gebruikt de server een ingebouwde PostgreSQL (PGlite) in `server/.data/`, dus Docker is niet nodig.

```bash
npm install
echo "APP_SECRET=$(openssl rand -hex 32)" > server/.env
npm run dev:server            # API op :8080 (serveert ook web/dist als die gebouwd is)
npm run dev:web               # Vite op :5173, stuurt /api door naar :8080
```

| Opdracht                                           | Wat het doet                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                         | Unittests van de server (rekenwerk) en API-integratietests (PostgreSQL in het geheugen, nagebootste koers-API's)                                                                                              |
| `npm run typecheck`                                | TypeScript-controle van server en web                                                                                                                                                                         |
| `npm run lint` / `npm run format`                  | ESLint / Prettier                                                                                                                                                                                             |
| `npm run build`                                    | Bouwt de server naar `server/dist` en de web-app naar `web/dist`                                                                                                                                              |
| `npm run db:generate -w server`                    | Maakt een migratie na een wijziging in `server/src/db/schema.ts`                                                                                                                                              |
| `npm run dev:live -w server`                       | Een tweede instantie op `http://127.0.0.1:8081` met een eigen lege database, om echte API-sleutels en wallets uit te proberen zonder ze te mengen met voorbeeldgegevens. Verwijder `server/.data/live` daarna |
| `npx tsx scripts/bench.ts [schaal]` (in `server/`) | Meet de belangrijkste pagina's met een grote nagebootste geschiedenis (schaal 1 ≈ 20.000 transacties)                                                                                                         |

Voorbeeldgegevens: maak een gebruiker aan en voer dan `SESSION=<pd_session-cookie> npx tsx server/scripts/sample-data.ts` uit.

Uitgaven maken (voor beheerders): zie [docs/releasen.md](docs/releasen.md).

### Techniek en waarom

- **Fastify + TypeScript** (server): snel, past goed bij schema's, weinig overhead. Eén taal voor server en web-app.
- **PostgreSQL + Drizzle ORM**: `NUMERIC`-kolommen voor exacte bedragen en hoeveelheden (decimal.js in de code, nooit gewone getallen), getypte queries en gegenereerde SQL-migraties. PGlite draait dezelfde migraties in tests, bij het ontwikkelen en in de variant met één container.
- **React + Vite + Tailwind + TanStack Query + Recharts** (web): een responsieve app met een lichte en donkere weergave, geserveerd door dezelfde container.
- **Eén app-container** met een ingebouwde planner. Voor één gebruiker thuis zouden een aparte worker of wachtrij alleen maar onderdelen toevoegen.

### Beveiliging

- Wachtwoorden worden gehasht met argon2id. Sessies zijn willekeurige tokens van 256 bits, gehasht opgeslagen, in `HttpOnly; SameSite=Strict`-cookies.
- CSRF: elk API-verzoek dat iets verandert, moet de header `X-Requested-With: portfolio` hebben, die andere sites niet kunnen meesturen zonder een CORS-preflight die de server nooit toestaat.
- Inloggen, de eerste installatie en wachtwoord wijzigen zijn per IP-adres begrensd. De app vertrouwt `X-Forwarded-For` alleen als `TRUST_PROXY` is gezet, zodat een vervalste header de limiet niet omzeilt. Achter een reverse proxy zet je `TRUST_PROXY` (bijvoorbeeld `true`, of het IP-adres van de proxy). De eerste installatie is atomair: er kan maar één gebruiker worden aangemaakt. Wachtwoorden en cookies worden niet gelogd.
- CSV-exports maken cellen onschadelijk die anders als spreadsheetformule zouden draaien (bijvoorbeeld een token met de naam `=HYPERLINK(…)`).
- Elke toevoeging, wijziging en verwijdering wordt vastgelegd in `audit_log`, met de situatie ervoor en erna.
- Antwoorden hebben een strikte Content-Security-Policy (alleen scripts van de eigen site, niet in een frame te laden), `nosniff`, `no-referrer` en een beperkende Permissions-Policy. Met `COOKIE_SECURE=true` komt er HSTS bij.
- De app draait als gewone gebruiker, niet als root. Back-ups zijn alleen leesbaar voor de eigenaar, en back-upnamen worden gecontroleerd zodat verzoeken niet buiten de back-upmap kunnen komen.
- Kluishuis op het internet zetten raden we af; gebruik een VPN (zie [Toegang buitenshuis](#toegang-buitenshuis-vpn)). Doe je het toch, zet het dan achter een reverse proxy met HTTPS en zet `COOKIE_SECURE=true`.
- API-sleutels van beurzen worden versleuteld opgeslagen (AES-256-GCM, HKDF van de app-sleutel) en nooit teruggestuurd of gelogd. Verandert de app-sleutel, dan moet je ze opnieuw invoeren.
- Een kwetsbaarheid gevonden? Meld het privé: zie [SECURITY.md](SECURITY.md).

## Problemen oplossen

| Wat je ziet                                         | Wat je kunt doen                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Een gesynchroniseerde munt heeft de verkeerde koers | Na een synchronisatie toont _New assets added_ aan welke koersbron elke nieuwe munt gekoppeld is (bijvoorbeeld "LUNA → CoinGecko terra-luna-2"). Klopt dat niet, pas de belegging dan aan onder _Assets_ en vul de juiste CoinGecko-id in.                   |
| Een koers staat op "stale" of "no price yet"        | _Settings → Prices_ toont wat mislukte. Gratis API's begrenzen; koersen worden bij de volgende update opnieuw geprobeerd. Bij een verkeerde ticker: pas de belegging aan (_Assets_) en verbeter de Yahoo-ticker of CoinGecko-id.                             |
| De grafiek zegt "valued at cost"                    | De koersgeschiedenis wordt nog geladen (dat gebeurt op de achtergrond na wijzigingen), of er is geen gratis geschiedenis voor die belegging. `POST /api/prices/backfill` dwingt een nieuwe controle af.                                                      |
| Een koppeling of wallet toont verschillen in saldo  | Geschiedenis die de API niet laat zien (heel oude transacties, stakingverplaatsingen). Vul de geschiedenis aan, of gebruik _Adjust_ voor een correctiestorting of -opname.                                                                                   |
| "Stored credentials cannot be decrypted"            | De app-sleutel is veranderd (bijvoorbeeld een nieuw `app-data`-volume of een andere `APP_SECRET`). Zet de oude sleutel terug, of voer de API-sleutels opnieuw in.                                                                                            |
| De container is unhealthy                           | `docker compose logs app`. De gezondheidscontrole (`/api/health`) faalt ook als de database niet bereikbaar is.                                                                                                                                              |
| Pagina's zijn traag                                 | Zet `LOG_LEVEL=debug` en voer `docker compose up -d` uit; elk verzoek logt dan zijn `responseTime` in milliseconden (`docker compose logs app \| grep responseTime`). Zet het daarna terug op `info`.                                                        |
| De `db`-container herstart steeds na een update     | Het log noemt oude databases of onverenigbare databestanden: de hoofdversie van PostgreSQL is veranderd. Ga terug naar de vorige image-tag en volg [PostgreSQL upgraden](#postgresql-upgraden).                                                              |
| "The database … is in use by the running Kluishuis" | In de variant met één container kan de opdrachtregel geen back-up maken of terugzetten terwijl de app draait. Gebruik _Settings → Backups & export_, of stop eerst de app.                                                                                   |
| Buitengesloten                                      | Er is één gebruiker en geen herstel via e-mail. Zet een back-up terug, of wis de gebruiker in de database: `docker compose exec db psql -U kluishuis -c "delete from users"`, en open de app om de eerste installatie opnieuw te doen (je gegevens blijven). |

## Licentie

Kluishuis is vrije software onder de [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Je mag het gebruiken, bestuderen, aanpassen en verspreiden. Verspreid je een aangepaste versie, of laat je anderen die via een netwerk gebruiken, dan moet je hun de broncode van die versie aanbieden, onder dezelfde licentie. De app linkt daarom naar zijn eigen broncode (_Settings → About_). Er is geen garantie.

De naam "Kluishuis" valt niet onder de licentie: geef een aangepaste versie die je verspreidt een eigen naam.

## In English

Kluishuis is a self-hosted dashboard for Dutch investors: stocks and ETFs, crypto, and gold and silver, in euros, with an estimate of the Dutch wealth tax (box 3), including the actual-return rebuttal scheme and a preview of the system planned from 2028. It runs on your own NAS, home server or laptop with Docker (`docker compose up -d` with [`docker-compose.yml`](docker-compose.yml)), and your data never leaves it. The app's interface is English for now; the documentation is in Dutch. Contributions in English are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under the AGPL-3.0.
