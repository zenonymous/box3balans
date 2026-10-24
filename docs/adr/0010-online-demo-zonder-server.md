# De online demo draait zonder server

_English: [../en/adr/0010-online-demo-zonder-server.md](../en/adr/0010-online-demo-zonder-server.md)_

Op [box3balans.nl/demo](https://box3balans.nl/demo/) staat de demo zonder server. Bij elke release (en op 1 januari) start een workflow de gewone demo, vraagt hem alles wat de pagina's vragen, in het Nederlands en in het Engels, en zet die antwoorden naast een eigen bouw van de web-app (`vite build --mode online-demo`) in de map `demo/` op de branch `gh-pages`. In de browser beantwoordt `web/src/staticDemo.ts` de vragen van de app uit die opname; de transacties en de geschiedenis worden daar gefilterd zoals de server dat doet. Opslaan kan niet: de app zegt dan dat dat in de online demo niet gaat. Alleen de taal wisselt, door de andere opname te kiezen.

Zo is het echte uitvoer van de echte code, zonder server om te onderhouden, zonder kosten en zonder gegevens van wie dan ook. De landingspagina blijft zoals hij is ([ADR 0008](0008-landingspagina-op-gh-pages.md)): de workflow schrijft alleen in `demo/`, en het bouwen gebeurt in een aparte job zonder schrijfrechten.

## Overwogen

- **De echte demo op een gratis host** (Fly.io, Render, Hugging Face Spaces): alles werkt, maar alle bezoekers delen één huishouden (wie een rekening hernoemt, doet dat voor iedereen), gratis plannen slapen in, en het vraagt een account bij een host. Een eigen kopie per bezoeker is werk aan de server.
- **De hele app in de browser**, met PGlite: de database kan daar draaien, Fastify en `node:crypto` niet zonder veel nabootsen, en het wordt een download van meerdere MB.
- **Alleen schermafbeeldingen**: staan al in de README, maar je kunt er niet doorheen klikken.

Wat er niet in zit: vragen met vrij getypte invoer (een belegging zoeken, eigen aannames in de voorvertoning van 2028) en alles wat iets opslaat of inleest.
