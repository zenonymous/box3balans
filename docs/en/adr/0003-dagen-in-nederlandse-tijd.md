# Days are counted in the user's time zone, not in UTC

_Nederlands: [0003-dagen-in-nederlandse-tijd.md](../../adr/0003-dagen-in-nederlandse-tijd.md)_

A transaction at 00:30 on 1 January Dutch time is 23:30 on 31 December in UTC. For the reference date (peildatum) and for everything that counts per year or per day, it belongs to 1 January. All calendar days are therefore determined in the configured time zone (`TIME_ZONE`, Europe/Amsterdam by default), not in UTC and not in the server's time zone. `scripts/test-dates.sh` runs the tests at moments when the two differ.
