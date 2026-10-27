# Beveiligingsonderbouwing (assurance case)

_English: [en/beveiligingsonderbouwing.md](en/beveiligingsonderbouwing.md)_

Waarom Box3balans doet wat het op het gebied van beveiliging belooft: wat het moet beschermen, tegen wie, waar de grenzen van vertrouwen liggen, welke ontwerpprincipes het volgt en hoe het de bekende soorten fouten tegengaat. Ook wat het niet doet. Hoe het in elkaar zit, staat in [architectuur.md](architectuur.md); een kwetsbaarheid melden gaat via [SECURITY.md](../SECURITY.md).

## Wat het belooft (beveiligingseisen)

1. **Je financiële gegevens blijven bij jou.** Bedragen, saldi en transacties verlaten de server niet; wat wel naar buiten gaat (symbolen, ISIN's, wallet-adressen, verzoeken met je eigen sleutel), staat in [privacy.md](privacy.md) en is in de app te zien en uit te zetten.
2. **Alleen jij komt erin.** Eén gebruiker, met een sterk wachtwoord en desgewenst tweestapsverificatie; een nieuwe installatie neemt de eerste gebruiker alleen aan met de setupcode uit het log.
3. **Sleutels van beurzen zijn beschermd.** Versleuteld opgeslagen, nooit teruggestuurd of gelogd, en bij voorkeur met alleen leesrechten (Coinbase wordt daarop gecontroleerd).
4. **Back-ups zijn zonder de wachtzin onleesbaar**, en terugzetten gebeurt helemaal of niet.
5. **Een uitgave is te controleren:** het image en de bestanden zijn ondertekend en komen aantoonbaar uit deze broncode.

## Wat er te beschermen valt

- Het financiële overzicht van een huishouden: bezit, schulden, transacties, namen en geboortedata van gezinsleden.
- API-sleutels van beurzen en brokers, en het geheim van de tweestapsverificatie.
- Het wachtwoord, sessies en herstelcodes.
- De back-ups, en de app-sleutel en wachtzin die erbij horen.
- De integriteit van de berekening: een verkeerde box 3 is ook schade.

## Dreigingsmodel

| Wie                                                                 | Wat die zou willen of kunnen                                                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Iemand op hetzelfde netwerk (huisgenoot, gast, besmet apparaat)     | Inloggen, een nieuwe installatie overnemen, verkeer meelezen.                                                                 |
| Een website die je bezoekt                                          | Via je browser verzoeken naar Box3balans sturen (CSRF), of via DNS-rebinding de eerste gebruiker aanmaken.                    |
| Een kwaadaardig bestand (een CSV, bankexport of pdf-tekst)          | Code laten uitvoeren, bestanden buiten de bedoelde map lezen, of een spreadsheet laten rekenen bij het openen van een export. |
| Een koersbron, blockchainverkenner of beurs (of wie daartussen zit) | Afleiden wat je bezit, of foute gegevens terugsturen.                                                                         |
| Een kwetsbare of kwaadaardige afhankelijkheid                       | Gegevens naar buiten sturen of code uitvoeren in de server.                                                                   |
| Iemand met een kopie van een back-up                                | Je gegevens lezen.                                                                                                            |
| Iemand met toegang tot de server of de schijf                       | Alles: daartegen beschermt de app niet volledig (zie _Wat het niet doet_).                                                    |
| Iemand die een vervalste uitgave verspreidt                         | Je een aangepast image laten draaien.                                                                                         |

## Vertrouwensgrenzen

1. **Browser ↔ server.** Alles wat de browser stuurt, is onbetrouwbaar: de server controleert sessie, CSRF-header en invoer bij elk verzoek.
2. **Server ↔ internet.** Uitgaand alleen via `fetch`, alleen HTTPS, alleen naar de vaste lijst in `server/src/lib/net.ts`, ook bij doorverwijzingen. Antwoorden van buiten zijn onbetrouwbaar en worden gecontroleerd voordat ze iets veranderen.
3. **Bestanden die je inleest.** Onbetrouwbaar: ze worden als tekst gelezen, nooit uitgevoerd, en pas opgeslagen nadat je het voorbeeld hebt gezien.
4. **Server ↔ database.** Vertrouwd, maar alleen via geparametriseerde queries (Drizzle); de database heeft geen poort naar buiten.
5. **Server ↔ schijf.** De app-sleutel, wachtzin en back-ups staan in eigen mappen, alleen leesbaar voor de app-gebruiker; back-upnamen worden gecontroleerd.
6. **De opdrachtregel in de container** (`docker compose exec`) is vertrouwd: wie die heeft, heeft de server al.
7. **De bouwstraat** (GitHub Actions) maakt en ondertekent de uitgaven; wat erin gaat, is vastgezet op versies.

## Ontwerpprincipes, en hoe ze zijn toegepast

Volgens Saltzer en Schroeder:

- **Eenvoud van mechanisme:** één proces, één gebruiker, één database, geen accounts voor anderen ([ADR 0001](adr/0001-zelf-hosten.md)); de uitgaande verbindingen staan op één lijst in één bestand.
- **Veilige standaard:** back-ups versleuteld, controle op nieuwe versies uit, tweestapsverificatie aan te zetten, koppelingen alleen met leesrechten aangeraden; een onbekend adres wordt geweigerd, een onbekende munt krijgt geen gegokte koers ([ADR 0004](adr/0004-koersgeschiedenis-alleen-met-zekerheid.md)).
- **Volledige controle:** elk API-verzoek gaat door dezelfde haak in `app.ts` (sessie, CSRF-header, publieke routes op een vaste lijst); elke `fetch` door dezelfde netwerkcontrole.
- **Open ontwerp:** de broncode, de lijst van bestemmingen en deze onderbouwing zijn openbaar; de beveiliging hangt niet af van geheimhouding van het ontwerp.
- **Scheiding van bevoegdheden:** inloggen kan met wachtwoord plus een code uit een authenticator-app; tweestapsverificatie uitzetten vraagt beide.
- **Minste rechten:** de app draait als gewone gebruiker in de container; sleutels van beurzen met alleen leesrechten; de browser mag alleen met de eigen server praten (CSP `connect-src 'self'`).
- **Zo weinig mogelijk gedeeld:** geen gedeelde dienst of cloud; elke installatie staat los.
- **Psychologische aanvaardbaarheid:** de app legt per koppeling uit welke rechten nodig zijn, toont wat er naar buiten ging, en herinnert je aan de wachtzin.

## Bekende soorten fouten, en hoe ze worden tegengegaan

| Soort (OWASP / CWE)                                   | Tegenmaatregel                                                                                                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Injectie (SQL, CWE-89)                                | Alleen Drizzle met parameters; SQL wordt nooit als tekst uit invoer samengesteld ([ADR 0006](adr/0006-databasegebruiker-blijft-superuser.md)).                                                                        |
| Cross-site scripting (CWE-79)                         | React escapet alle tekst; een strikte Content-Security-Policy (alleen scripts van de eigen site).                                                                                                                     |
| Cross-site request forgery (CWE-352)                  | Elk verzoek dat iets verandert, vraagt de header `X-Requested-With: portfolio` (die een andere site niet zonder CORS-preflight kan meesturen); sessiecookies zijn `SameSite=Strict` en `HttpOnly`.                    |
| Zwakke authenticatie (CWE-287, CWE-307)               | argon2id; rate limits op inloggen, installatie en wachtwoordwijziging; na vijf foute codes een oplopende pauze; sessies als willekeurige tokens, gehasht opgeslagen; bij een nieuw wachtwoord vervallen alle sessies. |
| Ontbrekende toegangscontrole (CWE-862)                | Alle routes onder `/api/` vragen een sessie, behalve een vaste lijst publieke routes; er is één gebruiker, dus geen rechten tussen gebruikers.                                                                        |
| Gevoelige gegevens blootgesteld (CWE-200, CWE-312)    | API-sleutels en het TOTP-geheim versleuteld (AES-256-GCM, HKDF van de app-sleutel); back-ups versleuteld (AES-256-GCM, scrypt); wachtwoorden, cookies en sleutels worden niet gelogd.                                 |
| Server-side request forgery (CWE-918)                 | Uitgaand alleen naar de vaste lijst, ook na een doorverwijzing; een lintregel verbiedt andere manieren om verbinding te maken; CI faalt bij een verbinding met een adres dat niet op de lijst staat.                  |
| Path traversal (CWE-22)                               | Back-upnamen moeten precies het patroon van de app volgen voordat er een pad van wordt gemaakt.                                                                                                                       |
| Onveilige deserialisatie / XXE (CWE-502, CWE-611)     | Alleen JSON, gecontroleerd met zod; XML (CAMT.053) met fast-xml-parser, dat geen externe entiteiten ophaalt of leest.                                                                                                 |
| Formule-injectie in CSV-exports (CWE-1236)            | Cellen die als formule zouden starten, worden onschadelijk gemaakt.                                                                                                                                                   |
| Zwakke cryptografie (CWE-327)                         | Alleen gangbare algoritmen (argon2id, AES-256-GCM, scrypt, HKDF, SHA-256); uitgaand alleen TLS met certificaatcontrole.                                                                                               |
| Kwetsbare of kwaadaardige afhankelijkheden (CWE-1395) | Lockfile; nieuwe versies pas na twee weken; Dependabot en `npm audit`; workflows vastgezet op commit; OpenSSF Scorecard; de netwerkcontrole houdt ook een afhankelijkheid die `fetch` gebruikt binnen de lijst.       |
| Vervalste uitgaven                                    | Images en bestanden ondertekend met Sigstore (cosign), met SBOM en SLSA-provenance; controleren staat in [SECURITY.md](../SECURITY.md).                                                                               |

## Hoe dit wordt bewaakt

- **Tests** voor de beveiligingseigenschappen: de netwerkcontrole (geen adres buiten de lijst, ook niet in de code), de CSRF-controle, de inlog- en tweestapsverificatieregels, versleuteling en terugzetten van back-ups, de setupcode, back-upnamen. Een test die het internet op gaat, faalt.
- **Statische analyse:** CodeQL (beveiligingsregels) en ESLint met type-informatie bij elke wijziging.
- **CI** draait het image in een afgeschermde opzet en faalt bij een verbinding met een adres dat niet op de lijst staat.
- **Beoordelingen:** twee beveiligingsaudits (oktober 2026) en een beveiligingsreview van de server bij uitgaven die daar iets aan veranderen.

## Wat het niet doet (restrisico's)

- **Toegang tot de server is toegang tot alles.** Wie de server of de schijf heeft, kan met de app-sleutel de opgeslagen API-sleutels lezen. Daarom het advies: sleutels met alleen leesrechten, en de app-sleutel buiten de server bewaren.
- **De app spreekt zelf HTTP**, bedoeld achter een VPN of een reverse proxy met HTTPS. Zet hem niet open naar het internet; met `COOKIE_SECURE=true` komt er HSTS bij.
- **Geen lijst met toegestane hostnamen** tegen DNS-rebinding; de setupcode dekt het moment waarop dat ertoe deed ([ADR 0007](adr/0007-dns-rebinding-alleen-gedocumenteerd.md)).
- **De databasegebruiker is superuser** ([ADR 0006](adr/0006-databasegebruiker-blijft-superuser.md)); de verdediging zit in de geparametriseerde queries.
- **Verbindingen buiten `fetch` om** (door een afhankelijkheid) houdt alleen de [afgeschermde opzet](privacy.md#afgeschermd-draaien) tegen, op netwerkniveau.
- **Eén beheerder, veel AI-hulp.** Het grootste deel van de code is met een AI-assistent geschreven en door de beheerder nagekeken (zie de [README](../README.md#gebouwd-met-ai-hulp)); de tests, statische analyse en reviews hierboven gelden er net zo voor.
