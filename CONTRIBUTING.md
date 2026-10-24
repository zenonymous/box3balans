# Bijdragen aan Box3balans

Fijn dat je wilt helpen! Box3balans is een hobbyproject voor iedereen in Nederland die zijn beleggingen en box 3 zelf wil bijhouden, op eigen hardware. Bijdragen in het Nederlands of Engels zijn allebei welkom.

**Een vraag?** Stel die bij [Discussions](https://github.com/zenonymous/box3balans/discussions/categories/q-a), niet als issue: issues zijn voor fouten, exportformaten en concrete voorstellen. Een los idee bespreek je eerst bij [Ideas](https://github.com/zenonymous/box3balans/discussions/categories/ideas).

_English: [CONTRIBUTING.en.md](CONTRIBUTING.en.md)_

## Waar je het meest mee helpt

- **Het formaat van je export of jaaroverzicht.** Kent Box3balans de CSV van je broker, bank of beurs of je jaaroverzicht (pdf) nog niet, kies dan in de app _Help anderen dit bestand in te lezen_ (of _… dit overzicht …_). Box3balans maakt een bestand met verzonnen gegevens in de opmaak van het jouwe; je ziet wat erin staat en deelt het met het formulier _Formaat delen_ bij [Issues](https://github.com/zenonymous/box3balans/issues/new/choose). Zie [Je formaat delen](docs/importeren.md#je-formaat-delen). Zelf een geanonimiseerd voorbeeld sturen kan ook, met de formulieren _Exportbestand van een broker, bank of beurs_ en _Jaaroverzicht (pdf) van een aanbieder_; stuur nooit de pdf zelf.
- **Fouten melden**, met de versie (linksonder in de app) en hoe je het kunt nadoen. Deel nooit echte bedragen, rekeningnummers, wallet-adressen of API-sleutels. Een beveiligingsprobleem meld je privé, niet als issue: zie [SECURITY.md](SECURITY.md#een-kwetsbaarheid-melden).
- **Belastingregels controleren.** Klopt een berekening niet met wat de Belastingdienst zegt? Meld het met een link naar de bron. De regels en hun bronnen staan in [`docs/box3-sources.md`](docs/box3-sources.md), de cijfers in [`server/src/rules/box3.json`](server/src/rules/box3.json).
- **Code.** Kijk in de [roadmap](docs/ROADMAP.md) wat er gepland is. Open voor grotere wijzigingen eerst een issue, zodat we de aanpak kunnen afstemmen voordat je er veel tijd in steekt.

## Ontwikkelomgeving

Je hebt Node.js 22 of nieuwer nodig; Docker is niet nodig. Zonder `DATABASE_URL` gebruikt de server een ingebouwde PostgreSQL (PGlite) in `server/.data/`.

```bash
npm install
echo "APP_SECRET=$(openssl rand -hex 32)" > server/.env
npm run dev:server     # API op http://localhost:8080 (serveert ook web/dist als die gebouwd is)
npm run dev:web        # Vite op http://localhost:5173, stuurt /api door naar :8080
```

Maak in de app een gebruiker aan. Voorbeeldgegevens laad je met `SESSION=<waarde van de pd_session-cookie> npx tsx server/scripts/sample-data.ts`.

## Voor je een pull request opent

**Een pull request wordt geaccepteerd als:**

1. de GitHub-workflow slaagt (opmaak, ESLint, typecontrole, tests, ShellCheck, actionlint en het Docker-image), en nieuwe of gewijzigde berekeningen een test met een uitgerekend voorbeeld hebben;
2. hij de [afspraken](#afspraken) hieronder volgt, en past bij de bewuste keuzes in [docs/adr/](docs/adr/) (of er eerst een issue over was);
3. er geen persoonlijke gegevens in staan, en je akkoord gaat met de [licentie](#licentie).

`npm install` zet ook git-hooks klaar (Husky). Vóór elke commit worden de gewijzigde bestanden opgemaakt (Prettier) en gecontroleerd (ESLint, met type-informatie), en draait de typecontrole: samen een paar seconden. Vóór elke push draaien de tests, ongeveer een halve minuut. Moet het in een noodgeval toch, sla ze dan over met `--no-verify`; de GitHub-workflow controleert alles opnieuw.

Alles zelf in één keer draaien:

```bash
npm run lint
npm run typecheck
npm test
npx prettier --check .    # of: npm run format
```

De GitHub-workflow doet hetzelfde, controleert de shell-scripts met ShellCheck en de workflow zelf met actionlint, en bouwt daarna het Docker-image. Heb je ShellCheck en actionlint geïnstalleerd (bijvoorbeeld `brew install shellcheck actionlint`), dan draai je die twee met `npm run lint:scripts`.

Verandert de app zichtbaar? Maak de screenshots in de README dan opnieuw: start de demo (`npm run demo`) en draai `npm run screenshots`. Dat vraagt Chrome, Chromium, Brave of Edge.

## Afspraken

- **Begrippen en beslissingen:** de woorden die de app en de code gebruiken, met hun betekenis, staan in [CONTEXT.md](CONTEXT.md). Keuzes die bewust zo zijn gemaakt (en waarom) staan in [docs/adr/](docs/adr/). Wil je daarvan afwijken, begin dan met een issue.

- **Documentatie in twee talen:** elk Markdown-document heeft een Nederlandse en een Engelse versie (`README.md` en `README.en.md`, `docs/x.md` en `docs/en/x.md`). Pas ze allebei aan; schrijf je maar één taal, zeg dat dan in de pull request, dan wordt de andere aangevuld. `test/docs-english.test.ts` controleert dat elk Nederlands document een Engelse versie heeft.
- **Geld en hoeveelheden** rekenen met `decimal.js` en worden in de database als `NUMERIC` opgeslagen, nooit als gewone getallen met afrondingsfouten.
- **Tests gebruiken geen internet.** Alle externe API's krijgen nep-antwoorden via `fakeFetch` in `server/test/helpers.ts`; een test die toch naar buiten gaat, faalt. Let op: `fakeFetch` kiest de **langste** passende URL, dus geef je eigen nep-antwoord de volledige host en het volledige pad als een standaardantwoord er ook op past.
- **Berekeningen krijgen een test met een uitgerekend voorbeeld**, met in een commentaar hoe je op het verwachte getal komt.
- **Tests werken op elke dag van het jaar.** Reken data in een test vanaf vandaag (`daysAgo(100)`), en kies ze zo dat ze niet op een maand- of jaargrens vallen. `scripts/test-dates.sh` draait de servertests alsof het een paar lastige momenten is (oud en nieuw, de eerste en laatste dag van een maand, de zomertijd, een schrikkeldag), in UTC en in Nederlandse tijd. Draai het na een wijziging die met datums rekent.
- **Paginatests** (`web/src/pages/*.dom.test.tsx`, met Testing Library en happy-dom) controleren wat een pagina zegt bij een vast antwoord van de server: de antwoorden van het demohuishouden staan in `web/src/test/*.fixture.json` (opnieuw te halen uit `web/dist-demo/data/nl/` na `npm run build:online-demo`). Rekenwerk hoort op de server, niet in de pagina.
- **Pagina's bekijken na een wijziging in de interface.** `npm run check:pages` opent met de demo (`npm run demo`) elke pagina op een telefoon en een computerscherm, licht en donker, en meldt fouten in de console, een pagina die zijwaarts scrollt en tekst die buiten zijn kaart valt of wordt afgesneden. Met paden erachter (`npm run check:pages -- / /holdings`) alleen die pagina's.
- **Belastingregels krijgen een bron** in `docs/box3-sources.md`: wat de regel is, waar het staat, en per wanneer het geldt. De cijfers zelf staan in `server/src/rules/box3.json`; een nieuw jaar komt erin zodra het Belastingplan is aangenomen, met `"final": false` tot de percentages voor banktegoeden en schulden definitief zijn (zie [docs/belastingregels.md](docs/belastingregels.md)).
- **Sjablonen voor jaaroverzichten** staan in `server/src/import/yearStatement.ts` (`TEMPLATES`), elk met een test op een tekstvoorbeeld met verzonnen gegevens. Een sjabloon herkent het document aan vaste teksten en zegt per waarde achter welk label het bedrag staat.
- **Gedeelde formaten** (een bestand uit _Formaat delen_) zijn data: een JSON-bestand in `server/src/import/formats/shared/`, geen code. Lees een bijdrage helemaal voordat je hem toevoegt; de stappen staan in [de README daar](server/src/import/formats/shared/README.md), en `test/shared-formats.test.ts` controleert elk bestand. Een jaaroverzicht uit _Formaat delen_ wordt een sjabloon zoals hierboven, met de gedeelde tekst als test.
- **Databasewijzigingen:** pas `server/src/db/schema.ts` aan en maak een migratie met `npm run db:generate -w server`. Migraties draaien automatisch bij het opstarten en moeten oude back-ups kunnen blijven terugzetten.
- **Teksten in de app** schrijf je in het Engels in `t("…")` (web) of `tr("…")` (server), met de Nederlandse vertaling in `web/src/i18n/nl.ts` of `server/src/i18n/nl.ts`. Gebruik de termen uit de aangifte (banktegoeden, overige bezittingen, schulden, peildatum, heffingsvrij vermogen). De tekst moet letterlijk tussen dubbele aanhalingstekens staan, zodat de test die op ontbrekende vertalingen controleert hem vindt; aantallen gaan met `tn()`/`trn()`. Houd teksten kort en concreet.
- **Privacy:** Box3balans stuurt niets naar de makers en verzamelt geen gebruiksgegevens. Nieuwe externe diensten alleen voor openbare gegevens (zoals koersen), en vermeld ze in de README.
- **Geen persoonlijke gegevens** in testbestanden, voorbeelden of screenshots.

## Licentie

Box3balans valt onder de [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Door een bijdrage in te sturen ga je ermee akkoord dat die onder dezelfde licentie valt.

## Omgang

Wees vriendelijk en geduldig, ook bij meningsverschillen. Iedereen doet dit in zijn vrije tijd.
