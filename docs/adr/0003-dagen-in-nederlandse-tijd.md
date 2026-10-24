# Dagen tellen in de tijdzone van de gebruiker, niet in UTC

_English: [../en/adr/0003-dagen-in-nederlandse-tijd.md](../en/adr/0003-dagen-in-nederlandse-tijd.md)_

Een transactie om 00:30 op 1 januari Nederlandse tijd is 23:30 op 31 december in UTC. Voor de peildatum en voor alles wat per jaar of per dag telt, hoort hij bij 1 januari. Alle kalenderdagen worden daarom bepaald in de ingestelde tijdzone (`TIME_ZONE`, standaard Europe/Amsterdam), niet in UTC en niet in de tijdzone van de server. `scripts/test-dates.sh` draait de tests op momenten waarop die twee verschillen.
