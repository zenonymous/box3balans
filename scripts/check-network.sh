#!/usr/bin/env bash
# Runs Box3balans in the shielded setup (deploy/egress: no internet of its own, a Squid proxy that only
# lets the listed hosts through) and uses it a little: an account with the setup code, a stock and a
# coin, a price refresh. Then checks that every connection went to a host on the list: none refused
# by the proxy, none refused by the app itself (docs/privacy.md).
#
#   scripts/check-network.sh            builds the image from this checkout
#   scripts/check-network.sh <image>    uses that image (e.g. ghcr.io/zenonymous/box3balans:edge)
#
# Needs Docker with Compose, curl and python3. Uses the internet (the listed hosts) through the proxy.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
project=b3b-network-check
port=18089
image=${1:-}

if [ -z "$image" ]; then
  image=ghcr.io/zenonymous/box3balans:network-check
  docker build -q -t "$image" "$root" >/dev/null
fi

cp "$root"/deploy/egress/{docker-compose.yml,squid.conf,allowed-hosts.txt} "$work/"
# The compose file names ghcr.io/zenonymous/box3balans:<version>; point it at the image to check.
sed -i.bak "s#image: ghcr.io/zenonymous/box3balans:.*#image: ${image}#" "$work/docker-compose.yml"
dc() { (cd "$work" && HTTP_PORT=$port docker compose -p "$project" "$@"); }
cleanup() {
  dc down -v >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

dc up -d >/dev/null 2>&1
base="http://127.0.0.1:$port"
for _ in $(seq 1 90); do
  curl -fs -o /dev/null "$base/api/health" && break
  sleep 2
done
curl -fs -o /dev/null "$base/api/health" || { echo "Box3balans didn't start"; dc logs; exit 1; }

code=$(dc logs app 2>&1 | grep -o 'setup code: [A-Z0-9-]*' | tail -1 | cut -d' ' -f3)
[ -n "$code" ] || { echo "No setup code in the log"; exit 1; }
jar="$work/cookies"
api() { curl -fs -b "$jar" -c "$jar" -H 'x-requested-with: portfolio' -H 'content-type: application/json' "$@"; }
api -X POST "$base/api/auth/setup" -d "{\"username\":\"check\",\"password\":\"network-check-$RANDOM-$RANDOM\",\"setupCode\":\"$code\"}" >/dev/null
# A stock (Yahoo) and a coin (CoinGecko); their prices may be unavailable, that's not what's checked.
api -X POST "$base/api/assets" -d '{"assetClass":"etf","name":"iShares Core MSCI World","symbol":"IWDA","priceSource":"yahoo","priceRef":"IWDA.AS"}' >/dev/null || true
api -X POST "$base/api/assets" -d '{"assetClass":"crypto","name":"Bitcoin","symbol":"BTC","priceSource":"coingecko","priceRef":"bitcoin"}' >/dev/null || true
api -X POST "$base/api/prices/refresh" -d '{}' >/dev/null || true

api "$base/api/network" >"$work/network.json"
# Squid logs a tunnel when it closes, and the app keeps its connections open: stop the app first.
dc stop app >/dev/null 2>&1
sleep 3
dc logs proxy >"$work/proxy.log" 2>&1

python3 - "$work/network.json" "$work/proxy.log" "$work/allowed-hosts.txt" <<'EOF'
import json, re, sys
network = json.load(open(sys.argv[1]))
proxy = open(sys.argv[2]).read().splitlines()
allowed = [l.strip() for l in open(sys.argv[3]) if l.strip() and not l.startswith("#")]
ok_host = lambda h: any(h == a or (a.startswith(".") and (h == a[1:] or h.endswith(a))) for a in allowed)
problems = []
# The app's own guard refused nothing, and recorded only listed hosts.
for b in network["blocked"]:
    problems.append(f"the app refused {b['method']} {b['host']}{b['what']}")
sent = {r["host"].split(":")[0] for r in network["recent"]}
problems += [f"the app contacted {h}, which isn't listed" for h in sorted(sent) if not ok_host(h)]
# The proxy refused nothing, and every tunnel went to a listed host.
tunnels = []
for line in proxy:
    m = re.search(r" ([A-Z_]+)/(\d+) \d+ CONNECT ([^ :]+):(\d+)", line)
    if m:
        tunnels.append(m.group(3))
        if "DENIED" in m.group(1) or not ok_host(m.group(3)):
            problems.append(f"the proxy saw {m.group(1)} for {m.group(3)}:{m.group(4)}")
    elif "TCP_DENIED" in line:
        problems.append("the proxy refused: " + line.strip()[-120:])
if not tunnels:
    problems.append("no connection went out through the proxy at all: nothing was checked")
print(f"Hosts contacted: {', '.join(sorted(set(tunnels)))}")
if problems:
    print("\n".join("PROBLEM: " + p for p in problems))
    sys.exit(1)
print("Every connection went to a host on the list.")
EOF
