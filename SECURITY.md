# Beveiliging

Box3balans bewaart financiële gegevens en API-sleutels van beurzen. Beveiligingsproblemen nemen we daarom serieus.

## Een kwetsbaarheid melden

Meld een kwetsbaarheid **privé**, niet in een openbaar issue: ga naar het tabblad **Security** van deze repository en kies **Report a vulnerability**. Beschrijf wat er mis is, hoe je het kunt nadoen en welke versie je gebruikt.

Je krijgt zo snel mogelijk een reactie. Box3balans is een hobbyproject, dus dat kan een paar dagen duren. We houden je op de hoogte van de oplossing en noemen je graag bij naam in de release notes, als je dat wilt.

_In English: please report vulnerabilities privately via **Security → Report a vulnerability**, not in a public issue._

## Welke versies

Oplossingen komen in de nieuwste uitgave. Werk bij met `docker compose pull && docker compose up -d`.

## Veilig gebruik

- Zet Box3balans **niet open naar het internet**. Gebruik voor toegang buitenshuis een VPN zoals WireGuard of Tailscale (zie de README).
- Geef API-sleutels van beurzen en brokers **alleen leesrechten**. De verbindingsdialoog vertelt per aanbieder welke rechten nodig zijn.
- Zet `BACKUP_PASSPHRASE`, zodat back-ups versleuteld zijn voordat ze ergens anders terechtkomen.
- Zet **tweestapsverificatie** aan (_Instellingen_) en bewaar de herstelcodes buiten de server.
- Bewaar de app-sleutel (`/data/app-secret`, of je eigen `APP_SECRET`) in je wachtwoordmanager: zonder kun je API-sleutels en tweestapsverificatie na een verhuizing niet meer lezen.
- Wil je weten wanneer er een beveiligingsoplossing is, zet dan _Instellingen → Over → Controleren op nieuwe versies_ aan, of volg de releases op GitHub.
