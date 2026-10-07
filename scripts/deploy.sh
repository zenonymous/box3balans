#!/usr/bin/env bash
# For running your own changes: copies the last commit to a server over SSH and builds and starts
# it there (instead of downloading the published image).
#
#   scripts/deploy.sh user@nas [folder-on-nas]        # folder defaults to "box3balans" in your home
#                                                     # ("kluishuis" for an install from before the rename)
#   DOCKER="sudo docker" scripts/deploy.sh user@nas   # when docker needs sudo (e.g. Synology)
#
# Only committed files are sent: never .env, the database or backups. The server keeps its own
# .env and data; code folders (server, web, docs) are replaced so deleted files don't linger.
set -euo pipefail

host=${1:?"Usage: scripts/deploy.sh user@nas [folder-on-nas]"}
dir=${2:-}
docker=${DOCKER:-docker}
if [[ -z $dir ]]; then
  # An install from before the rename to Box3balans lives in ~/kluishuis; keep updating that one.
  dir=$(ssh "$host" '[ -f kluishuis/docker-compose.yml ] && echo kluishuis || echo box3balans')
fi
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
  # Also a folder from before the rename (Kluishuis).
  if [ -n \"\$(ls -A)\" ] && ! grep -qsE '^name: (box3balans|kluishuis)' docker-compose.yml; then
    echo 'Refusing: $dir is not empty and is not a Box3balans folder.' >&2
    exit 1
  fi
  # An install from before the rename keeps its Docker project (volumes) and database names.
  if grep -qs '^name: kluishuis' docker-compose.yml && ! grep -qs '^COMPOSE_PROJECT_NAME=' .env; then
    printf '\\n# Van voor de naamswijziging (Kluishuis): zo blijven de bestaande gegevens in gebruik.\\n' >> .env
    echo 'COMPOSE_PROJECT_NAME=kluishuis' >> .env
    grep -qs '^DB_NAME=' .env || echo 'DB_NAME=kluishuis' >> .env
    echo 'Added COMPOSE_PROJECT_NAME=kluishuis and DB_NAME=kluishuis to $dir/.env, so this install keeps its data.'
  fi
  rm -rf server web docs
  tar -xf -"

ssh -t "$host" "set -e; cd '$dir'
  # The Kluishuis install's data is in kluishuis_* volumes; a new folder would start empty next to it.
  if $docker volume ls -q | grep -qx 'kluishuis_db-data' && ! grep -qs '^COMPOSE_PROJECT_NAME=' .env; then
    echo 'This server already has Box3balans installed under its earlier name, Kluishuis.' >&2
    echo 'To update it, deploy to its folder: scripts/deploy.sh $host kluishuis' >&2
    echo 'To start a separate, empty install anyway, put COMPOSE_PROJECT_NAME=box3balans in $dir/.env.' >&2
    exit 1
  fi
  $docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
  $docker compose -f docker-compose.yml -f docker-compose.build.yml ps"
