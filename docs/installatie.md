# Box3balans installeren

Box3balans draait in Docker. Hieronder per systeem hoe je het installeert. Overal geldt hetzelfde idee:

1. Een map met daarin [`docker-compose.yml`](../docker-compose.yml), en eventueel een `.env` met je instellingen ([`.env.example`](../.env.example) laat zien wat kan).
2. `docker compose up -d`, of het equivalent in de app van je NAS.
3. Open `http://<adres-van-je-server>:8080` en maak je gebruiker aan. _Aan de slag_ helpt je daarna op weg; zet onder _Instellingen_ ook tweestapsverificatie aan.

Wil je eerst rondkijken zonder iets in te stellen? Start de demo: `docker run --rm -p 8080:8080 -e DEMO=true ghcr.io/zenonymous/box3balans:latest`.

Kies bij twijfel de **standaardopstelling** (`docker-compose.yml`: Box3balans met een eigen PostgreSQL). De variant met **één container** (`docker-compose.lite.yml`) is handig om het uit te proberen of op een laptop.

> **Map voor back-ups.** In `docker-compose.yml` staat `./backups:/backups`: de back-ups komen in een map `backups` naast het compose-bestand. Plak je het compose-bestand in de webinterface van je NAS, vervang `./backups` dan door een volledig pad (bijvoorbeeld `/volume1/docker/box3balans/backups`), zodat je zeker weet waar ze terechtkomen. Zet die map in de back-uptool van je NAS.

