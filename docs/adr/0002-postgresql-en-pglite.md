# PostgreSQL, met PGlite als ingebouwde variant

_English: [../en/adr/0002-postgresql-en-pglite.md](../en/adr/0002-postgresql-en-pglite.md)_

Bedragen en hoeveelheden moeten exact zijn (`NUMERIC`), en wie een NAS heeft, draait makkelijk een tweede container. De gewone installatie gebruikt daarom PostgreSQL in Docker Compose. Om het uit te proberen, op een laptop, bij het ontwikkelen en in de tests draait dezelfde database als PGlite in het proces zelf, met dezelfde migraties. Zo is er één schema en één set queries, en hebben tests en ontwikkelaars geen Docker nodig. Wat PGlite niet kan, gebruikt de code dus niet.
