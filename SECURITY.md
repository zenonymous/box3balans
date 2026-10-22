# Beveiliging

Box3balans bewaart financiële gegevens en API-sleutels van beurzen. Beveiligingsproblemen nemen we daarom serieus.

## Een kwetsbaarheid melden

Meld een kwetsbaarheid **privé**, niet in een openbaar issue of in Discussions:

1. Open het meldformulier met [**Report a vulnerability**](https://github.com/zenonymous/box3balans/security/advisories/new). Je kunt het ook vinden op het tabblad **Security and quality** van deze repository (op een smal scherm onder **⋯**): kies daar **Report a vulnerability**. Je hebt een GitHub-account nodig.
2. Beschrijf:
   - wat er mis is;
   - hoe je het kunt nadoen;
   - wat iemand ermee kan;
   - welke versie je gebruikt (linksonder in de app).

Alleen jij en de beheerder zien de melding. Je krijgt zo snel mogelijk een reactie; Box3balans is een hobbyproject, dus dat kan een paar dagen duren. We houden je op de hoogte van de oplossing. Wil je meehelpen, dan kan dat in de melding zelf: GitHub biedt daar een tijdelijke privé-fork. De oplossing komt in een nieuwe uitgave, met in de release notes en in een security advisory wat er was. We noemen je daar graag bij naam, als je dat wilt.

Houd het voor je tot de uitgave met de oplossing er is, of tot een datum die we samen afspreken.

_In English: please report vulnerabilities privately, not in a public issue, with [**Report a vulnerability**](https://github.com/zenonymous/box3balans/security/advisories/new) (or the **Security and quality** tab → **Report a vulnerability**; you need a GitHub account). Describe what is wrong, how to reproduce it, its impact and the version (bottom left in the app). Please keep it private until a release with the fix is out._

## Welke versies

Oplossingen komen in de nieuwste uitgave. Werk bij met `docker compose pull && docker compose up -d`.

## Images controleren

De images op `ghcr.io/zenonymous/box3balans` worden gebouwd door de workflow **CI** in deze repository. Vanaf versie 0.1.9 ondertekent die workflow ze met [cosign](https://docs.sigstore.dev/), zonder sleutel: de handtekening is gekoppeld aan de identiteit van die workflow bij GitHub. Zo controleer je dat een image echt van hier komt en onderweg niet is veranderd:

```bash
cosign verify ghcr.io/zenonymous/box3balans:latest \
  --certificate-identity-regexp '^https://github\.com/zenonymous/box3balans/\.github/workflows/ci\.yml@refs/(tags/v|heads/main)' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Die images hebben ook een lijst van alles wat erin zit (een SBOM in SPDX-formaat) en een beschrijving van hoe ze zijn gebouwd (provenance). Bekijken kan met Docker:

```bash
docker buildx imagetools inspect ghcr.io/zenonymous/box3balans:latest --format '{{ json (index .SBOM "linux/amd64").SPDX }}'
```

## Downloads controleren

Elke release heeft vanaf 0.1.28 ook downloadbare bestanden: de broncode (`box3balans-<versie>-source.tar.gz`), de lijst van afhankelijkheden (`box3balans-<versie>.spdx.json`) en `SHA256SUMS`, elk met een handtekening (`….sigstore.json`) van de workflow **Release files**, zonder sleutel, net als bij de images. Zo controleer je er een:

```bash
cosign verify-blob box3balans-0.1.33-source.tar.gz \
  --bundle box3balans-0.1.33-source.tar.gz.sigstore.json \
  --certificate-identity-regexp '^https://github\.com/zenonymous/box3balans/\.github/workflows/release-files\.yml@refs/(tags/v|heads/main)' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
sha256sum -c SHA256SUMS
```

## Veilig gebruik

- Box3balans maakt alleen verbinding met een vaste lijst van adressen en verstuurt nooit bedragen; zie [Wat Box3balans verstuurt](docs/privacy.md) en _Instellingen → Netwerk_. Wil je dat ook op netwerkniveau afgedwongen, gebruik dan de [afgeschermde opzet](docs/privacy.md#afgeschermd-draaien). De CI controleert bij elke wijziging dat het image alleen adressen van de lijst benadert, en onder _Instellingen → Netwerk_ zet je functies uit, tot helemaal offline.
- Een nieuwe installatie neemt de eerste gebruiker alleen aan met de **setupcode** uit het log van de app, zodat niemand anders op je netwerk hem kan overnemen.
- Zet Box3balans **niet open naar het internet**. Gebruik voor toegang buitenshuis een VPN zoals WireGuard of Tailscale (zie de README).
- Geef API-sleutels van beurzen en brokers **alleen leesrechten**. De verbindingsdialoog vertelt per aanbieder welke rechten nodig zijn.
- Zet `BACKUP_PASSPHRASE`, zodat back-ups versleuteld zijn voordat ze ergens anders terechtkomen.
- Zet **tweestapsverificatie** aan (_Instellingen_) en bewaar de herstelcodes buiten de server.
- Bewaar de app-sleutel (`/data/app-secret`, of je eigen `APP_SECRET`) in je wachtwoordmanager: zonder kun je API-sleutels en tweestapsverificatie na een verhuizing niet meer lezen.
- Wil je weten wanneer er een beveiligingsoplossing is, zet dan _Instellingen → Over → Controleren op nieuwe versies_ aan, of volg de releases op GitHub.