Na de installatie: zet `BACKUP_PASSPHRASE` (versleutelde back-ups) en, als je de back-upbestanden zelf wilt openen, `PUID`/`PGID` op je eigen gebruiker. Zie de [README](../README.md#installeren).

## Synology (DSM 7.2 of nieuwer)

1. Installeer **Container Manager** via het Package Center.
2. Maak in File Station een map, bijvoorbeeld `docker/box3balans`, en daarin een map `backups`.
3. Zet `docker-compose.yml` in `docker/box3balans`. Verander de regel `./backups:/backups` in `/volume1/docker/box3balans/backups:/backups` (pas `volume1` aan als je gedeelde map op een ander volume staat). Wil je instellingen meegeven, zet dan ook een `.env` in die map.
4. Open Container Manager → **Project** → **Create**. Geef als naam `box3balans`, kies de map `docker/box3balans` en gebruik het bestaande `docker-compose.yml`. Rond de wizard af; Container Manager downloadt de images en start het project.
5. Open `http://<ip-van-je-nas>:8080`.

**Gebruikers-id:** Synology-gebruikers hebben vaak `PUID=1026` en `PGID=100`. Je ziet ze via SSH met het commando `id` (SSH zet je aan onder Configuratiescherm → Terminal & SNMP). Hyper Backup draait met beheerrechten en kan de map `backups` hoe dan ook meenemen.

**Bijwerken:** log in via SSH en voer uit:

```bash
cd /volume1/docker/box3balans
sudo docker compose pull
sudo docker compose up -d
```

## QNAP (Container Station 3)

1. Installeer **Container Station** via het App Center.
2. Maak een gedeelde map voor de back-ups, bijvoorbeeld `/share/Container/box3balans/backups`.
3. Open Container Station → **Applications** → **Create**. Geef als naam `box3balans` en plak de inhoud van `docker-compose.yml`. Verander `./backups:/backups` in `/share/Container/box3balans/backups:/backups`. Instellingen uit `.env.example` zet je onder `environment:` van de `app`-service, bijvoorbeeld `BACKUP_PASSPHRASE: "vier willekeurige woorden hier"` in plaats van `BACKUP_PASSPHRASE: ${BACKUP_PASSPHRASE:-}`.
4. Kies **Create** en open daarna `http://<ip-van-je-nas>:8080`.

## Unraid

Er is een sjabloon voor Community Applications ([`deploy/unraid/box3balans.xml`](../deploy/unraid/box3balans.xml)): één container met de ingebouwde database, als gebruiker `99` en groep `100`. Zodra Box3balans in **Apps** staat, zoek je daar op _Box3balans_, vul je eventueel een back-upwachtwoord in en kies je **Apply**. Tot die tijd, of als je liever PostgreSQL als aparte database hebt, gaat het zo:

1. Installeer via **Apps** (Community Applications) de plug-in **Docker Compose Manager**.
2. Ga naar **Docker** → **Compose** → **Add New Stack**, noem hem `box3balans` en plak de inhoud van `docker-compose.yml` bij **Edit Stack → Compose File**.
3. Verander `./backups:/backups` in `/mnt/user/appdata/box3balans/backups:/backups`. Unraid gebruikt meestal `PUID=99` en `PGID=100`; zet die bij **Edit Stack → Env File**, met eventueel je andere instellingen.
4. Kies **Compose Up** en open `http://<ip-van-je-server>:8080`.

## TrueNAS SCALE (24.10 of nieuwer)

1. Maak een dataset voor de back-ups, bijvoorbeeld `/mnt/tank/box3balans/backups`.
2. Ga naar **Apps** → **Discover Apps** → het menu (⋮) → **Install via YAML**.
3. Geef als naam `box3balans` en plak de inhoud van `docker-compose.yml`. Verander `./backups:/backups` in `/mnt/tank/box3balans/backups:/backups` en zet de instellingen die je wilt direct onder `environment:` (zoals bij QNAP hierboven). TrueNAS-apps draaien vaak als gebruiker `568`; zet `PUID: "568"` en `PGID: "568"`, of je eigen gebruiker.
4. Sla op en open `http://<ip-van-je-server>:8080`.

## CasaOS en ZimaOS

1. Open de **App Store** en kies rechtsboven **Custom Install** (het plusje), en dan **Import**.
2. Plak de inhoud van [`deploy/casaos/docker-compose.yml`](../deploy/casaos/docker-compose.yml) en kies **Submit**.
3. Vul eventueel een back-upwachtwoord in (`BACKUP_PASSPHRASE`) en kies **Install**.
4. Open `http://<ip-van-je-server>:8080`. De database en de sleutel staan in `/DATA/AppData/box3balans/data`, de back-ups in `/DATA/AppData/box3balans/backups`.

Dit is de variant met één container en de ingebouwde database, net als `docker-compose.lite.yml`.

## Raspberry Pi 4 of 5

Gebruik de **64-bit**-versie van Raspberry Pi OS, en bij voorkeur een SSD in plaats van een SD-kaart: een database schrijft vaak, en SD-kaarten slijten daarvan.

```bash
curl -fsSL https://get.docker.com | sh       # installeert Docker en Docker Compose
sudo usermod -aG docker $USER                # Docker zonder sudo; log daarna opnieuw in
mkdir ~/box3balans && cd ~/box3balans
curl -fsSLO https://raw.githubusercontent.com/zenonymous/box3balans/main/docker-compose.yml
docker compose up -d
```

Open `http://<ip-van-je-pi>:8080`.

## Linux-server (Debian, Ubuntu en andere)

Installeer Docker Engine met de Compose-plug-in volgens [de handleiding van Docker](https://docs.docker.com/engine/install/), en volg dan de stappen in de [README](../README.md#installeren).

## Windows of Mac met Docker Desktop

1. Installeer [Docker Desktop](https://www.docker.com/products/docker-desktop/) en start het.
2. Maak een map, bijvoorbeeld `box3balans` in je documenten, en zet `docker-compose.lite.yml` erin (download het bestand via de link, of met `curl -fsSLO https://raw.githubusercontent.com/zenonymous/box3balans/main/docker-compose.lite.yml`; gebruik op Windows `curl.exe`).
3. Open een terminal (op Windows PowerShell) in die map en voer uit:

   ```bash
   docker compose -f docker-compose.lite.yml up -d
   ```

4. Open `http://localhost:8080`.

Een laptop staat niet altijd aan: zolang hij slaapt, worden koersen en koppelingen niet bijgewerkt en maakt Box3balans geen automatische back-ups. Dat haalt het in zodra hij weer aan staat. Wil je Box3balans altijd bereikbaar hebben, zet het dan op een NAS of thuisserver: met een back-up en terugzetten neem je je gegevens mee.

## Na de installatie

- **Toegang buitenshuis:** gebruik een VPN, zie de [README](../README.md#toegang-buitenshuis-vpn). Zet poort 8080 niet open in je router.
- **Bijwerken:** `docker compose pull && docker compose up -d` (met `-f docker-compose.lite.yml` voor de variant met één container).
- **Problemen:** `docker compose logs app --tail 50`, en de tabel [Problemen oplossen](../README.md#problemen-oplossen). Kom je er niet uit, stel je vraag dan bij [Discussions](https://github.com/zenonymous/box3balans/discussions/categories/q-a). Is er iets kapot, open dan [een issue](https://github.com/zenonymous/box3balans/issues/new/choose).
