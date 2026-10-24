# Beveiliging

_English: [below](#security-in-english)._

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

Vanaf 0.1.32 staat er ook een beschrijving bij van hoe en waaruit de bestanden zijn gebouwd (_provenance_ volgens SLSA): `box3balans-<versie>.intoto.jsonl`, ondertekend met Sigstore en ook bewaard bij GitHub. Met de [GitHub CLI](https://cli.github.com/) controleer je die zo:

```bash
gh attestation verify box3balans-0.1.36-source.tar.gz --repo zenonymous/box3balans
```

## Veilig gebruik

- Box3balans maakt alleen verbinding met een vaste lijst van adressen en verstuurt nooit bedragen; zie [Wat Box3balans verstuurt](docs/privacy.md) en _Instellingen → Netwerk_. Wil je dat ook op netwerkniveau afgedwongen, gebruik dan de [afgeschermde opzet](docs/privacy.md#afgeschermd-draaien). De CI controleert bij elke wijziging dat het image alleen adressen van de lijst benadert, en onder _Instellingen → Netwerk_ zet je functies uit, tot helemaal offline.
- Een nieuwe installatie neemt de eerste gebruiker alleen aan met de **setupcode** uit het log van de app, zodat niemand anders op je netwerk hem kan overnemen.
- Zet Box3balans **niet open naar het internet**. Gebruik voor toegang buitenshuis een VPN zoals WireGuard of Tailscale (zie de README).
- Geef API-sleutels van beurzen en brokers **alleen leesrechten**. De verbindingsdialoog vertelt per aanbieder welke rechten nodig zijn.
- Back-ups zijn versleuteld voordat ze ergens anders terechtkomen. Zet de wachtzin (_Instellingen → Back-ups_, of je eigen `BACKUP_PASSPHRASE`) in je wachtwoordmanager.
- Zet **tweestapsverificatie** aan (_Instellingen_) en bewaar de herstelcodes buiten de server.
- Bewaar de app-sleutel (`/data/app-secret`, of je eigen `APP_SECRET`) in je wachtwoordmanager: zonder kun je API-sleutels en tweestapsverificatie na een verhuizing niet meer lezen.
- Wil je weten wanneer er een beveiligingsoplossing is, zet dan _Instellingen → Over → Controleren op nieuwe versies_ aan, of volg de releases op GitHub.

---

# Security (in English)

Box3balans stores financial data and exchange API keys, so we take security problems seriously.

## Reporting a vulnerability

Report a vulnerability **privately**, not in a public issue or in Discussions:

1. Open the report form with [**Report a vulnerability**](https://github.com/zenonymous/box3balans/security/advisories/new). You can also find it on this repository's **Security and quality** tab (on a narrow screen under **⋯**): choose **Report a vulnerability** there. You need a GitHub account.
2. Describe:
   - what is wrong;
   - how to reproduce it;
   - what someone could do with it;
   - which version you use (bottom left in the app).

Only you and the maintainer see the report. You'll get a reply as soon as possible; Box3balans is a hobby project, so that can take a few days. We'll keep you posted on the fix. If you'd like to help, you can do so in the report itself: GitHub offers a temporary private fork there. The fix comes in a new release, with what was wrong in the release notes and in a security advisory. We're glad to credit you by name there, if you want.

Please keep it to yourself until the release with the fix is out, or until a date we agree on together.

## Supported versions

Fixes go into the latest release. Update with `docker compose pull && docker compose up -d`.

## Verifying images

The images at `ghcr.io/zenonymous/box3balans` are built by the **CI** workflow in this repository. Since version 0.1.9 that workflow signs them with [cosign](https://docs.sigstore.dev/), keyless: the signature is tied to that workflow's identity at GitHub. This checks that an image really comes from here and wasn't changed on the way:

```bash
cosign verify ghcr.io/zenonymous/box3balans:latest \
  --certificate-identity-regexp '^https://github\.com/zenonymous/box3balans/\.github/workflows/ci\.yml@refs/(tags/v|heads/main)' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The images also carry a list of everything in them (an SBOM in SPDX format) and a description of how they were built (provenance). You can view them with Docker:

```bash
docker buildx imagetools inspect ghcr.io/zenonymous/box3balans:latest --format '{{ json (index .SBOM "linux/amd64").SPDX }}'
```

## Verifying downloads

Since 0.1.28 every release also has downloadable files: the source code (`box3balans-<version>-source.tar.gz`), the list of dependencies (`box3balans-<version>.spdx.json`) and `SHA256SUMS`, each with a signature (`….sigstore.json`) from the **Release files** workflow, keyless, just like the images. To check one:

```bash
cosign verify-blob box3balans-0.1.33-source.tar.gz \
  --bundle box3balans-0.1.33-source.tar.gz.sigstore.json \
  --certificate-identity-regexp '^https://github\.com/zenonymous/box3balans/\.github/workflows/release-files\.yml@refs/(tags/v|heads/main)' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
sha256sum -c SHA256SUMS
```

Since 0.1.32 there's also a description of how and from what the files were built (SLSA _provenance_): `box3balans-<version>.intoto.jsonl`, signed with Sigstore and also kept at GitHub. With the [GitHub CLI](https://cli.github.com/) you check it like this:

```bash
gh attestation verify box3balans-0.1.36-source.tar.gz --repo zenonymous/box3balans
```

## Using it safely

- Box3balans only connects to a fixed list of hosts and never sends amounts; see [What Box3balans sends](docs/en/privacy.md) and _Settings → Network_. To enforce that at network level too, use the [sealed-off setup](docs/en/privacy.md#running-it-sealed-off). CI checks on every change that the image only contacts hosts on the list, and under _Settings → Network_ you can switch features off, down to fully offline.
- A new installation only accepts its first user with the **setup code** from the app's log, so nobody else on your network can claim it.
- **Don't expose Box3balans to the internet.** For access away from home, use a VPN such as WireGuard or Tailscale (see the README).
- Give exchange and broker API keys **read-only permissions**. The connection dialog tells you per provider which permissions are needed.
- Backups are encrypted before they end up anywhere else. Put the passphrase (_Settings → Backups_, or your own `BACKUP_PASSPHRASE`) in your password manager.
- Turn on **two-step verification** (_Settings_) and keep the recovery codes off the server.
- Keep the app key (`/data/app-secret`, or your own `APP_SECRET`) in your password manager: without it you can't read API keys and two-step verification after a move.
- To hear when there's a security fix, turn on _Settings → About → Check for new versions_, or watch the releases on GitHub.
