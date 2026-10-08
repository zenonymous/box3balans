# Bijdragen aan Box3balans

Fijn dat je wilt helpen! Box3balans is een hobbyproject voor iedereen in Nederland die zijn beleggingen en box 3 zelf wil bijhouden, op eigen hardware. Bijdragen in het Nederlands of Engels zijn allebei welkom.

_In English: contributions in English are welcome too. Issues and pull requests may be written in either language._

## Waar je het meest mee helpt

- **Exportbestanden van je broker, bank of beurs.** Met een geanonimiseerd voorbeeld kan Box3balans een formaat leren lezen. Gebruik het formulier _Exportbestand van een broker, bank of beurs_ bij [Issues](../../issues/new/choose).
- **Fouten melden**, met de versie (linksonder in de app) en hoe je het kunt nadoen. Deel nooit echte bedragen, rekeningnummers, wallet-adressen of API-sleutels.
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

- **Geld en hoeveelheden** rekenen met `decimal.js` en worden in de database als `NUMERIC` opgeslagen, nooit als gewone getallen met afrondingsfouten.
- **Tests gebruiken geen internet.** Alle externe API's krijgen nep-antwoorden via `fakeFetch` in `server/test/helpers.ts`; een test die toch naar buiten gaat, faalt. Let op: `fakeFetch` kiest de **langste** passende URL, dus geef je eigen nep-antwoord de volledige host en het volledige pad als een standaardantwoord er ook op past.
- **Berekeningen krijgen een test met een uitgerekend voorbeeld**, met in een commentaar hoe je op het verwachte getal komt.
- **Belastingregels krijgen een bron** in `docs/box3-sources.md`: wat de regel is, waar het staat, en per wanneer het geldt. De cijfers zelf staan in `server/src/rules/box3.json`; een nieuw jaar komt erin zodra het Belastingplan is aangenomen, met `"final": false` tot de percentages voor banktegoeden en schulden definitief zijn (zie [docs/belastingregels.md](docs/belastingregels.md)).
- **Databasewijzigingen:** pas `server/src/db/schema.ts` aan en maak een migratie met `npm run db:generate -w server`. Migraties draaien automatisch bij het opstarten en moeten oude back-ups kunnen blijven terugzetten.
- **Teksten in de app** schrijf je in het Engels in `t("…")` (web) of `tr("…")` (server), met de Nederlandse vertaling in `web/src/i18n/nl.ts` of `server/src/i18n/nl.ts`. Gebruik de termen uit de aangifte (banktegoeden, overige bezittingen, schulden, peildatum, heffingsvrij vermogen). De tekst moet letterlijk tussen dubbele aanhalingstekens staan, zodat de test die op ontbrekende vertalingen controleert hem vindt; aantallen gaan met `tn()`/`trn()`. Houd teksten kort en concreet.
- **Privacy:** Box3balans stuurt niets naar de makers en verzamelt geen gebruiksgegevens. Nieuwe externe diensten alleen voor openbare gegevens (zoals koersen), en vermeld ze in de README.
- **Geen persoonlijke gegevens** in testbestanden, voorbeelden of screenshots.

## Licentie

Box3balans valt onder de [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Door een bijdrage in te sturen ga je ermee akkoord dat die onder dezelfde licentie valt.

## Omgang

Wees vriendelijk en geduldig, ook bij meningsverschillen. Iedereen doet dit in zijn vrije tijd.
