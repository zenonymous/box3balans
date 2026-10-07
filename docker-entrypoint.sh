#!/bin/sh
# Prepares the data and backup folders, creates the secrets on first start, then runs the app as
# PUID:PGID (default 1000), so backups on a host folder belong to your NAS user.
#
# /data/app-secret   key that encrypts exchange API keys (unless APP_SECRET is set in .env)
# /data/db-password  password for the bundled PostgreSQL (unless POSTGRES_PASSWORD is set); the db
#                    container reads the same file when it creates the database
set -e
uid="${PUID:-1000}"
gid="${PGID:-1000}"
data="${DATA_DIR:-/data}"

random_hex() { node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'; }

# Writes a file in one go (write, then rename), so the database never reads half a password. The
# file starts out private (umask 077) and only then gets its final mode.
put() { (umask 077 && printf '%s' "$2" > "$1.tmp") && chmod "$3" "$1.tmp" && mv "$1.tmp" "$1"; }

prepare() {
  mkdir -p "$data" "$BACKUP_DIR"
  if [ -z "$APP_SECRET" ] && [ ! -s "$data/app-secret" ]; then
    put "$data/app-secret" "$(random_hex)" 600
    echo "Created an encryption key in $data/app-secret"
  fi
  # Only with the bundled PostgreSQL (PGHOST is set); without it the database lives in $data.
  if [ -n "$PGHOST" ]; then
    if [ -n "$POSTGRES_PASSWORD" ]; then
      put "$data/db-password" "$POSTGRES_PASSWORD" 644
    elif [ ! -s "$data/db-password" ]; then
      put "$data/db-password" "$(random_hex)" 644
      echo "Created a database password in $data/db-password"
    fi
  fi
}

if [ "$(id -u)" = "0" ]; then
  prepare
  chown "$uid:$gid" "$data"
  # The db container reads db-password as its own user, so the folder stays traversable.
  chmod 755 "$data"
  [ -f "$data/app-secret" ] && chown "$uid:$gid" "$data/app-secret"
  [ -d "$data/pglite" ] && chown -R "$uid:$gid" "$data/pglite"
  [ -f "$data/pglite.lock" ] && chown "$uid:$gid" "$data/pglite.lock"
  chown -R "$uid:$gid" "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  exec su-exec "$uid:$gid" "$@"
fi
prepare
exec "$@"
