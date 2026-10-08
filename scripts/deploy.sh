#!/usr/bin/env bash
# For running your own changes: copies the last commit to a server over SSH and builds and starts
# it there (instead of downloading the published image).
#
#   scripts/deploy.sh user@nas [folder-on-nas]        # folder defaults to "box3balans" in your home
#   DOCKER="sudo docker" scripts/deploy.sh user@nas   # when docker needs sudo (e.g. Synology)
#
# Only committed files are sent: never .env, the database or backups. The server keeps its own
# .env and data; code folders (server, web, docs) are replaced so deleted files don't linger.
#
# $dir, $host and $docker are meant to expand here, before ssh sends the commands ($dir is checked below).
# shellcheck disable=SC2029
set -euo pipefail

host=${1:?"Usage: scripts/deploy.sh user@nas [folder-on-nas]"}
dir=${2:-box3balans}
docker=${DOCKER:-docker}
if [[ ! $dir =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Use a plain folder path (letters, digits, . _ - /), relative to your home or absolute." >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)"
if [[ -n $(git status --porcelain) ]]; then
  echo "Note: uncommitted changes are NOT deployed; only the last commit is." >&2
fi
echo "Deploying $(git log -1 --format='%h (%cs) %s') to $host:$dir"

git archive --format=tar HEAD | ssh "$host" "set -e
  mkdir -p '$dir' && cd '$dir'
  if [ -n \"\$(ls -A)\" ] && ! grep -qs '^name: box3balans' docker-compose.yml; then
    echo 'Refusing: $dir is not empty and is not a Box3balans folder.' >&2
    exit 1
  fi
  rm -rf server web docs
  tar -xf -"

ssh -t "$host" "set -e; cd '$dir'
  $docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
  $docker compose -f docker-compose.yml -f docker-compose.build.yml ps"
