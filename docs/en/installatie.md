# Installing Box3balans

_Nederlands: [installatie.md](../installatie.md)_

Box3balans runs in Docker. Below, per system, how to install it. The idea is the same everywhere:

1. A folder containing [`docker-compose.yml`](../../docker-compose.yml), and optionally a `.env` with your settings ([`.env.example`](../../.env.example) shows what's possible).
2. `docker compose up -d`, or the equivalent in your NAS's app.
3. Open `http://<address-of-your-server>:8080` and create your user, with the **setup code** from the app's log (`docker compose logs app`, or the container's log in your NAS's app). _Get started_ then helps you on your way; also turn on two-step verification under _Settings_.

Want to look around first without setting anything up? Start the demo: `docker run --rm -p 8080:8080 -e DEMO=true ghcr.io/zenonymous/box3balans:latest`.

If in doubt, choose the **standard setup** (`docker-compose.yml`: Box3balans with its own PostgreSQL). The **single-container** variant (`docker-compose.lite.yml`) is handy for trying it out or on a laptop.

> **Backup folder.** `docker-compose.yml` contains `./backups:/backups`: the backups go into a `backups` folder next to the compose file. If you paste the compose file into your NAS's web interface, replace `./backups` with a full path (for example `/volume1/docker/box3balans/backups`), so you know for sure where they end up. Include that folder in your NAS's backup tool.

After installing: put your backups' passphrase in your password manager (_Settings → Backups_; backups are encrypted by default) and, if you want to open the backup files yourself, set `PUID`/`PGID` to your own user. See the [README](../../README.en.md#installing).

## Synology (DSM 7.2 or newer)

1. Install **Container Manager** from the Package Center.
2. In File Station, create a folder, for example `docker/box3balans`, with a `backups` folder inside.
3. Put `docker-compose.yml` in `docker/box3balans`. Change the line `./backups:/backups` to `/volume1/docker/box3balans/backups:/backups` (adjust `volume1` if your shared folder is on another volume). If you want to pass settings, also put a `.env` in that folder.
4. Open Container Manager → **Project** → **Create**. Name it `box3balans`, choose the `docker/box3balans` folder and use the existing `docker-compose.yml`. Finish the wizard; Container Manager downloads the images and starts the project.
5. Open `http://<ip-of-your-nas>:8080`.

**User ID:** Synology users often have `PUID=1026` and `PGID=100`. You can see them over SSH with the `id` command (turn SSH on under Control Panel → Terminal & SNMP). Hyper Backup runs with admin rights and can include the `backups` folder either way.

**Updating:** log in over SSH and run:

```bash
cd /volume1/docker/box3balans
sudo docker compose pull
sudo docker compose up -d
```

## QNAP (Container Station 3)

1. Install **Container Station** from the App Center.
2. Create a shared folder for the backups, for example `/share/Container/box3balans/backups`.
3. Open Container Station → **Applications** → **Create**. Name it `box3balans` and paste the contents of `docker-compose.yml`. Change `./backups:/backups` to `/share/Container/box3balans/backups:/backups`. Settings from `.env.example` go under `environment:` of the `app` service, for example `BACKUP_PASSPHRASE: "four random words here"` instead of `BACKUP_PASSPHRASE: ${BACKUP_PASSPHRASE:-}`.
4. Choose **Create** and then open `http://<ip-of-your-nas>:8080`.

## Unraid

There's a template for Community Applications ([`deploy/unraid/box3balans.xml`](../../deploy/unraid/box3balans.xml)): one container with the built-in database, as user `99` and group `100`. Once Box3balans is listed in **Apps**, search there for _Box3balans_, optionally fill in a backup passphrase and choose **Apply**. Until then, or if you'd rather have PostgreSQL as a separate database, do this:

1. Install the **Docker Compose Manager** plugin via **Apps** (Community Applications).
2. Go to **Docker** → **Compose** → **Add New Stack**, name it `box3balans` and paste the contents of `docker-compose.yml` under **Edit Stack → Compose File**.
3. Change `./backups:/backups` to `/mnt/user/appdata/box3balans/backups:/backups`. Unraid usually uses `PUID=99` and `PGID=100`; set those under **Edit Stack → Env File**, with any other settings you want.
4. Choose **Compose Up** and open `http://<ip-of-your-server>:8080`.

## TrueNAS SCALE (24.10 or newer)

1. Create a dataset for the backups, for example `/mnt/tank/box3balans/backups`.
2. Go to **Apps** → **Discover Apps** → the menu (⋮) → **Install via YAML**.
3. Name it `box3balans` and paste the contents of `docker-compose.yml`. Change `./backups:/backups` to `/mnt/tank/box3balans/backups:/backups` and put the settings you want directly under `environment:` (as for QNAP above). TrueNAS apps often run as user `568`; set `PUID: "568"` and `PGID: "568"`, or your own user.
4. Save and open `http://<ip-of-your-server>:8080`.

## CasaOS and ZimaOS

1. Open the **App Store** and choose **Custom Install** (the plus sign) at the top right, then **Import**.
2. Paste the contents of [`deploy/casaos/docker-compose.yml`](../../deploy/casaos/docker-compose.yml) and choose **Submit**.
3. Optionally fill in your own passphrase for the backups (`BACKUP_PASSPHRASE`; leaving it empty is fine, Box3balans then makes one) and choose **Install**.
4. Open `http://<ip-of-your-server>:8080`. The database and the key are in `/DATA/AppData/box3balans/data`, the backups in `/DATA/AppData/box3balans/backups`.

This is the single-container variant with the built-in database, just like `docker-compose.lite.yml`.

## Raspberry Pi 4 or 5

Use the **64-bit** version of Raspberry Pi OS, and preferably an SSD instead of an SD card: a database writes often, and SD cards wear out from that.

```bash
curl -fsSL https://get.docker.com | sh       # installs Docker and Docker Compose
sudo usermod -aG docker $USER                # Docker without sudo; log in again afterwards
mkdir ~/box3balans && cd ~/box3balans
curl -fsSLO https://raw.githubusercontent.com/zenonymous/box3balans/main/docker-compose.yml
docker compose up -d
```

Open `http://<ip-of-your-pi>:8080`.

## Linux server (Debian, Ubuntu and others)

Install Docker Engine with the Compose plugin following [Docker's guide](https://docs.docker.com/engine/install/), then follow the steps in the [README](../../README.en.md#installing).

## Windows or Mac with Docker Desktop

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it.
2. Create a folder, for example `box3balans` in your documents, and put `docker-compose.lite.yml` in it (download the file via the link, or with `curl -fsSLO https://raw.githubusercontent.com/zenonymous/box3balans/main/docker-compose.lite.yml`; on Windows use `curl.exe`).
3. Open a terminal (PowerShell on Windows) in that folder and run:

   ```bash
   docker compose -f docker-compose.lite.yml up -d
   ```

4. Open `http://localhost:8080`.

A laptop isn't always on: while it sleeps, prices and connections aren't updated and Box3balans makes no automatic backups. It catches up as soon as it's on again. If you want Box3balans always reachable, put it on a NAS or home server: a backup and restore takes your data along.

## After installing

- **The setup code:** on first start Box3balans writes a one-time code to its log (`No account yet … setup code: K7QX2-MPF9R`); the screen where you create your user asks for it. That way nobody else on your network can take over a new installation. Every restart while there's no user yet gives a new one. You can also set your own code with `SETUP_CODE` in `.env`.
- **Extra sealed off (optional):** run Box3balans without its own internet access, with a proxy that only lets through the hosts on the list; see [What Box3balans sends](privacy.md#running-it-sealed-off).
- **Access away from home:** use a VPN, see the [README](../../README.en.md#access-away-from-home-vpn). Don't open port 8080 in your router.
- **A server with a public address** (a VPS): Docker opens a published port bypassing a firewall such as ufw. Set `HTTP_BIND=127.0.0.1` in `.env` there and reach Box3balans through a VPN or a reverse proxy on that server.
- **Updating:** `docker compose pull && docker compose up -d` (with `-f docker-compose.lite.yml` for the single-container variant).
- **Problems:** `docker compose logs app --tail 50`, and the [Troubleshooting](../../README.en.md#troubleshooting) table. If you can't figure it out, ask your question in [Discussions](https://github.com/zenonymous/box3balans/discussions/categories/q-a). If something is broken, open [an issue](https://github.com/zenonymous/box3balans/issues/new/choose).
