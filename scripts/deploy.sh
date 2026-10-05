#!/usr/bin/env bash
# Copies the last commit to the NAS over SSH and (re)builds and starts it there.
#
#   scripts/deploy.sh user@nas [folder-on-nas]        # folder defaults to "kluishuis" in your home
#   DOCKER="sudo docker" scripts/deploy.sh user@nas   # when docker needs sudo (e.g. Synology)
#
# Only committed files are sent: never .env, the database or backups. The NAS keeps its own .env
# and data; code folders (server, web, docs) are replaced so deleted files don't linger.
set -euo pipefail

host=${1:?"Usage: scripts/deploy.sh user@nas [folder-on-nas]"}
dir=${2:-kluishuis}
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
  if [ -n \"\$(ls -A)\" ] && ! grep -qs '^name: kluishuis' docker-compose.yml; then
    echo 'Refusing: $dir is not empty and is not a Kluishuis folder.' >&2
    exit 1
  fi
  rm -rf server web docs
  tar -xf -"

ssh -t "$host" "set -e; cd '$dir'
  if [ ! -f .env ]; then
    echo 'Code copied. First deploy: create $dir/.env from .env.example (see README), then run:'
    echo '  cd $dir && $docker compose up -d --build'
    exit 0
  fi
  $docker compose up -d --build
  $docker compose ps"
