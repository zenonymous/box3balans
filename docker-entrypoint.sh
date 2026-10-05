#!/bin/sh
# Starts as root only to give the backup folder to the app's user, then drops privileges.
# PUID/PGID (default 1000) let backups on a host folder belong to your NAS user.
set -e
uid="${PUID:-1000}"
gid="${PGID:-1000}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$BACKUP_DIR"
  chown -R "$uid:$gid" "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  exec su-exec "$uid:$gid" "$@"
fi
exec "$@"
