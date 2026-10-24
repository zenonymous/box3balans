# A fixed list of destinations, enforced in the app

_Nederlands: [0011-vaste-lijst-van-bestemmingen.md](../../adr/0011-vaste-lijst-van-bestemmingen.md)_

Box3balans may only connect to the hosts in [`server/src/lib/net.ts`](../../../server/src/lib/net.ts), per feature with what goes out. At startup a check is put in front of every `fetch` in the process: HTTPS only, hosts on the list only, and a redirect only if the new host is on it too. Everything else is refused. Every request is recorded for _Settings → Network_ (the latest in memory, counts per day for 90 days, the last 50 refusals).

Other ways out (`node:http`, `node:net`, `undici` and the like) are forbidden by a lint rule in `server/src`. A test fails if the code mentions a host that's not on the list, and keeps the list in line with [docs/privacy.md](../privacy.md) and with the list of the sealed-off setup ([`deploy/egress/allowed-hosts.txt`](../../../deploy/egress/allowed-hosts.txt)).

On the same page you switch destinations off (down to fully offline); the guard then refuses them, and price refreshes, price history and syncs skip them. A CI step (`scripts/check-network.sh`) runs the image of every change in the sealed-off setup and fails on a connection to a host that's not on the list.

That way someone who wants to check Box3balans can read one file instead of all the code, and a user sees in the app what was sent.

## Considered

- **Only documenting it:** honest, but not verifiable, and it goes out of date with every new price source.
- **Only the sealed-off setup (a proxy at network level):** the strongest, because it's independent of Box3balans's code, but an extra container not everyone wants. So it's optional, alongside: [docs/privacy.md](../privacy.md#running-it-sealed-off).
